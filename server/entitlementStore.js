import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Dev-grade single-file entitlement persistence, mirroring tokenStore.js.
//
// Billing model (credit-based, not a subscription):
//   • £10 one-time activation → account becomes 'active' and receives £1 of
//     AI token credit (creditPence = 100, measured in TOKEN VALUE).
//   • Further usage is bought at £2 per £1 of tokens: a top-up of X pence
//     grants X/2 pence of token credit.
//   • Every Claude call meters its real token cost and deducts it from
//     creditPence. When it runs out, paid AI routes 402 until a top-up.
//
// Each record is keyed by the client's stable anonymous id (generated in the
// browser). For a real multi-user product this becomes a users table keyed by
// an authenticated account — the shape maps straight onto that later.
const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '.subscriptions.json')

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

export function getEntitlement(clientId) {
  if (!clientId) return null
  const rec = readAll()[clientId]
  return rec ? { ...blank(clientId), ...rec } : null
}

export function isActive(clientId) {
  const e = getEntitlement(clientId)
  return !!e && e.status === 'active'
}

export function hasCredit(clientId) {
  const e = getEntitlement(clientId)
  return !!e && e.creditPence > 0
}

function patch(clientId, fn) {
  if (!clientId) return null
  const all = readAll()
  const rec = { ...blank(clientId), ...(all[clientId] || {}) }
  const next = { ...rec, ...fn(rec), clientId, updatedAt: Date.now() }
  all[clientId] = next
  writeAll(all)
  return next
}

// £10 activation: mark active and grant the included token credit.
export function activate(clientId, { customerId, creditPence, paidPence }) {
  return patch(clientId, (rec) => ({
    status: 'active',
    customerId: customerId ?? rec.customerId,
    creditPence: rec.creditPence + creditPence,
    paidPence: rec.paidPence + (paidPence ?? 0),
  }))
}

// Top-up: paid amount already converted to token credit by the caller.
export function addCredit(clientId, creditPence, paidPence = 0) {
  return patch(clientId, (rec) => ({
    creditPence: rec.creditPence + creditPence,
    paidPence: rec.paidPence + paidPence,
  }))
}

// Meter one Claude call. Records lifetime usage always; the credit balance can
// dip slightly negative on the call that exhausts it — the next call is blocked.
export function recordUsage(clientId, costPence) {
  if (!clientId || !(costPence > 0)) return null
  return patch(clientId, (rec) => ({
    usedPence: rec.usedPence + costPence,
    creditPence: rec.creditPence - costPence,
  }))
}
