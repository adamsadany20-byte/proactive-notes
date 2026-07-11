import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Storage for Web Push targets — everything the server needs to fire a reminder
// notification at a device even when the site is closed.
//
// One record per billing key (the Supabase user id when logged in, else the
// anonymous clientId — same keying as the entitlement store):
//   {
//     key,
//     subscriptions: [ { endpoint, keys:{p256dh,auth}, ua, createdAt } ],
//       — a user may register several devices; each is one PushSubscription.
//     reminders: [ { id, title, target, mode, weekdays, time, sessionDates,
//                    completions } ]
//       — a compact projection of the client's reminders + which days are
//         already done, uploaded whenever they change. The cron sweep reads
//         this to decide what's due.
//     tzOffset: number   // minutes behind UTC (Date.getTimezoneOffset())
//     sent: { "reminderId@YYYY-MM-DD": epochMs }  // dedup, pruned to a few days
//     updatedAt
//   }
//
// TWO BACKENDS (auto-selected, mirroring entitlementStore):
//   • Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set — rows in a
//     `push_targets` table, survives redeploys.
//   • Flat file server/.push.json otherwise — fine for local dev.
const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '.push.json')

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/$/, '')
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const useSupabase = !!(SB_URL && SB_KEY)

export const pushBackend = useSupabase ? 'supabase' : 'file'

const REST = `${SB_URL}/rest/v1/push_targets`
const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

function blank(key) {
  return {
    key,
    subscriptions: [],
    reminders: [],
    tzOffset: 0,
    sent: {},
    updatedAt: Date.now(),
  }
}

function fromRow(row) {
  if (!row) return null
  return {
    key: row.key,
    subscriptions: row.subscriptions || [],
    reminders: row.reminders || [],
    tzOffset: Number(row.tz_offset) || 0,
    sent: row.sent || {},
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
  }
}
function toRow(rec) {
  return {
    key: rec.key,
    subscriptions: rec.subscriptions,
    reminders: rec.reminders,
    tz_offset: rec.tzOffset,
    sent: rec.sent,
    updated_at: new Date(rec.updatedAt).toISOString(),
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
  if (!r.ok) throw new Error(`push read failed: ${r.status} ${await r.text()}`)
  const rows = await r.json()
  return fromRow(rows[0])
}
async function sbAll() {
  const r = await fetch(`${REST}?select=*`, { headers: sbHeaders })
  if (!r.ok) throw new Error(`push scan failed: ${r.status} ${await r.text()}`)
  return (await r.json()).map(fromRow)
}
async function sbWrite(rec) {
  const r = await fetch(REST, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([toRow(rec)]),
  })
  if (!r.ok) throw new Error(`push write failed: ${r.status} ${await r.text()}`)
}
async function sbDelete(key) {
  await fetch(`${REST}?key=eq.${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: sbHeaders,
  })
}

// ---- Public API (async) -----------------------------------------------------
export async function getTarget(key) {
  if (!key) return null
  if (useSupabase) return sbGet(key)
  const rec = readAll()[key]
  return rec ? { ...blank(key), ...rec } : null
}

// Every record — the cron sweep iterates these.
export async function allTargets() {
  if (useSupabase) return sbAll()
  return Object.values(readAll())
}

async function mutate(key, fn) {
  if (!key) return null
  const cur = (await getTarget(key)) || blank(key)
  const next = { ...cur, ...fn(cur), key, updatedAt: Date.now() }
  if (useSupabase) {
    await sbWrite(next)
  } else {
    const all = readAll()
    all[key] = next
    writeAll(all)
  }
  return next
}

// Add (or refresh) a device subscription. De-duped by endpoint.
export async function addSubscription(key, sub, tzOffset) {
  return mutate(key, (rec) => {
    const others = rec.subscriptions.filter((s) => s.endpoint !== sub.endpoint)
    return {
      subscriptions: [
        ...others,
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
          ua: sub.ua || '',
          createdAt: Date.now(),
        },
      ],
      tzOffset: Number.isFinite(tzOffset) ? tzOffset : rec.tzOffset,
    }
  })
}

// Drop a subscription by endpoint (user turned reminders off, or it went stale).
export async function removeSubscription(key, endpoint) {
  return mutate(key, (rec) => ({
    subscriptions: rec.subscriptions.filter((s) => s.endpoint !== endpoint),
  }))
}

// Replace the stored reminder schedule for this key (+ refresh tz).
export async function syncReminders(key, reminders, tzOffset) {
  return mutate(key, (rec) => ({
    reminders: Array.isArray(reminders) ? reminders : [],
    tzOffset: Number.isFinite(tzOffset) ? tzOffset : rec.tzOffset,
  }))
}

// Persist the record after a sweep mutated its `subscriptions` (dead ones pruned)
// and/or `sent` log. Writes verbatim — the caller already produced the next shape.
export async function saveTarget(rec) {
  if (!rec?.key) return
  const next = { ...rec, updatedAt: Date.now() }
  if (useSupabase) {
    await sbWrite(next)
  } else {
    const all = readAll()
    all[rec.key] = next
    writeAll(all)
  }
}

export async function deleteTarget(key) {
  if (!key) return
  if (useSupabase) {
    await sbDelete(key)
  } else {
    const all = readAll()
    delete all[key]
    writeAll(all)
  }
}
