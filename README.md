# Proactive Notes

An adaptive notes app where an AI agent reads what you write and **builds the
workspace around it in real time**. You don't use trigger phrases — type
`maths test`, `WWDC`, or `budgeting app` and the page assembles itself.

## Run it

The frontend runs on its own; the backend (server/) is optional and only needed
for broader AI + real Google Calendar.

```bash
# 1. Frontend (always)
npm install
npm run dev          # http://localhost:5173

# 2. Backend (optional — broader AI + Google Calendar)
cd server
npm install
cp .env.example .env # fill in keys you want (all optional)
npm start            # http://localhost:8787
```

`npm run build` produces a static bundle in `dist/`. With no backend running, the
app stays fully on the local engine and the simulated calendar — nothing breaks.

## Categories: a bounded `kind` + an open-ended `topic`

Every note gets **two** labels:

- **`kind`** — one of 12 behavioural categories (academic, event, project, goal,
  tasks, purchase, health, finance, travel, recipe, media, general). It's a fixed
  set on purpose: the kind decides **which tools get built** (flashcards, streak,
  calendar, checklist…), and each tool has to exist.
- **`topic`** — an **unbounded** label for what the note is actually *about*:
  "Oman", "Sourdough Bread", "Work Presentation". Derived on-device by
  `src/engine/topics.ts` with lightweight keyword extraction (stopword/intent-verb
  removal, then scoring by frequency, proper-noun-ness, a domain lexicon and
  position). No fixed list, no network, no LLM.

The topic leads the UI — the editor chip reads `Oman · Travel 95%`, and note rows
show the topic in the kind's colour.

## Tiers: local engine vs. cloud AI

**The local engine handles almost everything.** Claude is consulted only where it
earns its keep. Three tiers (sidebar → Settings & tools → AI tier):

| Tier | Price | What it adds |
|---|---|---|
| **Free** | £0 | 100% local. No network calls, ever. |
| **Classification** | £2/mo | Claude re-classifies a note **only when the local engine is unsure** (confidence < 0.72). Includes £1/mo of usage. |
| **Evolve AI** | £12/mo | Everything: classification **plus** suggestions, live world knowledge, and on-the-fly tool generation. Includes £5/mo tools + £1/mo classifier, metered as two separate pools. |

Two independent escalations, both gated behind confidence so most notes never
touch the network:

- **Classification** (`/api/classify`, Haiku, ~0.12p a call → ~800 per £1) — fires
  when the local keyword classifier is unsure. Fixes cases like "work
  presentation" (was *academic*) → **project**, "trip to oman" (was *event*) →
  **travel**.
- **World knowledge** (`/api/enrich`) — fires only when a note contains a salient
  term the local engine can't place (an unknown acronym or proper noun) *and* its
  confidence is low. Measured: 6 of 7 notes stay local.

| Note | Local kind | Escalates to AI? |
|------|-----------|------------------|
| `WWDC` | event | no — in local knowledge base |
| `maths test` | academic | no — subject resolved locally |
| `budgeting app` | project | no — confident enough |
| `run a 5k` | goal | no |
| `Dinner with Sam` | general | no — common words filtered |
| `Vivatech` | unknown | **yes** — unknown proper noun |

Set `ANTHROPIC_API_KEY` in `server/.env` to enable the cloud tiers (without a key
they show "AI not configured on server" and the app stays local). Billing is
**off by default** (`BILLING_ENABLED=false`) — every tier is unlocked while you
build. See [DEPLOYMENT.md](DEPLOYMENT.md) for the billing/subscription setup.

## Google Calendar

With Google credentials in `server/.env`, the calendar panel shows a **Connect
Google** button. Setup:

1. Google Cloud Console → enable the **Google Calendar API**.
2. Create an **OAuth 2.0 Client** (type: Web application).
3. Add redirect URI `http://localhost:8787/auth/google/callback`.
4. Put the client id/secret in `server/.env`.

Once connected, the app **reads** your real upcoming events (so conflict
detection runs against your actual schedule) and can **write** events it creates.
Without credentials it uses the in-app simulated calendar.

## What it does

As you type, inference runs on a debounce and the UI evolves through four stages:

1. **Classification signal** — a faint tinted border + ambient label appears once
   the agent recognises the content type. Nothing interrupts typing.
2. **Contextual prompt** — on a pause, one soft question appears beside the note
   (e.g. *"When is it?"*) with quick-reply chips. Ignore it and keep writing.
3. **Feature emergence** — relevant segments begin filling in below the note: a
   calendar block, a flashcard deck, a project board. They start partial and
   populate as more is known.
4. **Full workspace** — once there's enough signal, every generated feature is
   present, editable, and linked. Editing the note (e.g. changing a date)
   propagates to the calendar automatically.

### Built-in flows

| You write | The agent infers | It builds |
|-----------|------------------|-----------|
| `maths test` | upcoming test | asks the date → adds a calendar test event → asks topics → flashcards, topic checklist, and a **study schedule** spread across the days before the test, each session written to the calendar |
| `WWDC` | a known event | cross-references the calendar, finds the **conflict** (*"You have Dinner with Sam during WWDC"*), offers a post-event **highlights briefing** that gets scheduled |
| `budgeting app` | a new project | asks stack / timeline / team / goal → generates a **kanban board + milestones** with dates distributed across the timeline |
| `run a 5k` | a goal | asks cadence + target → generates a weekly **habit tracker** |

Notes persist in `localStorage`; multiple note contexts run simultaneously.

## Architecture

The "AI" is a **self-contained, deterministic inference engine** — no API key, no
network, fully reliable for a demo. It is structured so a real LLM can be dropped
in behind the same interface.

```
src/
  engine/
    knowledge.ts    known-event DB (WWDC, GDC, F1…), relative to "today"
    entities.ts     natural-language date/time/topic/subject extraction
    classify.ts     note-kind classification with length-scaled confidence
    questions.ts    one-at-a-time conversational follow-ups per kind
    generate.ts     feature generators (flashcards, schedule, board, …)
    inference.ts    orchestrator → { kind, confidence, entities, question, stage }
  store/
    calendar.ts     seeded calendar + conflict detection
    reconcile.ts    segment reconciliation + note→calendar event sync
    appStore.tsx    reducer, persistence, the single source of truth
  ui/
    useInference.ts the staged dual-debounce loop (450ms ambient / 1100ms prompt)
    kindMeta.ts     per-kind colour identity
  components/       NoteEditor, ContextualPrompt, Segments, Sidebar, CalendarPanel
```

### Key design decisions

- **Inference never runs per-keystroke.** Two debounces drive the stages; the
  text cursor is never moved or blocked.
- **Segments are incremental, not destructive.** A generated segment is
  auto-managed (refreshes as inputs grow) until the user edits it, at which point
  it freezes and becomes user-owned. Re-classification carries over what still
  applies instead of resetting.
- **Answers feed the entity pipeline.** A date or topic given via a chip is
  parsed back into the same entity set as one typed into the note, so it reaches
  the generators and the calendar.
- **Calendar sync is bidirectional.** The agent reads the calendar to find
  conflicts and writes events the note owns; changing the note regenerates only
  that note's events, leaving fixed commitments untouched.

### Swapping in a real LLM

`engine/inference.ts` exposes a single pure function:

```ts
infer(note, { paused }): { kind, confidence, entities, nextQuestion, stage }
```

Replace `classify` / `extractEntities` / `nextQuestion` with calls to the
Anthropic API (e.g. a `claude-opus-4-8` tool-use call returning the same shape)
and the rest of the app — staging, reconciliation, calendar sync — is unchanged.
Keep the call on the debounce and cache by note text to stay responsive.
# proactive-notes
