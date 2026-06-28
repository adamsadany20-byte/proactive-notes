import type { CalendarEvent } from '../types'

// Pre-existing commitments. Real conflicts come from the user's connected
// calendar; this starts empty. (When a calendar provider is wired in, return
// its events here so conflict detection has something to check against.)
export function seedCalendar(): CalendarEvent[] {
  return []
}

function toMinutes(t?: string): number | undefined {
  if (!t) return undefined
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Find fixed/other events that clash with a proposed slot on the same day.
export function findConflicts(
  events: CalendarEvent[],
  candidate: { date: string; start?: string; end?: string; id?: string },
): CalendarEvent[] {
  const cs = toMinutes(candidate.start)
  const ce = toMinutes(candidate.end)
  return events.filter((e) => {
    if (e.id === candidate.id) return false
    if (e.date !== candidate.date) return false
    if (cs === undefined || ce === undefined) return false
    const es = toMinutes(e.start)
    const ee = toMinutes(e.end)
    if (es === undefined || ee === undefined) return false
    return cs < ee && es < ce // overlap
  })
}

export function formatDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function relativeDay(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(iso + 'T00:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff > 1 && diff < 7) return `In ${diff} days`
  return formatDay(iso)
}
