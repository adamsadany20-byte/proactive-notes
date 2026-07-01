import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { saveTokens, loadTokens, clearTokens } from './tokenStore.js'
import {
  isSubscribed,
  setEntitlement,
  setStatusByCustomer,
} from './entitlementStore.js'

// Load server/.env explicitly relative to THIS file, so the keys load no matter
// where the process is launched from (project root via `npm start`, or the
// server dir via `npm run dev:server`). The default `dotenv/config` only checks
// the current working directory, which silently dropped the keys when started
// from the repo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

const PORT = process.env.PORT || 8787
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173'
// One model powers all AI features (enrichment, tool suggestions, tool
// generation) when "Broader AI" is on. Haiku is fast + cheap; override per env.
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5'

// A dated context line prepended to world-knowledge prompts. Grounding the model
// in "today" is the single biggest lever on the quality of its world knowledge:
// without it, "the latest iPhone" or "the current model" is ambiguous and the
// model hedges toward stale, generic picks. With it, Haiku reasons from its
// training knowledge up to a concrete present and names current, specific things.
function todayContext() {
  const now = new Date()
  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return `Today's date is ${date}. Reason from your world knowledge as of the most recent generation you know about, and prefer things that are current and available now over older or discontinued ones.`
}

// ---------------------------------------------------------------------------
// Billing. The whole app stays usable for free until BILLING_ENABLED=true, so
// you can keep building and testing without paying. When it's on, the paid AI
// routes require an active Stripe subscription. Everything is lazy/optional:
// with no Stripe keys the billing endpoints simply report "not configured".
// ---------------------------------------------------------------------------
const BILLING_ENABLED =
  String(process.env.BILLING_ENABLED || 'false').toLowerCase() === 'true'
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID
const billingConfigured = () =>
  !!(process.env.STRIPE_SECRET_KEY && STRIPE_PRICE_ID)

// Free mode (billing off) → always allowed, so editing/trying never gets gated.
// With billing on, a client needs an active subscription tied to its clientId.
function hasAccess(clientId) {
  if (!BILLING_ENABLED) return true
  return isSubscribed(clientId)
}

const app = express()
// Reflect the request origin so the app works regardless of which local port
// Vite picks (5173, 5174, …). For a local-dev tool this is the simplest robust
// setup; tighten to APP_ORIGIN if you ever deploy this publicly.
app.use(cors({ origin: true, credentials: true }))
// JSON-parse everything EXCEPT the Stripe webhook, which must read the raw body
// to verify the signature. That route registers its own express.raw() parser.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/billing/webhook') return next()
  express.json({ limit: '256kb' })(req, res, next)
})

// ---------------------------------------------------------------------------
// Capability reporting — the frontend uses this to degrade gracefully. There
// are two AI tiers:
//   • Local ML  — no key, runs entirely in the browser.
//   • Claude    — ANTHROPIC_API_KEY (Haiku by default)
// ---------------------------------------------------------------------------
const haikuConfigured = () => !!process.env.ANTHROPIC_API_KEY
// Legacy alias — older clients read `aiConfigured` to mean "cloud AI available".
const aiConfigured = () => haikuConfigured()
const calendarConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

app.get('/api/config', (_req, res) => {
  res.json({
    aiConfigured: aiConfigured(),
    haikuConfigured: haikuConfigured(),
    calendarConfigured: calendarConfigured(),
    calendarConnected: !!loadTokens(),
    enrichModel: AI_MODEL,
    billingEnabled: BILLING_ENABLED,
    billingConfigured: billingConfigured(),
  })
})

// ---------------------------------------------------------------------------
// Billing endpoints (Stripe). Lazy-load the SDK so the server boots instantly
// and runs fine with no Stripe keys at all.
// ---------------------------------------------------------------------------
let _stripe = null
async function getStripe() {
  if (!_stripe) {
    const { default: Stripe } = await import('stripe')
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  }
  return _stripe
}

// What the frontend needs to decide whether to show a paywall. In free mode
// `subscribed` is true for everyone so nothing is ever locked.
app.get('/api/billing/status', (req, res) => {
  const clientId = req.query.clientId
  res.json({
    billingEnabled: BILLING_ENABLED,
    billingConfigured: billingConfigured(),
    freeMode: !BILLING_ENABLED,
    subscribed: hasAccess(clientId),
  })
})

// Start a Stripe Checkout session for this client and return its URL.
app.post('/api/billing/checkout', async (req, res) => {
  if (!BILLING_ENABLED) return res.json({ freeMode: true })
  if (!billingConfigured())
    return res.status(400).json({ error: 'Billing is not configured on the server.' })
  const { clientId } = req.body || {}
  if (!clientId) return res.status(400).json({ error: 'Missing clientId' })
  try {
    const stripe = await getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      // client_reference_id ties the resulting subscription back to this client
      // in the webhook; metadata is a belt-and-braces copy.
      client_reference_id: clientId,
      metadata: { clientId },
      success_url: `${APP_ORIGIN}/?billing=success`,
      cancel_url: `${APP_ORIGIN}/?billing=cancel`,
    })
    res.json({ url: session.url })
  } catch (err) {
    console.error('checkout error:', err?.message || err)
    res.status(502).json({ error: 'checkout_failed' })
  }
})

// Stripe webhook — the source of truth for subscription state. Uses the raw
// body (registered above) so the signature verifies. Without a webhook secret
// set we still parse the event (handy for local `stripe listen` without -e).
app.post(
  '/api/billing/webhook',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    if (!billingConfigured()) return res.status(400).send('billing not configured')
    let event
    try {
      const stripe = await getStripe()
      const sig = req.headers['stripe-signature']
      if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET,
        )
      } else {
        event = JSON.parse(req.body.toString('utf8'))
      }
    } catch (err) {
      console.error('webhook signature error:', err?.message || err)
      return res.status(400).send(`Webhook Error: ${err?.message || err}`)
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object
          const clientId = s.client_reference_id || s.metadata?.clientId
          setEntitlement(clientId, {
            status: 'active',
            customerId: s.customer,
            subscriptionId: s.subscription,
          })
          break
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object
          const status =
            event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status
          setStatusByCustomer(sub.customer, status)
          break
        }
        default:
          break
      }
      res.json({ received: true })
    } catch (err) {
      console.error('webhook handler error:', err?.message || err)
      res.status(500).send('handler error')
    }
  },
)

// ---------------------------------------------------------------------------
// World-knowledge enrichment — called ONLY when the local engine signals it
// needs world knowledge it doesn't have (see worldKnowledge.ts on the client).
// ---------------------------------------------------------------------------
// Lazy-load the Anthropic SDK for the same reason as googleapis: importing it
// at startup blocks the server boot. We construct the client on first Claude
// request instead. `haikuConfigured()` (env-key check) is the source of truth
// for whether the Claude tier is available — not the client instance.
let _anthropic = null
async function getAnthropic() {
  if (!_anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _anthropic
}

// ---------------------------------------------------------------------------
// Backend routing. The only cloud tier is Claude. A request resolves to 'haiku'
// when ANTHROPIC_API_KEY is present, otherwise null and the caller returns
// not-configured. The "local" tier never reaches the server.
// ---------------------------------------------------------------------------
function resolveBackend(requested) {
  if (requested === 'local') return null
  return haikuConfigured() ? 'haiku' : null
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

// Claude via the official SDK. We use forced tool use to get structured JSON —
// the most widely-supported method across models and SDK versions (more robust
// than output_config.format, which depends on newer API/SDK support).
async function callClaude({ system, user, schema, maxTokens }) {
  const anthropic = await getAnthropic()
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

// Run a structured-JSON generation on an already-resolved backend. Claude is the
// only cloud tier, so this simply delegates to it.
function generateJSON(_backend, opts) {
  return callClaude(opts)
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

const ENRICH_SYSTEM = `You resolve real-world references inside very short personal notes, using your broad world
knowledge. You are given the full note text and one candidate term the local classifier could
not place. Decide whether the candidate refers to a recognizable real-world thing — a known
event, conference, festival, product, company, place, public figure, film, game, or team — that
general world knowledge can identify.

Reason carefully before answering:
- Use the surrounding note text as disambiguating context (e.g. "tickets for X" implies an event;
  "should I buy the X" implies a product). The same word can mean different things — let the note decide.
- Only set recognized=true when you can confidently tie the candidate to ONE specific, real entity.
  If it's ambiguous, a common personal name, or something you can't place, set recognized=false.
- Do not fabricate. Never invent dates, prices, or specifics you're unsure of.

Return JSON only:
- recognized: true only if you can confidently identify the candidate as a specific real-world entity.
- kind: the note's content type given this knowledge ("event" for things the user would attend/watch/track).
- name: the canonical name of the entity (e.g. "AWS re:Invent", not "reinvent").
- category: a short label (e.g. "Tech conference", "Music festival", "Sporting event", "Product").
- summary: one accurate sentence on what it is.
- highlights: 3-5 concrete things the user would care about (agenda items, what to watch for, key facts). Empty if not an event.
- confidence: 0..1 — your genuine certainty that the identification is correct.
If the candidate is just a personal name or something not in world knowledge, set recognized=false and kind="general".`

app.post('/api/enrich', async (req, res) => {
  const { text = '', candidate = '', backend, clientId } = req.body || {}
  if (!hasAccess(clientId))
    return res
      .status(402)
      .json({ configured: true, subscribed: false, error: 'Subscription required' })
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false })
  if (!candidate.trim()) return res.json({ configured: true, recognized: false })

  try {
    const data = await generateJSON(resolved, {
      system: ENRICH_SYSTEM,
      user: `${todayContext()}\n\nNote: "${text}"\nCandidate term: "${candidate}"`,
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

const SUGGEST_SYSTEM = `You are a sharp, opinionated assistant inside a notes app. Read the user's note
and propose the few tools that would genuinely move the needle for THEM on THIS
note — quality over quantity.

Rules for a curated list:
- Return 3-4 suggestions, never more. Order them best-first (most useful #1).
- Each must be SPECIFIC to the note's actual content — never generic filler like
  "Notes" or "To-do list". If you can't make it specific, drop it.
- Prefer concrete, INTERACTIVE tools the app can build and the user would
  actually touch: trackers, checklists, schedules, calculators, planners,
  comparison tables, quick-reference cards, flashcards.
- Each suggestion must be DISTINCT — no two that overlap in purpose.
- Skip anything that needs live external data, accounts, or the internet.

Examples (note -> the 3 best):
- learning guitar -> "Chord Diagram Reference", "Practice Log", "Song Progress Tracker"
- a road trip -> "Itinerary Builder", "Packing Checklist", "Fuel Cost Estimator"
- building an app -> "Feature Checklist", "Tech Stack Comparison", "API Endpoint Tracker"
- a chemistry exam -> "Reaction Flashcards", "Study Schedule", "Formula Quick Reference"
- buying a laptop -> "Spec Comparison", "Price Tracker", "Pros & Cons Matrix", "Where-to-Buy List"

When the note is about BUYING or choosing a product, lean into shopping tools:
price trackers, spec/feature comparison tables, budget calculators, pros-&-cons
matrices, shortlists, and where-to-buy / deal checklists.

Each suggestion: a short label (2-3 words, Title Case), a single fitting emoji
icon, and a one-line description of what it does for this note.`

app.post('/api/suggest', async (req, res) => {
  const { text = '', backend, clientId } = req.body || {}
  if (!hasAccess(clientId))
    return res
      .status(402)
      .json({ configured: true, subscribed: false, error: 'Subscription required', suggestions: [] })
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

// ---------------------------------------------------------------------------
// Real-world recommendations — the AI's reach beyond the note itself. Given the
// note, it names concrete real things worth knowing about: products & models,
// places, books, tools, services. Knowledge-based (no live data), so we forbid
// invented prices/links and keep each pick to a name + why.
// ---------------------------------------------------------------------------
const RECOMMEND_SCHEMA = {
  type: 'object',
  properties: {
    heading: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string' }, // e.g. "Product", "Place", "Book", "Tool"
          detail: { type: 'string' }, // one line on why it fits
        },
        required: ['name', 'kind', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['heading', 'recommendations'],
  additionalProperties: false,
}

const RECOMMEND_SYSTEM = `You recommend concrete, real-world things based on a personal note. You have broad world
knowledge — draw on it fully. Read the note, infer the person's intent, budget signals, skill
level, and context, then name SPECIFIC real things: exact product models, brands, places,
books, apps, tools, services, or people to follow.

Rules:
- Return 3-5 recommendations, best-first (the single most useful pick is #1). Each must be a
  real, identifiable thing — a precise model name ("iPhone 15 Pro", not "a good phone"), a real
  place, a real title — never a generic category.
- Lean on your world knowledge to be CURRENT and PRECISE: name the actual current-generation
  model, the well-known author's actual book, the real neighbourhood. Distinguish tiers (budget
  vs flagship, beginner vs advanced) and pick to match the note's cues.
- "detail" is one tight, information-dense line on why THIS pick fits THIS note — mention the
  concrete tradeoff or standout trait (e.g. "titanium build, best camera, priced highest"). No
  marketing fluff, no filler.
- "kind" is a short noun label: Product, Place, Book, App, Tool, Brand, Resource, Dish, Person, etc.
- Knowledge-based only: NEVER invent live prices, links, ratings, or stock. If unsure of an exact
  spec or figure, stay qualitative rather than guessing a number. Prefer well-established, verifiable
  options over obscure ones you're unsure exist.
- "heading" is a short, friendly title tailored to the note
  (e.g. "iPhones to consider", "Spots to check out in Lisbon", "Reads on habit-building").
Examples:
- "buying a budget laptop for uni" -> heading "Laptops worth a look"; specific current models spanning price tiers, each with its tradeoff.
- "weekend in Lisbon" -> heading "Spots to check out"; real neighbourhoods, landmarks, and a signature dish.
- "learning to cook Thai food" -> heading "Where to start"; real dishes, a classic named cookbook, key pantry ingredients.`

app.post('/api/recommend', async (req, res) => {
  const { text = '', backend, clientId } = req.body || {}
  if (!hasAccess(clientId))
    return res
      .status(402)
      .json({ configured: true, subscribed: false, error: 'Subscription required', recommendations: [] })
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false, recommendations: [] })
  if (text.trim().length < 8)
    return res.json({ configured: true, recommendations: [] })

  console.log(`/api/recommend via ${resolved}`)
  try {
    const data = await generateJSON(resolved, {
      system: RECOMMEND_SYSTEM,
      user: `${todayContext()}\n\nNote:\n"""\n${text}\n"""`,
      schema: RECOMMEND_SCHEMA,
      maxTokens: 1024,
    })
    res.json({
      configured: true,
      heading: data.heading ?? 'Worth a look',
      recommendations: data.recommendations ?? [],
    })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`recommend error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg, recommendations: [] })
  }
})

const GENERATE_SCHEMA = {
  type: 'object',
  properties: { code: { type: 'string' } },
  required: ['code'],
  additionalProperties: false,
}

const GENERATE_SYSTEM = `You build self-contained, interactive React components that drop into an existing
app and must look like a NATIVE part of it. Output ONLY component code.

Technical requirements (hard):
- A single React functional component, exported as default.
- ONLY "React" is in scope. Use React.useState / React.useEffect (NOT bare hooks).
- No imports, no external libraries, no fetch, no localStorage, no <style> tags, no CSS classes.
- Inline styles only (the style={{}} prop). Must render without errors if untouched.
- Bake in REAL, relevant initial data derived from the user's note (never leave it empty).
- Make it genuinely interactive (inputs, toggles, add/remove, edit) where it makes sense.

Design system — the component renders INSIDE the app's DOM, so these CSS custom
properties are already in scope. Reference them with var(...) in inline styles.
NEVER hardcode hex colors; always use these tokens so theming stays consistent:
- Surfaces:  var(--panel) (cards/white), var(--panel-2) (subtle raised), var(--bg) (page)
- Text:      var(--ink) (primary), var(--ink-soft) (secondary), var(--ink-faint) (muted/labels)
- Borders:   var(--line) (default), var(--line-soft) (faint dividers)
- Accent:    var(--accent) (the user's chosen accent), var(--accent-soft) (tint bg), var(--accent-ink) (text on tint)
- Radii:     var(--radius) (14px, big cards), var(--radius-sm) (10px, controls/inner cards)
- Shadow:    var(--shadow) (soft elevation), var(--shadow-lg) (hover/lifted)
- Heading font: var(--display) — a modern sans; use for titles/headings only.

Styling rules so it blends in seamlessly:
- The ROOT element must be transparent with NO outer border/card and NO shadow — the
  app already wraps you in a card. Use only padding (e.g. 4px) on the root.
- Section/sub-card surfaces: background var(--panel-2) or var(--panel), 1px solid var(--line),
  border-radius var(--radius-sm), padding 12-14px.
- Headings: font-family var(--display), font-weight 700, letter-spacing -0.02em,
  color var(--ink), ~14-15px.
- Body text ~13.5px, color var(--ink); secondary text var(--ink-soft); labels in
  sentence case ~12px, weight 500-600, color var(--ink-soft). Do NOT use uppercase
  "eyebrow" labels or wide letter-spacing — keep type natural and calm.
- Primary buttons: background var(--accent), color #fff, border none, border-radius 10px,
  padding 8px 14px, font-weight 600, cursor pointer. Secondary: background var(--panel),
  1px solid var(--line), color var(--ink). Add a subtle hover where natural.
- Pills/tags/chips: background var(--accent-soft), color var(--accent-ink),
  border-radius 20px, padding 2px 10px, font-size 11px, font-weight 600.
- Inputs/selects: background var(--panel), 1px solid var(--line), border-radius var(--radius-sm),
  padding 8px 10px, font 13px, color var(--ink), outline none.
- Checkboxes/toggles: when "on" use var(--accent); when off use var(--line) border.
- Layout: generous spacing (gaps 8-12px), rounded corners, airy. Use flex/grid for tidy alignment.
- Calm and refined — match a premium, minimal aesthetic. Avoid loud colors, emoji walls, or harsh borders.`

app.post('/api/generate-feature', async (req, res) => {
  const { label = '', description = '', text = '', backend, clientId } = req.body || {}
  if (!hasAccess(clientId))
    return res
      .status(402)
      .json({ configured: true, subscribed: false, error: 'Subscription required' })
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

// Lazy-load googleapis. It's a very large package that takes many seconds to
// import, which would otherwise block server startup for an OPTIONAL feature
// that's often not configured. We only pull it in the first time a Calendar
// route actually runs, so the server boots instantly.
let _googlePromise = null
function getGoogle() {
  if (!_googlePromise) {
    _googlePromise = import('googleapis').then((m) => m.google)
  }
  return _googlePromise
}

async function oauthClient() {
  const google = await getGoogle()
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ||
      `http://localhost:${PORT}/auth/google/callback`,
  )
}

// Returns an authed client, or null if not connected.
async function authedClient() {
  const tokens = loadTokens()
  if (!tokens) return null
  const client = await oauthClient()
  client.setCredentials(tokens)
  // Persist refreshed tokens so the refresh_token survives.
  client.on('tokens', (t) => saveTokens({ ...tokens, ...t }))
  return client
}

// Google returns 'invalid_grant' (and friends) when a refresh token has been
// revoked or expired — the connection is dead and won't recover on retry. Detect
// that so we can drop the stale tokens and let the user reconnect cleanly, rather
// than surfacing a permanent error against a connection that no longer exists.
function isAuthError(err) {
  const code = err?.response?.status || err?.code
  const reason =
    err?.response?.data?.error ||
    err?.errors?.[0]?.reason ||
    err?.message ||
    ''
  return (
    code === 401 ||
    /invalid_grant|invalid_token|token has been expired or revoked|unauthorized/i.test(
      String(reason),
    )
  )
}

app.get('/auth/google', async (_req, res) => {
  if (!calendarConfigured())
    return res.status(400).send('Google Calendar is not configured on the server.')
  const client = await oauthClient()
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  })
  res.redirect(url)
})

app.get('/auth/google/callback', async (req, res) => {
  try {
    const client = await oauthClient()
    const { tokens } = await client.getToken(req.query.code)
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
  const client = await authedClient()
  if (!client) return res.json({ connected: false, events: [] })
  try {
    const google = await getGoogle()
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
    if (isAuthError(err)) {
      // Connection is revoked/expired — clear it so the UI prompts a reconnect.
      clearTokens()
      return res.json({ connected: false, events: [] })
    }
    res.status(502).json({ connected: true, error: 'list_failed', events: [] })
  }
})

// Create an event the app owns (study session, test, briefing…).
app.post('/api/calendar/events', async (req, res) => {
  const client = await authedClient()
  if (!client) return res.status(409).json({ connected: false })
  try {
    const google = await getGoogle()
    const calendar = google.calendar({ version: 'v3', auth: client })
    const r = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: toGoogleEvent(req.body),
    })
    res.json({ connected: true, event: normalizeEvent(r.data) })
  } catch (err) {
    console.error('calendar insert error:', err?.message || err)
    if (isAuthError(err)) {
      clearTokens()
      return res.status(409).json({ connected: false })
    }
    res.status(502).json({ connected: true, error: 'insert_failed' })
  }
})

app.delete('/api/calendar/events/:id', async (req, res) => {
  const client = await authedClient()
  if (!client) return res.status(409).json({ connected: false })
  try {
    const google = await getGoogle()
    const calendar = google.calendar({ version: 'v3', auth: client })
    await calendar.events.delete({ calendarId: 'primary', eventId: req.params.id })
    res.json({ connected: true, ok: true })
  } catch (err) {
    console.error('calendar delete error:', err?.message || err)
    if (isAuthError(err)) {
      clearTokens()
      return res.status(409).json({ connected: false })
    }
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
const DIST_DIR = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
  console.log(`  Frontend: serving built app from ${DIST_DIR}`)
}

app.listen(PORT, () => {
  console.log(`Proactive Notes server on http://localhost:${PORT}`)
  console.log(`  Claude tier: ${haikuConfigured() ? `configured (${AI_MODEL})` : 'not configured'}`)
  console.log(`  Calendar: ${calendarConfigured() ? 'configured' : 'not configured'}`)
  console.log(
    `  Billing: ${
      BILLING_ENABLED
        ? billingConfigured()
          ? 'ENABLED + Stripe configured'
          : 'ENABLED but Stripe NOT configured (set STRIPE_SECRET_KEY + STRIPE_PRICE_ID)'
        : 'free mode (BILLING_ENABLED=false) — nothing gated'
    }`,
  )
})
