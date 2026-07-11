// Client-side Web Push: register the service worker, subscribe the device with
// the server's VAPID key, and keep the server's copy of the reminder schedule in
// sync so it can fire notifications while the app is closed.
//
// Everything here degrades gracefully — on a browser without push support, or a
// server without VAPID keys, the calls just report "unsupported/unconfigured"
// and the in-app 20s reminder poll (useReminders) still works when the app is open.

import type { Note, Reminder } from '../types'
import { sessionDates } from '../store/streak'
import { getClientId } from './api'

const configuredApiBase = (import.meta as any).env?.VITE_API_BASE as
  | string
  | undefined
const API_BASE =
  configuredApiBase ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')

export type PushState =
  | 'unsupported' // browser can't do push (or not a PWA on iOS)
  | 'ios-needs-install' // iOS Safari tab — must Add to Home Screen first
  | 'unconfigured' // server has no VAPID keys
  | 'default' // supported, not yet asked
  | 'denied' // user blocked notifications
  | 'granted' // subscribed and ready

// --- environment detection ---------------------------------------------------

export function isIOS(): boolean {
  const ua = navigator.userAgent || ''
  const iOSDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports as Mac; detect via touch points.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOSDevice || iPadOS
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (navigator as any).standalone === true
  )
}

export function pushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// --- auth header (mirrors api.ts) --------------------------------------------

async function authHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  try {
    const { getAuthToken } = await import('./supabase')
    const token = await getAuthToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  } catch {
    /* supabase optional */
  }
  return headers
}

function tzOffset(): number {
  return new Date().getTimezoneOffset()
}

// --- server config -----------------------------------------------------------

let _config: { configured: boolean; publicKey: string | null } | null = null
export async function getPushConfig() {
  if (_config) return _config
  try {
    const r = await fetch(API_BASE + '/api/push/config')
    _config = await r.json()
  } catch {
    _config = { configured: false, publicKey: null }
  }
  return _config!
}

// --- current state -----------------------------------------------------------

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) {
    // The most common "unsupported" case on mobile is an iOS Safari tab: push
    // exists there only once the site is installed to the home screen.
    if (isIOS() && !isStandalone()) return 'ios-needs-install'
    return 'unsupported'
  }
  if (isIOS() && !isStandalone()) return 'ios-needs-install'
  const cfg = await getPushConfig()
  if (!cfg.configured || !cfg.publicKey) return 'unconfigured'
  const perm = Notification.permission
  if (perm === 'denied') return 'denied'
  if (perm === 'granted') {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    return sub ? 'granted' : 'default'
  }
  return 'default'
}

// --- registration + subscription ---------------------------------------------

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Does an existing subscription use the given VAPID public key? Compares the
// raw applicationServerKey bytes so a rotated/stale key is detected.
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const opt = sub.options?.applicationServerKey
  if (!opt) return false
  const have = new Uint8Array(opt as ArrayBuffer)
  const want = urlBase64ToUint8Array(publicKey)
  if (have.length !== want.length) return false
  for (let i = 0; i < have.length; i++) if (have[i] !== want[i]) return false
  return true
}

// Subscribe, tolerating the browser throwing when a conflicting subscription
// still exists — clear it and try once more before giving up.
async function subscribeFresh(
  reg: ServiceWorkerRegistration,
  applicationServerKey: BufferSource,
): Promise<PushSubscription | null> {
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
  } catch {
    const existing = await reg.pushManager.getSubscription()
    if (existing) await existing.unsubscribe().catch(() => {})
    try {
      return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
    } catch {
      return null
    }
  }
}

// Ask permission, subscribe, and register the subscription with the server.
// Returns the resulting state so the UI can reflect success/denial.
export async function enablePush(): Promise<PushState> {
  const state = await pushState()
  if (state === 'unsupported' || state === 'ios-needs-install' || state === 'unconfigured') {
    return state
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default'

  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready)
  if (!reg) return 'unsupported'
  await navigator.serviceWorker.ready

  const cfg = await getPushConfig()
  if (!cfg.publicKey) return 'unconfigured'

  const appServerKey = urlBase64ToUint8Array(cfg.publicKey) as BufferSource
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await subscribeFresh(reg, appServerKey)
  } else if (!sameKey(sub, cfg.publicKey)) {
    // An existing subscription made with a *different* VAPID key (the server's
    // keys were rotated, or a stale one lingered). The browser won't let us
    // subscribe with a new key until the old one is gone, so drop it and re-sub.
    await sub.unsubscribe().catch(() => {})
    sub = await subscribeFresh(reg, appServerKey)
  }
  if (!sub) return 'default'

  const res = await fetch(API_BASE + '/api/push/subscribe', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      subscription: sub.toJSON(),
      tzOffset: tzOffset(),
      clientId: getClientId(),
    }),
  })
  if (!res.ok) return 'default'
  return 'granted'
}

// Unsubscribe this device and tell the server to forget it.
export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await fetch(API_BASE + '/api/push/unsubscribe', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ endpoint: sub.endpoint, clientId: getClientId() }),
      })
      await sub.unsubscribe()
    }
  } catch {
    /* best-effort */
  }
}

// --- schedule sync -----------------------------------------------------------

// Project the client's reminders into the compact shape the server sweep needs.
function projectReminders(reminders: Reminder[], notes: Note[]) {
  const noteById = new Map(notes.map((n) => [n.id, n]))
  return reminders.map((r) => {
    const note = noteById.get(r.noteId)
    return {
      id: r.id,
      title: r.title,
      target: r.target,
      mode: r.mode,
      weekdays: r.weekdays,
      time: r.time,
      completions: r.completions,
      sessionDates: r.mode === 'sessions' && note ? sessionDates(note) : [],
    }
  })
}

// Upload the current schedule + completion state. Called (debounced) whenever
// reminders change so the server always knows what's due and what's done.
export async function syncReminderSchedule(
  reminders: Reminder[],
  notes: Note[],
): Promise<void> {
  try {
    // Only bother the server once the device is actually subscribed.
    if (!pushSupported()) return
    if (Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return

    await fetch(API_BASE + '/api/push/sync', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        reminders: projectReminders(reminders, notes),
        tzOffset: tzOffset(),
        clientId: getClientId(),
      }),
    })
  } catch {
    /* best-effort */
  }
}

// Fire a server-sent test notification so the user can confirm it works.
export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(API_BASE + '/api/push/test', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ clientId: getClientId() }),
    })
    const j = await r.json()
    return r.ok ? { ok: true } : { ok: false, error: j?.error }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}
