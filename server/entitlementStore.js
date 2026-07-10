import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Entitlement persistence for the credit-based billing model.
//
//   • £10 one-time activation → account becomes 'active' and receives £1 of
//     AI token credit (creditPence = 100, measured in TOKEN VALUE).
//   • Further usage is bought at £2 per £1 of tokens: a top-up of X pence
//     grants X/2 pence of token credit.
//   • Every Claude call meters its real token cost and deducts it from
//     creditPence. When it runs out, paid AI routes 402 until a top-up.
//
// TWO BACKENDS, chosen automatically:
//   • Supabase (production): set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and
//     records live in an `entitlements` table keyed by the billing key (the
//     Supabase user id when logged in, else the anonymous clientId). This
//     SURVIVES redeploys — required before charging real money.
//   • Flat file (local dev): with no service-role key, records fall back to
//     server/.subscriptions.json. Fine for testing; resets on ephemeral hosts.
//
// Every export is async so callers `await` regardless of which backend is live.
const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '.subscriptions.json')

// ---- Backend selection ------------------------------------------------------
// The server can reuse the frontend's VITE_SUPABASE_URL (same project URL); the
// service-role key is server-only and must NEVER be exposed to the browser.
const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/$/, '')
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const useSupabase = !!(SB_URL && SB_KEY)

export const entitlementsBackend = useSupabase ? 'supabase' : 'file'

const REST = `${SB_URL}/rest/v1/entitlements`
const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

// ---- Shared shape -----------------------------------------------------------
function blank(clientId) {
  return {
    clientId,
    status: 'none', // 'none' | 'active'
    creditPence: 0, // remaining token credit, in pence of TOKEN VALUE
    usedPence: 0, // lifetime token value consumed
    paidPence: 0, // lifetime amount actually paid
    customerId: null,
    updatedAt: Date.now(),
  }
}

// DB rows are snake_case; the rest of the app speaks camelCase.
function fromRow(row) {
  if (!row) return null
  return {
    clientId: row.key,
    status: row.status || 'none',
    creditPence: Number(row.credit_pence) || 0,
    usedPence: Number(row.used_pence) || 0,
    paidPence: Number(row.paid_pence) || 0,
    customerId: row.customer_id ?? null,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
  }
}

// ---- Flat-file backend ------------------------------------------------------
function readAll() {
  if (!existsSync(FILE)) return {}
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}
function writeAll(data) {
  writeFileSync(FILE, JSON.stringify(data, null, 2))
}

// ---- Supabase backend -------------------------------------------------------
async function sbGet(key) {
  const url = `${REST}?key=eq.${encodeURIComponent(key)}&select=*`
  const r = await fetch(url, { headers: sbHeaders })
  if (!r.ok) throw new Error(`entitlement read failed: ${r.status} ${await r.text()}`)
  const rows = await r.json()
  return fromRow(rows[0])
}

async function sbWrite(rec) {
  const row = {
    key: rec.clientId,
    status: rec.status,
    credit_pence: rec.creditPence,
    used_pence: rec.usedPence,
    paid_pence: rec.paidPence,
    customer_id: rec.customerId,
    updated_at: new Date(rec.updatedAt).toISOString(),
  }
  // Upsert on the primary key. resolution=merge-duplicates makes the POST an
  // insert-or-update; we've already merged the new values in `mutate`.
  const r = await fetch(REST, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row]),
  })
  if (!r.ok) throw new Error(`entitlement write failed: ${r.status} ${await r.text()}`)
}

// ---- Public API (async) -----------------------------------------------------
export async function getEntitlement(clientId) {
  if (!clientId) return null
  if (useSupabase) return sbGet(clientId)
  const rec = readAll()[clientId]
  return rec ? { ...blank(clientId), ...rec } : null
}

export async function isActive(clientId) {
  const e = await getEntitlement(clientId)
  return !!e && e.status === 'active'
}

export async function hasCredit(clientId) {
  const e = await getEntitlement(clientId)
  return !!e && e.creditPence > 0
}

// Read-modify-write. Per-user concurrency is effectively serial (a user waits
// for each AI response), so a full atomic upsert isn't needed here.
async function mutate(clientId, fn) {
  if (!clientId) return null
  const cur = (await getEntitlement(clientId)) || blank(clientId)
  const next = { ...cur, ...fn(cur), clientId, updatedAt: Date.now() }
  if (useSupabase) {
    await sbWrite(next)
  } else {
    const all = readAll()
    all[clientId] = next
    writeAll(all)
  }
  return next
}

// £10 activation: mark active and grant the included token credit.
export function activate(clientId, { customerId, creditPence, paidPence }) {
  return mutate(clientId, (rec) => ({
    status: 'active',
    customerId: customerId ?? rec.customerId,
    creditPence: rec.creditPence + creditPence,
    paidPence: rec.paidPence + (paidPence ?? 0),
  }))
}

// Top-up: paid amount already converted to token credit by the caller.
export function addCredit(clientId, creditPence, paidPence = 0) {
  return mutate(clientId, (rec) => ({
    creditPence: rec.creditPence + creditPence,
    paidPence: rec.paidPence + paidPence,
  }))
}

// Meter one Claude call. Records lifetime usage always; the credit balance can
// dip slightly negative on the call that exhausts it — the next call is blocked.
export function recordUsage(clientId, costPence) {
  if (!clientId || !(costPence > 0)) return Promise.resolve(null)
  return mutate(clientId, (rec) => ({
    usedPence: rec.usedPence + costPence,
    creditPence: rec.creditPence - costPence,
  }))
}
