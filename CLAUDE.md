# Proactive Notes Codebase Guide

## Recent Work (Jul 2026)

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

### Billing: credit model (replaces subscriptions)

`BILLING_ENABLED=false` (default) = everything free, nothing gated. When on:
£10 one-time activation includes £5 of AI token credit; every Claude call
meters its real Anthropic cost (server-side, `usageCostPence` in
`server/index.js`) and deducts it; more credit is bought at £2 per £1 of tokens
(`kind: 'topup'` checkout). Checkout uses inline `price_data` (no Stripe Price
IDs). Tapping the locked Evolve AI tier opens a confirmation modal
(`UpgradeModal.tsx`) — pay vs stay free — instead of jumping straight to Stripe.
Users can set a spend cap (`capPence`) that limits **top-up** spend **on top of**
the activation fee (the £10 activation never counts toward it): enforced only on
`kind:'topup'` checkout against `paidPence - ACTIVATION_PRICE_PENCE`
(`POST /api/billing/cap`; UI in `Sidebar.tsx` → `SpendLimit`, shown only once
activated). `FREE_CLIENT_IDS` env = never-billed clientIds (owner bypass for
testing a live deploy). Store: `server/entitlementStore.js` — Supabase-backed when
`SUPABASE_SERVICE_ROLE_KEY` is set (survives redeploys), else a local flat file;
`{status, creditPence, usedPence, paidPence, capPence}` per billing key (Supabase
user id when logged in, else anonymous clientId).

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

**Streak Ring** (center)
- Flame icon (🔥 lit / 🌱 unlit)
- Count (0-N)
- Unit label (days / sessions)
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
- Local ML classification (goal, academic, event, project, task, purchase, general)
- Entity extraction (dates, topics, time, subject, people, locations, amounts, duration, priority)
- Multi-stage inference (classify → prompt → emerge → workspace)
- World knowledge escalation (LLM enrichment via Claude API)

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

---

## Known Limitations & TODOs

- Recurring reminders: no snooze / postponement UI yet
- Sessions: can't manually reorder or skip ahead
- Google Calendar: sync is read-only (can't create events remotely)
- Mobile: layout tested, but touch interactions could be smoother
- Performance: large note collections (100+) untested
