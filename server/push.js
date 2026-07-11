import { allTargets, saveTarget } from './pushStore.js'

// Web Push wiring: VAPID setup, a single-target sender that prunes dead
// subscriptions, and the cron sweep that fires reminders that have come due.
//
// The library is lazy-loaded so the server boots (and runs push-less) even if
// `web-push` isn't installed or no VAPID keys are set.
let _webpush = null
let _ready = false

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim()
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim()
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:notify@evolve.app').trim()

export const pushPublicKey = VAPID_PUBLIC_KEY
export function pushConfigured() {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
}

async function webpush() {
  if (_ready) return _webpush
  if (!pushConfigured()) return null
  try {
    const mod = await import('web-push')
    _webpush = mod.default || mod
    _webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
    _ready = true
    return _webpush
  } catch (err) {
    console.warn('  ⚠️  web-push unavailable — closed-app reminders disabled:', err.message)
    return null
  }
}

// Send one payload to every subscription on a record. Returns the list of
// subscriptions that are still alive (dead ones — 404/410 — are dropped so the
// record self-heals). `changed` says whether anything was pruned.
export async function sendToTarget(rec, payload) {
  const wp = await webpush()
  if (!wp) return { subscriptions: rec.subscriptions, changed: false, sent: 0 }

  const body = JSON.stringify(payload)
  const alive = []
  let sent = 0
  for (const sub of rec.subscriptions) {
    try {
      await wp.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: 3600 },
      )
      alive.push(sub)
      sent++
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        // Subscription is gone (uninstalled / permission revoked) — drop it.
        continue
      }
      // Transient failure — keep the subscription and try again next sweep.
      alive.push(sub)
    }
  }
  return { subscriptions: alive, changed: alive.length !== rec.subscriptions.length, sent }
}

// ---- Due-reminder logic (server mirror of the client's streak schedule) -----

// Wall-clock parts for a given instant in the user's timezone. We shift the
// epoch by the stored offset and then read the UTC getters, so the fields read
// as the user's local date/time. getTimezoneOffset() is minutes BEHIND UTC
// (UTC+1 → -60), so local = UTC - offset.
function localParts(nowMs, tzOffsetMin) {
  const d = new Date(nowMs - (Number(tzOffsetMin) || 0) * 60000)
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
  return { iso, weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

function dueMinutes(time) {
  const [h, m] = String(time || '09:00').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function isDue(r, parts) {
  const expected =
    r.mode === 'sessions'
      ? Array.isArray(r.sessionDates) && r.sessionDates.includes(parts.iso)
      : Array.isArray(r.weekdays) && r.weekdays.includes(parts.weekday)
  if (!expected) return false
  if (Array.isArray(r.completions) && r.completions.includes(parts.iso)) return false
  return parts.minutes >= dueMinutes(r.time)
}

function pruneSent(sent, nowMs) {
  const cutoff = nowMs - 3 * 86400000 // keep ~3 days of dedup history
  const out = {}
  for (const [k, ts] of Object.entries(sent || {})) {
    if (ts >= cutoff) out[k] = ts
  }
  return out
}

function buildBody(r) {
  const n = Array.isArray(r.completions) ? r.completions.length : 0
  const noun = r.mode === 'sessions' ? 'session' : 'day'
  if (n > 0) return `Keep your ${n}-${noun} streak alive 🔥`
  return 'Light your first flame 🌱'
}

// The cron sweep. Called by /api/cron/tick. Walks every stored target, sends a
// push for each reminder that's due right now (and not already sent today), and
// persists any change (dedup marks + pruned dead subscriptions).
export async function runTick(nowMs = Date.now()) {
  const wp = await webpush()
  if (!wp) return { configured: false, targets: 0, sent: 0 }

  const targets = await allTargets()
  let totalSent = 0
  for (const rec of targets) {
    if (!rec?.subscriptions?.length || !rec?.reminders?.length) continue
    const parts = localParts(nowMs, rec.tzOffset)
    let sent = { ...(rec.sent || {}) }
    let subs = rec.subscriptions
    let dirty = false

    for (const r of rec.reminders) {
      if (!isDue(r, parts)) continue
      const key = `${r.id}@${parts.iso}`
      if (sent[key]) continue

      const res = await sendToTarget(
        { ...rec, subscriptions: subs },
        {
          title: r.title || 'Time to check in',
          body: buildBody(r),
          tag: key,
          url: '/',
          reminderId: r.id,
        },
      )
      subs = res.subscriptions
      if (res.sent > 0) {
        sent[key] = nowMs
        totalSent += res.sent
      }
      if (res.changed || res.sent > 0) dirty = true
    }

    const prunedSent = pruneSent(sent, nowMs)
    if (Object.keys(prunedSent).length !== Object.keys(rec.sent || {}).length) dirty = true

    if (dirty) {
      await saveTarget({ ...rec, subscriptions: subs, sent: prunedSent })
    }
  }
  return { configured: true, targets: targets.length, sent: totalSent }
}
