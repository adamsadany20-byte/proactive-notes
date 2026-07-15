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
// The model is now recurring SUBSCRIPTIONS with two independently-metered usage
// pools, reset each billing cycle:
//   • plan 'classifier' — £2/mo, includes £1 of classifier usage.
//   • plan 'evolve'     — £12/mo, includes £5 of coding+world-knowledge ('ai'
//     pool) AND £1 of classifier usage, metered separately.
// Each pool bills overage at 2p per 1p beyond its included allowance. The
// included amounts live server-side (index.js); the store only tracks usage.
// Legacy credit fields (creditPence) are kept for back-compat but unused here.
function blank(clientId) {
  return {
    clientId,
    status: 'none', // 'none' | 'active' — active whenever a plan is live
    plan: 'none', // 'none' | 'classifier' | 'evolve'
    aiUsedPence: 0, // coding + world-knowledge usage THIS cycle (token value)
    classifierUsedPence: 0, // classifier usage THIS cycle (token value)
    periodStart: 0, // current billing-cycle start (ms)
    periodEnd: 0, // current billing-cycle end (ms)
    subscriptionId: null, // Stripe subscription id
    creditPence: 0, // legacy (one-time credit model) — unused under subscriptions
    usedPence: 0, // lifetime token value consumed (all pools)
    paidPence: 0, // lifetime amount actually paid
    capPence: 0, // user-set spend limit on overage (0 = no limit)
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
    plan: row.plan || 'none',
    aiUsedPence: Number(row.ai_used_pence) || 0,
    classifierUsedPence: Number(row.classifier_used_pence) || 0,
    periodStart: row.period_start ? Date.parse(row.period_start) : 0,
    periodEnd: row.period_end ? Date.parse(row.period_end) : 0,
    subscriptionId: row.subscription_id ?? null,
    creditPence: Number(row.credit_pence) || 0,
    usedPence: Number(row.used_pence) || 0,
    paidPence: Number(row.paid_pence) || 0,
    capPence: Number(row.cap_pence) || 0,
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
    plan: rec.plan,
    ai_used_pence: rec.aiUsedPence,
    classifier_used_pence: rec.classifierUsedPence,
    period_start: rec.periodStart ? new Date(rec.periodStart).toISOString() : null,
    period_end: rec.periodEnd ? new Date(rec.periodEnd).toISOString() : null,
    subscription_id: rec.subscriptionId,
    credit_pence: rec.creditPence,
    used_pence: rec.usedPence,
    paid_pence: rec.paidPence,
    cap_pence: rec.capPence,
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

// ---- Subscription capability checks -----------------------------------------
// Which plan (if any) is live. Evolve includes the classifier capability.
export async function planOf(clientId) {
  const e = await getEntitlement(clientId)
  return e?.plan || 'none'
}
export async function hasClassifier(clientId) {
  const p = await planOf(clientId)
  return p === 'classifier' || p === 'evolve'
}
export async function hasEvolve(clientId) {
  return (await planOf(clientId)) === 'evolve'
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

// User-set lifetime spend limit (0 = no limit). Enforced at checkout so a user
// can't be charged past what they chose to spend. Creates a record if needed so
// a limit can be set before activation.
export function setCap(clientId, capPence) {
  return mutate(clientId, () => ({ capPence: Math.max(0, Number(capPence) || 0) }))
}

// Top-up: paid amount already converted to token credit by the caller.
export function addCredit(clientId, creditPence, paidPence = 0) {
  return mutate(clientId, (rec) => ({
    creditPence: rec.creditPence + creditPence,
    paidPence: rec.paidPence + paidPence,
  }))
}

// Meter one Claude call into a pool ('ai' or 'classifier'). Accumulates this
// cycle's pool usage (what overage is computed from at renewal) and the lifetime
// total. Also decrements the legacy credit balance so the old one-time model
// keeps working if a record still has credit.
export function recordUsage(clientId, costPence, pool = 'ai') {
  if (!clientId || !(costPence > 0)) return Promise.resolve(null)
  const field = pool === 'classifier' ? 'classifierUsedPence' : 'aiUsedPence'
  return mutate(clientId, (rec) => ({
    usedPence: rec.usedPence + costPence,
    creditPence: rec.creditPence - costPence,
    [field]: (rec[field] || 0) + costPence,
  }))
}

// ---- Subscription lifecycle -------------------------------------------------
// Start (or switch) a plan. Sets the billing-cycle window and zeroes both pools
// for the fresh cycle.
export function setSubscription(
  clientId,
  { plan, subscriptionId, customerId, periodStart, periodEnd, paidPence },
) {
  return mutate(clientId, (rec) => ({
    status: plan && plan !== 'none' ? 'active' : 'none',
    plan: plan || 'none',
    subscriptionId: subscriptionId ?? rec.subscriptionId,
    customerId: customerId ?? rec.customerId,
    periodStart: periodStart ?? rec.periodStart,
    periodEnd: periodEnd ?? rec.periodEnd,
    aiUsedPence: 0,
    classifierUsedPence: 0,
    paidPence: rec.paidPence + (paidPence ?? 0),
  }))
}

// Renew: advance the billing window and reset the metered pools for the new
// cycle. (Overage for the ENDING cycle is computed by the caller before this.)
export function resetCycle(clientId, { periodStart, periodEnd, paidPence } = {}) {
  return mutate(clientId, (rec) => ({
    periodStart: periodStart ?? rec.periodEnd,
    periodEnd: periodEnd ?? rec.periodEnd,
    aiUsedPence: 0,
    classifierUsedPence: 0,
    paidPence: rec.paidPence + (paidPence ?? 0),
  }))
}

// Subscription ended (cancelled / payment failed to the point of cancellation).
export function cancelSubscription(clientId) {
  return mutate(clientId, () => ({ status: 'none', plan: 'none', subscriptionId: null }))
}
