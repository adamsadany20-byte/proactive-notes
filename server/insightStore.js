import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Lightweight flat-file store for two low-stakes streams the app collects:
//   • feedback  — free-text notes the user sends ("things the app could add").
//   • events    — owner-only product analytics (note created, tool generated…).
//
// Kept deliberately simple: append-only JSON arrays, capped, on the local disk.
// This is fine for a single-instance server; on an ephemeral host (Render free
// tier) the files reset on redeploy, so feedback ALSO forwards to a webhook (see
// FEEDBACK_WEBHOOK_URL in index.js) for durable delivery. Analytics is
// best-effort and can be moved to Supabase later, mirroring pushStore.
const here = dirname(fileURLToPath(import.meta.url))
const FEEDBACK_FILE = join(here, '.feedback.json')
const EVENTS_FILE = join(here, '.analytics.json')

const FEEDBACK_CAP = 1000
const EVENTS_CAP = 20000

function load(file) {
  try {
    if (!existsSync(file)) return []
    const arr = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function save(file, arr) {
  try {
    writeFileSync(file, JSON.stringify(arr))
  } catch (err) {
    console.error('insightStore save failed:', err?.message || err)
  }
}

export function addFeedback(entry) {
  const all = load(FEEDBACK_FILE)
  all.push(entry)
  save(FEEDBACK_FILE, all.slice(-FEEDBACK_CAP))
}

export function listFeedback(limit = 100) {
  return load(FEEDBACK_FILE).slice(-limit).reverse()
}

export function addEvents(events) {
  if (!events.length) return
  const all = load(EVENTS_FILE)
  for (const e of events) all.push(e)
  save(EVENTS_FILE, all.slice(-EVENTS_CAP))
}

// Aggregate the raw event log into an owner-readable summary: totals, a
// per-event-name breakdown, distinct clients, and daily activity for the last
// two weeks.
export function summarizeEvents() {
  const all = load(EVENTS_FILE)
  const byName = {}
  const clients = new Set()
  const byDay = {}
  const now = Date.now()
  const DAY = 86400000

  for (const e of all) {
    byName[e.name] = (byName[e.name] || 0) + 1
    if (e.clientId) clients.add(e.clientId)
    if (e.at && now - e.at < 14 * DAY) {
      const day = new Date(e.at).toISOString().slice(0, 10)
      byDay[day] = (byDay[day] || 0) + 1
    }
  }

  return {
    totalEvents: all.length,
    distinctClients: clients.size,
    byName,
    byDay,
    feedbackCount: load(FEEDBACK_FILE).length,
    recentFeedback: listFeedback(25),
  }
}
