// Thin client for the backend. Every call degrades gracefully: if the server
// is down or a feature isn't configured, we return a "not configured" shape and
// the app stays fully on the local engine / simulated calendar.

// Base URL for the backend. In local dev it defaults to the Express server on
// :8787. For deployment, set VITE_API_BASE at build time — use "" (empty) when
// the backend serves the built frontend from the same origin, so requests go to
// relative paths like /api/config.
const API_BASE =
  ((import.meta as any).env?.VITE_API_BASE as string | undefined) ??
  'http://localhost:8787'

// Which AI tier the user has selected. 'local' never touches the network.
export type AiBackend = 'local' | 'gemini' | 'haiku' | 'groq'

export interface ServerConfig {
  aiConfigured: boolean // legacy: true if ANY cloud tier has a key
  haikuConfigured: boolean
  geminiConfigured: boolean
  groqConfigured: boolean
  calendarConfigured: boolean
  calendarConnected: boolean
  enrichModel?: string
  geminiModel?: string
  groqModel?: string
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
    const timeoutPromise = new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    )
    const r = await Promise.race([fetch(url, init), timeoutPromise])
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
    body: JSON.stringify({ text, candidate, backend }),
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
    body: JSON.stringify({ text, backend }),
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
      body: JSON.stringify({ label, description, text, backend }),
    },
  )
}

export async function fetchCalendarEvents(): Promise<ExternalEvent[]> {
  const r = await safeJson<{ connected: boolean; events: ExternalEvent[] }>(
    API_BASE + '/api/calendar/events',
  )
  return r?.events ?? []
}

export function createCalendarEvent(ev: {
  title: string
  date: string
  start?: string
  end?: string
}) {
  return safeJson<{ connected: boolean; event?: ExternalEvent }>(
    API_BASE + '/api/calendar/events',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ev),
    },
  )
}

export function disconnectCalendar() {
  return safeJson(API_BASE + '/api/calendar/disconnect', { method: 'POST' })
}

// Kick off the OAuth flow by navigating the whole window to the backend.
export function connectCalendar() {
  window.location.href = API_BASE + '/auth/google'
}
