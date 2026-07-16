import type {
  CalendarEvent,
  ChecklistItem,
  Entities,
  Flashcard,
  InferenceResult,
  Note,
  NoteKind,
  Segment,
  SegmentType,
  StudySession,
} from '../types'
import {
  makeFlashcards,
  makeMilestones,
  makeProjectTasks,
  makePurchasePlan,
  makeStudySchedule,
  makeTopicChecklist,
  uid,
} from '../engine/generate'
import { isSoftwareProject } from '../engine/classify'
import { findConflicts } from './calendar'

// Which segment types a kind wants, given current data. The streak tracker
// attaches wherever a note has multiple recurrences laddering up to a wider
// goal: recurring habits (goal) and study plans with 2+ sessions (academic).
function desiredTypes(kind: NoteKind, entities: Entities): SegmentType[] {
  switch (kind) {
    case 'academic': {
      const base: SegmentType[] = ['calendar', 'checklist', 'flashcards', 'schedule']
      if (makeStudySchedule(entities).length >= 2) base.push('streak-tracker')
      return base
    }
    case 'event':
      return ['event-alert']
    case 'project':
      return ['project-board']
    case 'goal':
      return ['streak-tracker']
    case 'tasks':
      return ['checklist']
    case 'purchase':
      return ['purchase-planner']
    // These reuse the general-purpose segments: a checklist for the things to
    // do/pack/gather (now seeded with a starter plan on classification), plus a
    // calendar block ONLY once the note carries a date. Without that guard a
    // dateless "trip to oman" showed an empty "forming" calendar skeleton next
    // to the useful checklist — noise, not information.
    case 'health':
    case 'travel':
      return entities.date ? ['calendar', 'checklist'] : ['checklist']
    case 'finance':
    case 'recipe':
    case 'media':
      return ['checklist']
    default:
      return []
  }
}

function titleFor(type: SegmentType, kind?: NoteKind): string {
  switch (type) {
    case 'calendar':
      return 'Calendar'
    case 'checklist':
      // The checklist is reused across kinds — name it for what it holds so the
      // menu reads as purpose-built rather than a generic "topic" list.
      switch (kind) {
        case 'travel':
          return 'Trip checklist'
        case 'health':
          return 'Health checklist'
        case 'finance':
          return 'Money to sort'
        case 'recipe':
          return 'Recipe steps'
        case 'media':
          return 'Your list'
        default:
          return 'Topic checklist'
      }
    case 'flashcards':
      return 'Flashcards'
    case 'schedule':
      return 'Study schedule'
    case 'project-board':
      return 'Project workspace'
    case 'streak-tracker':
      return 'Streak'
    case 'event-alert':
      return 'Event'
    case 'purchase-planner':
      return 'Buying decision'
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
    case 'streak-tracker':
      return `${a.cadence ?? ''}|${a.target ?? ''}|${entities.date?.iso ?? ''}|${entities.topics.join('|')}`
    case 'event-alert':
      return `${entities.knownEvent?.id ?? ''}|${entities.knownEvent?.name ?? ''}|${entities.date?.iso ?? ''}|${a.attend ?? ''}|${a.briefing ?? ''}|${note.enrichment?.summary ?? ''}`
    case 'purchase-planner':
      return `${note.text.trim().split('\n')[0].slice(0, 60)}|${a.budget ?? ''}|${a.priorities ?? ''}|${a.timing ?? ''}|${entities.amounts?.join(',') ?? ''}`
  }
}

function buildData(
  type: SegmentType,
  note: Note,
  entities: Entities,
  calendar: CalendarEvent[],
  kind: NoteKind,
): { data: any; filled: boolean } {
  switch (type) {
    case 'flashcards': {
      const cards = makeFlashcards(entities)
      return { data: { cards }, filled: cards.length > 0 }
    }
    case 'checklist': {
      const items = makeTopicChecklist(entities, kind)
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
      // "Filled" = the user has given the defining detail. For a software build
      // that's the stack; a non-software project skips that question, so key off
      // its first real answer instead — otherwise the board is stuck "forming".
      const filled = isSoftwareProject(note.text)
        ? 'stack' in note.answers
        : 'timeline' in note.answers || 'goal' in note.answers
      return {
        data: { tasks, milestones },
        filled,
      }
    }
    case 'streak-tracker': {
      // The streak's state lives on its Reminder, not the segment. This segment
      // just decides whether to show the tracker/offer at all.
      const worthy =
        'cadence' in note.answers || makeStudySchedule(entities).length >= 2
      return { data: {}, filled: worthy }
    }
    case 'purchase-planner': {
      // Usable the moment we know what's being bought — questions enrich it.
      return { data: makePurchasePlan(note, entities), filled: true }
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

// ---- Merging user-owned lists with fresh note-derived items -----------------
//
// Checklists and flashcards are editable, but must ALSO keep absorbing new
// topics as the note grows. So instead of freezing on first edit (or blowing
// the user's edits away on refresh), we merge: keep every existing item, append
// only the fresh items for topics not already present and not deleted by the
// user (`dismissed`). Never removes — pulling a topic out of the note leaves any
// item the user kept for it.
const norm = (s: string) => s.trim().toLowerCase()

function checklistKey(i: ChecklistItem): string {
  return i.key ?? norm(i.text)
}

function mergeChecklist(
  existing: ChecklistItem[],
  fresh: ChecklistItem[],
  dismissed: string[],
): ChecklistItem[] {
  const have = new Set(existing.map(checklistKey))
  const dead = new Set(dismissed)
  const adds = fresh.filter((f) => {
    const k = checklistKey(f)
    return !have.has(k) && !dead.has(k)
  })
  return adds.length ? [...existing, ...adds] : existing
}

function mergeFlashcards(
  existing: Flashcard[],
  fresh: Flashcard[],
  dismissed: string[],
): Flashcard[] {
  // Keyed by topic: a topic is "present" if it has any card, so partially
  // trimmed decks aren't refilled. New topics bring their whole set.
  const have = new Set(existing.map((c) => norm(c.topic)))
  const dead = new Set(dismissed)
  const adds = fresh.filter((f) => {
    const k = norm(f.topic)
    return !have.has(k) && !dead.has(k)
  })
  return adds.length ? [...existing, ...adds] : existing
}

export function reconcileSegments(
  note: Note,
  result: InferenceResult,
  calendar: CalendarEvent[],
): Segment[] {
  const { kind, entities } = result
  const want = desiredTypes(kind, entities)
  const next: Segment[] = []

  for (const type of want) {
    const sig = signature(type, note, entities)
    const existing = note.segments.find((s) => s.type === type)

    if (!existing) {
      const { data, filled } = buildData(type, note, entities, calendar, kind)
      next.push({
        id: uid('seg'),
        type,
        title: titleFor(type, kind),
        filled,
        data: { ...data, auto: true, sig, dismissed: [] },
      })
      continue
    }

    // Editable lists: merge rather than freeze-or-replace, so the user's edits
    // persist AND the note keeps feeding in new topics as it grows.
    if (type === 'checklist' || type === 'flashcards') {
      if (existing.data?.sig === sig) {
        next.push(existing)
        continue
      }
      const { data: fresh } = buildData(type, note, entities, calendar, kind)
      const dismissed: string[] = existing.data?.dismissed ?? []
      if (type === 'checklist') {
        const items = mergeChecklist(
          existing.data?.items ?? [],
          fresh.items,
          dismissed,
        )
        next.push({
          ...existing,
          filled: items.length > 0,
          data: { ...existing.data, items, sig, dismissed },
        })
      } else {
        const cards = mergeFlashcards(
          existing.data?.cards ?? [],
          fresh.cards,
          dismissed,
        )
        next.push({
          ...existing,
          filled: cards.length > 0,
          data: { ...existing.data, cards, sig, dismissed },
        })
      }
      continue
    }

    if (existing.data?.auto !== false && existing.data?.sig !== sig) {
      // Still auto-managed and inputs changed → refresh, preserving id.
      const { data, filled } = buildData(type, note, entities, calendar, kind)
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
