import './loadEnv.js' // MUST be first — populates process.env before other imports read it
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { saveTokens, loadTokens, clearTokens } from './tokenStore.js'
import {
  getEntitlement,
  isActive,
  hasCredit,
  activate,
  addCredit,
  recordUsage,
  setCap,
  planOf,
  hasClassifier,
  hasEvolve,
  setSubscription,
  resetCycle,
  cancelSubscription,
  entitlementsBackend,
} from './entitlementStore.js'
import {
  addSubscription,
  removeSubscription,
  syncReminders as syncPushReminders,
  getTarget,
  deleteTarget,
  pushBackend,
} from './pushStore.js'
import {
  pushConfigured,
  pushPublicKey,
  sendToTarget,
  runTick,
} from './push.js'

// Load server/.env explicitly relative to THIS file, so the keys load no matter
// where the process is launched from (project root via `npm start`, or the
// server dir via `npm run dev:server`). The default `dotenv/config` only checks
// the current working directory, which silently dropped the keys when started
// from the repo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

const PORT = process.env.PORT || 8787
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173'
// Two models split the work by what each is best at per pound:
//   • CODE (tool suggestions + tool generation) — Haiku: fast, cheap, and
//     plenty for emitting well-specified JSON and React components.
//   • KNOWLEDGE (enrichment + recommendations) — Sonnet: strong world
//     knowledge, and these routes also do live web search.
// AI_MODEL (if set) overrides BOTH — handy for testing one model everywhere.
const AI_MODEL_CODE =
  process.env.AI_MODEL || process.env.AI_MODEL_CODE || 'claude-haiku-4-5'
const AI_MODEL_KNOWLEDGE =
  process.env.AI_MODEL || process.env.AI_MODEL_KNOWLEDGE || 'claude-sonnet-5'

// Live web search for the world-knowledge routes (/api/enrich, /api/recommend).
// This is the biggest single lever on knowledge quality: the model can verify
// current products, events, and prices instead of relying on training data.
// Set WEB_SEARCH=false to disable (calls become cheaper but knowledge-only).
const WEB_SEARCH =
  String(process.env.WEB_SEARCH ?? 'true').toLowerCase() !== 'false'

// Hard ceiling on searches per call, enforced by the API (max_uses). Search
// result tokens dominate the cost of a knowledge call, so this — not the model
// choice — is the main cost lever. The prompts also tell the model to search
// only for the specific fact it's missing and stop, so it usually stays well
// under the cap; this just guarantees a call can't run away. Each route passes
// its own default (enrich needs one lookup; recommend may need a couple).
const MAX_SEARCHES = Number(process.env.MAX_SEARCHES || 2)

// The dynamic-filtering web search variant needs Opus 4.6+/Sonnet 4.6+; older
// or smaller models fall back to the basic variant.
function webSearchToolType(model) {
  const m = String(model).toLowerCase()
  const modern =
    /opus-4-[678]|opus-4\b|sonnet-5|sonnet-4-6|fable/.test(m)
  return modern ? 'web_search_20260209' : 'web_search_20250305'
}

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
// Billing — credit model. The whole app stays usable for free until
// BILLING_ENABLED=true, so you can keep building and testing without paying.
//
// When it's on:
//   • £10 one-time activation unlocks the Claude tools and includes £5 of AI
//     token credit (credit is measured in real token value).
//   • Every Claude call meters its actual Anthropic cost and deducts it.
//   • More usage is bought at £2 per £1 of tokens (a £4 top-up = £2 of credit).
//
// Everything is lazy/optional: with no Stripe key the billing endpoints simply
// report "not configured". No Stripe Price objects are needed — Checkout uses
// inline price_data.
// ---------------------------------------------------------------------------
const BILLING_ENABLED =
  String(process.env.BILLING_ENABLED || 'false').toLowerCase() === 'true'
const billingConfigured = () => !!process.env.STRIPE_SECRET_KEY

// The commercial knobs, all overridable per env (values in pence).
const ACTIVATION_PRICE_PENCE = Number(process.env.ACTIVATION_PRICE_PENCE || 1000) // £10 flat fee
const ACTIVATION_CREDIT_PENCE = Number(process.env.ACTIVATION_CREDIT_PENCE || 500) // includes £5 of tokens
const TOKEN_MARKUP = Number(process.env.TOKEN_MARKUP || 2) // £2 paid per £1 of tokens
const TOPUP_PRICE_PENCE = Number(process.env.TOPUP_PRICE_PENCE || 400) // default top-up: £4 → £2 of tokens
// Anthropic bills in USD; credit is in GBP pence. Fixed conversion, env-tunable.
const USD_TO_GBP = Number(process.env.USD_TO_GBP || 0.78)

// ---------------------------------------------------------------------------
// Recurring subscription plans (the current model). Two tiers, each billed
// monthly with independently-metered included usage pools; overage bills at
// OVERAGE_MARKUP pence per 1p of token value beyond a pool's allowance.
//   • classifier — £2/mo, includes £1 of classifier usage.
//   • evolve     — £12/mo, includes £5 of coding+world-knowledge ('ai' pool)
//                  AND £1 of classifier usage.
// All values in pence, env-tunable.
// ---------------------------------------------------------------------------
const CLASSIFIER_PRICE_PENCE = Number(process.env.CLASSIFIER_PRICE_PENCE || 200) // £2/mo
const CLASSIFIER_INCLUDED_PENCE = Number(process.env.CLASSIFIER_INCLUDED_PENCE || 100) // £1 classifier
const EVOLVE_PRICE_PENCE = Number(process.env.EVOLVE_PRICE_PENCE || 1200) // £12/mo
const EVOLVE_AI_INCLUDED_PENCE = Number(process.env.EVOLVE_AI_INCLUDED_PENCE || 500) // £5 coding+knowledge
const EVOLVE_CLASSIFIER_INCLUDED_PENCE = Number(
  process.env.EVOLVE_CLASSIFIER_INCLUDED_PENCE || 100,
) // £1 classifier
const OVERAGE_MARKUP = Number(process.env.OVERAGE_MARKUP || 2) // charge £2 per £1 of overage

// What a plan includes for a given usage pool ('ai' | 'classifier'), in pence.
function includedFor(plan, pool) {
  if (plan === 'classifier') return pool === 'classifier' ? CLASSIFIER_INCLUDED_PENCE : 0
  if (plan === 'evolve')
    return pool === 'classifier' ? EVOLVE_CLASSIFIER_INCLUDED_PENCE : EVOLVE_AI_INCLUDED_PENCE
  return 0
}
const planPrice = (plan) =>
  plan === 'evolve' ? EVOLVE_PRICE_PENCE : plan === 'classifier' ? CLASSIFIER_PRICE_PENCE : 0

// What the user would be CHARGED for usage beyond their plan this cycle: each
// pool's spill past its allowance, at the markup. This is the number the user's
// spend limit caps — the plan fee itself never counts toward it.
function overageChargePence(ent) {
  if (!ent || ent.plan === 'none') return 0
  return (
    Math.max(0, (ent.aiUsedPence || 0) - includedFor(ent.plan, 'ai')) * OVERAGE_MARKUP +
    Math.max(0, (ent.classifierUsedPence || 0) - includedFor(ent.plan, 'classifier')) *
      OVERAGE_MARKUP
  )
}

// A subscriber who set a limit stops at it, rather than being billed past what
// they chose to spend. (cap 0 = no limit.)
function capReached(ent) {
  return !!ent && ent.capPence > 0 && overageChargePence(ent) >= ent.capPence
}

// Comma-separated clientIds that are never billed — put your own browser's
// `evolve.clientId` (localStorage) here so YOU can keep testing a deployed app
// for free even with billing enabled for everyone else.
const FREE_CLIENT_IDS = new Set(
  String(process.env.FREE_CLIENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

// Free mode (billing off) → always allowed, so editing/trying never gets gated.
// With billing on, a client needs an activated account with credit remaining.
async function hasAccess(clientId) {
  if (!BILLING_ENABLED) return true
  if (clientId && FREE_CLIENT_IDS.has(clientId)) return true
  // New model: the Evolve subscription unlocks the coding/world-knowledge
  // features — unless the user's own spend limit has been reached.
  if (await hasEvolve(clientId)) {
    return !capReached(await getEntitlement(clientId))
  }
  // Legacy one-time credit, still honoured for pre-subscription accounts.
  return (await isActive(clientId)) && (await hasCredit(clientId))
}

// Classification is unlocked by EITHER paid plan (classifier or evolve), and
// stops at the user's spend limit like everything else.
async function hasClassifyAccess(clientId) {
  if (!BILLING_ENABLED) return true
  if (clientId && FREE_CLIENT_IDS.has(clientId)) return true
  if (!(await hasClassifier(clientId))) return false
  return !capReached(await getEntitlement(clientId))
}

// 402 payload that tells the frontend WHY: which plan is needed, or that the
// user's own spend limit stopped them. `need` is the capability the route wants.
async function paywallBody(clientId, extra = {}, need = 'evolve') {
  const ent = await getEntitlement(clientId)
  const money = (p) => `£${(p / 100).toFixed(2)}`

  // Subscribed, but they've hit the limit they set on beyond-plan usage.
  if (capReached(ent)) {
    return {
      configured: true,
      subscribed: false,
      reason: 'cap_reached',
      error:
        `You've reached the ${money(ent.capPence)} limit you set for usage beyond ` +
        `your plan. Raise or remove it to continue.`,
      ...extra,
    }
  }

  if (need === 'classifier') {
    return {
      configured: true,
      subscribed: false,
      reason: 'no_plan',
      error:
        `Sharper classification is part of the Classification ` +
        `(${money(CLASSIFIER_PRICE_PENCE)}/mo) and Evolve AI ` +
        `(${money(EVOLVE_PRICE_PENCE)}/mo) plans.`,
      ...extra,
    }
  }

  // Evolve features. Legacy credit accounts get the old top-up message.
  const active = await isActive(clientId)
  const legacyCredit = active && (ent?.plan || 'none') === 'none'
  return {
    configured: true,
    subscribed: false,
    reason: legacyCredit ? 'no_credit' : 'no_plan',
    error: legacyCredit
      ? 'AI credit used up — top up to continue.'
      : `The AI tools are part of Evolve AI (${money(EVOLVE_PRICE_PENCE)}/mo).`,
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Usage metering — real Anthropic cost per call, converted to GBP pence.
// Prices are USD per million tokens (input, output). Web search requests are
// billed by Anthropic at $10 per 1,000 searches on top of tokens.
// ---------------------------------------------------------------------------
const MODEL_PRICES_USD = [
  { match: /fable/, in: 10, out: 50 },
  { match: /opus/, in: 5, out: 25 },
  { match: /sonnet/, in: 3, out: 15 },
  { match: /haiku/, in: 1, out: 5 },
]
function priceForModel(model) {
  const m = String(model).toLowerCase()
  return MODEL_PRICES_USD.find((p) => p.match.test(m)) || { in: 5, out: 25 }
}
function usageCostPence(usage, model) {
  if (!usage) return 0
  const p = priceForModel(model)
  const inTok =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) * 1.25 +
    (usage.cache_read_input_tokens || 0) * 0.1
  const usd =
    (inTok * p.in + (usage.output_tokens || 0) * p.out) / 1_000_000 +
    (usage.server_tool_use?.web_search_requests || 0) * 0.01
  return usd * USD_TO_GBP * 100
}

// Deduct a call's cost from the client's usage. `pool` says which allowance it
// draws from — 'ai' (coding + world knowledge) or 'classifier' — so the Evolve
// plan can meter its two included pots independently. Metered even in free mode
// so `usedPence` shows what your users would have cost you.
async function meterUsage(clientId, costPence, pool = 'ai') {
  if (!clientId || !(costPence > 0)) return
  try {
    await recordUsage(clientId, costPence, pool)
  } catch (err) {
    console.error('metering error:', err?.message || err)
  }
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

// Supabase access tokens are HS256-signed with the project's JWT secret
// (Settings → API → JWT Secret). When SUPABASE_JWT_SECRET is set we verify the
// signature so a forged token can't impersonate another user (critical once
// billing is real). Without it we fall back to an UNVERIFIED decode — fine for
// local dev, but the startup log warns, and it must be set before charging.
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || ''

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function verifySupabaseJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  try {
    const header = JSON.parse(b64urlToBuf(h).toString())
    if (header.alg !== 'HS256') return null // only the shared-secret alg here
    const expected = createHmac('sha256', SUPABASE_JWT_SECRET)
      .update(`${h}.${p}`)
      .digest()
    const got = b64urlToBuf(sig)
    if (expected.length !== got.length || !timingSafeEqual(expected, got))
      return null
    const payload = JSON.parse(b64urlToBuf(p).toString())
    if (payload.exp && Date.now() / 1000 > payload.exp) return null // expired
    return payload
  } catch {
    return null
  }
}

// Legacy: decode without verifying the signature. Dev-only convenience.
function decodeJwtUnverified(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(b64urlToBuf(parts[1]).toString())
  } catch {
    return null
  }
}

// Auth middleware: extract the Supabase user id from the JWT (verified when a
// secret is configured), and fall back to the anonymous clientId otherwise.
app.use((req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = SUPABASE_JWT_SECRET
      ? verifySupabaseJwt(token)
      : decodeJwtUnverified(token)
    if (payload?.sub) req.userId = payload.sub // Supabase user UUID
    // A forged/expired token yields no userId → treated as anonymous below.
  }
  if (!req.userId) {
    req.clientId = req.query.clientId || (req.body?.clientId ?? null)
  }
  next()
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
    // Model names are intentionally not exposed to clients.
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

// What the frontend needs to decide whether to show a paywall, and — once
// billing is on — the live credit balance. In free mode `subscribed` is true
// for everyone so nothing is ever locked.
app.get('/api/billing/status', async (req, res) => {
  // Prefer userId (from Supabase JWT); fall back to clientId (legacy, for local-only)
  const key = req.userId || req.clientId
  const pricing = {
    // New subscription tiers.
    classifierPricePence: CLASSIFIER_PRICE_PENCE,
    classifierIncludedPence: CLASSIFIER_INCLUDED_PENCE,
    evolvePricePence: EVOLVE_PRICE_PENCE,
    evolveAiIncludedPence: EVOLVE_AI_INCLUDED_PENCE,
    evolveClassifierIncludedPence: EVOLVE_CLASSIFIER_INCLUDED_PENCE,
    overageMarkup: OVERAGE_MARKUP, // £ charged per £1 of usage beyond a pool's allowance
    // Legacy one-time credit model (kept for old accounts / back-compat).
    activationPence: ACTIVATION_PRICE_PENCE,
    includedCreditPence: ACTIVATION_CREDIT_PENCE,
    topupPence: TOPUP_PRICE_PENCE,
    tokenMarkup: TOKEN_MARKUP,
  }
  try {
    const [e, subscribed, active, classifier, evolve] = await Promise.all([
      getEntitlement(key),
      hasAccess(key),
      isActive(key),
      hasClassifyAccess(key),
      hasEvolve(key),
    ])
    const plan = e?.plan || 'none'
    const freeBypass = !!(key && FREE_CLIENT_IDS.has(key))
    res.json({
      billingEnabled: BILLING_ENABLED,
      billingConfigured: billingConfigured(),
      freeMode: !BILLING_ENABLED,
      subscribed,
      active: active || freeBypass,
      // Subscription state + the two metered pools this cycle.
      plan,
      hasClassifier: classifier || freeBypass || !BILLING_ENABLED,
      hasEvolve: evolve || freeBypass || !BILLING_ENABLED,
      pools: {
        ai: {
          usedPence: e ? Math.round(e.aiUsedPence * 100) / 100 : 0,
          includedPence: includedFor(plan, 'ai'),
        },
        classifier: {
          usedPence: e ? Math.round(e.classifierUsedPence * 100) / 100 : 0,
          includedPence: includedFor(plan, 'classifier'),
        },
      },
      periodEnd: e?.periodEnd || 0,
      // What beyond-plan usage would cost this cycle — the figure the user's
      // spend limit caps.
      overagePence: e ? Math.round(overageChargePence(e) * 100) / 100 : 0,
      creditPence: e ? Math.max(0, Math.round(e.creditPence * 100) / 100) : 0,
      usedPence: e ? Math.round(e.usedPence * 100) / 100 : 0,
      paidPence: e ? Math.round(e.paidPence) : 0,
      capPence: e ? Math.round(e.capPence) : 0,
      pricing,
    })
  } catch (err) {
    // A store read failure shouldn't 500 the UI. Fail closed on paid access
    // (report not subscribed unless we're in free mode).
    console.error('billing status error:', err?.message || err)
    res.json({
      billingEnabled: BILLING_ENABLED,
      billingConfigured: billingConfigured(),
      freeMode: !BILLING_ENABLED,
      subscribed: !BILLING_ENABLED,
      active: false,
      creditPence: 0,
      usedPence: 0,
      paidPence: 0,
      capPence: 0,
      pricing,
    })
  }
})

// Start a Stripe Checkout session for this client and return its URL.
// kind: 'activate' (£10 one-time, includes £5 of AI credit) or
//       'topup'    (buys credit at £{TOKEN_MARKUP} per £1 of tokens).
app.post('/api/billing/checkout', async (req, res) => {
  if (!BILLING_ENABLED) return res.json({ freeMode: true })
  if (!billingConfigured())
    return res.status(400).json({ error: 'Billing is not configured on the server.' })
  // Prefer userId (from JWT); fall back to clientId from body (legacy)
  const key = req.userId || req.body?.clientId
  const { kind = 'activate' } = req.body || {}
  if (!key) return res.status(400).json({ error: 'Missing auth or clientId' })

  // New model: recurring subscription plans. `kind` is the plan id.
  if (kind === 'classifier' || kind === 'evolve') {
    const plan = kind
    const amount = planPrice(plan)
    const name =
      plan === 'evolve'
        ? `Evolve AI — £${(EVOLVE_PRICE_PENCE / 100).toFixed(0)}/mo (incl. £${(
            EVOLVE_AI_INCLUDED_PENCE / 100
          ).toFixed(0)} coding & world knowledge + £${(
            EVOLVE_CLASSIFIER_INCLUDED_PENCE / 100
          ).toFixed(0)} classifier)`
        : `Classification — £${(CLASSIFIER_PRICE_PENCE / 100).toFixed(0)}/mo (incl. £${(
            CLASSIFIER_INCLUDED_PENCE / 100
          ).toFixed(0)} classifier usage)`
    try {
      const stripe = await getStripe()
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              product_data: { name },
              unit_amount: amount,
              recurring: { interval: 'month' },
            },
            quantity: 1,
          },
        ],
        client_reference_id: key,
        metadata: { key, plan },
        // Copy the key+plan onto the subscription so invoice/subscription
        // webhooks (which don't carry the checkout session) can resolve them.
        subscription_data: { metadata: { key, plan } },
        success_url: `${APP_ORIGIN}/?billing=success`,
        cancel_url: `${APP_ORIGIN}/?billing=cancel`,
      })
      return res.json({ url: session.url })
    } catch (err) {
      console.error('subscription checkout error:', err?.message || err)
      return res.status(502).json({ error: 'checkout_failed' })
    }
  }

  const isTopup = kind === 'topup'
  const amount = isTopup ? TOPUP_PRICE_PENCE : ACTIVATION_PRICE_PENCE

  // Respect the user's own spend limit. The limit is what they're willing to
  // spend ON TOP OF the one-time activation fee — i.e. it caps top-up spend, not
  // the entry fee. So activation is never blocked by the cap; only top-ups are,
  // and they're measured against how much they've already topped up (paid beyond
  // the activation price). (cap = 0 → no limit.)
  if (isTopup) {
    try {
      const ent = await getEntitlement(key)
      const cap = ent?.capPence || 0
      const paid = ent?.paidPence || 0
      const topupSpend = Math.max(0, paid - ACTIVATION_PRICE_PENCE)
      if (cap > 0 && topupSpend + amount > cap) {
        return res.status(400).json({
          error:
            `This top-up (£${(amount / 100).toFixed(2)}) would take you past the ` +
            `£${(cap / 100).toFixed(2)} spending limit you set for usage on top of ` +
            `your plan — you've added £${(topupSpend / 100).toFixed(2)} so far. ` +
            `Raise or clear your limit to continue.`,
          capReached: true,
          capPence: cap,
          topupPence: topupSpend,
          remainingPence: Math.max(0, cap - topupSpend),
        })
      }
    } catch (err) {
      console.error('cap check error:', err?.message || err)
      // Don't hard-block a purchase on a transient read error; fall through.
    }
  }

  const creditPence = isTopup
    ? Math.floor(TOPUP_PRICE_PENCE / TOKEN_MARKUP)
    : ACTIVATION_CREDIT_PENCE
  const name = isTopup
    ? `Evolve AI credit top-up (£${(creditPence / 100).toFixed(2)} of AI usage)`
    : `Evolve AI — one-time activation (includes £${(
        ACTIVATION_CREDIT_PENCE / 100
      ).toFixed(2)} of AI usage)`

  try {
    const stripe = await getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: { name },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      // client_reference_id ties the payment back to this client in the
      // webhook; metadata is a belt-and-braces copy plus the purchase kind.
      client_reference_id: key,
      metadata: { key, kind: isTopup ? 'topup' : 'activate' },
      success_url: `${APP_ORIGIN}/?billing=success`,
      cancel_url: `${APP_ORIGIN}/?billing=cancel`,
    })
    res.json({ url: session.url })
  } catch (err) {
    console.error('checkout error:', err?.message || err)
    res.status(502).json({ error: 'checkout_failed' })
  }
})

// Let a user set their own lifetime spend limit (in pence; 0 clears it). Keyed
// to the account so it follows them across devices and is enforced at checkout.
app.post('/api/billing/cap', async (req, res) => {
  const key = req.userId || req.body?.clientId
  if (!key) return res.status(400).json({ error: 'Missing auth or clientId' })
  const capPence = Math.max(0, Math.round(Number(req.body?.capPence) || 0))
  try {
    const rec = await setCap(key, capPence)
    res.json({ capPence: rec?.capPence ?? capPence })
  } catch (err) {
    console.error('set cap error:', err?.message || err)
    res.status(502).json({ error: 'Could not save your spending limit.' })
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
      const stripe = await getStripe()
      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object
          // checkout sets both client_reference_id and metadata.key to the
          // billing key (Supabase userId, or anonymous clientId).
          const clientId = s.client_reference_id || s.metadata?.key
          if (!clientId) break
          // New: subscription checkouts start a plan and set its billing window.
          if (s.mode === 'subscription' && s.metadata?.plan) {
            const sub = s.subscription ? await stripe.subscriptions.retrieve(s.subscription) : null
            await setSubscription(clientId, {
              plan: s.metadata.plan,
              subscriptionId: s.subscription ?? null,
              customerId: s.customer ?? null,
              periodStart: sub ? sub.current_period_start * 1000 : Date.now(),
              periodEnd: sub ? sub.current_period_end * 1000 : null,
              paidPence: s.amount_total ?? planPrice(s.metadata.plan),
            })
            break
          }
          // Legacy one-time credit model.
          if (s.metadata?.kind === 'topup') {
            const credit = Math.floor((s.amount_total ?? 0) / TOKEN_MARKUP)
            await addCredit(clientId, credit, s.amount_total ?? 0)
          } else {
            await activate(clientId, {
              customerId: s.customer,
              creditPence: ACTIVATION_CREDIT_PENCE,
              paidPence: s.amount_total ?? ACTIVATION_PRICE_PENCE,
            })
          }
          break
        }
        // A renewal payment. Bill the just-ended cycle's overage (one cycle in
        // arrears, via an invoice item on the next invoice), then reset pools.
        case 'invoice.paid': {
          const inv = event.data.object
          if (inv.billing_reason !== 'subscription_cycle') break // create handled above
          const clientId = inv.subscription_details?.metadata?.key || inv.metadata?.key
          if (!clientId) break
          const ent = await getEntitlement(clientId)
          if (!ent || ent.plan === 'none') break
          await billOverage(stripe, ent, inv.customer)
          const sub = inv.subscription
            ? await stripe.subscriptions.retrieve(inv.subscription)
            : null
          await resetCycle(clientId, {
            periodStart: sub ? sub.current_period_start * 1000 : Date.now(),
            periodEnd: sub ? sub.current_period_end * 1000 : null,
            paidPence: inv.amount_paid ?? 0,
          })
          break
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object
          const clientId = sub.metadata?.key
          if (clientId) await cancelSubscription(clientId)
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

// Compute a subscriber's overage for the ending cycle (each pool beyond its
// included allowance, charged at OVERAGE_MARKUP) and add it as an invoice item
// on the customer, so it lands on the upcoming invoice. No-op when nothing's owed.
async function billOverage(stripe, ent, customerId) {
  if (!customerId) return
  const pools = [
    { pool: 'ai', used: ent.aiUsedPence || 0 },
    { pool: 'classifier', used: ent.classifierUsedPence || 0 },
  ]
  let overagePence = 0
  for (const { pool, used } of pools) {
    const over = Math.max(0, used - includedFor(ent.plan, pool))
    overagePence += over * OVERAGE_MARKUP
  }
  overagePence = Math.round(overagePence)
  if (overagePence <= 0) return
  await stripe.invoiceItems.create({
    customer: customerId,
    currency: 'gbp',
    amount: overagePence,
    description: `AI usage over your plan's included allowance (£${(overagePence / 100).toFixed(2)})`,
  })
}

// ---------------------------------------------------------------------------
// Web Push — closed-app reminder notifications.
//
// Flow: the browser subscribes (service worker + VAPID public key) and POSTs the
// PushSubscription here; it also uploads a compact projection of its reminders
// whenever they change. A cron pinger hits /api/cron/tick every few minutes; the
// sweep sends a notification for each reminder that's come due. The push key is
// the same billing key used elsewhere (Supabase userId, else anonymous clientId).
// ---------------------------------------------------------------------------
const pushKeyOf = (req) => req.userId || req.clientId || req.body?.clientId

// The browser needs the VAPID public key to create a subscription.
app.get('/api/push/config', (_req, res) => {
  res.json({ configured: pushConfigured(), publicKey: pushPublicKey || null })
})

// Register (or refresh) a device's push subscription.
app.post('/api/push/subscribe', async (req, res) => {
  const key = pushKeyOf(req)
  if (!key) return res.status(400).json({ error: 'Missing auth or clientId' })
  const { subscription, tzOffset } = req.body || {}
  if (!subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'Invalid subscription' })
  }
  try {
    await addSubscription(
      key,
      { ...subscription, ua: req.headers['user-agent'] || '' },
      Number(tzOffset),
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('push subscribe error:', err?.message || err)
    res.status(503).json({
      error:
        'Reminders storage isn’t set up on the server yet (the push_targets table is missing).',
    })
  }
})

// Drop a device subscription (reminders turned off, or client cleaning up).
app.post('/api/push/unsubscribe', async (req, res) => {
  const key = pushKeyOf(req)
  if (!key) return res.status(400).json({ error: 'Missing auth or clientId' })
  const endpoint = req.body?.endpoint
  try {
    if (endpoint) await removeSubscription(key, endpoint)
    else await deleteTarget(key)
    res.json({ ok: true })
  } catch (err) {
    console.error('push unsubscribe error:', err?.message || err)
    res.status(502).json({ error: 'Could not remove your subscription.' })
  }
})

// Upload the current reminder schedule + completion state so the sweep knows
// what's due. Sent by the client whenever reminders change.
app.post('/api/push/sync', async (req, res) => {
  const key = pushKeyOf(req)
  if (!key) return res.status(400).json({ error: 'Missing auth or clientId' })
  const { reminders, tzOffset } = req.body || {}
  try {
    await syncPushReminders(key, reminders, Number(tzOffset))
    res.json({ ok: true })
  } catch (err) {
    console.error('push sync error:', err?.message || err)
    res.status(502).json({ error: 'Could not sync reminders.' })
  }
})

// Fire a one-off test push to this key's devices, so the user can confirm
// notifications actually arrive after enabling them.
app.post('/api/push/test', async (req, res) => {
  const key = pushKeyOf(req)
  if (!key) return res.status(400).json({ error: 'Missing auth or clientId' })
  if (!pushConfigured()) return res.status(400).json({ error: 'Push not configured' })

  // Read the device record first. A throw here means the storage backend isn't
  // ready (most commonly the Supabase `push_targets` table hasn't been created)
  // — report that specifically instead of a generic "couldn't send".
  let rec
  try {
    rec = await getTarget(key)
  } catch (err) {
    console.error('push test — store read failed:', err?.message || err)
    return res.status(503).json({
      error:
        'Reminders storage isn’t set up on the server yet (the push_targets table is missing). Once it’s created this will work.',
    })
  }

  if (!rec?.subscriptions?.length) {
    return res.status(400).json({
      error: 'No devices are registered on the server. Turn reminders off and back on, then try again.',
    })
  }

  try {
    const { sent, failures } = await sendToTarget(rec, {
      title: 'Reminders are on 🔔',
      body: "You'll get a nudge here even when the app is closed.",
      tag: 'evolve-test',
      url: '/',
    })
    if (sent === 0) {
      // Every send was rejected — surface why rather than claiming success.
      const reason = failures?.[0]?.reason || 'the push service rejected it'
      return res.status(502).json({ error: `Couldn’t deliver the test — ${reason}.` })
    }
    res.json({ ok: true, sent })
  } catch (err) {
    console.error('push test — send failed:', err?.message || err)
    res.status(502).json({ error: 'Could not send a test notification.' })
  }
})

// Cron endpoint — the external pinger (e.g. cron-job.org) calls this every few
// minutes. It both wakes a sleeping free-tier server and fires due reminders.
// Guard with CRON_SECRET so only your pinger can trigger sends.
const CRON_SECRET = (process.env.CRON_SECRET || '').trim()
app.all('/api/cron/tick', async (req, res) => {
  if (CRON_SECRET) {
    const given = req.query.secret || req.headers['x-cron-secret']
    if (given !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const result = await runTick()
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('cron tick error:', err?.message || err)
    res.status(500).json({ error: 'tick failed' })
  }
})

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

// Claude via the official SDK. We use a `respond` tool to get structured JSON —
// the most widely-supported method across models and SDK versions.
//
// When `webSearch` is set (world-knowledge routes), the Anthropic-hosted web
// search tool is added so the model can check live, current information before
// answering. Search runs server-side inside the same request; we loop on
// pause_turn in case the search loop needs continuing. tool_choice must be
// 'auto' in that case (a forced tool would prevent searching), so we also
// fall back to parsing JSON out of plain text.
//
// Every call meters its real cost against the client's credit.
async function callClaude({
  model,
  system,
  user,
  schema,
  maxTokens,
  webSearch,
  maxSearches,
  clientId,
  pool = 'ai',
}) {
  const anthropic = await getAnthropic()
  const useSearch = !!webSearch && WEB_SEARCH
  const tools = [
    {
      name: 'respond',
      description:
        'Return the final structured result for the request. Always finish by calling this exactly once.',
      input_schema: schema || { type: 'object' },
    },
  ]
  if (useSearch) {
    // Cap searches per call. Route asks for what it needs; MAX_SEARCHES is the
    // absolute ceiling so no call can run away. min() keeps it honest.
    const cap = Math.max(1, Math.min(maxSearches ?? MAX_SEARCHES, MAX_SEARCHES))
    tools.push({ type: webSearchToolType(model), name: 'web_search', max_uses: cap })
  }

  let messages = [{ role: 'user', content: user }]
  let costPence = 0
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        tool_choice: useSearch ? { type: 'auto' } : { type: 'tool', name: 'respond' },
        messages,
      })
      costPence += usageCostPence(msg.usage, model)

      // Server-side tool loop hit its iteration cap — resume where it left off.
      if (msg.stop_reason === 'pause_turn') {
        messages = [...messages, { role: 'assistant', content: msg.content }]
        continue
      }

      const block = msg.content.find(
        (b) => b.type === 'tool_use' && b.name === 'respond',
      )
      if (block) return block.input || {}
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      return parseJSON(text)
    }
    throw new Error('model did not finish after several continuations')
  } finally {
    await meterUsage(clientId, costPence, pool)
  }
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
- Search discipline: if you already know exactly what the candidate is and nothing about it is
  time-sensitive, DON'T search — just answer. Only search when you're missing a specific fact you
  need (a current date, this year's edition, whether it still exists). When you do search, run ONE
  targeted query for exactly that fact, read the result, and stop — do not explore, cross-check, or
  look up tangential details. Never search more than once.
- Only set recognized=true when you can confidently tie the candidate to ONE specific, real entity.
  If it's ambiguous, a common personal name, or something you can't place, set recognized=false.
- Do not fabricate. Never invent dates, prices, or specifics you're unsure of — but DO include
  concrete dates/facts you verified via search.

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
  const { text = '', candidate = '', backend } = req.body || {}
  const key = req.userId || req.body?.clientId
  if (!(await hasAccess(key))) return res.status(402).json(await paywallBody(key))
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false })
  if (!candidate.trim()) return res.json({ configured: true, recognized: false })

  try {
    const data = await generateJSON(resolved, {
      model: AI_MODEL_KNOWLEDGE,
      system: ENRICH_SYSTEM,
      user: `${todayContext()}\n\nNote: "${text}"\nCandidate term: "${candidate}"`,
      schema: ENRICH_SCHEMA,
      maxTokens: 2048,
      webSearch: true,
      // Identifying one entity is a single-lookup job.
      maxSearches: 1,
      clientId: key,
    })
    res.json({ configured: true, ...data })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`enrich error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg })
  }
})

// ---------------------------------------------------------------------------
// Classification — the paid upgrade over the local keyword classifier. Fires
// ONLY when the local engine is uncertain (see useRemoteClassify on the client),
// so most notes never reach it. Cheap: Haiku, no web search — well under 1p a
// call. Meters into the 'classifier' pool so it bills separately from the
// coding/world-knowledge features.
// ---------------------------------------------------------------------------
const NOTE_KINDS = [
  'academic',
  'event',
  'project',
  'goal',
  'tasks',
  'purchase',
  'health',
  'finance',
  'travel',
  'recipe',
  'media',
  'general',
]

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: NOTE_KINDS },
    topic: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['kind', 'topic', 'confidence'],
  additionalProperties: false,
}

const CLASSIFY_SYSTEM = `You classify a short personal note by the user's INTENT — what they want to DO with it —
not by world knowledge. Pick exactly ONE kind from this fixed set, choosing by what the note is
FOR:
- academic: studying for a test/exam, revising a subject, coursework.
- event: a dated thing to attend or watch — concert, match, wedding, meeting, appointment with a time.
- project: something to BUILD, make, or prepare — an app, a website, a work presentation, a deliverable.
- goal: a personal habit or ongoing goal — exercise, meditate, read more, save regularly.
- tasks: a to-do list / checklist / errands — several things to get done.
- purchase: deciding on or researching a specific product to BUY.
- health: medical / wellbeing — doctor or dentist appointments, medication, symptoms, treatment.
- finance: money admin — bills, rent, tax, statements, budgeting chores.
- travel: a TRIP to plan — itinerary, flights, hotels, packing, a place you're going.
- recipe: a meal to cook — ingredients and steps.
- media: things to watch / read / listen to — a watchlist, reading list.
- general: a plain note that fits none of the above.

Guidance:
- Judge by the dominant intent. "work presentation" is something you PREPARE → project, NOT academic.
  "trip to Oman" is a place you're going → travel, NOT a generic event. "dentist Friday 2pm" → health.
- A single strong cue is enough; you don't need many words.
- Also return "topic": a short 1-3 word label (Title Case) naming what the note is ABOUT
  (e.g. "Oman", "Work Presentation", "Sourdough Bread"). Keep it concrete and specific.
- "confidence" is your genuine certainty (0..1).
Return JSON only.`

app.post('/api/classify', async (req, res) => {
  const { text = '', localKind = '', localConfidence = 0, backend } = req.body || {}
  const key = req.userId || req.body?.clientId
  if (!(await hasClassifyAccess(key)))
    return res.status(402).json(await paywallBody(key, { classified: false }, 'classifier'))
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false })
  if (text.trim().length < 3) return res.json({ configured: true, classified: false })

  try {
    const data = await generateJSON(resolved, {
      model: AI_MODEL_CODE,
      system: CLASSIFY_SYSTEM,
      user: `Note:\n"""\n${text}\n"""\n\nThe local classifier guessed "${localKind}" at ${Math.round(
        Number(localConfidence) * 100,
      )}% confidence, but it was unsure. Decide the correct kind yourself.`,
      schema: CLASSIFY_SCHEMA,
      maxTokens: 256,
      clientId: key,
      pool: 'classifier',
    })
    res.json({
      configured: true,
      classified: true,
      kind: data.kind,
      topic: data.topic,
      confidence: data.confidence,
    })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`classify error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, classified: false, error: msg })
  }
})

// ---------------------------------------------------------------------------
// Tailored basic questions (Classifier + Evolve tiers). Cheap Haiku call, no
// web search. Given a classified note, write 2-3 basic clarifying questions
// specific to its topic — the thing that makes the paid classifier feel like it
// actually engages with the note rather than only labelling it.
// ---------------------------------------------------------------------------
const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          chips: { type: 'array', items: { type: 'string' } },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

const QUESTIONS_SYSTEM = `You help a notes app ask a person a few BASIC clarifying questions about a note
they just wrote, tailored to what it's specifically about.

Rules:
- Return 2-3 questions, most useful first. Never more than 3.
- Each must be BASIC and concrete — the obvious things you'd need to know to help
  with THIS note ("When are you travelling?", "How many days in Oman?",
  "Who's going with you?"). Never abstract, open-ended, or essay-style.
- Tailor to the note's actual topic: reference the real place / subject / product
  where it reads naturally.
- Give 2-4 short tappable answer "chips" when the answer is likely one of a few
  options (durations, yes/no, budgets, counts). Omit "chips" for genuinely open
  questions (names, free text).
- Keep each question under ~8 words. Friendly, plain language. No preamble.
Return JSON only.`

app.post('/api/questions', async (req, res) => {
  const { text = '', kind = '', topic = '', backend } = req.body || {}
  const key = req.userId || req.body?.clientId
  if (!(await hasClassifyAccess(key)))
    return res.status(402).json(await paywallBody(key, { questions: [] }, 'classifier'))
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false, questions: [] })
  if (text.trim().length < 3) return res.json({ configured: true, questions: [] })

  try {
    const data = await generateJSON(resolved, {
      model: AI_MODEL_CODE,
      system: QUESTIONS_SYSTEM,
      user: `Note:\n"""\n${text}\n"""\n\nDetected category: ${
        kind || 'unknown'
      }${topic ? `; topic: ${topic}` : ''}.\nWrite the 2-3 basic questions.`,
      schema: QUESTIONS_SCHEMA,
      maxTokens: 400,
      clientId: key,
      pool: 'classifier',
    })
    res.json({ configured: true, questions: (data.questions ?? []).slice(0, 3) })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`questions error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg, questions: [] })
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
  const { text = '', backend } = req.body || {}
  const key = req.userId || req.body?.clientId
  if (!(await hasAccess(key)))
    return res.status(402).json(await paywallBody(key, { suggestions: [] }))
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false, suggestions: [] })
  if (!text.trim()) return res.json({ configured: true, suggestions: [] })

  console.log(`/api/suggest via ${resolved}`)
  try {
    const data = await generateJSON(resolved, {
      model: AI_MODEL_CODE,
      system: SUGGEST_SYSTEM,
      user: `Note:\n"""\n${text}\n"""`,
      schema: SUGGEST_SCHEMA,
      maxTokens: 1024,
      clientId: key,
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
    // Concrete next steps to take — things to DO, not things to look at.
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' }, // short imperative step
          detail: { type: 'string' }, // one line on how / why / when
        },
        required: ['action', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['heading', 'recommendations', 'actions'],
  additionalProperties: false,
}

const RECOMMEND_SYSTEM = `You recommend concrete, real-world things based on a personal note. You have broad world
knowledge AND (when available) a web_search tool — use both fully. Read the note, infer the
person's intent, budget signals, skill level, and context, then name SPECIFIC real things:
exact product models, brands, places, books, apps, tools, services, or people to follow.

Rules:
- Search discipline — search ONLY for exactly what you need and nothing more:
  • If your existing knowledge already answers the note well (timeless picks — classic books,
    established places, core techniques, well-known tools), DON'T search at all. Just answer.
  • Only search when currency genuinely matters (this year's models, recent releases, an upcoming
    event's details). When you do, run ONE broad query that covers the whole set of picks at once
    (e.g. "best flagship phones 2026 UK price"), read it, and write your answer. Do NOT do a
    separate search per recommendation, and do NOT verify each price or spec individually.
  • Only run a second search if the note clearly spans two unrelated things to look up. Never more.
- Return 3-5 recommendations, best-first (the single most useful pick is #1). Each must be a
  real, identifiable thing — a precise model name ("iPhone 17 Pro", not "a good phone"), a real
  place, a real title — never a generic category.
- Be CURRENT and PRECISE: name the actual current-generation model, the well-known author's
  actual book, the real neighbourhood. Distinguish tiers (budget vs flagship, beginner vs
  advanced) and pick to match the note's cues.
- "detail" is one tight, information-dense line on why THIS pick fits THIS note — mention the
  concrete tradeoff or standout trait (e.g. "titanium build, best camera, priced highest"). An
  approximate price is welcome ONLY if you just verified it via search; otherwise stay qualitative.
- "kind" is a short noun label: Product, Place, Book, App, Tool, Brand, Resource, Dish, Person, etc.
- NEVER invent prices, links, ratings, or stock you didn't verify. Prefer well-established,
  verifiable options over obscure ones you're unsure exist.
- "heading" is a short, friendly title tailored to the note
  (e.g. "iPhones to consider", "Spots to check out in Lisbon", "Reads on habit-building").

Also return "actions": 3-5 concrete NEXT STEPS the person should take to move this
note forward — things to DO, distinct from the "things worth a look" above.
- Each is a short imperative "action" (under ~8 words) plus a one-line "detail" on
  how, why, or when. Tailor to the note's specifics and be genuinely useful.
- Order best-first (the highest-leverage next step is #1). Concrete and doable, not
  vague ("Book flights 6-8 weeks out" not "Plan your trip").
- Examples: "buying a laptop" -> "Set a hard budget", "Check for student discount",
  "Compare 2-3 shortlisted models". "trip to Oman" -> "Check visa requirements for
  your passport", "Book flights 6-8 weeks ahead", "Pack for 35°C+ heat".

Examples of recommendations:
- "buying a budget laptop for uni" -> heading "Laptops worth a look"; specific current models spanning price tiers, each with its tradeoff.
- "weekend in Lisbon" -> heading "Spots to check out"; real neighbourhoods, landmarks, and a signature dish.
- "learning to cook Thai food" -> heading "Where to start"; real dishes, a classic named cookbook, key pantry ingredients.`

app.post('/api/recommend', async (req, res) => {
  const { text = '', backend } = req.body || {}
  const key = req.userId || req.body?.clientId
  if (!(await hasAccess(key)))
    return res.status(402).json(await paywallBody(key, { recommendations: [] }))
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false, recommendations: [] })
  if (text.trim().length < 8)
    return res.json({ configured: true, recommendations: [] })

  console.log(`/api/recommend via ${resolved}`)
  try {
    const data = await generateJSON(resolved, {
      model: AI_MODEL_KNOWLEDGE,
      system: RECOMMEND_SYSTEM,
      user: `${todayContext()}\n\nNote:\n"""\n${text}\n"""`,
      schema: RECOMMEND_SCHEMA,
      maxTokens: 2048,
      webSearch: true,
      // One broad search usually covers a set of picks; allow a second only
      // when a note spans two distinct things to look up.
      maxSearches: 2,
      clientId: key,
    })
    res.json({
      configured: true,
      heading: data.heading ?? 'Worth a look',
      recommendations: data.recommendations ?? [],
      actions: data.actions ?? [],
    })
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`recommend error [${resolved}]:`, msg)
    res.status(502).json({ configured: true, error: msg, recommendations: [], actions: [] })
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
  const { label = '', description = '', text = '', backend } = req.body || {}
  const key = req.userId || req.body?.clientId
  if (!(await hasAccess(key))) return res.status(402).json(await paywallBody(key))
  const resolved = resolveBackend(backend)
  if (!resolved) return res.json({ configured: false })
  if (!label.trim()) return res.json({ configured: true, code: '' })

  try {
    const data = await generateJSON(resolved, {
      model: AI_MODEL_CODE,
      system: GENERATE_SYSTEM,
      user: `Build a component that is: "${label}" — ${description}\n\nTailored to this note:\n"""\n${text}\n"""`,
      schema: GENERATE_SCHEMA,
      maxTokens: 8192,
      clientId: key,
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
  console.log(
    `  Claude tier: ${
      haikuConfigured()
        ? `configured (code: ${AI_MODEL_CODE} · knowledge: ${AI_MODEL_KNOWLEDGE}, web search ${
            WEB_SEARCH ? 'on' : 'off'
          })`
        : 'not configured'
    }`,
  )
  console.log(`  Calendar: ${calendarConfigured() ? 'configured' : 'not configured'}`)
  console.log(
    `  Billing: ${
      BILLING_ENABLED
        ? billingConfigured()
          ? `ENABLED — £${(ACTIVATION_PRICE_PENCE / 100).toFixed(0)} activation incl. £${(
              ACTIVATION_CREDIT_PENCE / 100
            ).toFixed(2)} credit, £${TOKEN_MARKUP} per £1 of tokens after`
          : 'ENABLED but Stripe NOT configured (set STRIPE_SECRET_KEY)'
        : 'free mode (BILLING_ENABLED=false) — nothing gated'
    }`,
  )
  console.log(
    `  Auth: Supabase JWT ${
      SUPABASE_JWT_SECRET ? 'signature-verified' : 'UNVERIFIED (dev only)'
    }`,
  )
  // Loud warning: charging real money while trusting unverified tokens lets
  // anyone forge a user id. Set SUPABASE_JWT_SECRET before going live.
  if (BILLING_ENABLED && !SUPABASE_JWT_SECRET) {
    console.warn(
      '  ⚠️  Billing is ON but SUPABASE_JWT_SECRET is unset — auth tokens are NOT verified.\n' +
        '      Set it (Supabase → Settings → API → JWT Secret) before charging real money.',
    )
  }
  console.log(
    `  Entitlements: ${
      entitlementsBackend === 'supabase'
        ? 'Supabase (survives redeploys)'
        : 'flat file server/.subscriptions.json'
    }`,
  )
  // Ephemeral-filesystem warning: the flat file resets on redeploy/restart on
  // most PaaS free tiers, wiping paid credit. Fine for testing only.
  if (BILLING_ENABLED && entitlementsBackend === 'file') {
    console.warn(
      '  ⚠️  Entitlements are on the flat file — paid credit is LOST on redeploy.\n' +
        '      Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to persist before live billing.',
    )
  }
  console.log(
    `  Push reminders: ${
      pushConfigured()
        ? `configured (targets in ${
            pushBackend === 'supabase' ? 'Supabase' : 'flat file server/.push.json'
          })`
        : 'not configured (set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY)'
    }`,
  )
})

// Safety-net internal sweep: while the server is awake, fire due reminders every
// 60s even without an external pinger (this alone is enough on an always-on
// host). On a free tier that sleeps, the external cron pinger is what wakes it —
// see /api/cron/tick. No-op when push isn't configured.
if (pushConfigured()) {
  setInterval(() => {
    runTick().catch((err) => console.error('internal tick error:', err?.message || err))
  }, 60000)
}
