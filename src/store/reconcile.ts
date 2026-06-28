import type {
  CalendarEvent,
  Entities,
  InferenceResult,
  Note,
  NoteKind,
  Segment,
  SegmentType,
  StudySession,
} from '../types'
import {
  makeFlashcards,
  makeGoalPlan,
  makeMilestones,
  makeProjectTasks,
  makeStudySchedule,
  makeTopicChecklist,
  uid,
} from '../engine/generate'
import { findConflicts } from './calendar'

// Which segment types a kind wants, given current data.
function desiredTypes(kind: NoteKind): SegmentType[] {
  switch (kind) {
    case 'academic':
      return ['calendar', 'checklist', 'flashcards', 'schedule']
    case 'event':
      return ['event-alert']
    case 'project':
      return ['project-board']
    case 'goal':
      return ['goal-tracker']
    case 'tasks':
      return ['checklist']
    default:
      return []
  }
}

function titleFor(type: SegmentType): string {
  switch (type) {
    case 'calendar':
      return 'Calendar'
    case 'checklist':
      return 'Topic checklist'
    case 'flashcards':
      return 'Flashcards'
    case 'schedule':
      return 'Study schedule'
    case 'project-board':
      return 'Project workspace'
    case 'goal-tracker':
      return 'Goal tracker'
    case 'event-alert':
      return 'Event'
  }
}

// A signature of the inputs a segment derives from. When it changes and the
// segment is still auto-managed, we regenerate its data (incremental fill).
function signature(
  type: SegmentType,
  note: Note,
  entities: Entities,
): string {
  const a = note.answers
  switch (type) {
    case 'flashcards':
    case 'checklist':
      return entities.topics.join('|') + '::' + (entities.subject ?? '')
    case 'schedule':
      return (entities.date?.iso ?? '') + '::' + entities.topics.join('|') + '::' + (entities.subject ?? '')
    case 'calendar':
      return (entities.date?.iso ?? '') + '::' + (entities.time ?? '')
    case 'project-board':
      return `${a.stack ?? ''}|${a.timeline ?? ''}|${a.team ?? ''}|${a.goal ?? ''}`
    case 'goal-tracker':
      return `${a.cadence ?? ''}|${a.target ?? ''}`
    case 'event-alert':
      return `${entities.knownEvent?.id ?? ''}|${entities.knownEvent?.name ?? ''}|${entities.date?.iso ?? ''}|${a.attend ?? ''}|${a.briefing ?? ''}|${note.enrichment?.summary ?? ''}`
  }
}

function buildData(
  type: SegmentType,
  note: Note,
  entities: Entities,
  calendar: CalendarEvent[],
): { data: any; filled: boolean } {
  switch (type) {
    case 'flashcards': {
      const cards = makeFlashcards(entities)
      return { data: { cards }, filled: cards.length > 0 }
    }
    case 'checklist': {
      const items = makeTopicChecklist(entities)
      return { data: { items }, filled: items.length > 0 }
    }
    case 'schedule': {
      const sessions = makeStudySchedule(entities)
      return { data: { sessions }, filled: sessions.length > 0 }
    }
    case 'calendar': {
      return {
        data: { date: entities.date?.iso, time: entities.time },
        filled: !!entities.date,
      }
    }
    case 'project-board': {
      const tasks = makeProjectTasks(note)
      const milestones = makeMilestones(note)
      return {
        data: { tasks, milestones },
        filled: 'stack' in note.answers,
      }
    }
    case 'goal-tracker': {
      return { data: makeGoalPlan(note), filled: 'cadence' in note.answers }
    }
    case 'event-alert': {
      const ev = entities.knownEvent
      const date = ev ? null : entities.date?.iso
      return {
        data: {
          eventName: ev?.name ?? noteHeadline(note),
          category: ev?.category,
          highlights: ev?.highlights ?? [],
          summary: ev?.synthetic ? note.enrichment?.summary : undefined,
          enriched: !!ev?.synthetic,
          date,
          attend: note.answers.attend,
          briefing: note.answers.briefing,
        },
        filled: !!ev || !!entities.date,
      }
    }
  }
}

function noteHeadline(note: Note): string {
  return note.text.trim().split('\n')[0].slice(0, 40) || 'Event'
}

export function reconcileSegments(
  note: Note,
  result: InferenceResult,
  calendar: CalendarEvent[],
): Segment[] {
  const { kind, entities } = result
  const want = desiredTypes(kind)
  const next: Segment[] = []

  for (const type of want) {
    const sig = signature(type, note, entities)
    const existing = note.segments.find((s) => s.type === type)
    if (!existing) {
      const { data, filled } = buildData(type, note, entities, calendar)
      next.push({
        id: uid('seg'),
        type,
        title: titleFor(type),
        filled,
        data: { ...data, auto: true, sig },
      })
    } else if (existing.data?.auto !== false && existing.data?.sig !== sig) {
      // Still auto-managed and inputs changed → refresh, preserving id.
      const { data, filled } = buildData(type, note, entities, calendar)
      next.push({
        ...existing,
        filled,
        data: { ...data, auto: true, sig },
      })
    } else {
      next.push(existing)
    }
  }

  // Preserve any segments the kind no longer "wants" only if user-edited.
  for (const seg of note.segments) {
    if (!want.includes(seg.type) && seg.data?.auto === false) {
      next.push(seg)
    }
  }
  return next
}

// Build the calendar events a note owns, from its current state. Caller merges
// these with non-owned (fixed / other-note) events.
export function buildOwnedEvents(
  note: Note,
  result: InferenceResult,
): CalendarEvent[] {
  const { kind, entities } = result
  const owned: CalendarEvent[] = []

  if (kind === 'academic' && entities.date) {
    owned.push({
      id: uid('cal'),
      title: testTitle(note, entities),
      date: entities.date.iso,
      start: entities.time ?? '09:00',
      end: addHour(entities.time ?? '09:00'),
      kind: 'test',
      noteId: note.id,
    })
    const schedule = note.segments.find((s) => s.type === 'schedule')
    const sessions: StudySession[] = schedule?.data?.sessions ?? []
    for (const s of sessions) {
      owned.push({
        id: uid('cal'),
        title: s.label,
        date: s.date,
        start: '17:00',
        end: '18:00',
        kind: 'study',
        noteId: note.id,
        topics: s.topics,
      })
    }
  }

  if (kind === 'event') {
    const ev = entities.knownEvent
    const attendIgnored = note.answers.attend === 'Ignore'
    // Synthetic (LLM-enriched) events have no real date — don't fabricate entries.
    if (ev && ev.synthetic) {
      // no owned calendar events; the info segment carries the knowledge
    } else if (ev && !attendIgnored) {
      for (let i = 0; i < ev.durationDays; i++) {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() + ev.startOffsetDays + i)
        owned.push({
          id: uid('cal'),
          title: ev.name,
          date: isoOf(d),
          start: ev.startTime,
          end: ev.endTime,
          kind: 'event',
          noteId: note.id,
        })
      }
      if (note.answers.briefing === 'Yes please') {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() + ev.startOffsetDays + ev.durationDays)
        owned.push({
          id: uid('cal'),
          title: `${ev.name} — highlights briefing`,
          date: isoOf(d),
          start: '09:00',
          end: '09:30',
          kind: 'briefing',
          noteId: note.id,
        })
      }
    } else if (!ev && entities.date) {
      owned.push({
        id: uid('cal'),
        title: noteHeadline(note),
        date: entities.date.iso,
        start: entities.time ?? '19:00',
        end: addHour(entities.time ?? '19:00'),
        kind: 'event',
        noteId: note.id,
      })
    }
  }

  return owned
}

// Compute conflicts for a note's event-alert against everything else.
export function eventConflicts(
  note: Note,
  result: InferenceResult,
  allEvents: CalendarEvent[],
): CalendarEvent[] {
  const ev = result.entities.knownEvent
  if (!ev || ev.synthetic) return []
  const conflicts: CalendarEvent[] = []
  for (let i = 0; i < ev.durationDays; i++) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + ev.startOffsetDays + i)
    const found = findConflicts(
      allEvents.filter((e) => e.noteId !== note.id),
      { date: isoOf(d), start: ev.startTime, end: ev.endTime },
    )
    conflicts.push(...found)
  }
  return conflicts
}

function testTitle(note: Note, entities: Entities): string {
  const subj = entities.subject
  if (subj) return `${cap(subj)} test`
  return noteHeadline(note)
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function addHour(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}
