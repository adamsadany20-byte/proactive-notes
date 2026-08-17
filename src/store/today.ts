import type { CalendarEvent, ChecklistItem, Note, Reminder } from '../types'
import { isoOf, sessionDates, todayIso, todaysCommitments } from './streak'

// ---------------------------------------------------------------------------
// "What should I do right now" — assembled from things the app already knows.
//
// The app was excellent at 0→1 (a blank note becomes a workspace) and absent at
// 1→done: once a checklist had twelve items, nothing helped you work THROUGH
// them. Every input for this already existed and simply lived in five different
// places, leaving the user as the integration layer:
//
//   • checklist items with a `remindAt` that has passed  → overdue / due
//   • study sessions scheduled for today                 → session
//   • streak commitments due today                       → commitment
//   • calendar events dated today                        → event
//   • project tasks parked in "doing"                    → doing
//   • notes started and quietly dropped                  → stale
//
// Pure and deterministic — no network, no AI, no cost. That matters: this is the
// panel a user sees most, so it must never spin, cost money, or need a plan.
// ---------------------------------------------------------------------------

export type TodayKind =
  | 'overdue'
  | 'due'
  | 'session'
  | 'commitment'
  | 'event'
  | 'doing'
  | 'stale'

export interface TodayItem {
  id: string
  kind: TodayKind
  text: string
  // Where it came from, so tapping it opens the right note.
  noteId: string
  noteTitle: string
  // Human label for when it's due ("09:00", "3 days ago").
  when?: string
  // Lower sorts first. Urgency, not chronology — an overdue thing outranks a
  // meeting later today.
  rank: number
  // Enough to tick it off in place.
  segmentId?: string
  itemId?: string
  reminderId?: string
}

// A note is "stale" when it has open items but hasn't been touched in a while.
// Long enough that it's genuinely been forgotten, not just left overnight.
const STALE_DAYS = 7
const DAY_MS = 86400000

function noteTitle(n: Note): string {
  return n.text.trim().split('\n')[0].slice(0, 60) || 'Untitled note'
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function agoLabel(ms: number): string {
  const days = Math.floor(ms / DAY_MS)
  if (days >= 14) return `${Math.floor(days / 7)} weeks ago`
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`
  const hours = Math.floor(ms / 3600000)
  return hours >= 1 ? `${hours}h ago` : 'just now'
}

export function collectToday(
  notes: Note[],
  calendar: CalendarEvent[],
  reminders: Reminder[],
  now: Date = new Date(),
): TodayItem[] {
  const today = isoOf(now)
  const out: TodayItem[] = []

  for (const note of notes) {
    const title = noteTitle(note)

    for (const seg of note.segments ?? []) {
      if (!seg.filled) continue
      const data: any = seg.data ?? {}

      // Checklist items carrying a reminder that has landed.
      if (seg.type === 'checklist') {
        for (const item of (data.items ?? []) as ChecklistItem[]) {
          if (!item?.text || item.done || !item.remindAt) continue
          const at = new Date(item.remindAt)
          if (Number.isNaN(at.getTime())) continue
          const overdue = at.getTime() < now.getTime() && isoOf(at) !== today
          const dueToday = isoOf(at) === today
          if (!overdue && !dueToday) continue
          out.push({
            id: `chk-${item.id}`,
            kind: overdue ? 'overdue' : 'due',
            text: item.text,
            noteId: note.id,
            noteTitle: title,
            when: overdue ? agoLabel(now.getTime() - at.getTime()) : hhmm(at),
            // Overdue outranks everything. Everything due TODAY sits in the
            // 100-199 band, ordered by clock time — scaled so a late-evening
            // item can't spill past the next band and end up sorted below a
            // backlog task.
            rank: overdue
              ? 0
              : 100 + Math.round(((at.getHours() * 60 + at.getMinutes()) / 1440) * 99),
            segmentId: seg.id,
            itemId: item.id,
          })
        }
      }

      // A project task actively in progress is the thing you already chose to
      // be working on — worth resurfacing so it isn't quietly abandoned.
      if (seg.type === 'project-board') {
        for (const task of data.tasks ?? []) {
          if (task?.column !== 'doing' || !task.title) continue
          out.push({
            id: `task-${task.id}`,
            kind: 'doing',
            text: task.title,
            noteId: note.id,
            noteTitle: title,
            rank: 600,
            segmentId: seg.id,
            itemId: task.id,
          })
        }
      }
    }

    // Study sessions scheduled for today.
    if (sessionDates(note).includes(today)) {
      out.push({
        id: `sess-${note.id}`,
        kind: 'session',
        text: `Study session — ${note.topic || title}`,
        noteId: note.id,
        noteTitle: title,
        rank: 300,
      })
    }
  }

  // Streak commitments due today that aren't ticked yet.
  for (const c of todaysCommitments(reminders, notes)) {
    if (c.done) continue
    out.push({
      id: `cmt-${c.reminderId}`,
      kind: 'commitment',
      text: c.title,
      noteId: c.noteId,
      noteTitle: c.title,
      rank: 200,
      reminderId: c.reminderId,
    })
  }

  // Anything on today's calendar, so the day's shape is visible alongside the work.
  for (const e of calendar) {
    if (e.date !== today || e.done) continue
    out.push({
      id: `ev-${e.id}`,
      kind: 'event',
      text: e.title,
      noteId: e.noteId ?? '',
      noteTitle: e.title,
      when: e.start,
      // Calendar band, 400-499, ordered by start time.
      rank: 400 + Math.round(((e.start ? Number(e.start.slice(0, 2)) : 0) / 24) * 99),
    })
  }

  // Picked up and quietly dropped: open items, untouched for a while. This is
  // the proactive one — nothing else in the app ever mentions these again.
  for (const note of notes) {
    const age = now.getTime() - (note.updatedAt ?? 0)
    if (age < STALE_DAYS * DAY_MS) continue
    let open = 0
    for (const seg of note.segments ?? []) {
      if (seg.type !== 'checklist' || !seg.filled) continue
      open += ((seg.data as any)?.items ?? []).filter(
        (i: ChecklistItem) => i && !i.done,
      ).length
    }
    if (!open) continue
    out.push({
      id: `stale-${note.id}`,
      kind: 'stale',
      text: `${open} thing${open === 1 ? '' : 's'} still open on "${noteTitle(note)}"`,
      noteId: note.id,
      noteTitle: noteTitle(note),
      when: agoLabel(age),
      rank: 700,
    })
  }

  return out.sort((a, b) => a.rank - b.rank || a.text.localeCompare(b.text))
}

// One-line summary for the panel header — the honest state of the day.
export function todaySummary(items: TodayItem[]): string {
  if (!items.length) return 'Nothing due — enjoy it'
  const overdue = items.filter((i) => i.kind === 'overdue').length
  const actionable = items.filter((i) => i.kind !== 'event' && i.kind !== 'stale').length
  const bits: string[] = []
  if (overdue) bits.push(`${overdue} overdue`)
  if (actionable) bits.push(`${actionable} to do`)
  const events = items.filter((i) => i.kind === 'event').length
  if (events) bits.push(`${events} on the calendar`)
  return bits.join(' · ') || `${items.length} to look at`
}

export { todayIso }

// ---------------------------------------------------------------------------
// The proactive layer: noticing things about the day, and about the user.
// All derived from data already on the device. No network, no AI, no cost.
// ---------------------------------------------------------------------------

export type DayPhase = 'morning' | 'afternoon' | 'evening' | 'night'

export function dayPhase(now: Date = new Date()): DayPhase {
  const h = now.getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  if (h >= 18 && h < 23) return 'evening'
  return 'night'
}

// The panel's heading changes with the time of day, because "here's your day"
// at 7am and "still open" at 10pm are different messages about the same list.
export function todayHeading(phase: DayPhase, items: TodayItem[]): string {
  const actionable = items.filter((i) => i.kind !== 'event' && i.kind !== 'stale').length
  if (!actionable) return phase === 'morning' ? 'Your day' : 'Now'
  switch (phase) {
    case 'morning':
      return 'Your day'
    case 'afternoon':
      return 'Now'
    case 'evening':
      return 'Left today'
    case 'night':
      return 'Still open'
  }
}

// ---- Learned rhythm ---------------------------------------------------------
//
// When does this person actually get things done? Derived from the local
// completion log (see Habits.completionLog): the dominant weekday and part of
// the day across their history. It only speaks when the pattern is real —
// enough history AND a genuinely dominant slot — otherwise it stays quiet
// rather than inventing a habit out of three data points.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PHASE_WORD: Record<DayPhase, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
  night: 'late nights',
}

// Below this there isn't enough history to claim a habit.
const RHYTHM_MIN_SAMPLES = 8
// The slot has to actually stand out, not just edge ahead of a flat spread.
const RHYTHM_MIN_SHARE = 0.34

export interface Rhythm {
  // "Sunday evenings"
  label: string
  weekday: number
  phase: DayPhase
  // True when right now falls inside that habitual window.
  isNow: boolean
  samples: number
}

export function describeRhythm(log: number[], now: Date = new Date()): Rhythm | null {
  if (!log || log.length < RHYTHM_MIN_SAMPLES) return null

  const byDay = new Array(7).fill(0)
  const byPhase: Record<DayPhase, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  }
  for (const ts of log) {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) continue
    byDay[d.getDay()]++
    byPhase[dayPhase(d)]++
  }

  const weekday = byDay.indexOf(Math.max(...byDay))
  const phase = (Object.keys(byPhase) as DayPhase[]).reduce((a, b) =>
    byPhase[a] >= byPhase[b] ? a : b,
  )

  // Both halves must be genuinely dominant, or we're reading noise.
  if (byDay[weekday] / log.length < RHYTHM_MIN_SHARE) return null
  if (byPhase[phase] / log.length < RHYTHM_MIN_SHARE) return null

  return {
    label: `${WEEKDAYS[weekday]} ${PHASE_WORD[phase]}`,
    weekday,
    phase,
    isNow: now.getDay() === weekday && dayPhase(now) === phase,
    samples: log.length,
  }
}

// ---- How full the day already is -------------------------------------------
//
// Having four things to do matters differently when three hours are already
// booked. Both numbers are to hand; nothing was saying them together.

export interface DayLoad {
  bookedMins: number
  actionable: number
  // Only worth surfacing when there's both real work AND real commitments.
  notable: boolean
}

export function dayLoad(
  calendar: CalendarEvent[],
  items: TodayItem[],
  now: Date = new Date(),
): DayLoad {
  const today = isoOf(now)
  let bookedMins = 0
  for (const e of calendar) {
    if (e.date !== today || !e.start) continue
    const [sh, sm] = e.start.split(':').map(Number)
    // No end time means we can't measure it; assume an hour rather than zero.
    if (!e.end) {
      bookedMins += 60
      continue
    }
    const [eh, em] = e.end.split(':').map(Number)
    const mins = eh * 60 + em - (sh * 60 + sm)
    if (mins > 0) bookedMins += mins
  }
  const actionable = items.filter((i) => i.kind !== 'event' && i.kind !== 'stale').length
  return {
    bookedMins,
    actionable,
    notable: bookedMins >= 90 && actionable >= 3,
  }
}

export function loadLabel(load: DayLoad): string {
  const hrs = Math.round((load.bookedMins / 60) * 10) / 10
  const h = Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1)
  return `${load.actionable} to do, and ${h}h already booked — pick the ones that matter.`
}
