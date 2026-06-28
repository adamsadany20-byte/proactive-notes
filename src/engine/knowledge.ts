import type { KnownEvent } from '../types'

// A small knowledge base of well-known events. Offsets are relative to "today"
// so the simulated calendar always has a live event to cross-reference — this
// is what lets a single word like "WWDC" trigger the event flow.
export const KNOWN_EVENTS: KnownEvent[] = [
  {
    id: 'wwdc',
    name: 'WWDC',
    aliases: ['wwdc', 'apple keynote', 'apple developer conference'],
    startOffsetDays: 3,
    durationDays: 5,
    startTime: '18:00',
    endTime: '20:00',
    category: 'Tech keynote',
    highlights: [
      'New iOS / macOS releases',
      'Developer API announcements',
      'Hardware reveals',
      'State of the Union session',
    ],
  },
  {
    id: 'gdc',
    name: 'GDC',
    aliases: ['gdc', 'game developers conference'],
    startOffsetDays: 6,
    durationDays: 4,
    startTime: '17:00',
    endTime: '19:00',
    category: 'Conference',
    highlights: ['Engine showcases', 'Indie talks', 'Networking sessions'],
  },
  {
    id: 'f1',
    name: 'Grand Prix',
    aliases: ['grand prix', 'f1', 'formula 1', 'gp'],
    startOffsetDays: 2,
    durationDays: 1,
    startTime: '14:00',
    endTime: '16:00',
    category: 'Sport',
    highlights: ['Race start', 'Qualifying recap', 'Podium results'],
  },
  {
    id: 'superbowl',
    name: 'Super Bowl',
    aliases: ['super bowl', 'superbowl'],
    startOffsetDays: 4,
    durationDays: 1,
    startTime: '23:00',
    endTime: '02:00',
    category: 'Sport',
    highlights: ['Kickoff', 'Halftime show', 'Final score'],
  },
  {
    id: 'ces',
    name: 'CES',
    aliases: ['ces', 'consumer electronics show'],
    startOffsetDays: 5,
    durationDays: 4,
    startTime: '16:00',
    endTime: '18:00',
    category: 'Tech expo',
    highlights: ['Gadget reveals', 'Keynotes', 'Award winners'],
  },
]

export function matchKnownEvent(text: string): KnownEvent | undefined {
  const t = text.toLowerCase()
  for (const ev of KNOWN_EVENTS) {
    for (const alias of ev.aliases) {
      // Word-boundary-ish match so "gp" doesn't fire inside "gpu".
      const re = new RegExp(`(^|[^a-z])${escapeRe(alias)}([^a-z]|$)`, 'i')
      if (re.test(t)) return ev
    }
  }
  return undefined
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
