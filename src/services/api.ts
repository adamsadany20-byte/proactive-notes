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
  // Google Docs/Sheets/Slides creation. `configured` = the server has Google
  // OAuth credentials; `connected` = a user has authorised it (shares the same
  // OAuth connection as the calendar, so these track calendarConfigured/Connected).
  googleConfigured?: boolean
  googleConnected?: boolean
  billingEnabled?: boolean
  billingConfigured?: boolean
  owner?: boolean // this client is an owner → sees the product-analytics view
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
  // Recurring-subscription model: which plan is live and the two metered pools.
  plan?: 'none' | 'classifier' | 'evolve'
  hasClassifier?: boolean
  hasEvolve?: boolean
  pools?: {
    ai: { usedPence: number; includedPence: number }
    classifier: { usedPence: number; includedPence: number }
  }
  periodEnd?: number
  // What beyond-plan usage would cost this cycle (pence) — what capPence caps.
  overagePence?: number
  pricing?: {
    // Subscription pricing.
    classifierPricePence?: number
    classifierIncludedPence?: number
    evolvePricePence?: number
    evolveAiIncludedPence?: number
    evolveClassifierIncludedPence?: number
    overageMarkup?: number
    // Legacy credit-model pricing.
    activationPence?: number
    includedCreditPence?: number
    topupPence?: number
    tokenMarkup?: number
  }
}

// Subscribe to a recurring plan ('classifier' £2/mo or 'evolve' £12/mo).
export function startSubscription(plan: 'classifier' | 'evolve') {
  return startCheckout(plan)
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
  kind: 'activate' | 'topup' | 'classifier' | 'evolve' = 'activate',
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
  return safeJson<ServerConfig>(
    API_BASE + '/api/config?clientId=' + encodeURIComponent(getClientId()),
  )
}

// ---- Feedback + product analytics -----------------------------------------

export async function submitFeedback(
  text: string,
  source = 'form',
  email = '',
): Promise<{ ok: boolean; error?: string }> {
  const r = await safeJson<{ ok?: boolean; error?: string }>(
    API_BASE + '/api/feedback',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, source, email, clientId: getClientId() }),
    },
  )
  if (!r) return { ok: false, error: 'Could not reach the server.' }
  return { ok: !!r.ok, error: r.error }
}

// Landing-page "gauge interest" signup — an email plus an optional note.
export function submitInterest(email: string, message = '') {
  return submitFeedback(message, 'interest', email)
}

export interface AnalyticsEvent {
  name: string
  props?: Record<string, unknown>
  at?: number
}

// Fire-and-forget event upload. `keepalive` lets it complete during page unload.
export function sendEvents(events: AnalyticsEvent[]): void {
  if (!events.length) return
  try {
    fetch(API_BASE + '/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events, clientId: getClientId() }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* analytics is best-effort */
  }
}

export interface FeedbackEntry {
  text: string
  source: string
  clientId: string | null
  at: number
}
export interface AnalyticsSummary {
  totalEvents: number
  distinctClients: number
  byName: Record<string, number>
  byDay: Record<string, number>
  feedbackCount: number
  recentFeedback: FeedbackEntry[]
}

export function fetchAnalyticsSummary() {
  return safeJson<AnalyticsSummary>(
    API_BASE +
      '/api/analytics/summary?clientId=' +
      encodeURIComponent(getClientId()),
  )
}

export function enrich(text: string, candidate: string, backend?: AiBackend) {
  return safeJson<EnrichResult>(API_BASE + '/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, candidate, backend, clientId: getClientId() }),
  })
}

export interface ClassifyResult {
  configured: boolean
  classified?: boolean
  kind?: string
  topic?: string
  confidence?: number
  error?: string
}

// Cloud classification (paid tiers). Sends the local guess so the model knows
// what it's overriding. Always routes to the cloud backend — the capability gate
// is the user's plan, not the local/haiku toggle.
export function classifyRemote(
  text: string,
  localKind: string,
  localConfidence: number,
) {
  return safeJson<ClassifyResult>(API_BASE + '/api/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      localKind,
      localConfidence,
      backend: 'haiku',
      clientId: getClientId(),
    }),
  })
}


// Cloud-tailored basic questions (paid tiers). Given a classified note, the
// server returns 2-3 questions specific to its topic. Always routes to the cloud
// backend — the gate is the user's plan (classifier or evolve).
export interface TailoredQuestionDTO {
  text: string
  chips?: string[]
}

export async function fetchTailoredQuestions(
  text: string,
  kind: string,
  topic: string | undefined,
): Promise<{ configured: boolean; questions: TailoredQuestionDTO[]; error?: string }> {
  const r = await safeJson<{
    configured: boolean
    questions?: TailoredQuestionDTO[]
    error?: string
  }>(API_BASE + '/api/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      kind,
      topic: topic ?? '',
      backend: 'haiku',
      clientId: getClientId(),
    }),
  })
  if (!r) return { configured: false, questions: [] }
  return {
    configured: r.configured !== false,
    questions: (r.questions ?? []).filter((q) => q?.text),
    error: r.error,
  }
}

export interface FeatureSuggestion {
  label: string
  icon: string
  description: string
}

export async function suggestFeaturesApi(
  text: string,
  backend?: AiBackend,
  context?: string,
): Promise<{ suggestions: FeatureSuggestion[]; error?: string }> {
  const r = await safeJson<{
    configured: boolean
    suggestions: FeatureSuggestion[]
    error?: string
  }>(API_BASE + '/api/suggest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, backend, context, clientId: getClientId() }),
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

// A concrete next step to take — a thing to DO (distinct from Recommendation,
// which is a thing to look at).
export interface ActionRec {
  action: string
  detail: string
}

export async function recommendApi(
  text: string,
  backend?: AiBackend,
  context?: string,
): Promise<{
  heading: string
  recommendations: Recommendation[]
  actions: ActionRec[]
  error?: string
}> {
  const r = await safeJson<{
    configured: boolean
    heading?: string
    recommendations?: Recommendation[]
    actions?: ActionRec[]
    error?: string
  }>(API_BASE + '/api/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, backend, context, clientId: getClientId() }),
  })
  if (!r || r.configured === false)
    return { heading: '', recommendations: [], actions: [] }
  return {
    heading: r.heading ?? 'Worth a look',
    recommendations: (r.recommendations ?? []).filter((x) => x?.name && x?.detail),
    actions: (r.actions ?? []).filter((x) => x?.action && x?.detail),
    error: r.error,
  }
}

export async function generateFeatureApi(
  label: string,
  description: string,
  text: string,
  backend?: AiBackend,
  context?: string,
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
        context,
        clientId: getClientId(),
      }),
    },
  )
}

// Google Calendar connection removed — the app uses its own local calendar and
// note-owned events only, so there's no OAuth connect/disconnect or external
// event sync. (The server's /auth/google + /api/calendar routes remain but are
// no longer reachable from the UI.)

// ---- Google Docs / Sheets / Slides creation -------------------------------

export interface CreatedDoc {
  id: string
  type: 'doc' | 'sheet' | 'slides'
  title: string
  url: string
}

export interface CreateDocResult {
  ok: boolean
  // Present on success.
  doc?: CreatedDoc
  // 'not_connected' → the app isn't authorised for Google (client should fall
  // back to a blank docs.new tab). Other values are hard failures.
  error?: 'not_connected' | 'not_configured' | 'create_failed' | 'network'
}

// Create a real Google file for a note, seeded with `seed` content, against the
// user's connected Google account. Returns { ok:false, error:'not_connected' }
// when Google isn't authorised — the caller then opens a blank doc instead.
export async function createGoogleDoc(input: {
  type: 'doc' | 'sheet' | 'slides'
  title: string
  seed?: string
}): Promise<CreateDocResult> {
  const r = await safeJson<CreateDocResult>(API_BASE + '/api/google/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return r ?? { ok: false, error: 'network' }
}

// Kick off the Google OAuth consent flow. Full-page redirect to the server,
// which bounces to Google and back to the app with ?google=connected. Used as a
// fallback for users who signed in with email rather than Google.
export function connectGoogle(): void {
  window.location.href = API_BASE + '/auth/google'
}

// Disconnect Google — clears the server-stored tokens (shared with the dormant
// calendar routes, hence the endpoint name). The next doc creation falls back to
// a blank docs.new until the user reconnects.
export async function disconnectGoogle(): Promise<void> {
  await safeJson(API_BASE + '/api/calendar/disconnect', { method: 'POST' })
}

// Fired after the Google account is linked so the app can refresh server config
// (googleConnected → true) without a reload. App.tsx listens for it.
export const GOOGLE_LINKED_EVENT = 'google-linked'

// Hand the Google tokens from a "Continue with Google" sign-in to the server so
// it can create Docs/Sheets/Slides on the user's behalf. No-op when neither
// token is present (e.g. a session with no Google provider). Fire-and-forget.
export async function linkGoogleTokens(input: {
  refreshToken?: string | null
  accessToken?: string | null
}): Promise<void> {
  if (!input.refreshToken && !input.accessToken) return
  const res = await safeJson<{ ok: boolean }>(API_BASE + '/api/google/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refreshToken: input.refreshToken ?? undefined,
      accessToken: input.accessToken ?? undefined,
    }),
  })
  if (res?.ok && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(GOOGLE_LINKED_EVENT))
  }
}
