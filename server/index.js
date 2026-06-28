import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { saveTokens, loadTokens, clearTokens } from './tokenStore.js'

const PORT = process.env.PORT || 8787
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173'
// One model powers all AI features (enrichment, tool suggestions, tool
// generation) when "Broader AI" is on. Haiku is fast + cheap; override per env.
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5'

const app = express()
// Reflect the request origin so the app works regardless of which local port
// Vite picks (5173, 5174, …). For a local-dev tool this is the simplest robust
// setup; tighten to APP_ORIGIN if you ever deploy this publicly.
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '256kb' }))

// Gemini model id for the Gemini tier. Flash is fast + cheap; override per env.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
// Groq model id for the Groq tier (fast OSS-model inference). Override per env.
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

// ---------------------------------------------------------------------------
// Capability reporting — the frontend uses this to degrade gracefully. There
// are four AI tiers and each cloud tier has its own key:
//   • Local ML  — no key, runs entirely in the browser.
//   • Gemini    — GOOGLE_GEMINI_API_KEY
//   • Claude    — ANTHROPIC_API_KEY (Haiku by default)
//   • Groq      — GROQ_API_KEY (Groq Cloud, OpenAI-compatible)
// ---------------------------------------------------------------------------
const haikuConfigured = () => !!process.env.ANTHROPIC_API_KEY
const geminiConfigured = () => !!process.env.GOOGLE_GEMINI_API_KEY
const groqConfigured = () => !!process.env.GROQ_API_KEY
// Legacy alias — older clients read `aiConfigured` to mean "any cloud AI".
const aiConfigured = () =>
  haikuConfigured() || geminiConfigured() || groqConfigured()
const calendarConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

app.get('/api/config', (_req, res) => {
  res.json({
    aiConfigured: aiConfigured(),
    haikuConfigured: haikuConfigured(),
    geminiConfigured: geminiConfigured(),
    groqConfigured: groqConfigured(),
    calendarConfigured: calendarConfigured(),
    calendarConnected: !!loadTokens(),
    enrichModel: AI_MODEL,
    geminiModel: GEMINI_MODEL,
    groqModel: GROQ_MODEL,
  })
})

// ---------------------------------------------------------------------------
// World-knowledge enrichment — called ONLY when the local engine signals it
// needs world knowledge it doesn't have (see worldKnowledge.ts on the client).
// ---------------------------------------------------------------------------
const anthropic = haikuConfigured()
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null

// ---------------------------------------------------------------------------
// Backend routing. The client sends the tier it wants (`backend`); we honour it
// only if the matching key is present, otherwise fall back to auto-detect. The
// "local" tier never reaches the server, so a request asking for it (or any tier
// whose key is missing) resolves to null and the caller returns not-configured.
// ---------------------------------------------------------------------------
function resolveBackend(requested) {
  if (requested === 'local') return null
  if (requested === 'haiku') return anthropic ? 'haiku' : null
  if (requested === 'gemini') return geminiConfigured() ? 'gemini' : null
  if (requested === 'groq') return groqConfigured() ? 'groq' : null
  // No (or unknown) preference — pick whatever is configured, Claude first.
  if (anthropic) return 'haiku'
  if (geminiConfigured()) return 'gemini'
  if (groqConfigured()) return 'groq'
  return null
}

// Robustly pull a JSON object out of a model response. Handles bare JSON,
// ```json fenced blocks, and leading/trailing prose by extracting the outermost
// {...} span. Throws with the raw text on failure so the caller can surface it.
function parseJSON(text) {
  if (!text) return {}
  let t = String(text).trim()
  // Strip markdown code fences if present.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    // Fall back to the outermost brace span.
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(t.slice(start, end + 1))
    }
    throw new Error(`could not parse JSON from model output: ${t.slice(0, 200)}`)
  }
}

// Append a strict "return only JSON matching this schema" instruction. Used by
// the providers that produce JSON via prompting (Gemini, Groq) rather than a
// native structured-output mode.
function withSchemaPrompt(system, schema) {
  if (!schema) return system
  return `${system}\n\nRespond with ONLY a single JSON object matching this JSON schema. No prose, no markdown, no code fences:\n${JSON.stringify(
    schema,
  )}`
}

// Gemini via the v1beta REST API. We ask for JSON via responseMimeType and put
// the schema in the prompt — far more portable than the strict responseSchema,
// which rejects several common JSON-schema constructs.
async function callGemini({ system, user, schema, maxTokens }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
    `?key=${encodeURIComponent(process.env.GOOGLE_GEMINI_API_KEY)}`
  const body = {
    systemInstruction: { parts: [{ text: withSchemaPrompt(system, schema) }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
    },
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Gemini API ${r.status}: ${detail.slice(0, 300)}`)
  }
  const data = await r.json()
  const cand = data?.candidates?.[0]
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    throw new Error(`Gemini stopped early (${cand.finishReason})`)
  }
  const text = cand?.content?.parts?.map((p) => p.text || '').join('') || ''
  return parseJSON(text)
}

// Claude via the official SDK. We use forced tool use to get structured JSON —
// the most widely-supported method across models and SDK versions (more robust
// than output_config.format, which depends on newer API/SDK support).
async function callClaude({ system, user, schema, maxTokens }) {
  const msg = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    system,
    tools: [
      {
        name: 'respond',
        description: 'Return the structured result for the request.',
        input_schema: schema || { type: 'object' },
      },
    ],
    tool_choice: { type: 'tool', name: 'respond' },
    messages: [{ role: 'user', content: user }],
  })
  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block) {
    const text = msg.content.find((b) => b.type === 'text')
    return text ? parseJSON(text.text) : {}
  }
  return block.input || {}
}

// Groq Cloud's API is OpenAI-compatible. We use JSON object mode (broadly
// supported across Groq's OSS models) and describe the schema in the system
// prompt — more portable than json_schema mode, which only some models accept.
async function callGroq({ system, user, schema, maxTokens }) {
  const body = {
    model: GROQ_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: withSchemaPrompt(system, schema) },
      { role: 'user', content: user },
    ],
    ...(schema ? { response_format: { type: 'json_object' } } : {}),
  }
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Groq API ${r.status}: ${detail.slice(0, 300)}`)
  }
  const data = await r.json()
  const text = data?.choices?.[0]?.message?.content || ''
  return parseJSON(text)
}

// Run a structured-JSON generation on an already-resolved backend.
function generateJSON(backend, opts) {
  if (backend === 'gemini') return callGemini(opts)
  if (backend === 'groq') return callGroq(opts)
  return callClaude(opts) // 'haiku'
}

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    recognized: { type: 'boolean' },
    kind: {
      type: 'string',
      enum: ['event', 'academic', 'project', 'goal', 'tasks', 'general', 'unknown'],
    },
    name: { type: 'string' },
    category: { type: 'string' },
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
  required: ['recognized', 'kind', 'name', 'category', 'summary', 'highlights', 'confidence'],
  additionalProperties: false,
}

const ENRICH_SYSTEM = `You resolve real-world references inside very short personal notes.
You are given the full note text and one candidate term the local classifier could not place.
Decide whether the candidate refers to a recognizable real-world thing (a known event, conference,
product, company, place, or public figure) that general world knowledge can identify.

Return JSON only:
- recognized: true only if you can confidently identify the candidate as a specific real-world entity.
- kind: the note's content type given this knowledge ("event" for things the user would attend/watch/track).
- name: the canonical name of the entity (e.g. "AWS re:Invent").
- category: a short label (e.g. "Tech conference", "Music festival", "Sporting event").
- summary: one sentence on what it is.
- highlights: 3-5 things the user would care about (agenda items, what to watch for). Empty if not an event.
- confidence: 0..1.
If the candidate is just a personal name or something not in world knowledge, set recognized=false and kind="general".`

app.post('/api/enrich', async (req, res) => {
  const { text = '', candidate = '', backend } = req.body || {}
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false })
  if (!candidate.trim()) return res.json({ configured: true, recognized: false })

  try {
    const data = await generateJSON(resolved, {
      system: ENRICH_SYSTEM,
      user: `Note: "${text}"\nCandidate term: "${candidate}"`,
      schema: ENRICH_SCHEMA,
      maxTokens: 1024,
    })
    res.json({ configured: true, ...data })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`enrich error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg })
  }
})

// ---------------------------------------------------------------------------
// Tool suggestion + generation — the "evolve with you" engine. Both run on the
// same Claude model and only fire when the user has Broader AI enabled.
// ---------------------------------------------------------------------------
const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          icon: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['label', 'icon', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
}

const SUGGEST_SYSTEM = `You are an assistant inside a notes app. Read the user's note and propose 3-6
SPECIFIC tools or resources that would genuinely help THEM with THIS note.
Be creative and specific to the content — not generic. Examples:
- learning guitar -> "Chord Diagram Reference", "Practice Log"
- a road trip -> "Packing Checklist", "Fuel Cost Estimator", "Itinerary"
- building an app -> "Component Checklist", "API Endpoint Tracker", "Tech Stack Comparison"
- a chemistry exam -> "Reaction Flashcards", "Periodic Table Quick Ref", "Study Schedule"
Each suggestion: a short label, a single emoji icon, and a one-line description.`

app.post('/api/suggest', async (req, res) => {
  const { text = '', backend } = req.body || {}
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false, suggestions: [] })
  if (!text.trim()) return res.json({ configured: true, suggestions: [] })

  console.log(`/api/suggest via ${resolved}`)
  try {
    const data = await generateJSON(resolved, {
      system: SUGGEST_SYSTEM,
      user: `Note:\n"""\n${text}\n"""`,
      schema: SUGGEST_SCHEMA,
      maxTokens: 1024,
    })
    res.json({ configured: true, suggestions: data.suggestions ?? [] })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`suggest error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg, suggestions: [] })
  }
})

const GENERATE_SCHEMA = {
  type: 'object',
  properties: { code: { type: 'string' } },
  required: ['code'],
  additionalProperties: false,
}

const GENERATE_SYSTEM = `You build self-contained, interactive React components. Output ONLY component code.
Hard requirements:
- A single React functional component, exported as default.
- ONLY "React" is in scope. Use React.useState / React.useEffect (NOT bare hooks).
- No imports, no external libraries, no fetch, no localStorage.
- Bake in REAL, relevant initial data derived from the user's note (don't leave it empty).
- Make it genuinely interactive (inputs, toggles, add/remove) where it makes sense.
- Inline styles only. Clean and readable. Must render without errors if untouched.`

app.post('/api/generate-feature', async (req, res) => {
  const { label = '', description = '', text = '', backend } = req.body || {}
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false })
  if (!label.trim()) return res.json({ configured: true, code: '' })

  try {
    const data = await generateJSON(resolved, {
      system: GENERATE_SYSTEM,
      user: `Build a component that is: "${label}" — ${description}\n\nTailored to this note:\n"""\n${text}\n"""`,
      schema: GENERATE_SCHEMA,
      maxTokens: 4096,
    })
    res.json({ configured: true, code: data.code ?? '' })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`generate-feature error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg })
  }
})

// ---------------------------------------------------------------------------
// Google Calendar — OAuth + event CRUD.
// ---------------------------------------------------------------------------
const SCOPES = ['https://www.googleapis.com/auth/calendar.events']

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ||
      `http://localhost:${PORT}/auth/google/callback`,
  )
}

// Returns an authed client, or null if not connected.
function authedClient() {
  const tokens = loadTokens()
  if (!tokens) return null
  const client = oauthClient()
  client.setCredentials(tokens)
  // Persist refreshed tokens so the refresh_token survives.
  client.on('tokens', (t) => saveTokens({ ...tokens, ...t }))
  return client
}

app.get('/auth/google', (_req, res) => {
  if (!calendarConfigured())
    return res.status(400).send('Google Calendar is not configured on the server.')
  const url = oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  })
  res.redirect(url)
})

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { tokens } = await oauthClient().getToken(req.query.code)
    saveTokens(tokens)
    res.redirect(`${APP_ORIGIN}/?calendar=connected`)
  } catch (err) {
    console.error('oauth callback error:', err?.message || err)
    res.redirect(`${APP_ORIGIN}/?calendar=error`)
  }
})

app.post('/api/calendar/disconnect', (_req, res) => {
  clearTokens()
  res.json({ ok: true })
})

// List upcoming events (used for conflict detection + display).
app.get('/api/calendar/events', async (_req, res) => {
  const client = authedClient()
  if (!client) return res.json({ connected: false, events: [] })
  try {
    const calendar = google.calendar({ version: 'v3', auth: client })
    const now = new Date()
    const max = new Date()
    max.setDate(max.getDate() + 21)
    const r = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: max.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    })
    const events = (r.data.items || [])
      .filter((e) => e.start?.dateTime || e.start?.date)
      .map((e) => normalizeEvent(e))
    res.json({ connected: true, events })
  } catch (err) {
    console.error('calendar list error:', err?.message || err)
    res.status(502).json({ connected: true, error: 'list_failed', events: [] })
  }
})

// Create an event the app owns (study session, test, briefing…).
app.post('/api/calendar/events', async (req, res) => {
  const client = authedClient()
  if (!client) return res.status(409).json({ connected: false })
  try {
    const calendar = google.calendar({ version: 'v3', auth: client })
    const r = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: toGoogleEvent(req.body),
    })
    res.json({ connected: true, event: normalizeEvent(r.data) })
  } catch (err) {
    console.error('calendar insert error:', err?.message || err)
    res.status(502).json({ connected: true, error: 'insert_failed' })
  }
})

app.delete('/api/calendar/events/:id', async (req, res) => {
  const client = authedClient()
  if (!client) return res.status(409).json({ connected: false })
  try {
    const calendar = google.calendar({ version: 'v3', auth: client })
    await calendar.events.delete({ calendarId: 'primary', eventId: req.params.id })
    res.json({ connected: true, ok: true })
  } catch (err) {
    console.error('calendar delete error:', err?.message || err)
    res.status(502).json({ connected: true, error: 'delete_failed' })
  }
})

// ---- shaping helpers --------------------------------------------------------

function normalizeEvent(e) {
  const startDt = e.start?.dateTime || (e.start?.date && `${e.start.date}T00:00:00`)
  const endDt = e.end?.dateTime || (e.end?.date && `${e.end.date}T00:00:00`)
  const d = new Date(startDt)
  const ed = endDt ? new Date(endDt) : null
  return {
    id: e.id,
    title: e.summary || '(no title)',
    date: isoDate(d),
    start: hhmm(d),
    end: ed ? hhmm(ed) : undefined,
    source: 'google',
  }
}

function toGoogleEvent({ title, date, start, end }) {
  const startISO = `${date}T${start || '09:00'}:00`
  const endISO = `${date}T${end || addHour(start || '09:00')}:00`
  return {
    summary: title,
    start: { dateTime: new Date(startISO).toISOString() },
    end: { dateTime: new Date(endISO).toISOString() },
  }
}

function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function hhmm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function addHour(t) {
  const [h, m] = t.split(':').map(Number)
  return `${pad((h + 1) % 24)}:${pad(m)}`
}
function pad(n) {
  return String(n).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// Production: serve the built frontend (Vite `dist/`) from this same server so
// the whole app deploys as ONE service. In dev this folder doesn't exist, so we
// skip it and the Vite dev server serves the UI instead. Mounted last so it
// never shadows the /api and /auth routes above.
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
  console.log(`  Frontend: serving built app from ${DIST_DIR}`)
}

app.listen(PORT, () => {
  console.log(`Proactive Notes server on http://localhost:${PORT}`)
  console.log(`  Claude (Haiku tier): ${haikuConfigured() ? `configured (${AI_MODEL})` : 'not configured'}`)
  console.log(`  Gemini tier: ${geminiConfigured() ? `configured (${GEMINI_MODEL})` : 'not configured'}`)
  console.log(`  Groq tier: ${groqConfigured() ? `configured (${GROQ_MODEL})` : 'not configured'}`)
  console.log(`  Calendar: ${calendarConfigured() ? 'configured' : 'not configured'}`)
})
