// Thin client for the backend. Every call degrades gracefully: if the server
// is down or a feature isn't configured, we return a "not configured" shape and
// the app stays fully on the local engine / simulated calendar.

// Base URL for the backend.
//   • If VITE_API_BASE is set at build time, use it verbatim (incl. "" for
//     same-origin, or a full URL for a split frontend/backend deploy).
//   • Otherwise fall back by build mode: local dev → the Express server on
//     :8787; a production build → same origin ("") so a single-service deploy
//     works even if the build command forgets to pass VITE_API_BASE="".
const configuredApiBase = (import.meta as any).env?.VITE_API_BASE as
  | string
  | undefined
const API_BASE =
  configuredApiBase ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')

// Which AI tier the user has selected. 'local' never touches the network;
// 'haiku' routes to Claude on the backend.
export type AiBackend = 'local' | 'haiku'

export interface ServerConfig {
  aiConfigured: boolean // true if the cloud AI tier has a key
  haikuConfigured: boolean
  calendarConfigured: boolean
  calendarConnected: boolean
  billingEnabled?: boolean
  billingConfigured?: boolean
}

// A stable, anonymous per-browser id. It ties Stripe subscriptions to this
// client without requiring a login. Persisted in localStorage; created lazily.
const CLIENT_ID_KEY = 'evolve.clientId'
export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY)
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
        `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      localStorage.setItem(CLIENT_ID_KEY, id)
    }
    return id
  } catch {
    return 'anon'
  }
}

export interface BillingStatus {
  billingEnabled: boolean
  billingConfigured: boolean
  freeMode: boolean
  // True whenever the client may use paid features — always true in free mode.
  subscribed: boolean
  // Credit model: £10 one-time activation includes £1 of AI token credit;
  // further usage is bought at £{tokenMarkup} per £1 of tokens.
  active?: boolean
  creditPence?: number
  usedPence?: number
  // Lifetime amount actually paid, and the user's self-set spend limit (0 = none).
  paidPence?: number
  capPence?: number
  pricing?: {
    activationPence: number
    includedCreditPence: number
    topupPence: number
    tokenMarkup: number
  }
}

export function fetchBillingStatus() {
  return safeJson<BillingStatus>(
    API_BASE +
      '/api/billing/status?clientId=' +
      encodeURIComponent(getClientId()),
  )
}

// Begin checkout. `kind` picks the product: 'activate' (£10 one-time, includes
// £1 of AI credit) or 'topup' (more credit at the markup rate). Returns a
// Stripe URL to redirect to, or an error/freeMode hint.
export async function startCheckout(
  kind: 'activate' | 'topup' = 'activate',
): Promise<{
  url?: string
  freeMode?: boolean
  error?: string
}> {
  const r = await safeJson<{ url?: string; freeMode?: boolean; error?: string }>(
    API_BASE + '/api/billing/checkout',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: getClientId(), kind }),
    },
  )
  if (!r) return { error: 'Could not reach the server.' }
  return r
}

// Set (or clear, with 0) the user's own lifetime spend limit, in pence. Enforced
// server-side at checkout so a user can't be charged past what they chose.
export async function setSpendCap(
  capPence: number,
): Promise<{ capPence?: number; error?: string }> {
  const r = await safeJson<{ capPence?: number; error?: string }>(
    API_BASE + '/api/billing/cap',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: getClientId(), capPence }),
    },
  )
  if (!r) return { error: 'Could not reach the server.' }
  return r
}

export interface EnrichResult {
  configured: boolean
  recognized?: boolean
  kind?: string
  name?: string
  category?: string
  summary?: string
  highlights?: string[]
  confidence?: number
  error?: string
}

export interface ExternalEvent {
  id: string
  title: string
  date: string
  start?: string
  end?: string
  source: 'google'
}

async function safeJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 30000,
): Promise<T | null> {
  try {
    // Add auth token to headers if available
    const { getAuthToken } = await import('./supabase')
    const token = await getAuthToken()
    const headers = new Headers(init?.headers || {})
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const timeoutPromise = new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    )
    const r = await Promise.race([
      fetch(url, { ...init, headers }),
      timeoutPromise,
    ])
    if (r instanceof Response) {
      return (await r.json()) as T
    }
    return null
  } catch {
    return null
  }
}

export function fetchServerConfig() {
  return safeJson<ServerConfig>(API_BASE + '/api/config')
}

export function enrich(text: string, candidate: string, backend?: AiBackend) {
  return safeJson<EnrichResult>(API_BASE + '/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, candidate, backend, clientId: getClientId() }),
  })
}

export interface FeatureSuggestion {
  label: string
  icon: string
  description: string
}

export async function suggestFeaturesApi(
  text: string,
  backend?: AiBackend,
): Promise<{ suggestions: FeatureSuggestion[]; error?: string }> {
  const r = await safeJson<{
    configured: boolean
    suggestions: FeatureSuggestion[]
    error?: string
  }>(API_BASE + '/api/suggest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, backend, clientId: getClientId() }),
  })
  if (!r) {
    return {
      suggestions: [],
      error: `Could not reach the server at ${API_BASE || 'the app origin'}. Is the backend running?`,
    }
  }
  if (r.configured === false) {
    return {
      suggestions: [],
      error: 'This AI tier has no API key configured on the server.',
    }
  }
  return { suggestions: r.suggestions ?? [], error: r.error }
}

export interface Recommendation {
  name: string
  kind: string
  detail: string
}

export async function recommendApi(
  text: string,
  backend?: AiBackend,
): Promise<{ heading: string; recommendations: Recommendation[]; error?: string }> {
  const r = await safeJson<{
    configured: boolean
    heading?: string
    recommendations?: Recommendation[]
    error?: string
  }>(API_BASE + '/api/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, backend, clientId: getClientId() }),
  })
  if (!r || r.configured === false) return { heading: '', recommendations: [] }
  return {
    heading: r.heading ?? 'Worth a look',
    recommendations: (r.recommendations ?? []).filter((x) => x?.name && x?.detail),
    error: r.error,
  }
}

export async function generateFeatureApi(
  label: string,
  description: string,
  text: string,
  backend?: AiBackend,
): Promise<{ configured?: boolean; code?: string; error?: string } | null> {
  return safeJson<{ configured: boolean; code: string; error?: string }>(
    API_BASE + '/api/generate-feature',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label,
        description,
        text,
        backend,
        clientId: getClientId(),
      }),
    },
  )
}

// Google Calendar connection removed — the app uses its own local calendar and
// note-owned events only, so there's no OAuth connect/disconnect or external
// event sync. (The server's /auth/google + /api/calendar routes remain but are
// no longer reachable from the UI.)
