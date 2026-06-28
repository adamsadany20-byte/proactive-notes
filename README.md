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

## Local engine vs. broader AI

The app is built so **the local engine handles almost everything**, and the LLM
is consulted **only when the local engine decides it needs world knowledge it
doesn't have.** There's a toggle in the sidebar ("Broader AI"):

- **Off** (default) — 100% local. No network calls ever.
- **On** — still local for almost everything. Before each note settles, the
  engine runs an *escalation check* (`src/engine/worldKnowledge.ts`): only if the
  note contains a salient term it can't place (an unknown acronym or proper noun)
  *and* its own confidence is low does it call the backend `/api/enrich`, which
  asks Claude (`claude-opus-4-8` by default) what the term is. The result is
  folded back into the same pipeline (category, summary, highlights).

Measured behavior of the gate (6 of 7 stay local):

| Note | Local kind | Escalates to AI? |
|------|-----------|------------------|
| `WWDC` | event | no — in local knowledge base |
| `maths test` | academic | no — subject resolved locally |
| `budgeting app` | project | no — confident enough |
| `run a 5k` | goal | no |
| `Dinner with Sam` | general | no — common words filtered |
| `Vivatech` | unknown | **yes** — unknown proper noun |

Set `ANTHROPIC_API_KEY` in `server/.env` to enable it (without a key the toggle
shows "no API key on server" and the app stays local). Use `ENRICH_MODEL` to pick
a faster/cheaper model (e.g. `claude-haiku-4-5`) for these lookups.

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
