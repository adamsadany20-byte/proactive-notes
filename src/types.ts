// ---------------------------------------------------------------------------
// Domain types for the Proactive Notes app.
// ---------------------------------------------------------------------------

export type NoteKind =
  | 'unknown'
  | 'academic' // a test / exam / topic to revise
  | 'event' // a known or dated event to attend / watch
  | 'project' // something to build / plan
  | 'goal' // a personal goal / habit
  | 'tasks' // a checklist / todo list
  | 'purchase' // a product / thing the user is deciding to buy
  | 'health' // health / wellbeing (appointments, meds, symptoms)
  | 'finance' // money admin (bills, budget, savings tasks)
  | 'travel' // a trip to plan (itinerary + packing)
  | 'recipe' // a recipe / meal to cook (ingredients + steps)
  | 'media' // a watch / read / listen list
  | 'general' // plain note, no special flow

// The four evolution stages described in the spec.
export type Stage =
  | 'idle' // nothing detected yet
  | 'classify' // Stage 1 — ambient signal
  | 'prompt' // Stage 2 — contextual question
  | 'emerge' // Stage 3 — features filling in
  | 'workspace' // Stage 4 — full workspace

// An extracted entity (date, time, topic, etc.) with the slice of text it came from.
export interface DateEntity {
  iso: string // YYYY-MM-DD
  label: string // human label e.g. "Fri 3 Jul"
  source: string // the raw matched text
}

export interface Entities {
  date?: DateEntity
  time?: string // "14:00"
  topics: string[] // extracted subject topics
  subject?: string // e.g. "maths", "history"
  knownEvent?: KnownEvent
  // Additional deterministic extractions (free, local-only). All optional so
  // existing consumers are unaffected; the local ML tier uses these to enrich
  // notes without any API call.
  people?: string[] // names / @mentions referenced in the note
  locations?: string[] // place cues ("in Paris", "at the gym")
  urls?: string[] // links found in the text
  emails?: string[] // email addresses
  amounts?: string[] // money references ("$40", "£12.50")
  duration?: string // "3 hours", "2 weeks"
  priority?: 'high' | 'medium' | 'low' // urgency cues ("urgent", "asap")
}

export interface KnownEvent {
  id: string
  name: string
  aliases: string[]
  // Relative window from "today" used by the simulated calendar so the demo
  // always has something live.
  startOffsetDays: number
  durationDays: number
  startTime: string
  endTime: string
  category: string
  highlights: string[]
  // True when this came from the LLM enrichment rather than the local knowledge
  // base — we show its info but don't fabricate dated calendar entries for it.
  synthetic?: boolean
}

// Result of a world-knowledge lookup (the "broader AI"). Attached to a note only
// when the local engine escalated and the LLM returned something.
export interface Enrichment {
  candidate: string
  status: 'pending' | 'done' | 'error'
  recognized?: boolean
  kind?: NoteKind
  name?: string
  category?: string
  summary?: string
  highlights?: string[]
  confidence?: number
}

// A cloud classification result (paid Classification/Evolve tiers). Fired only
// when the local keyword classifier is uncertain; overrides the local kind/topic
// when done. `forText` pins it to the exact note text it was computed for, so a
// stale result never applies after the note is edited.
export interface RemoteClassification {
  forText: string
  status: 'pending' | 'done' | 'error'
  kind?: NoteKind
  topic?: string
  confidence?: number
}

// A conversational follow-up question the agent asks, one at a time.
export interface AgentQuestion {
  id: string
  field: string // which slot it fills, e.g. "date" | "topics"
  text: string
  // Optional quick-reply chips the user can tap.
  chips?: string[]
  // Free-text placeholder when no chips fit.
  placeholder?: string
}

// ---- Generated feature segments ----------------------------------------------

export type SegmentType =
  | 'calendar'
  | 'flashcards'
  | 'checklist'
  | 'schedule'
  | 'project-board'
  | 'streak-tracker'
  | 'event-alert'
  | 'purchase-planner'

// One candidate in a buying decision — the user fills price/notes in to compare.
export interface PurchaseOption {
  id: string
  name: string
  price: string
  note: string
}

export interface Flashcard {
  id: string
  topic: string
  front: string
  back: string
  known?: boolean
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  // Stable topic key for auto-generated items (the source topic, normalised).
  // Survives text edits so the reconciler can tell whether a topic is already in
  // the list. User-added items have none.
  key?: string
  // Optional reminder — an ISO datetime the item is due. Surfaces a due/overdue
  // badge and (while the app is open) a browser notification when it lands.
  remindAt?: string
}

export interface StudySession {
  id: string
  date: string // YYYY-MM-DD
  label: string
  topics: string[]
  calendarEventId?: string
}

export interface ProjectTask {
  id: string
  title: string
  column: 'backlog' | 'doing' | 'done'
}

export interface Milestone {
  id: string
  title: string
  due?: string
  done: boolean
}

export interface Segment {
  id: string
  type: SegmentType
  title: string
  // Whether the segment is still "filling in" (partial) or complete.
  filled: boolean
  data: any // shape depends on `type`; see generators
}

// ---- Calendar ---------------------------------------------------------------

export interface CalendarEvent {
  id: string
  title: string
  date: string // YYYY-MM-DD
  start?: string // HH:MM
  end?: string // HH:MM
  kind: 'fixed' | 'study' | 'event' | 'briefing' | 'test' | 'reminder'
  noteId?: string // back-link to the note that created it
  topics?: string[]
  source?: 'google' // present when synced from the user's real calendar
  // Set on projected recurring-reminder occurrences (see store/streak.ts).
  reminderId?: string
  done?: boolean // whether this occurrence has been completed
}

// ---- Recurring reminders & streaks ------------------------------------------

// A streak-tracked commitment attached to a note that ladders up to a wider
// objective. Two modes:
//   'recurring' — an open-ended habit (a goal). Occurrences come from `weekdays`
//                 (0 = Sunday … 6 = Saturday); the streak is the trailing run of
//                 completed days, with today given grace.
//   'sessions'  — a finite ordered plan toward an end (e.g. study sessions before
//                 a test). Occurrences come from the note's scheduled sessions;
//                 the streak is how many you've completed in order without a gap.
// `completions` is the log of ISO days marked done — the streak is derived from
// it, never stored redundantly.
export type StreakMode = 'recurring' | 'sessions'

export interface Reminder {
  id: string
  noteId: string // the note this belongs to
  title: string
  target?: string // the wider goal, e.g. "run 5k" / "Maths test"
  mode: StreakMode
  weekdays: number[] // 0..6 — used when mode === 'recurring'
  time: string // "HH:MM" — when the nudge fires / event lands
  createdAt: number
  completions: string[] // ISO days (YYYY-MM-DD) completed
  bestStreak: number // longest run ever achieved, in occurrences
}

// Derived streak state for a reminder, computed on demand.
export interface StreakInfo {
  current: number // consecutive occurrences completed
  best: number
  todayExpected: boolean
  todayDone: boolean
  atRisk: boolean // streak alive but an occurrence is due and still pending
  // The occurrence the primary action should complete next (to extend the
  // streak), or null when there's nothing due right now.
  actionableDate: string | null
}

// ---- Notes ------------------------------------------------------------------

export interface Note {
  id: string
  text: string
  kind: NoteKind
  // The open-ended, locally-derived label for what the note is *about*
  // (unbounded — unlike `kind`). Undefined until something salient is written.
  topic?: string
  confidence: number // 0..1
  createdAt: number
  updatedAt: number
  // Slots the agent has filled, by field name.
  answers: Record<string, string>
  // Questions already asked (so we never repeat).
  askedFields: string[]
  segments: Segment[]
  // Cached entity extraction for change-detection / propagation.
  entities?: Entities
  // World-knowledge enrichment from the LLM, when the local engine escalated.
  enrichment?: Enrichment
  // Cloud classification result, when the local classifier was uncertain and a
  // paid tier escalated it.
  classification?: RemoteClassification
  // True once the user has declined the "start a streak?" offer for this goal,
  // so we stop asking (they can still opt in from the tracker later).
  streakDeclined?: boolean
}

export interface InferenceResult {
  kind: NoteKind
  // Open-ended topic label (see Note.topic).
  topic?: string
  confidence: number
  entities: Entities
  // The single next question to ask, if any.
  nextQuestion?: AgentQuestion
  stage: Stage
}
