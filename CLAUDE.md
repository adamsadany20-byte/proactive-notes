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
   (Classification £1/mo, Evolve AI £6/mo with two metered pools), and the spend
   cap was rewired to limit **overage** instead of a dead top-up path. (See
   "Billing".)
5. **Payment overhaul** — collapsed the beta/standard dual rate into ONE rate
   (`OVERAGE_MARKUP`, default 1.5), deleted the legacy credit model, and pinned
   the Stripe API version. (See "Payment overhaul", which supersedes the
   dual-rate description in "Billing" below.)

**Note:** the Stripe subscription path is now verified in test mode (see "Known
Limitations"). The paragraph below is retained for the deployment steps; the
"never run" claim no longer holds. Historically: it had never run against
real Stripe — see "Known Limitations". The `entitlements` subscription-columns
migration has been applied, and the webhook must subscribe to
`checkout.session.completed`, `invoice.paid`, and `customer.subscription.deleted`.

## Recent Work (Jul 2026)

### "Now" panel — the 1→done half of the app

The app was excellent at 0→1 (a blank note becomes a workspace) and absent at
1→done: once a checklist had twelve items, nothing helped you work THROUGH them.
Measurably — segment code had **zero** hits for progress, reorder, priority,
estimate, subtask or dependency, and checklist items never surfaced outside
their own note. `GlobalStreak` covered streak commitments only.

**[today.ts](src/store/today.ts) `collectToday()`** merges what already existed
in five separate places: overdue/due checklist items (`remindAt`), study sessions
today, streak commitments due today, today's calendar events, project tasks in
`doing`, and — the proactive one — **stale notes** (open items, untouched 7+
days), which nothing in the app ever mentioned again. Pure, deterministic, no
network and no AI: this is the panel a user sees most, so it must never spin or
cost money.

Ranking is by **urgency in bands**, not chronology: overdue `0`, due-today
`100-199` (scaled by clock time), commitments `200`, sessions `300`, calendar
`400-499`, doing `600`, stale `700`. The scaling matters — an early version used
raw minutes, so an item due at 23:30 scored ~1510 and sorted *below* a backlog
task.

**[TodayPanel.tsx](src/components/TodayPanel.tsx)** renders it under
`GlobalStreak`. The top item is called out as **"Start here"** — a ranked list
still makes you choose; naming one thing is what turns a list into a
recommendation. Everything tickable completes in place (writing back through
`editSegment`/`toggleOccurrence`) and re-ranks immediately.

Also: checklists gained a **progress bar** and **finished items sink** (display
order only, stable sort — the stored order is untouched so nothing jumps while
editing).

Verified in-browser with seeded data: 1 overdue + 1 due-today + 1 doing + 1 stale
ranked correctly, ticking the hero from the panel removed it and promoted the
next item with the summary updating, and the progress bar read 33% with the done
item sunk to the bottom.

### Owner accounts by email (`OWNER_EMAILS`)

`FREE_CLIENT_IDS` was browser-scoped — it died whenever storage was cleared and
didn't follow you to another device. `OWNER_EMAILS` (comma-separated) allowlists
by **email**, read off the Supabase JWT, so it follows the person.

For an owner: `hasAccess()` / `hasClassifyAccess()` return true regardless of
plan, `rateLimit()` is skipped entirely, and both `/api/config` and
`/api/billing/status` report `owner: true`. The client uses that to unlock all
tiers (`lockedFor()` short-circuits) and to suppress the paywall in
`FeatureGenerator` — so an owner never sees an upgrade prompt.

**Security note worth keeping in mind:** this is exactly as trustworthy as the
token it reads. With `SUPABASE_JWT_SECRET` set the email is signature-verified
and unforgeable — verified by sending a token carrying the owner email with a
junk signature, which correctly came back `owner: false`. WITHOUT that secret the
server decodes tokens unverified and anyone could claim the address, which is
the same caveat that already applies to billing identity.

What this does NOT bypass: the genuinely *time*-based behaviour — the learned
rhythm needs ≥8 completions, stale nudges need 5 days of silence, streaks need
occurrences. Those aren't permissions, they're thresholds for a claim being true;
relaxing them for an owner would just display an invented pattern.

### Ticking workspaces off + the 5-day "still open" nudge

**`Note.doneAt`** — a whole workspace can be ticked off from its sidebar row
(green check, strikethrough, dimmed). Done notes are *kept, not deleted*, and
drop out of the Now panel entirely: nothing from a finished workspace should
still be asking for attention.

**`Note.openedAt`** — SELECT now records that a note was *entered*, distinct from
edited. "Haven't touched this" has to count reading it, not just typing in it.
Deliberately does NOT bump `updatedAt`, or merely opening a note would look like
an edit to the Supabase sync.

**One shared staleness rule** in [today.ts](src/store/today.ts) —
`lastTouched()` / `isNoteStale()` / `staleNotes()` — used by all three consumers
so they can't disagree: stale = not done, has text, and `max(openedAt,
updatedAt, createdAt)` older than **`STALE_DAYS` (5)**.

**Two delivery paths, no server change:**
- *In-app* — [useReminders.ts](src/ui/useReminders.ts) raises a toast, keyed
  `stale-{id}@{today}` so it fires once per note per day.
- *Closed-app push* — `projectStaleNudges()` in
  [push.ts](src/services/push.ts) projects each stale note as a **`sessions`-mode
  pseudo-reminder**, which is just "due on these dates". The existing server
  sweep already understands that shape, so this needed **zero** server work.
  Dates are the day it goes stale, **+3 and +7** — a forgotten note is worth
  mentioning a few times and then letting go; nagging daily is how people turn
  notifications off. Capped at 5 notes.

Stale items sort **most-neglected-first** within their band (`700 + max(0, 99 -
daysStale)`) — a flat 700 tie-broke alphabetically and let a 6-day-old note
outrank a 9-day-old one.

Verified in-browser with four seeded notes: touched-today didn't nudge, 9-day and
6-day did (in that order), and a 20-day note that was **ticked off** correctly
stayed silent. The toast was confirmed by temporarily widening its 8s auto-hide
(reverted) — earlier checks kept landing ~20s after load and missing the window.

### The proactive layer in the "Now" panel

Three signals, all derived on-device from data the app already had. No network,
no AI, no cost.

**1. Time-of-day framing.** `dayPhase()` / `todayHeading()` — the panel is "Your
day" at 7am, "Now" in the afternoon, "Left today" in the evening, "Still open"
late. Same list; different message about it.

**2. Learned rhythm — when this person actually gets things done.** Needed
history that didn't exist, so `Habits.completionLog` was added: a timestamp each
time anything is ticked off (checklist item, board task, streak commitment),
de-duplicated within a minute (clearing five things is ONE work session, not
five signals), capped at 250, **local-only and never synced** — same treatment as
`shoppingLog`, because it's behavioural and worthless to anyone but this device.
`describeRhythm()` finds the dominant weekday and day-phase and renders
"You usually clear things on Monday afternoons" — upgrading to "— this is that
window" when now falls inside it.

It **stays silent unless the pattern is real**: ≥8 samples AND ≥34% share on both
the weekday and the phase. A flat spread returns null rather than inventing a
habit out of noise. Verified both ways.

**3. Day load.** `dayLoad()` — having four things to do reads differently when
three hours are already booked. Both numbers were to hand; nothing said them
together. Surfaces only when it's genuinely notable (≥90 min booked AND ≥3
actionable items).

Verified in-browser: a log weighted 10/13 to the current weekday+phase produced
"You usually clear things on Monday afternoons — this is that window" with the
is-now styling; flattening the same log to a spread removed the line entirely
while the rest of the panel kept working; 3.5h of meetings + 3 tasks produced the
load line.

### Vercel deployment (alongside Render)

Deploys as **static `dist/` on Vercel's CDN + the entire Express app as ONE
serverless function** (`api/index.js` re-exports `server/index.js`). Routing is in
[vercel.json](vercel.json): `/api/*` and `/auth/*` rewrite into the function,
everything else falls through to `index.html` (SPA). One function rather than a
file-per-route, so the API is identical on Vercel and on `npm start` — no second
code path to keep in sync. Render still works unchanged.

**`IS_SERVERLESS` (`process.env.VERCEL`) gates everything process-shaped**:
`app.listen`, `express.static(dist)` + the `*` catch-all, and the 60s push
`setInterval`. Without those guards the function would bind a port it doesn't own
and shadow the CDN.

**Two things get worse on serverless, and both are deliberate trade-offs:**
- **The 60s push sweep never runs** (instances freeze between requests), so
  `/api/cron/tick` is the ONLY reminder path. `vercel.json` declares **no crons**
  — the owner wires up their own scheduler. The route accepts the secret as
  `?secret=`, `x-cron-secret`, or `Authorization: Bearer` (the Vercel Cron form),
  so any scheduler works without a code change.
- **The rate limiter is weakened.** `rateHits` is in-memory, so every cold start
  begins empty and concurrent instances don't share counts — a determined caller
  gets ~`limit × instances`. It still catches accidental loops but is no longer a
  hard spend ceiling. The per-account `capPence` (billing on) is the durable
  control; moving the counter to Supabase/Redis would fix it properly.

**Supabase is mandatory here, not optional** — the FS is ephemeral *and*
per-instance, so every flat-file fallback silently loses data. `tokenStore` was
the gap and already has a Supabase backend (`google_tokens`).

Server deps are hoisted into the **root** `package.json` so Vercel's bundler can
trace them; `server/package.json` stays for local dev. No `VITE_API_BASE` needed —
a production build already defaults to same-origin.

Verified by importing the exported app under `VERCEL=1`: `/api/config`,
`/api/billing/status` and `/api/cron/tick` (GET) all 200, `/privacy` correctly
404s inside the function (the CDN serves it), nothing binds port 8787, and
non-serverless mode still boots and serves `dist/`.

### Generated apps persist + the topic workspace

Three changes that turn generated tools from a demo into a feature, and finally
cash in the `topic` layer.

**1. Generated apps are persisted on the note** (`Note.apps: GeneratedApp[]`).
They lived in `useState` in [FeatureGenerator.tsx](src/ui/FeatureGenerator.tsx),
so a bespoke tool the user paid Claude to write evaporated on reload. They now go
through the store (`saveApp`/`updateApp`/`removeApp`), which means localStorage +
the whole-note Supabase row — so they follow the user across devices. Crucially
`data` (the state entered INTO the tool — ticks, rows, values) persists too;
that's what makes it feel like a real feature. `loading` is deliberately NOT
stored — it's transient UI, tracked in a local `building` Set. Capped at
`MAX_APPS_PER_NOTE` (12) because generated code is a few KB each and localStorage
has a quota.

**2. The generator now sees what the app already knows.**
`collectNoteContext()` only ever sent the user's *answers*, which is why tools
came out generic — the model never saw the classification, the extracted
entities, or what was already on screen. It now also sends the topic + kind, the
deterministic entities (date, duration, people, places, amounts, priority), a
summary of the filled segments, and the labels of tools already built, under a
heading telling the model to **complement, not rebuild**. The server prompt
gained a "Depth" block: seed 8–15 real items not 3 placeholders, give it totals /
grouping / progress, handle empty and full states. Input tokens are cheap on
Haiku, so this costs ~nothing per call.

**3. `/topic` workspace** — [TopicWorkspace.tsx](src/components/TopicWorkspace.tsx).
`Note.topic` was decorative (a chip, a sidebar label, search matching). Now, when
a topic links **more than one** note, the editor chip becomes a button opening a
sheet with everything about that subject: every note, their merged calendar in
date order, every open checklist item (tickable in place, writing back through
`editSegment`), and every generated tool **rendered live** and interactive. One
note = no button, since that would just be the note again.

Verified in-browser with seeded data: 3 notes sharing "Oman" → chip reads "See
everything about Oman (3 notes)"; the sheet merges 2 calendar events, 2 open
items and 1 tool; clicking inside the persisted tool updates it, writes through
to localStorage, and the value survives a full reload.

### Payment overhaul: ONE pricing model (no beta rate, no legacy credit)

The dual-rate "beta pricing" system is **gone**. There is now exactly one rate,
so the number the UI quotes and the number `billOverage()` charges cannot
diverge — that class of bug is removed structurally, not by keeping two values in
sync. `BETA_MARKUP`, `betaPricing()`, `effectiveMarkup()`, `standardMarkup`,
`BETA_ALLOWANCE_PENCE`, `betaMode()` and the `beta_limit` 402 no longer exist.

**The model**: Free (local engine) · Classification **£1/mo** (incl. 50p) ·
Evolve AI **£6/mo** (incl. £2.50 `ai` + 50p `classifier`, metered separately).
Usage beyond a plan bills at **`OVERAGE_MARKUP`, now defaulting to 1.5**× real
token cost, one cycle in arrears. Raising it later applies to existing
subscribers at their next cycle; their monthly fee is held by Stripe and never
changes retroactively.

**The legacy one-time credit model is also gone** (`activate`/`topup`,
`ACTIVATION_*`, `TOKEN_MARKUP`, `TOPUP_*`, `creditPence`, `no_credit`). It was
dead weight with a live footgun: `/api/billing/checkout` defaulted to
`kind='activate'`, so a request with a missing/……typo'd plan silently created a
£10 one-time charge. It now **400s on an unrecognised plan**.

**Stripe API version is pinned** (`STRIPE_API_VERSION`, default
`2025-02-24.acacia`). It was unpinned, which meant the SDK's own bundled version
was in force — and the fields this code depends on MOVED in `2025-03-31.basil`:
`subscription.current_period_start/end` → `subscription.items.data[]`, and
`invoice.subscription` → `invoice.parent.subscription_details`. A routine
`npm update` would have silently stopped overage billing and cycle resets with no
error. `subscriptionPeriod()` / `invoiceKey()` / `invoiceSubscriptionId()` read
**both** shapes, so raising the pinned version is safe. Verified against the live
account: at `2026-06-24.dahlia` the top-level `current_period_end` is `null`
while `items[0]` still has it, and the helper resolves it either way.

**Verified end-to-end against real Stripe (test mode)**: unknown plan → 400;
subscription checkout (£6 GBP monthly, correct metadata, product name showing
"incl. £2.50 … + £0.50" — it previously rounded 50p up to "£1");
`checkout.session.completed` with a REAL subscription → plan set and a real
`periodEnd`; `invoice.paid` sent in the NEW basil shape → 300p invoice item
(200p over × 1.5) and pools reset; spend cap → 402 `cap_reached`;
`customer.subscription.deleted` → downgrade and 402 `no_plan`; free mode
(`BILLING_ENABLED=false`) unchanged.

Usage is surfaced in Settings → **Usage this month**
([UsageMeter.tsx](src/components/UsageMeter.tsx)) — per-pool bars of real money
used vs included, what overage will be added to the next invoice, and the rate.
It replaces `BetaUsage.tsx`.

### Open beta recruitment page (`/beta`)

[Beta.tsx](src/components/Beta.tsx), routed in [main.tsx](src/main.tsx) like
`/welcome`. Recruits testers by asking for *specific* things (where it misread
you / wasted your time / what was missing / what broke) rather than "any feedback
welcome", and carries a blunt cost section: local engine £0, small models
~0.1–1p, **web-search calls ~20p each**. Every price and rate is **fetched from
the server** (`/api/billing/status` → `pricing`) so the page cannot quote a
number different from the one charged. Signups post with source `beta`
(`submitBetaSignup`), separable from `/welcome`'s `interest` signups.

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
- **Sheets get real column names, with no AI call.** `seedToRows(title, seed, kind)`
  used to put the note title in A1 and split lines on commas — a grid, but an
  anonymous one. It now uses the note's **kind** to pick headers
  (`SHEET_TEMPLATES`: finance → `Item | Amount | Due | Notes`, travel →
  `Item | Qty | Packed`, recipe → `Ingredient | Quantity`, …) and lifts a
  trailing amount ("rent 900") or leading quantity ("500g flour", "2x shirts")
  out of the text into its own cell. If the note is ALREADY tabular it uses its
  own header row when one looks like headers, else names the columns from the
  kind. Rows are padded rectangular. A1 is now a header row, not a redundant
  title (the file is already named after the note). Deterministic and free —
  an AI-structured version would have cost ~0.2p a sheet, which is cheap but
  buys little over this. The client sends `kind` with the create request.
- **`/api/google/create` is rate-limited** (`cheap` bucket, with its own 429
  message since no AI runs there). The Google token is single-user, so every
  call writes a file into the CONNECTED account's Drive — uncapped, an open
  endpoint lets anyone fill the owner's Drive with junk.
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
- **Token storage survives redeploys.** `tokenStore.js` is Supabase-backed (new
  **`google_tokens`** table, single row `id='default'`) when
  `SUPABASE_SERVICE_ROLE_KEY` is set, else the old flat file — which Render
  rebuilds on every push, silently dropping the Google connection so the doc
  chips fell back to blank `docs.new` tabs until someone reconnected. Its API is
  **async** (all call sites await it); the googleapis `client.on('tokens')`
  refresh listener is fire-and-forget with a `.catch`, since googleapis emits it
  synchronously. Still single-user — per-user Google is a separate change.
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
- **Classification £1/mo** — includes **50p** classifier usage.
- **Evolve AI £6/mo** — **two independently-metered pools**: **£2.50** coding +
  world knowledge (`ai`) **and 50p** classifier. Includes everything.

Prices were halved from the original £2/£12 for the beta. The **included usage
was halved by the same factor deliberately** — each plan bundles usage worth
half its fee (50% gross margin). Raising an `*_INCLUDED_PENCE` without raising
the price eats that margin, and a plan that bundles as much usage as it charges
for loses money on every subscriber once Stripe's ~2.9% + 30p is taken.

Each pool overages at **£1.50 per £1** (`OVERAGE_MARKUP`) beyond its allowance.
Checkout is `mode:'subscription'` with inline recurring `price_data` (no Stripe
Price IDs). Webhooks: `checkout.session.completed` (start plan + window),
`invoice.paid` on `subscription_cycle` (bill the ENDING cycle's overage as an
invoice item — **one cycle in arrears** — then reset both pools),
`customer.subscription.deleted` (downgrade). Every Claude call meters its real
Anthropic cost (`usageCostPence`) into its pool via `meterUsage(id, cost, pool)`.

Route gating: `/api/classify` needs **classifier-or-evolve**; suggest / recommend
/ generate-feature / enrich need **evolve**. 402s carry `reason`
(`no_plan` | `cap_reached`).

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
- **Billing: the subscription path IS verified against real Stripe (test mode)** —
  see "Payment overhaul" for the full list of what was exercised, including a
  REAL subscription (so `current_period_*` is actually resolved) and an
  `invoice.paid` sent in the new basil shape. **Still unverified:** real webhook
  *signature* validation (tested with `STRIPE_WEBHOOK_SECRET` unset, which takes
  the unsigned-parse branch) and anything against a **live** key. Overage bills
  one cycle in arrears, so a live mistake wouldn't surface for a month.
- **Billing: with `STRIPE_WEBHOOK_SECRET` unset the webhook accepts UNSIGNED
  events** — anyone who knows the URL can POST a forged
  `checkout.session.completed` and grant themselves a paid plan. Fine for local
  `stripe listen`; must be set in production.
- Billing: `capPence` stops usage at the limit, but Stripe has no hard cap of its
  own — the cap is only enforced by our own `capReached()` on each call.
- **Cost exposure in free mode**: with `BILLING_ENABLED=false` (production today)
  `hasAccess()` returns true for everyone, so the spend cap does nothing. The
  per-key **rate limit** (`RATE_LIMIT_EXPENSIVE_PER_HOUR` / `..._CHEAP_...`) is
  the only thing bounding spend there. It runs as a front gate BEFORE the paywall
  check, so a rejected 402 call still consumes rate budget — deliberate (blunter
  but strictly safer), and harmless since those calls cost nothing.
- Rate limiting is in-memory: it resets on redeploy and isn't shared across
  instances. Fine for one Render instance; would need Redis if scaled out.
- **CORS is browser-only.** Locking `ALLOWED_ORIGINS` stops another *website*
  calling the API from a visitor's browser; it does nothing against curl or a
  script. Don't mistake it for spend protection — the rate limit is that.
- `deriveTopic` is heuristic. It degrades to `undefined` (no label) rather than
  nonsense, and the paid classifier's topic overrides it when it fires.
