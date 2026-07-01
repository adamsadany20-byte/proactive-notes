import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Dev-grade single-file subscription persistence, mirroring tokenStore.js. Each
// record is keyed by the client's stable anonymous id (generated in the browser
// and sent with requests). For a real multi-user product this becomes a users
// table keyed by an authenticated account, not a flat JSON file — but the shape
// here (clientId -> { status, customerId, subscriptionId }) maps straight onto
// that later.
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

export function getEntitlement(clientId) {
  if (!clientId) return null
  return readAll()[clientId] || null
}

// Active = a live, paying subscription. Stripe statuses 'active' and 'trialing'
// both grant access; everything else (canceled, past_due, unpaid…) does not.
export function isSubscribed(clientId) {
  const e = getEntitlement(clientId)
  return !!e && (e.status === 'active' || e.status === 'trialing')
}

export function setEntitlement(clientId, patch) {
  if (!clientId) return null
  const all = readAll()
  all[clientId] = {
    ...(all[clientId] || {}),
    ...patch,
    clientId,
    updatedAt: Date.now(),
  }
  writeAll(all)
  return all[clientId]
}

// Webhooks for subscription changes carry the Stripe customer id, not our
// clientId, so we look the record up by customer to update its status.
export function setStatusByCustomer(customerId, status) {
  if (!customerId) return null
  const all = readAll()
  const rec = Object.values(all).find((e) => e.customerId === customerId)
  if (!rec) return null
  all[rec.clientId] = { ...rec, status, updatedAt: Date.now() }
  writeAll(all)
  return all[rec.clientId]
}
