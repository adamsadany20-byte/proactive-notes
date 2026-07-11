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

// Locally-learned behavioural signals the deterministic engine uses to
// personalise suggestions — never synced to the server, purely on-device.
interface Habits {
  // Timestamps of shopping trips the user has planned, newest appended. The
  // pattern engine derives a weekly cadence ("you usually shop Tuesday
  // evenings") from these once there's a repeated weekday.
  shoppingLog: number[]
}

interface State {
  notes: Note[]
  calendar: CalendarEvent[]
  reminders: Reminder[]
  selectedId: string | null
  settings: Settings
  config: ServerConfig | null
  billing: BillingStatus | null
  habits: Habits
  // Ids of notes/reminders the user has deleted. Kept locally (never synced) so a
  // cloud row whose deletion hasn't finished syncing can't be resurrected by
  // HYDRATE on the next sign-in. Capped to a recent window.
  deletedIds: string[]
}

const MAX_TOMBSTONES = 500

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
  | { type: 'SET_BILLING'; billing: BillingStatus }
  | { type: 'SET_ENRICHMENT'; id: string; enrichment: Enrichment }
  | { type: 'SET_EXTERNAL_EVENTS'; events: ExternalEvent[] }
  | { type: 'TOGGLE_OCCURRENCE'; reminderId: string; iso: string }
  | { type: 'UPDATE_REMINDER'; reminderId: string; patch: Partial<Reminder> }
  | { type: 'START_STREAK'; noteId: string }
  | { type: 'DECLINE_STREAK'; noteId: string }
  | { type: 'LOG_SHOPPING'; ts: number }
  | { type: 'HYDRATE'; notes: Note[]; reminders: Reminder[] }

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
    habits: { shoppingLog: [] },
    deletedIds: [],
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
      habits: { shoppingLog: parsed.habits?.shoppingLog ?? [] },
      deletedIds: parsed.deletedIds ?? [],
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
      const removedReminderIds = state.reminders
        .filter((r) => r.noteId === action.id)
        .map((r) => r.id)
      const notes = state.notes.filter((n) => n.id !== action.id)
      const calendar = state.calendar.filter((e) => e.noteId !== action.id)
      const reminders = state.reminders.filter((r) => r.noteId !== action.id)
      const selectedId =
        state.selectedId === action.id ? notes[0]?.id ?? null : state.selectedId
      const ensured = notes.length ? notes : [newNote()]
      // Tombstone the note + its reminders so a not-yet-synced cloud row can't be
      // resurrected by a later HYDRATE (e.g. after sign-out/in).
      const gone = [action.id, ...removedReminderIds]
      const deletedIds = [
        ...state.deletedIds.filter((id) => !gone.includes(id)),
        ...gone,
      ].slice(-MAX_TOMBSTONES)
      return {
        ...state,
        notes: ensured,
        calendar,
        reminders,
        selectedId: selectedId ?? ensured[0].id,
        deletedIds,
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
    case 'LOG_SHOPPING': {
      // Keep a bounded, de-duplicated history (ignore repeat logs within an
      // hour so a double-tap doesn't skew the learned cadence).
      const log = state.habits.shoppingLog
      if (log.some((t) => Math.abs(t - action.ts) < 3600_000)) return state
      const shoppingLog = [...log, action.ts].slice(-60)
      return { ...state, habits: { ...state.habits, shoppingLog } }
    }
    case 'HYDRATE': {
      // Merge cloud rows into local state (last-write-wins per id by updatedAt).
      // Skip anything the user has tombstoned — a deleted note/reminder must not
      // be resurrected just because its cloud row hasn't finished being pruned.
      const tomb = new Set(state.deletedIds)
      const incomingNotes = action.notes.filter((n) => !tomb.has(n.id))
      const incomingReminders = action.reminders.filter((r) => !tomb.has(r.id))

      const byId = new Map(state.notes.map((n) => [n.id, n]))
      for (const cloud of incomingNotes) {
        const local = byId.get(cloud.id)
        if (!local || (cloud.updatedAt ?? 0) >= (local.updatedAt ?? 0)) {
          byId.set(cloud.id, cloud)
        }
      }
      let notes = Array.from(byId.values())
      // If the only local note was a blank starter, and cloud gave us real
      // notes, drop the empty one so it doesn't linger.
      if (incomingNotes.length) {
        notes = notes.filter(
          (n) => n.text.trim() !== '' || incomingNotes.some((c) => c.id === n.id),
        )
      }
      if (!notes.length) notes = [newNote()]

      const rById = new Map(state.reminders.map((r) => [r.id, r]))
      for (const cloud of incomingReminders) rById.set(cloud.id, cloud)
      const reminders = Array.from(rById.values())

      const selectedId = notes.some((n) => n.id === state.selectedId)
        ? state.selectedId
        : notes[0].id
      return { ...state, notes, reminders, selectedId }
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
  setBilling: (billing: BillingStatus) => void
  setEnrichment: (id: string, enrichment: Enrichment) => void
  setExternalEvents: (events: ExternalEvent[]) => void
  toggleOccurrence: (reminderId: string, iso: string) => void
  updateReminder: (reminderId: string, patch: Partial<Reminder>) => void
  startStreak: (noteId: string) => void
  declineStreak: (noteId: string) => void
  logShopping: (ts?: number) => void
}

const StoreContext = createContext<StoreApi | null>(null)

// Debounce Supabase sync to avoid hammering the DB on rapid edits
let saveTimeout: ReturnType<typeof setTimeout> | null = null

// Whether this device has pulled the user's cloud data down yet. Deletion
// reconciliation (pruning cloud rows that no longer exist locally) is gated on
// this: before the first load completes, local state is just the blank starter,
// so pruning then would wipe every real note out of the cloud.
let hydrated = false

async function syncToSupabase(state: State) {
  const { supabase } = await import('../services/supabase')

  if (!supabase) return

  // The row's user_id must match the signed-in user or row-level security
  // rejects the write with a 403. Get it from the current session.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const userId = user.id

  // Upsert all notes in one batch (each row carries user_id for RLS).
  const noteRows = state.notes.map((note) => ({
    id: note.id,
    user_id: userId,
    data: note,
    updated_at: new Date().toISOString(),
  }))
  if (noteRows.length) {
    const { error } = await supabase.from('notes').upsert(noteRows)
    if (error) console.error('Failed to sync notes to Supabase:', error)
  }

  // Upsert all reminders the same way.
  const reminderRows = state.reminders.map((reminder) => ({
    id: reminder.id,
    user_id: userId,
    data: reminder,
    updated_at: new Date().toISOString(),
  }))
  if (reminderRows.length) {
    const { error } = await supabase.from('reminders').upsert(reminderRows)
    if (error) console.error('Failed to sync reminders to Supabase:', error)
  }

  // Hard-delete anything the user has tombstoned. This is the authoritative
  // deletion signal and runs even before the first hydrate (unlike the
  // reconciliation below), so a deleted note can't linger in the cloud and be
  // resurrected on the next sign-in.
  if (state.deletedIds.length) {
    const ids = state.deletedIds
    const [{ error: ne }, { error: re }] = await Promise.all([
      supabase.from('notes').delete().in('id', ids),
      supabase.from('reminders').delete().in('id', ids),
    ])
    if (ne) console.error('Failed to delete tombstoned notes in Supabase:', ne)
    if (re) console.error('Failed to delete tombstoned reminders in Supabase:', re)
  }

  // Reconcile deletions: an upsert-only sync leaves rows for notes/reminders the
  // user has since deleted, so on the next load they'd be pulled back and merged
  // in — deletes never "stuck". Prune any cloud row whose id is gone locally.
  // Gated on `hydrated` so we never prune before this device has the cloud data.
  if (!hydrated) return

  const localNoteIds = new Set(state.notes.map((n) => n.id))
  const { data: cloudNotes } = await supabase.from('notes').select('id')
  const staleNotes = (cloudNotes ?? [])
    .map((r: any) => r.id as string)
    .filter((id) => !localNoteIds.has(id))
  if (staleNotes.length) {
    const { error } = await supabase.from('notes').delete().in('id', staleNotes)
    if (error) console.error('Failed to prune deleted notes in Supabase:', error)
  }

  const localReminderIds = new Set(state.reminders.map((r) => r.id))
  const { data: cloudReminders } = await supabase.from('reminders').select('id')
  const staleReminders = (cloudReminders ?? [])
    .map((r: any) => r.id as string)
    .filter((id) => !localReminderIds.has(id))
  if (staleReminders.length) {
    const { error } = await supabase
      .from('reminders')
      .delete()
      .in('id', staleReminders)
    if (error) console.error('Failed to prune deleted reminders in Supabase:', error)
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load)

  // Load the signed-in user's notes/reminders from Supabase on mount, and
  // again whenever they sign in (so a fresh device pulls their data).
  useEffect(() => {
    let cancelled = false
    // Re-gate pruning until this mount has pulled the cloud down. The provider
    // remounts on sign-out/in (AuthGate swaps it out), and a stale `hydrated`
    // from a previous session could otherwise let a sync prune a freshly
    // signed-in user's cloud notes before their data has loaded.
    hydrated = false

    const loadFromSupabase = async () => {
      const { supabase } = await import('../services/supabase')
      if (!supabase) return

      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      // RLS scopes these selects to the current user automatically.
      const [{ data: notesData }, { data: remindersData }] = await Promise.all([
        supabase.from('notes').select('data'),
        supabase.from('reminders').select('data'),
      ])
      if (cancelled) return

      const notes = (notesData ?? []).map((row: any) => row.data as Note)
      const reminders = (remindersData ?? []).map((row: any) => row.data as Reminder)
      if (notes.length || reminders.length) {
        dispatch({ type: 'HYDRATE', notes, reminders })
      }
      // Cloud data is now in local state, so it's safe for the sync to prune rows
      // the user deletes from here on without risking a wipe of unpulled notes.
      hydrated = true
    }

    loadFromSupabase().catch((err) => {
      console.error('Failed to load from Supabase:', err)
    })

    // Re-pull whenever auth state changes (e.g. just signed in).
    let unsub: (() => void) | undefined
    import('../services/supabase').then(({ supabase }) => {
      if (!supabase || cancelled) return
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') loadFromSupabase().catch(() => {})
      })
      unsub = () => data.subscription.unsubscribe()
    })

    return () => {
      cancelled = true
      unsub?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      logShopping: (ts) => dispatch({ type: 'LOG_SHOPPING', ts: ts ?? Date.now() }),
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
