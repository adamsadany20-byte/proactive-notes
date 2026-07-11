import type { CalendarEvent, Note, Reminder, StreakInfo } from '../types'
import { uid } from '../engine/generate'

// ---------------------------------------------------------------------------
// Recurring-reminder scheduling + streak maths.
//
// A reminder recurs on a set of weekdays. The "streak" is the number of
// consecutive *expected* occurrences the user has completed, ending at the most
// recent expected day. Today is given grace: if today is expected but not yet
// done, the streak isn't broken — it's "at risk" until the day passes.
// ---------------------------------------------------------------------------

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const
export const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

// Horizon (days ahead) over which recurring occurrences are projected onto the
// calendar. Matches the CalendarPanel's own two-week window.
const HORIZON_DAYS = 14

export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export function todayIso(): string {
  return isoOf(new Date())
}

function dateOf(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

// Does this reminder expect an occurrence on the given day?
export function isExpectedOn(reminder: Reminder, iso: string): boolean {
  if (!reminder.weekdays.length) return false
  return reminder.weekdays.includes(dateOf(iso).getDay())
}

// Human label for a weekday set: Daily / Weekdays / Weekly on … / a day list.
export function cadenceLabel(weekdays: number[]): string {
  const set = [...new Set(weekdays)].sort()
  if (set.length === 0) return 'No days set'
  if (set.length === 7) return 'Daily'
  if (set.length === 5 && [1, 2, 3, 4, 5].every((d) => set.includes(d)))
    return 'Weekdays'
  if (set.length === 2 && set.includes(0) && set.includes(6)) return 'Weekends'
  if (set.length === 1) return `Weekly · ${WEEKDAY_FULL[set[0]]}`
  return `${set.length}× a week`
}

// Map an answer chip ("Daily", "3× a week", "Weekly") to a weekday set. Weekly
// anchors to the day the note was created so it feels personal.
export function weekdaysFromCadence(cadence: string | undefined, anchor: Date): number[] {
  const c = (cadence ?? '').toLowerCase()
  if (c.includes('week') && (c.includes('3') || c.includes('×') || c.includes('x')))
    return [1, 3, 5]
  if (c.includes('weekday')) return [1, 2, 3, 4, 5]
  if (c.includes('weekly') || c === 'weekly') return [anchor.getDay()]
  // Default (Daily / unknown) → every day.
  return [0, 1, 2, 3, 4, 5, 6]
}

function headline(note: Note): string {
  return note.text.trim().split('\n')[0].slice(0, 48) || 'Daily goal'
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// The ordered, de-duplicated set of scheduled session dates for a note (from its
// study-schedule segment). These are the "individual recurrences" of a wider
// goal — e.g. every study session before a test.
export function sessionDates(note: Note): string[] {
  const seg = note.segments.find((s) => s.type === 'schedule')
  const sessions = (seg?.data?.sessions ?? []) as { date: string }[]
  return [...new Set(sessions.map((s) => s.date))].sort()
}

// How many occurrences a weekday schedule would land on the calendar over the
// projection horizon. Used to decide whether a goal recurs enough to be worth
// offering a streak ("more than one event for the same goal").
export function occurrenceCount(weekdays: number[], days = HORIZON_DAYS): number {
  if (!weekdays.length) return 0
  let n = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  for (let i = 0; i <= days; i++) {
    if (weekdays.includes(cursor.getDay())) n++
    cursor.setDate(cursor.getDate() + 1)
  }
  return n
}

// How many streak-worthy occurrences a note would have, for the "start a streak?"
// offer. Sessions notes count their scheduled sessions; everything else counts
// its recurring schedule.
export function candidateOccurrenceCount(note: Note): number {
  if (note.kind === 'academic') return sessionDates(note).length
  const weekdays = weekdaysFromCadence(note.answers.cadence, new Date())
  return occurrenceCount(weekdays)
}

// A fresh reminder seeded from a note. Academic notes track their study sessions
// (a finite plan toward the test); everything else is an open-ended habit.
export function reminderFromNote(note: Note): Reminder {
  const created = new Date()
  const base = {
    id: uid('rem'),
    noteId: note.id,
    createdAt: created.getTime(),
    completions: [] as string[],
    bestStreak: 0,
  }
  if (note.kind === 'academic') {
    const subject = note.entities?.subject
    return {
      ...base,
      mode: 'sessions',
      title: note.answers.goal || headline(note),
      target:
        note.answers.target || (subject ? `${cap(subject)} test` : undefined),
      weekdays: [],
      time: '17:00',
    }
  }
  return {
    ...base,
    mode: 'recurring',
    title: note.answers.goal || headline(note),
    target: note.answers.target || undefined,
    weekdays: weekdaysFromCadence(note.answers.cadence, created),
    time: '09:00',
  }
}

// ---- Streak computation -----------------------------------------------------

// Recurring habit: the trailing run of completed expected-days, ending at the
// most recent one. Today gets grace — an unfinished today doesn't break it.
function recurringStreak(reminder: Reminder): StreakInfo {
  const done = new Set(reminder.completions)
  const today = todayIso()
  const todayExpected = isExpectedOn(reminder, today)
  const todayDone = done.has(today)

  let current = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  let first = true
  for (let guard = 0; guard < 3650; guard++) {
    const iso = isoOf(cursor)
    if (isExpectedOn(reminder, iso)) {
      if (done.has(iso)) current++
      else if (first && iso === today) {
        // grace for today
      } else break
      first = false
    }
    cursor.setDate(cursor.getDate() - 1)
    if (cursor.getTime() < reminder.createdAt - 86400000) break
  }

  return {
    current,
    best: Math.max(reminder.bestStreak, current),
    todayExpected,
    todayDone,
    atRisk: todayExpected && !todayDone && current > 0,
    actionableDate: todayExpected && !todayDone ? today : null,
  }
}

// Finite plan (e.g. study sessions): how many sessions you've completed in order
// without a gap. The next incomplete session is what to do next; an unfinished
// session whose date has arrived means you're falling behind.
function sessionStreak(reminder: Reminder, note: Note): StreakInfo {
  const occ = sessionDates(note)
  const done = new Set(reminder.completions)
  const today = todayIso()

  let current = 0
  for (const d of occ) {
    if (done.has(d)) current++
    else break
  }
  const actionableDate = occ[current] ?? null // first incomplete session
  const behind = occ.some((d) => d <= today && !done.has(d))

  return {
    current,
    best: Math.max(reminder.bestStreak, current),
    todayExpected: occ.includes(today),
    todayDone: done.has(today),
    atRisk: behind && current > 0,
    actionableDate,
  }
}

export function computeStreak(reminder: Reminder, note?: Note): StreakInfo {
  if (reminder.mode === 'sessions' && note) return sessionStreak(reminder, note)
  return recurringStreak(reminder)
}

// ---- Global streak (one streak across everything) ---------------------------
//
// Instead of a separate streak per topic, this is a single streak spanning ALL
// recurring commitments — the motivation to do *everything*, not just one habit.
// A day "counts" only when every commitment expected that day is completed;
// today gets grace (an unfinished today puts the streak at risk, doesn't break
// it). Days with nothing scheduled are neutral (they neither extend nor break).

export interface GlobalStreakInfo {
  current: number // trailing run of fully-completed days
  best: number // longest such run ever
  expectedToday: number // commitments due today
  doneToday: number // of those, how many are done
  remainingToday: number // still to do today to keep the streak
  todayExpected: boolean
  atRisk: boolean // due today, not all done, and a streak is on the line
  hasAny: boolean // any commitments are being tracked at all
}

// How many commitments a reminder expects on a given day, and how many of those
// are already completed. Recurring reminders fire on their weekdays; session
// plans fire on their scheduled dates.
function dayStat(
  reminders: Reminder[],
  notesById: Map<string, Note>,
  iso: string,
): { expected: number; done: number } {
  let expected = 0
  let done = 0
  for (const r of reminders) {
    if (r.mode === 'sessions') {
      const note = notesById.get(r.noteId)
      if (!note) continue
      if (sessionDates(note).includes(iso)) {
        expected++
        if (r.completions.includes(iso)) done++
      }
    } else if (isExpectedOn(r, iso)) {
      expected++
      if (r.completions.includes(iso)) done++
    }
  }
  return { expected, done }
}

export function computeGlobalStreak(
  reminders: Reminder[],
  notes: Note[],
): GlobalStreakInfo {
  const empty: GlobalStreakInfo = {
    current: 0,
    best: 0,
    expectedToday: 0,
    doneToday: 0,
    remainingToday: 0,
    todayExpected: false,
    atRisk: false,
    hasAny: false,
  }
  if (!reminders.length) return empty

  const notesById = new Map(notes.map((n) => [n.id, n]))
  const today = todayIso()
  const stat = (iso: string) => dayStat(reminders, notesById, iso)

  // Trailing run ending today (today graced if not fully done).
  const earliest = Math.min(...reminders.map((r) => r.createdAt))
  let current = 0
  {
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    for (let guard = 0; guard < 3650; guard++) {
      const iso = isoOf(cursor)
      const { expected, done } = stat(iso)
      if (expected > 0) {
        if (done >= expected) current++
        else if (iso === today) {
          // grace for today
        } else break
      }
      cursor.setDate(cursor.getDate() - 1)
      if (cursor.getTime() < earliest - 86400000) break
    }
  }

  // Longest historical run (scan earliest → today).
  let best = 0
  {
    let run = 0
    const cursor = new Date(earliest)
    cursor.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(0, 0, 0, 0)
    for (let guard = 0; guard < 3650 && cursor <= end; guard++) {
      const iso = isoOf(cursor)
      const { expected, done } = stat(iso)
      if (expected > 0) {
        if (done >= expected) {
          run++
          if (run > best) best = run
        } else if (iso !== today) {
          run = 0
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    best = Math.max(best, current)
  }

  const t = stat(today)
  return {
    current,
    best,
    expectedToday: t.expected,
    doneToday: t.done,
    remainingToday: Math.max(0, t.expected - t.done),
    todayExpected: t.expected > 0,
    atRisk: t.expected > 0 && t.done < t.expected && current > 0,
    hasAny: true,
  }
}

// ---- Today's commitments (the actionable daily ritual) ----------------------

export interface Commitment {
  reminderId: string
  noteId: string
  title: string
  mode: Reminder['mode']
  done: boolean
}

// Every commitment due *today*, with its completion state — the exact list the
// user ticks off to keep the global streak alive. Unfinished ones first so it
// reads as a to-do list.
export function todaysCommitments(
  reminders: Reminder[],
  notes: Note[],
): Commitment[] {
  const notesById = new Map(notes.map((n) => [n.id, n]))
  const today = todayIso()
  const out: Commitment[] = []
  for (const r of reminders) {
    let due = false
    if (r.mode === 'sessions') {
      const note = notesById.get(r.noteId)
      due = !!note && sessionDates(note).includes(today)
    } else {
      due = isExpectedOn(r, today)
    }
    if (!due) continue
    out.push({
      reminderId: r.id,
      noteId: r.noteId,
      title: r.title,
      mode: r.mode,
      done: r.completions.includes(today),
    })
  }
  return out.sort((a, b) => Number(a.done) - Number(b.done))
}

// ---- Milestones -------------------------------------------------------------
//
// Streaks earn a sense of building toward something. These are the rungs; the
// UI shows how far off the next one is ("4 days to a week").

export const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365]

export function milestoneLabel(target: number): string {
  if (target === 7) return 'a week'
  if (target === 14) return 'two weeks'
  if (target === 21) return 'three weeks'
  if (target === 30) return 'a month'
  if (target === 100) return '100 days'
  if (target === 365) return 'a year'
  return `${target} days`
}

export function nextMilestone(
  current: number,
): { target: number; remaining: number; label: string } | null {
  for (const m of MILESTONES) {
    if (m > current)
      return { target: m, remaining: m - current, label: milestoneLabel(m) }
  }
  return null
}

export function isMilestone(current: number): boolean {
  return MILESTONES.includes(current)
}

// ---- This week's rhythm -----------------------------------------------------
//
// A Monday→Sunday snapshot of which days were fully completed — makes recent
// consistency visible at a glance rather than as a bare number.

export interface WeekDay {
  iso: string
  label: string // S M T W T F S
  isToday: boolean
  isFuture: boolean
  expected: boolean // anything due that day
  complete: boolean // every commitment that day done
  missed: boolean // expected, in the past, not all done
}

export function weekRhythm(reminders: Reminder[], notes: Note[]): WeekDay[] {
  const notesById = new Map(notes.map((n) => [n.id, n]))
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  const todayI = isoOf(base)
  // Monday-start week containing today.
  const monday = new Date(base)
  monday.setDate(monday.getDate() - ((base.getDay() + 6) % 7))

  const out: WeekDay[] = []
  const cursor = new Date(monday)
  for (let i = 0; i < 7; i++) {
    const iso = isoOf(cursor)
    const { expected, done } = dayStat(reminders, notesById, iso)
    const isFuture = iso > todayI
    out.push({
      iso,
      label: WEEKDAY_LABELS[cursor.getDay()],
      isToday: iso === todayI,
      isFuture,
      expected: expected > 0,
      complete: expected > 0 && done >= expected,
      missed: expected > 0 && !isFuture && iso !== todayI && done < expected,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

// ---- Trail (the row of dots the UI renders) ---------------------------------

export interface TrailItem {
  iso: string
  done: boolean
  marker: 'today' | 'next' | null
  label: string
}

export function trailItems(
  reminder: Reminder,
  note: Note,
  info: StreakInfo,
  count = 7,
): TrailItem[] {
  const done = new Set(reminder.completions)
  const today = todayIso()

  if (reminder.mode === 'sessions') {
    const occ = sessionDates(note)
    // Window the plan around current progress so it stays compact.
    const win = Math.max(count, 7)
    const start = Math.max(0, Math.min(info.current - 2, occ.length - win))
    return occ.slice(Math.max(0, start), Math.max(0, start) + win).map((iso) => ({
      iso,
      done: done.has(iso),
      marker: iso === info.actionableDate ? 'next' : null,
      label: String(dateOf(iso).getDate()),
    }))
  }

  // Recurring: the last `count` expected days, most recent last.
  const out: TrailItem[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  for (let guard = 0; guard < 3650 && out.length < count; guard++) {
    const iso = isoOf(cursor)
    if (isExpectedOn(reminder, iso)) {
      out.unshift({
        iso,
        done: done.has(iso),
        marker: iso === today ? 'today' : null,
        label: WEEKDAY_LABELS[dateOf(iso).getDay()],
      })
    }
    cursor.setDate(cursor.getDate() - 1)
  }
  return out
}

// Next recurring occurrence strictly after today (for "next: Tomorrow" hints).
export function nextOccurrence(reminder: Reminder): string | null {
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() + 1)
  for (let i = 0; i < 366; i++) {
    const iso = isoOf(cursor)
    if (isExpectedOn(reminder, iso)) return iso
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

// Project every reminder's upcoming occurrences onto calendar events. Derived at
// render time (never persisted) so the dates stay relative to "today".
export function reminderCalendarEvents(reminders: Reminder[]): CalendarEvent[] {
  const events: CalendarEvent[] = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  for (const r of reminders) {
    if (!r.weekdays.length) continue
    const done = new Set(r.completions)
    const cursor = new Date(start)
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const iso = isoOf(cursor)
      if (isExpectedOn(r, iso)) {
        events.push({
          id: `rem-${r.id}-${iso}`,
          title: r.title,
          date: iso,
          start: r.time,
          kind: 'reminder',
          reminderId: r.id,
          done: done.has(iso),
        })
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return events
}
