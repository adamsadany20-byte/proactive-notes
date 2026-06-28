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
  Note,
  Segment,
} from '../types'
import type { AiBackend, ExternalEvent, ServerConfig } from '../services/api'
import { infer } from '../engine/inference'
import { uid } from '../engine/generate'
import { seedCalendar } from './calendar'
import { buildOwnedEvents, reconcileSegments } from './reconcile'

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
  selectedId: string | null
  settings: Settings
  config: ServerConfig | null
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
  | { type: 'SET_BACKEND'; backend: AiBackend }
  | { type: 'SET_CONFIG'; config: ServerConfig }
  | { type: 'SET_ENRICHMENT'; id: string; enrichment: Enrichment }
  | { type: 'SET_EXTERNAL_EVENTS'; events: ExternalEvent[] }

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
    selectedId: first.id,
    settings: { aiBackend: 'local', broaderAi: false },
    config: null,
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
    // Migrate older saves: pre-tier state only had `broaderAi`.
    const backend: AiBackend =
      parsed.settings?.aiBackend ?? (parsed.settings?.broaderAi ? 'haiku' : 'local')
    return {
      ...parsed,
      calendar: [...seedCalendar(), ...owned],
      settings: { aiBackend: backend, broaderAi: backend !== 'local' },
      config: null,
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
  return {
    ...state,
    notes: state.notes.map((n) => (n.id === note.id ? updated : n)),
    calendar,
  }
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
      const selectedId =
        state.selectedId === action.id ? notes[0]?.id ?? null : state.selectedId
      const ensured = notes.length ? notes : [newNote()]
      return {
        ...state,
        notes: ensured,
        calendar,
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
    case 'SET_EXTERNAL_EVENTS': {
      const calendar = [
        ...state.calendar.filter((e) => e.source !== 'google'),
        ...externalToCalendar(action.events),
      ]
      return { ...state, calendar }
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
  setBackend: (backend: AiBackend) => void
  setConfig: (config: ServerConfig) => void
  setEnrichment: (id: string, enrichment: Enrichment) => void
  setExternalEvents: (events: ExternalEvent[]) => void
}

const StoreContext = createContext<StoreApi | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota errors */
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
      setBackend: (backend) => dispatch({ type: 'SET_BACKEND', backend }),
      setConfig: (config) => dispatch({ type: 'SET_CONFIG', config }),
      setEnrichment: (id, enrichment) =>
        dispatch({ type: 'SET_ENRICHMENT', id, enrichment }),
      setExternalEvents: (events) =>
        dispatch({ type: 'SET_EXTERNAL_EVENTS', events }),
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
