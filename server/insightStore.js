import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Store for the two low-stakes streams the app collects:
//   • feedback  — free-text notes + optional email (feedback form, the periodic
//     prompt, and landing-page "interest" signups all land here, tagged by
//     `source`). Made DURABLE so a launch's feedback isn't lost.
//   • events    — owner-only product-analytics counters.
//
// FEEDBACK BACKENDS (auto-selected, mirroring pushStore):
//   • Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set — rows in a
//     `feedback` table, survives redeploys and is browsable in the dashboard.
//     (See DEPLOYMENT.md for the one-time table SQL.)
//   • Flat file server/.feedback.json otherwise — fine for local dev.
// Events stay flat-file (best-effort counters; not worth a table).
const here = dirname(fileURLToPath(import.meta.url))
const FEEDBACK_FILE = join(here, '.feedback.json')
const EVENTS_FILE = join(here, '.analytics.json')

const FEEDBACK_CAP = 2000
const EVENTS_CAP = 20000

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/$/, '')
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const useSupabase = !!(SB_URL && SB_KEY)
export const feedbackBackend = useSupabase ? 'supabase' : 'file'

const REST = `${SB_URL}/rest/v1/feedback`
const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

function loadFile(file) {
  try {
    if (!existsSync(file)) return []
    const arr = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function saveFile(file, arr) {
  try {
    writeFileSync(file, JSON.stringify(arr))
  } catch (err) {
    console.error('insightStore save failed:', err?.message || err)
  }
}

// ---- Feedback (async: Supabase or flat file) --------------------------------
export async function addFeedback(entry) {
  if (useSupabase) {
    try {
      const r = await fetch(REST, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify([
          {
            text: entry.text || '',
            source: entry.source || 'form',
            email: entry.email || null,
            client_id: entry.clientId || null,
          },
        ]),
      })
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      return
    } catch (err) {
      // Never lose a submission: fall back to the local file on any failure.
      console.error('feedback supabase write failed, using file:', err?.message || err)
    }
  }
  const all = loadFile(FEEDBACK_FILE)
  all.push(entry)
  saveFile(FEEDBACK_FILE, all.slice(-FEEDBACK_CAP))
}

export async function listFeedback(limit = 100) {
  if (useSupabase) {
    try {
      const url = `${REST}?select=*&order=created_at.desc&limit=${limit}`
      const r = await fetch(url, { headers: sbHeaders })
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
      const rows = await r.json()
      return rows.map((row) => ({
        text: row.text,
        source: row.source,
        email: row.email,
        clientId: row.client_id,
        at: row.created_at ? Date.parse(row.created_at) : Date.now(),
      }))
    } catch (err) {
      console.error('feedback supabase read failed, using file:', err?.message || err)
    }
  }
  return loadFile(FEEDBACK_FILE).slice(-limit).reverse()
}

// ---- Events (flat file) -----------------------------------------------------
export function addEvents(events) {
  if (!events.length) return
  const all = loadFile(EVENTS_FILE)
  for (const e of events) all.push(e)
  saveFile(EVENTS_FILE, all.slice(-EVENTS_CAP))
}

// Aggregate the raw event log + recent feedback into an owner summary.
export async function summarizeEvents() {
  const all = loadFile(EVENTS_FILE)
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

  const recentFeedback = await listFeedback(25)
  return {
    totalEvents: all.length,
    distinctClients: clients.size,
    byName,
    byDay,
    feedbackCount: recentFeedback.length,
    recentFeedback,
  }
}
