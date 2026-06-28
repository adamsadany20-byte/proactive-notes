import type {
  Entities,
  Flashcard,
  Milestone,
  Note,
  ProjectTask,
  Segment,
  StudySession,
  ChecklistItem,
} from '../types'
import { SUBJECT_TOPICS } from './entities'

let counter = 0
export function uid(prefix = 'id'): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

function effectiveTopics(entities: Entities): string[] {
  if (entities.topics.length) return entities.topics
  if (entities.subject && SUBJECT_TOPICS[entities.subject])
    return SUBJECT_TOPICS[entities.subject]
  return []
}

// ---- Flashcards -------------------------------------------------------------

// Card fronts are study prompts; backs start empty for the user to fill in.
const CARD_FRONTS = [
  (t: string) => `Define the key idea in ${t}.`,
  (t: string) => `Give a worked example for ${t}.`,
  (t: string) => `What's a common mistake in ${t}?`,
]

export function makeFlashcards(entities: Entities): Flashcard[] {
  const topics = effectiveTopics(entities)
  const cards: Flashcard[] = []
  topics.forEach((topic) => {
    CARD_FRONTS.slice(0, 2).forEach((front) => {
      cards.push({ id: uid('card'), topic, front: front(topic), back: '' })
    })
  })
  return cards
}

// ---- Topic checklist --------------------------------------------------------

export function makeTopicChecklist(entities: Entities): ChecklistItem[] {
  return effectiveTopics(entities).map((t) => ({
    id: uid('chk'),
    text: t,
    done: false,
  }))
}

// ---- Study schedule ---------------------------------------------------------

// Spread study sessions across the days leading up to the test, one cluster of
// topics per day, leaving the test day itself free.
export function makeStudySchedule(entities: Entities): StudySession[] {
  if (!entities.date) return []
  const topics = effectiveTopics(entities)
  if (!topics.length) return []

  const testDay = new Date(entities.date.iso + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const daysUntil = Math.max(
    0,
    Math.round((testDay.getTime() - today.getTime()) / 86400000),
  )
  if (daysUntil <= 0) return []

  // Up to one session per available day (excluding the test day), capped so we
  // don't over-schedule. Distribute topics round-robin.
  const slots = Math.min(daysUntil, Math.max(topics.length, 3))
  const sessions: StudySession[] = []
  const perSlot = Math.ceil(topics.length / slots)

  for (let i = 0; i < slots; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i + 1)
    if (d >= testDay) break
    const slotTopics = topics.slice(i * perSlot, i * perSlot + perSlot)
    const useTopics = slotTopics.length ? slotTopics : [topics[i % topics.length]]
    sessions.push({
      id: uid('sess'),
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      label: `Revise ${useTopics.join(' & ')}`,
      topics: useTopics,
    })
  }
  return sessions
}

// ---- Project board ----------------------------------------------------------

export function makeProjectTasks(note: Note): ProjectTask[] {
  const stack = note.answers['stack'] || 'your stack'
  const base: string[] = [
    'Define core feature set',
    `Scaffold project (${stack})`,
    'Design data model',
    'Build main UI flow',
    'Wire up persistence',
    'Polish & test',
  ]
  return base.map((title, i) => ({
    id: uid('task'),
    title,
    column: i === 0 ? 'doing' : 'backlog',
  }))
}

export function makeMilestones(note: Note): Milestone[] {
  const timeline = note.answers['timeline'] || ''
  const titles = ['Prototype working', 'Core features done', 'First release']
  return titles.map((title, i) => ({
    id: uid('ms'),
    title,
    due: timeline ? distributeDue(timeline, i, titles.length) : undefined,
    done: false,
  }))
}

function distributeDue(timeline: string, i: number, n: number): string {
  const today = new Date()
  let totalDays = 30
  if (/weekend/i.test(timeline)) totalDays = 2
  else if (/week/i.test(timeline)) {
    const m = timeline.match(/(\d+)/)
    totalDays = (m ? parseInt(m[1], 10) : 1) * 7
  } else if (/month/i.test(timeline)) {
    const m = timeline.match(/(\d+)/)
    totalDays = (m ? parseInt(m[1], 10) : 1) * 30
  }
  const d = new Date(today)
  d.setDate(d.getDate() + Math.round((totalDays * (i + 1)) / n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---- Goal tracker -----------------------------------------------------------

export function makeGoalPlan(note: Note): { cadence: string; target: string; streak: number; days: boolean[] } {
  return {
    cadence: note.answers['cadence'] || 'Daily',
    target: note.answers['target'] || '',
    streak: 0,
    days: Array(7).fill(false),
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
