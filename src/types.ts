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
  | 'goal-tracker'
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
  // Optional reminder — an ISO datetime the item is due. Surfaces a due/overdue
  // badge and (while the app is open) a browser notification when it lands.
  remindAt?: string
}

// ---- Mind map ("Map" mode) --------------------------------------------------

export interface MindNode {
  id: string
  text: string
  x: number // centre coordinates within the canvas
  y: number
}
export interface MindEdge {
  id: string
  from: string
  to: string
}
export interface MindMap {
  nodes: MindNode[]
  edges: MindEdge[]
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
  kind: 'fixed' | 'study' | 'event' | 'briefing' | 'test'
  noteId?: string // back-link to the note that created it
  topics?: string[]
  source?: 'google' // present when synced from the user's real calendar
}

// ---- Notes ------------------------------------------------------------------

export interface Note {
  id: string
  text: string
  kind: NoteKind
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
  // Ideas connected on the "Map" mode canvas. Independent of the written text.
  mindmap?: MindMap
}

export interface InferenceResult {
  kind: NoteKind
  confidence: number
  entities: Entities
  // The single next question to ask, if any.
  nextQuestion?: AgentQuestion
  stage: Stage
}
