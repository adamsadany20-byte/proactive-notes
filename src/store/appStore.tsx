import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type {
  CalendarEvent,
  Enrichment,
  InferenceResult,
  MindMap,
  Note,
  Reminder,
  Segment,
} from '../types'
import type {
  AiBackend,
  BillingStatus,
  ExternalEvent,
  ServerConfig,
} from '../services/api'
import { infer } from '../engine/inference'
import { uid } from '../engine/generate'
import { seedCalendar } from './calendar'
import { buildOwnedEvents, reconcileSegments } from './reconcile'
import { computeStreak, reminderFromNote } from './streak'

interface Settings {
  // Which AI tier is active. 'local' = deterministic engine only, no network.
  aiBackend: AiBackend
  // Derived master switch kept in sync with aiBackend: true for any cloud tier.
  // Existing consumers (world-knowledge escalation, etc.) gate on this.
  broaderAi: boolean
}

interface State {
  notes: Note[]
  calendar: CalendarEvent[]
  reminders: Reminder[]
  selectedId: string | null
  settings: Settings
  config: ServerConfig | null
  billing: BillingStatus | null
}

type Action =
  | { type: 'CREATE_NOTE' }
  | { type: 'SELECT'; id: string }
  | { type: 'DELETE'; id: string }
  | { type: 'SET_TEXT'; id: string; text: string }
  | { type: 'REASSESS'; id: string; paused: boolean }
  | { type: 'ANSWER'; id: string; field: string; value: string }
  | { type: 'SKIP'; id: string; field: string }
  | { type: 'EDIT_SEGMENT'; id: string; segmentId: string; data: any }
  | { type: 'SET_MINDMAP'; id: string; mindmap: MindMap }
  | { type: 'SET_BACKEND'; backend: AiBackend }
  | { type: 'SET_CONFIG'; config: ServerConfig }
  | { type: 'SET_BILLING'; billing: BillingStatus }
  | { type: 'SET_ENRICHMENT'; id: string; enrichment: Enrichment }
  | { type: 'SET_EXTERNAL_EVENTS'; events: ExternalEvent[] }
  | { type: 'TOGGLE_OCCURRENCE'; reminderId: string; iso: string }
  | { type: 'UPDATE_REMINDER'; reminderId: string; patch: Partial<Reminder> }
  | { type: 'START_STREAK'; noteId: string }
  | { type: 'DECLINE_STREAK'; noteId: string }

const STORAGE_KEY = 'proactive-notes-v1'

function newNote(): Note {
  const now = Date.now()
  return {
    id: uid('note'),
    text: '',
    kind: 'unknown',
    confidence: 0,
    createdAt: now,
    updatedAt: now,
    answers: {},
    askedFields: [],
    segments: [],
  }
}

function freshState(): State {
  const first = newNote()
  return {
    notes: [first],
    calendar: seedCalendar(),
    reminders: [],
    selectedId: first.id,
    settings: { aiBackend: 'local', broaderAi: false },
    config: null,
    billing: null,
  }
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw) as State
    if (!parsed.notes?.length) return freshState()
    // Re-seed the fixed calendar each load so relative demo dates stay current,
    // and keep note-owned events. Google events are refetched, not persisted.
    const owned = parsed.calendar.filter((e) => e.noteId)
    // Migrate older saves: pre-tier state only had `broaderAi`, and earlier
    // versions persisted now-removed 'gemini'/'groq' tiers — collapse those to
    // the Claude tier so the only valid values are 'local' and 'haiku'.
    const saved =
      parsed.settings?.aiBackend ?? (parsed.settings?.broaderAi ? 'haiku' : 'local')
    const backend: AiBackend = saved === 'local' ? 'local' : 'haiku'
    return {
      ...parsed,
      calendar: [...seedCalendar(), ...owned],
      reminders: (parsed.reminders ?? []).map((r) => ({
        ...r,
        mode: r.mode ?? 'recurring',
        completions: r.completions ?? [],
        weekdays: r.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
        bestStreak: r.bestStreak ?? 0,
      })),
      settings: { aiBackend: backend, broaderAi: backend !== 'local' },
      config: null,
      billing: null,
    }
  } catch {
    return freshState()
  }
}

function externalToCalendar(events: ExternalEvent[]): CalendarEvent[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    date: e.date,
    start: e.start,
    end: e.end,
    kind: 'fixed' as const,
    source: 'google' as const,
  }))
}

// Run inference for a note and fold the results (kind, confidence, entities,
// segments, owned calendar events) back into state.
function reassess(state: State, note: Note, paused: boolean): State {
  const result: InferenceResult = infer(note, { paused })
  const segments = reconcileSegments(note, result, state.calendar)
  const updated: Note = {
    ...note,
    kind: result.kind,
    confidence: result.confidence,
    entities: result.entities,
    segments,
  }
  // Rebuild this note's owned calendar events (needs updated segments).
  const owned = buildOwnedEvents(updated, result)
  const calendar = [
    ...state.calendar.filter((e) => e.noteId !== note.id),
    ...owned,
  ]
  const reminders = syncReminders(state.reminders, updated, result)
  return {
    ...state,
    notes: state.notes.map((n) => (n.id === note.id ? updated : n)),
    calendar,
    reminders,
  }
}

// Keep an *existing* reminder in lock-step with its goal note by refreshing its
// display fields (title/target). Reminders are no longer created automatically —
// a streak only begins once the user accepts the offer (see START_STREAK). The
// schedule and completion log are owned by the user and never overwritten here.
function syncReminders(
  reminders: Reminder[],
  note: Note,
  result: InferenceResult,
): Reminder[] {
  const existing = reminders.find((r) => r.noteId === note.id)
  if (result.kind !== 'goal' || !existing) return reminders
  const title = note.answers.goal || note.text.trim().split('\n')[0].slice(0, 48)
  const target = note.answers.target || existing.target
  if (title && (title !== existing.title || target !== existing.target)) {
    return reminders.map((r) =>
      r.id === existing.id ? { ...r, title, target } : r,
    )
  }
  return reminders
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'CREATE_NOTE': {
      const n = newNote()
      return { ...state, notes: [n, ...state.notes], selectedId: n.id }
    }
    case 'SELECT':
      return { ...state, selectedId: action.id }
    case 'DELETE': {
      const notes = state.notes.filter((n) => n.id !== action.id)
      const calendar = state.calendar.filter((e) => e.noteId !== action.id)
      const reminders = state.reminders.filter((r) => r.noteId !== action.id)
      const selectedId =
        state.selectedId === action.id ? notes[0]?.id ?? null : state.selectedId
      const ensured = notes.length ? notes : [newNote()]
      return {
        ...state,
        notes: ensured,
        calendar,
        reminders,
        selectedId: selectedId ?? ensured[0].id,
      }
    }
    case 'SET_TEXT': {
      const notes = state.notes.map((n) =>
        n.id === action.id
          ? { ...n, text: action.text, updatedAt: Date.now() }
          : n,
      )
      return { ...state, notes }
    }
    case 'REASSESS': {
      const note = state.notes.find((n) => n.id === action.id)
      if (!note) return state
      return reassess(state, note, action.paused)
    }
    case 'ANSWER': {
      const note = state.notes.find((n) => n.id === action.id)
      if (!note) return state
      const updated: Note = {
        ...note,
        answers: { ...note.answers, [action.field]: action.value },
        askedFields: Array.from(new Set([...note.askedFields, action.field])),
        updatedAt: Date.now(),
      }
      return reassess(
        { ...state, notes: state.notes.map((n) => (n.id === note.id ? updated : n)) },
        updated,
        true,
      )
    }
    case 'SKIP': {
      const note = state.notes.find((n) => n.id === action.id)
      if (!note) return state
      const updated: Note = {
        ...note,
        askedFields: Array.from(new Set([...note.askedFields, action.field])),
        updatedAt: Date.now(),
      }
      return reassess(
        { ...state, notes: state.notes.map((n) => (n.id === note.id ? updated : n)) },
        updated,
        true,
      )
    }
    case 'EDIT_SEGMENT': {
      const notes = state.notes.map((n) => {
        if (n.id !== action.id) return n
        const segments = n.segments.map((s) =>
          s.id === action.segmentId
            ? ({ ...s, filled: true, data: { ...action.data, auto: false, sig: s.data?.sig } } as Segment)
            : s,
        )
        return { ...n, segments, updatedAt: Date.now() }
      })
      return { ...state, notes }
    }
    case 'SET_MINDMAP': {
      const notes = state.notes.map((n) =>
        n.id === action.id
          ? { ...n, mindmap: action.mindmap, updatedAt: Date.now() }
          : n,
      )
      return { ...state, notes }
    }
    case 'SET_BACKEND':
      return {
        ...state,
        settings: {
          ...state.settings,
          aiBackend: action.backend,
          broaderAi: action.backend !== 'local',
        },
      }
    case 'SET_CONFIG':
      return { ...state, config: action.config }
    case 'SET_BILLING':
      return { ...state, billing: action.billing }
    case 'SET_EXTERNAL_EVENTS': {
      const calendar = [
        ...state.calendar.filter((e) => e.source !== 'google'),
        ...externalToCalendar(action.events),
      ]
      return { ...state, calendar }
    }
    case 'TOGGLE_OCCURRENCE': {
      const reminders = state.reminders.map((r) => {
        if (r.id !== action.reminderId) return r
        const has = r.completions.includes(action.iso)
        const completions = has
          ? r.completions.filter((d) => d !== action.iso)
          : [...r.completions, action.iso]
        const next: Reminder = { ...r, completions }
        // Lock in a new personal best whenever the current run beats it.
        const note = state.notes.find((n) => n.id === r.noteId)
        next.bestStreak = Math.max(r.bestStreak, computeStreak(next, note).current)
        return next
      })
      return { ...state, reminders }
    }
    case 'UPDATE_REMINDER': {
      const reminders = state.reminders.map((r) =>
        r.id === action.reminderId ? { ...r, ...action.patch } : r,
      )
      return { ...state, reminders }
    }
    case 'START_STREAK': {
      const note = state.notes.find((n) => n.id === action.noteId)
      // Don't double-create if a streak is already running for this note.
      if (!note || state.reminders.some((r) => r.noteId === note.id)) return state
      const notes = state.notes.map((n) =>
        n.id === note.id ? { ...n, streakDeclined: false } : n,
      )
      return {
        ...state,
        notes,
        reminders: [...state.reminders, reminderFromNote(note)],
      }
    }
    case 'DECLINE_STREAK': {
      const notes = state.notes.map((n) =>
        n.id === action.noteId ? { ...n, streakDeclined: true } : n,
      )
      return { ...state, notes }
    }
    case 'SET_ENRICHMENT': {
      const note = state.notes.find((n) => n.id === action.id)
      if (!note) return state
      const updated: Note = { ...note, enrichment: action.enrichment }
      // Re-run inference so a recognized entity reshapes the workspace.
      return reassess(
        { ...state, notes: state.notes.map((n) => (n.id === note.id ? updated : n)) },
        updated,
        true,
      )
    }
    default:
      return state
  }
}

interface StoreApi {
  state: State
  selected: Note | null
  createNote: () => void
  select: (id: string) => void
  remove: (id: string) => void
  setText: (id: string, text: string) => void
  reassess: (id: string, paused: boolean) => void
  answer: (id: string, field: string, value: string) => void
  skip: (id: string, field: string) => void
  editSegment: (id: string, segmentId: string, data: any) => void
  setMindmap: (id: string, mindmap: MindMap) => void
  setBackend: (backend: AiBackend) => void
  setConfig: (config: ServerConfig) => void
  setBilling: (billing: BillingStatus) => void
  setEnrichment: (id: string, enrichment: Enrichment) => void
  setExternalEvents: (events: ExternalEvent[]) => void
  toggleOccurrence: (reminderId: string, iso: string) => void
  updateReminder: (reminderId: string, patch: Partial<Reminder>) => void
  startStreak: (noteId: string) => void
  declineStreak: (noteId: string) => void
}

const StoreContext = createContext<StoreApi | null>(null)

// Debounce Supabase sync to avoid hammering the DB on rapid edits
let saveTimeout: ReturnType<typeof setTimeout> | null = null

async function syncToSupabase(state: State) {
  const { supabase } = await import('../services/supabase')
  const { getAuthToken } = await import('../services/supabase')

  if (!supabase) return

  const token = await getAuthToken()
  if (!token) return

  // For each note in the state, upsert it to the DB
  for (const note of state.notes) {
    const { error } = await supabase
      .from('notes')
      .upsert({
        id: note.id,
        data: note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', note.id)

    if (error) {
      console.error('Failed to sync note to Supabase:', error)
    }
  }

  // Similarly for reminders
  for (const reminder of state.reminders) {
    const { error } = await supabase
      .from('reminders')
      .upsert({
        id: reminder.id,
        data: reminder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reminder.id)

    if (error) {
      console.error('Failed to sync reminder to Supabase:', error)
    }
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  // Load fresh data from Supabase on mount
  useEffect(() => {
    const loadFromSupabase = async () => {
      const { supabase } = await import('../services/supabase')
      const { getAuthToken } = await import('../services/supabase')

      if (!supabase) return

      const token = await getAuthToken()
      if (!token) return

      // Fetch notes from Supabase
      const { data: notesData, error: notesError } = await supabase
        .from('notes')
        .select('*')

      if (!notesError && notesData) {
        const notesToAdd = notesData.filter(
          (row: any) => !state.notes.find((n) => n.id === row.id),
        )
        notesToAdd.forEach((row: any) => {
          dispatch({ type: 'CREATE_NOTE' })
          // The new note's ID will be different, so this is a placeholder.
          // In production, you'd do a more sophisticated merge.
        })
      }

      // Fetch reminders from Supabase
      const { data: remindersData, error: remindersError } = await supabase
        .from('reminders')
        .select('*')

      if (!remindersError && remindersData) {
        remindersData.forEach((row: any) => {
          const exists = state.reminders.find((r) => r.id === row.id)
          if (!exists) {
            dispatch({
              type: 'UPDATE_REMINDER',
              reminderId: row.id,
              patch: row.data,
            })
          }
        })
      }
    }

    // Load from Supabase once on mount
    loadFromSupabase().catch((err) => {
      console.error('Failed to load from Supabase:', err)
    })
  }, [])

  useEffect(() => {
    // Always save to localStorage (fast, local-first)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota errors */
    }

    // Debounce Supabase sync (only if configured + logged in)
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      syncToSupabase(state).catch((err) => {
        console.error('Supabase sync error:', err)
      })
    }, 1500)

    return () => {
      if (saveTimeout) clearTimeout(saveTimeout)
    }
  }, [state])

  const api = useMemo<StoreApi>(
    () => ({
      state,
      selected: state.notes.find((n) => n.id === state.selectedId) ?? null,
      createNote: () => dispatch({ type: 'CREATE_NOTE' }),
      select: (id) => dispatch({ type: 'SELECT', id }),
      remove: (id) => dispatch({ type: 'DELETE', id }),
      setText: (id, text) => dispatch({ type: 'SET_TEXT', id, text }),
      reassess: (id, paused) => dispatch({ type: 'REASSESS', id, paused }),
      answer: (id, field, value) => dispatch({ type: 'ANSWER', id, field, value }),
      skip: (id, field) => dispatch({ type: 'SKIP', id, field }),
      editSegment: (id, segmentId, data) =>
        dispatch({ type: 'EDIT_SEGMENT', id, segmentId, data }),
      setMindmap: (id, mindmap) => dispatch({ type: 'SET_MINDMAP', id, mindmap }),
      setBackend: (backend) => dispatch({ type: 'SET_BACKEND', backend }),
      setConfig: (config) => dispatch({ type: 'SET_CONFIG', config }),
      setBilling: (billing) => dispatch({ type: 'SET_BILLING', billing }),
      setEnrichment: (id, enrichment) =>
        dispatch({ type: 'SET_ENRICHMENT', id, enrichment }),
      setExternalEvents: (events) =>
        dispatch({ type: 'SET_EXTERNAL_EVENTS', events }),
      toggleOccurrence: (reminderId, iso) =>
        dispatch({ type: 'TOGGLE_OCCURRENCE', reminderId, iso }),
      updateReminder: (reminderId, patch) =>
        dispatch({ type: 'UPDATE_REMINDER', reminderId, patch }),
      startStreak: (noteId) => dispatch({ type: 'START_STREAK', noteId }),
      declineStreak: (noteId) => dispatch({ type: 'DECLINE_STREAK', noteId }),
    }),
    [state],
  )

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
