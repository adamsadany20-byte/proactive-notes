# Proactive Notes Codebase Guide

## Where things stand (14 Jul 2026)

The app is **live on Render** (auto-deploys from `main`), with Supabase accounts +
Stripe on a **live key**, but it hasn't been advertised — so there are **no real
customers yet**. `BILLING_ENABLED=true` in production; it defaults to `false`
everywhere else (free mode = nothing gated).

Most recent session, in order:
1. **Mobile + streak redesign** — the ember palette, an SVG progress ring, a
   drawn `FlameIcon`, a solid top bar, and notch/home-indicator safe areas.
   (See "Visual Design" + "UI Patterns → Mobile".)
2. **Open-ended categories** — kinds went 7 → 12, and a *second, unbounded*
   `topic` layer was added. (See "Two-layer classification".)
3. **Cloud classification** — the local keyword classifier was mislabelling
   ("work presentation" → academic, "trip to oman" → event); Claude now
   re-classifies **only when the local engine is unsure**. (See "Cloud
   classification".)
4. **Billing switched from one-time credit → two recurring subscriptions**
   (Classification £2/mo, Evolve AI £12/mo with two metered pools), and the spend
   cap was rewired to limit **overage** instead of a dead top-up path. (See
   "Billing".)

**Before charging anyone:** the Stripe subscription path has never run against
real Stripe — see "Known Limitations". The `entitlements` subscription-columns
migration has been applied, and the webhook must subscribe to
`checkout.session.completed`, `invoice.paid`, and `customer.subscription.deleted`.

## Recent Work (Jul 2026)

### Auto-suggested Google Docs / Sheets / Slides

Senses when a note wants a real document and offers a one-tap chip under the
editor to spin one up in the user's Google account, seeded with the note's
content and linked back onto the note.
- **Detection** — `detectDocNeed(note)` in [engine/docs.ts](src/engine/docs.ts)
  is pure/deterministic/local (mirrors `patterns.ts`): explicit type words
  ("presentation" → slides, "budget/spreadsheet" → sheet, "essay/report" → doc)
  win at high confidence; else a kind lean (`finance`/`purchase` → sheet); else
  soft table/writing hints on longer notes. Returns null for plain notes so it
  never nags. We deliberately **suggest, not auto-open** — literally opening a
  tab unprompted is hostile (popup blockers, wrong account).
- **UI** — [DocSuggestion.tsx](src/components/DocSuggestion.tsx), rendered under
  `SmartSuggestions` in [NoteEditor.tsx](src/components/NoteEditor.tsx). Primary
  chip is the sensed type; the other two are offered as alternates; a × dismisses
  that type for the note (`Note.docsDeclined`). Created files list under it and
  persist (`Note.docs: DocLink[]`, synced via the whole-note Supabase row).
  Per-type accents: doc blue, sheet green, slides amber.
- **Creation** — `POST /api/google/create` (server/index.js) creates the file via
  the Docs/Sheets/Slides APIs and seeds it (doc: note text as body; sheet:
  lines→rows, commas→cols via `seedToRows`; slides: note title/subtitle on the
  title slide), returning `{id, url}`. Uses `authedClient()` (the same googleapis
  OAuth client the calendar uses). `SCOPES` is **only `drive.file`** — a
  NON-SENSITIVE scope that still creates + seeds all three file types (per-file
  access to app-created files is enough for the Docs/Sheets/Slides APIs). This is
  deliberate: the broad `documents`/`spreadsheets`/`presentations`/
  `calendar.events` scopes are *sensitive*, which triggers Google's "unverified
  app" warning + a verification review. Do NOT re-add them. `/api/config` reports
  `googleConfigured`/`googleConnected`.
- **Google access is granted AT LOGIN, not a separate step.** "Continue with
  Google" ([AuthGate.tsx](src/components/AuthGate.tsx)) requests the doc scopes +
  `access_type:offline` + `prompt:consent` via Supabase `signInWithOAuth`. The
  returned `provider_refresh_token`/`provider_token` (only present on the fresh
  redirect, captured in `onAuthStateChange`) is POSTed to `POST /api/google/link`,
  which stores it (`refresh_token` + `expiry_date:1` to force a refresh on first
  use). `linkGoogleTokens` then fires a `google-linked` window event; App.tsx
  refetches config so `googleConnected` flips true without a reload. **This means
  the Google OAuth client in the Supabase dashboard MUST be the same
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` the server uses** — only the issuing
  client can refresh the token.
- **Fallbacks** — email/OTP sign-in has no Google link, so the chip shows a
  "Connect Google" link → `connectGoogle()` → the server `/auth/google` flow
  (redirects back with `?google=connected`). If Google isn't connected at all,
  the chip opens a blank `docs.new`/`sheets.new`/`slides.new` (no title/seed, not
  linked back).
- **Setup / caveat**: enable the Docs/Sheets/Slides/Drive APIs on the shared
  Google Cloud OAuth client, and set it as the Supabase Google provider. Since
  the only scope is the non-sensitive `drive.file`, publishing the OAuth consent
  screen to "In production" needs **no** Google verification and shows no warning.
  (While the consent screen is in "Testing", only accounts added under Test users
  can sign in.) Not yet run against real Google OAuth end-to-end.

### Local pattern recognition (free tier, no network)

Deterministic on-device intelligence surfaced as a quiet strip under the editor
([SmartSuggestions.tsx](src/components/SmartSuggestions.tsx), rendered in
[NoteEditor.tsx](src/components/NoteEditor.tsx)). All logic is pure functions in
[engine/patterns.ts](src/engine/patterns.ts):
- **List continuation** — `detectListPattern(text)` spots an ordered list the
  user is mid-writing (`1) 2)`, `a) b)`, `1a) 1b)` compound, `Step 1/2`,
  bullets, `[ ]` checkboxes) and returns the next marker. Compound rolls the
  letter and carries into the number (`1z)`→`2a)`). Offers only once the current
  item has content. The chip appends `\n<marker> ` and refocuses the textarea.
- **Shopping lists** — `detectShoppingList(text)` fires on an explicit cue
  ("shopping list", "groceries", "pick up from Tesco"…) or a short list whose
  items are dominated by a grocery lexicon; extracts the items (line- or
  comma-split, markers stripped).
- **Temporal cadence** — `describeCadence(timestamps)` learns a weekly shopping
  rhythm from the habit log (dominant weekday with ≥2 shops → "Tuesday
  evenings" + next date/time). Surfaced as a personalised suggestion instead of
  re-asking. Backed by a local-only `habits.shoppingLog` slice in
  [appStore.tsx](src/store/appStore.tsx) (`LOG_SHOPPING` action / `logShopping`,
  de-dupes within an hour, capped at 60; persisted to localStorage, never synced
  to Supabase). "Plan this shop" appends a timestamp.

### Two-layer classification: bounded `kind` + open-ended `topic`

`NoteKind` must stay bounded — it decides which **tools** get built
(`desiredTypes()` in [reconcile.ts](src/store/reconcile.ts)), and someone has to
have written each tool. So "unlimited categories" is a **second layer**:
`Note.topic` is an **unbounded**, locally-derived label for what a note is
*about* ("Oman", "Sourdough Bread", "Work Presentation").
[engine/topics.ts](src/engine/topics.ts) `deriveTopic(text, entities, kind)` does
lightweight keyword extraction — drop stopwords + intent verbs ("want to buy…"),
score the rest by frequency, proper-noun-ness, a domain lexicon and position,
prefer adjacent pairs and keep proper-noun runs whole ("Dune Part Two"). Pure,
deterministic, no network. The topic **leads** the editor chip (`Oman · Travel
95%`) and the note-list rows; note search matches it too.

Kinds grew from 7 → 12: added **health, finance, travel, recipe, media** (each
with lexicons in `classify.ts`, colours in `index.css`, glyphs in `icons.tsx`,
labels in `kindMeta.ts`, tools in `reconcile.ts` — they reuse `calendar` +
`checklist`, which fill from list content and degrade to hidden when empty).
Trips moved out of `event` → `travel`.

### Cloud classification (paid) — the fix for weak local classification

The keyword classifier mislabels ("work presentation" → academic, "trip to oman"
→ event). `POST /api/classify` (Haiku, **no web search, ~0.12p/call**) returns
`{kind, topic, confidence}` over the full kind enum.
[useRemoteClassify.ts](src/ui/useRemoteClassify.ts) (mirrors `useWorldKnowledge`)
escalates **only when local confidence < 0.72**, debounced 900ms, deduped, and
pins the result to the exact text (`RemoteClassification.forText`) so a stale
result never mislabels an edited note. `infer()` folds it in after
`applyEnrichment`, overriding kind/confidence/topic. Most notes never touch the
network.

### Billing: two recurring subscriptions (replaces the credit model)

`BILLING_ENABLED=false` (default) = everything free, nothing gated. When on,
three tiers:
- **Free** — local engine only.
- **Classification £2/mo** — includes **£1** classifier usage.
- **Evolve AI £12/mo** — **two independently-metered pools**: **£5** coding +
  world knowledge (`ai`) **and £1** classifier. Includes everything.

Each pool overages at **£2 per £1** (`OVERAGE_MARKUP`) beyond its allowance.
Checkout is `mode:'subscription'` with inline recurring `price_data` (no Stripe
Price IDs). Webhooks: `checkout.session.completed` (start plan + window),
`invoice.paid` on `subscription_cycle` (bill the ENDING cycle's overage as an
invoice item — **one cycle in arrears** — then reset both pools),
`customer.subscription.deleted` (downgrade). Every Claude call meters its real
Anthropic cost (`usageCostPence`) into its pool via `meterUsage(id, cost, pool)`.

Route gating: `/api/classify` needs **classifier-or-evolve**; suggest / recommend
/ generate-feature / enrich need **evolve**. 402s carry `reason`
(`no_plan` | `cap_reached` | `no_credit`).

Spend cap (`capPence`) now limits **overage** — the plan fee never counts toward
it — and is enforced on **every paid call** (`capReached()`), not just checkout,
so usage stops rather than billing past what the user chose. Note the tier UI
locks off `plan`, NOT `hasClassifier`/`hasEvolve` (those go false when capped, and
a capped subscriber must not be shown a padlock selling them the plan they own).

Store: `server/entitlementStore.js` — Supabase-backed when
`SUPABASE_SERVICE_ROLE_KEY` is set (**needs the subscription columns — see
DEPLOYMENT.md migration**), else a local flat file. Per billing key:
`{status, plan, aiUsedPence, classifierUsedPence, periodStart, periodEnd,
subscriptionId, paidPence, capPence}` (+ legacy `creditPence`; the old
`activate`/`topup` one-time paths still work for pre-existing accounts).
`FREE_CLIENT_IDS` env = never-billed clientIds (owner bypass).

Client tier state: `settings.tier: 'free' | 'classifier' | 'evolve'` is the source
of truth; `aiBackend` ('local'/'haiku') and `broaderAi` are **derived**
(`settingsForTier()`). `broaderAi` is true ONLY for evolve — it's what gates the
Evolve-only features (world-knowledge escalation, FeatureGenerator), so a
Classification-only plan doesn't trigger them.

### Closed-app reminders (Web Push)

Reminder notifications that reach the user with the site closed — a PWA + Web
Push, no native app. Client (`src/services/push.ts`, `public/sw.js`): registers
a service worker, subscribes with the server's VAPID public key, and uploads a
compact projection of the user's reminders (`usePushSync` → `POST
/api/push/sync`) whenever they change. Server (`server/push.js`,
`server/pushStore.js`): stores subscriptions + schedule per billing key (same
keying as entitlements — Supabase `push_targets` table when
`SUPABASE_SERVICE_ROLE_KEY` is set, else flat file `server/.push.json`).

Delivery: `POST /api/cron/tick` (guarded by `CRON_SECRET`) runs a sweep —
`runTick()` finds reminders due *now* (weekday/session-date match, past their
`time` in the user's stored tz offset, not completed, not already sent today via
the `sent` dedup log) and pushes via `web-push`. An **external cron pinger**
(cron-job.org) drives it every 2–3 min AND wakes the sleeping Render free tier;
an internal 60s `setInterval` also fires it while the server is awake (enough on
an always-on host). Dead subscriptions (404/410) self-prune.

`enablePush` is resilient: if a stale subscription made with a *different* VAPID
key lingers (keys rotated), it unsubscribes and re-subscribes rather than
throwing (`sameKey`/`subscribeFresh` in `push.ts`); and `PushControls.enable`
wraps the whole flow so that if permission is granted but the server rejects the
subscription (e.g. missing Supabase `push_targets` table), the user sees a clear
"couldn't reach the reminders server" message instead of the button silently
staying put.

Config lives in env only: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (must stay
stable — changing them breaks existing subscriptions), `VAPID_SUBJECT`,
`CRON_SECRET`. **`server/loadEnv.js` is imported first in `index.js`** so dotenv
populates `process.env` before push.js/pushStore.js read it at import time (ESM
evaluates imports before the body). UI: sidebar **🔔 Reminders**
(`PushControls.tsx`) — enable/test/off, plus an iOS "Add to Home Screen" guide
(Apple only allows Web Push for installed PWAs, not Safari tabs). The in-app 20s
`useReminders` poll still handles nudges while the app is open; push is the
additive closed-app path.

### World knowledge: Opus + live web search

Split models (server/index.js): `AI_MODEL_CODE` (default `claude-haiku-4-5`)
powers /api/suggest + /api/generate-feature; `AI_MODEL_KNOWLEDGE` (default
`claude-sonnet-5`) powers /api/enrich + /api/recommend. `AI_MODEL` env
overrides both. The knowledge routes attach the Anthropic web search server
tool (`WEB_SEARCH=true` default) with `tool_choice: auto` + a `respond` tool
for structured JSON (text-JSON fallback + `pause_turn` loop in `callClaude`).

Search is capped and disciplined: `MAX_SEARCHES` env (default 2) is the
absolute `max_uses` ceiling; enrich passes `maxSearches: 1`, recommend `2`, and
`callClaude` clamps `min(route, MAX_SEARCHES)`. Both prompts tell the model to
search ONLY for the specific missing fact (one broad query for the whole set,
not per-pick) or not at all for timeless picks. Even so, a single search pulls
tens of thousands of result-tokens into context, so a recommend call is still
~20p on Sonnet — search-result input tokens dominate, NOT the model choice. The
real cost levers are `MAX_SEARCHES=1` or `WEB_SEARCH=false`. Haiku
suggestions/generation (no search) cost well under 1p.

### Workspace layout: two-column grid + collapsible segments

`.workspace` is a `repeat(auto-fit, minmax(330px, 1fr))` grid (max-width
860px); compact segments sit side by side, `WIDE_SEGMENTS` (flashcards,
project-board, purchase-planner) span the full row. Every segment header is a
collapse toggle (grid-rows 0fr/1fr animation, chevron). Entrance staggering
via nth-child animation-delay.

### Recurring Reminders + Streak System

A unified streak-tracking system for recurring commitments and finite plans. **Streaks are always opt-in**: they appear as an offer only when a note generates more than one occurrence laddering up to a wider goal.

#### One global streak (across everything)

There is a **single streak spanning ALL commitments**, not a separate streak per
topic. `computeGlobalStreak(reminders, notes)` ([streak.ts](src/store/streak.ts))
counts the trailing run of days where **every** commitment due that day was
completed — "do everything", not just one habit. Today gets grace (an unfinished
today is *at risk*, not broken); days with nothing scheduled are neutral. `best`
is the longest such run over the whole history (derived from stored completions —
nothing extra persisted). It's surfaced two ways: a hero banner at the top of the
right column ([GlobalStreak.tsx](src/components/GlobalStreak.tsx) in
[CalendarPanel.tsx](src/components/CalendarPanel.tsx)), and the flame-ring number
inside every per-note streak segment (so the one number shows everywhere; the
per-note controls just feed it). Per-note `computeStreak` still exists for the
per-note trail + completion actions.

#### Two Streak Modes

**Recurring** (habits/goals, `mode: 'recurring'`)
- Weekday schedule (Daily / 3×/week / Weekly / etc.)
- Streak = trailing run of completed days, with today given grace (unfinished today doesn't break it)
- Examples: daily meditation, 3× a week running goal
- UI: "Mark today done" button, weekday toggle editor, recurring calendar events

**Sessions** (finite plans, `mode: 'sessions'`)
- Individual scheduled dates (e.g. study sessions before a test)
- Streak = consecutive sessions completed **in order** (first gap stops your count)
- Examples: 3-session test prep, multi-day project checkpoints
- UI: "Complete session" buttons for each upcoming date, no editor (dates are locked)
- Calendar: study events show completion state (✓ strikethrough when done)

#### Opt-In Flow

1. User writes a note (e.g. "meditate daily" or "Biology test on Jul 20")
2. Classification → `goal` or `academic` (with 2+ study sessions)
3. Streak segment renders with invite: *"Turn this into a streak? I'll add N check-ins…"*
4. Accept → reminder created, calendar events projected (2-week horizon)
5. Decline → quiet "🔥 Start a streak" link remains (can opt in later)

The gating is on `candidateOccurrenceCount()`: only offers when >1 occurrence exists. This keeps streaks meaningful (no 1-off events).

#### Core Types & Flows

**State**
- `Reminder` (in appStore): mode, title, target, weekdays[], completions[], bestStreak
- `StreakInfo` (computed on demand): current, best, todayExpected, todayDone, atRisk, actionableDate
- Note.streakDeclined: tracks if user dismissed the offer (stops re-asking)

**Key Functions** ([streak.ts](src/store/streak.ts))
- `computeStreak(reminder, note?)`: dispatch to recurring or session logic
- `trailItems()`: renders 7-day history (weekday labels for recurring, day numbers for sessions)
- `sessionDates(note)`: extract the schedule from a note's study-schedule segment
- `candidateOccurrenceCount()`: how many occurrences would justify an offer

**Store Actions**
- `startStreak(noteId)`: create reminder + project calendar
- `declineStreak(noteId)`: set streakDeclined, hide invite
- `toggleOccurrence(reminderId, iso)`: mark date done/undone, update bestStreak
- `updateReminder(reminderId, patch)`: edit schedule/time (recurring mode only)

#### Visual Design

**The ember palette** — the streak has its OWN colour, not the `goal` raspberry.
`--ember` / `--ember-lit` / `--ember-deep` / `--ember-soft` (index.css) are a warm
amber→terracotta fire range that still reads as the earthy theme. Everything
streak-flavoured pulls from it: `.today`, the sidebar streak, trail pips, the
`reminder` calendar kind (`KIND_COLOR` in CalendarPanel), and per-note streak
segments (`.segment:has(.streak)` re-tints the whole segment so trail dots don't
inherit the workspace `--tint`).

**Streak Ring** (center)
- `FlameIcon` — a filled two-path flame (outer body + inner core at 50%), drawn
  in `ui/icons.tsx`. Not an emoji.
- An **SVG progress ring** (`.ring-prog`) around the count: `stroke-dasharray`
  with `pathLength={100}`, filling toward the next MILESTONE (arc uses the
  `emberArc` gradient, lit → deep). Only visible when the streak is alive; muted
  under `prefers-reduced-motion`.
- Count (0-N) + unit label (days / sessions)
- Warm halo & shadow (only when alive)
- Celebration burst (12 radiating sparks + ring pulse) when streak extended

**States**
- *"Let's begin"* (0 streak) — soft tone
- *"On a roll"* (alive, not at risk) — normal tone
- *"Keep it alive"* (at risk today) — emphatic, pulsing ring
- *"🎉 Every session done"* (plan complete) — celebration

**Trail** (7 recent days/sessions)
- Dots with completion fill & labels
- Today/next markers pulse
- Interactive (tap to toggle completion)
- Sessions: day numbers; recurring: weekday letters

**Button & Editor**
- Primary action: "Mark today done" / "Complete session · {date}"
- Schedule toggle (recurring only): choose weekdays, set reminder time
- Plan target display (sessions only): "🎯 Biology test"

#### Calendar Integration

Recurring reminders project as calendar events (kind `'reminder'`) across the 2-week horizon. Study sessions show as kind `'study'` with completion state overlaid from the session reminder.

Event styling: dashed border (pending) → solid + strikethrough (done).

Nudges fire via `useReminders` (20-second poll). Copy is streak-aware: *"keep your 4-day streak alive 🔥"*.

#### Edge Cases & Decisions

- **Today grace** (recurring): an unfinished today doesn't break the streak (it's "at risk")
- **Session order** (sessions): completing sessions out of order is allowed UI-wise, but the streak cap is the first gap
- **Best streak** locked on completion: whenever current > bestStreak, we lock in the new best
- **Schedule changes** (recurring): editing weekdays re-projects calendar events; prior completions persist
- **Plan complete** (sessions): when all sessions done, show celebration msg, disable primary button

---

## Existing Features (Pre-Jul)

### Notes & Inference
- Local keyword classification — now 12 kinds (goal, academic, event, project,
  tasks, purchase, health, finance, travel, recipe, media, general), plus an
  unbounded `topic` label (see "Two-layer classification" above)
- Entity extraction (dates, topics, time, subject, people, locations, amounts, duration, priority)
- Multi-stage inference (classify → prompt → emerge → workspace)
- World knowledge escalation (LLM enrichment via Claude API)
- Cloud classification escalation on low local confidence (paid tiers)

### Segments
- Calendar (test dates, study schedules, events)
- Checklist (topic prep, to-do lists with one-off reminders)
- Flashcards (auto-generated q&a deck per topic)
- Schedule (study sessions before a test)
- Project Board (backlog, doing, done; milestones)
- Event Alert (calendar conflicts, briefing alerts)
- Purchase Planner (options, considerations, where-to-look)

### Calendar
- Note-owned events (study sessions, tests, events)
- Google Calendar integration (read-only, local fallback)
- Conflict detection
- Two-week preview

### Reminders
- One-off checklist item reminders (datetime picker)
- Browser notifications (permission-gated)
- In-app toast display

---

## Architecture Notes

**Store** (appStore.tsx)
- Central Redux-style reducer for notes, calendar, reminders, settings
- Persists to localStorage (recovers on reload)
- Migrations handle schema changes (e.g. reminders field, mode field)

**Reconciliation** (reconcile.ts)
- Infers desired segments per note kind
- Auto-refreshes segment data when inputs change (signature-based)
- Builds owned calendar events from segments (e.g. study sessions)

**Inference** (engine/*)
- Local classifiers run in-browser
- Questions guide the user through clarification
- Segments render based on answers + entity data

**UI Patterns**
- Segment shells (common header, body, metadata)
- Conditional rendering on `filled` (skeleton vs. real)
- Inline editing (segment data lives in store, editable via actions)

**Mobile (it's a web app, not a native one — respect the hardware)**
- **Safe areas**: the top bar (`.mnav`) pads with `max(..., env(safe-area-inset-left/right))`
  so a landscape notch never clips it; `.col-main` / `.col-side` / `.col-cal` pad
  their bottoms with `calc(… + env(safe-area-inset-bottom))` so the home indicator
  never sits on content.
- **Top bar**: a real solid header. The streak is a standalone `.mnav-streak`
  button pinned right (not nested inside the Calendar button), and the wordmark
  `.mnav-name` is hidden below 540px — at 375px it used to paint over the Notes
  icon. Nav buttons are ≥40px tall for tap targets.
- Verified at 375×812; the AI-tier control gets a tighter 3-up variant
  (`.tier-seg-3`) so "Classification" fits.

---

## Known Limitations & TODOs

- Recurring reminders: no snooze / postponement UI yet
- Sessions: can't manually reorder or skip ahead
- Google Calendar: sync is read-only (can't create events remotely)
- Mobile: safe areas + top bar done (see UI Patterns); touch interactions could
  still be smoother
- Performance: large note collections (100+) untested
- **Billing: the Stripe subscription path is NOT yet verified against real
  Stripe.** Verified by test: 402 gating, per-pool metering, cap math +
  enforcement, the status payload. NOT verified end-to-end: subscription
  checkout, webhook signatures for the new events, and `invoice.paid` → pool
  reset → `stripe.invoiceItems.create` (which creates a REAL charge). Run the
  flow in Stripe **test** mode (`stripe listen --forward-to
  localhost:8787/api/billing/webhook`) before relying on it. Overage bills **one
  cycle in arrears**, so a mistake wouldn't surface for a month.
- Billing: the legacy one-time credit path (`activate`/`topup`) is still in the
  code for pre-subscription accounts. There are no such accounts in practice —
  it can probably be deleted.
- Billing: `capPence` stops usage at the limit, but Stripe has no hard cap of its
  own — the cap is only enforced by our own `capReached()` on each call.
- `deriveTopic` is heuristic. It degrades to `undefined` (no label) rather than
  nonsense, and the paid classifier's topic overrides it when it fires.
