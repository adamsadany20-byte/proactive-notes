import type {
  Entities,
  Flashcard,
  Milestone,
  Note,
  NoteKind,
  ProjectTask,
  PurchaseOption,
  Segment,
  StudySession,
  ChecklistItem,
} from '../types'
import { isSoftwareProject } from './classify'
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

// Starter checklists per kind. These make classification pay off on its own: a
// note the local engine recognises as (say) travel gets a sensible trip plan
// immediately, instead of an empty box waiting for the user to type a list.
// Purely local + deterministic — no network, no tokens. When the note also names
// explicit topics, those lead and these are appended (see mergeChecklist).
const STARTER_CHECKLISTS: Partial<Record<NoteKind, string[]>> = {
  travel: [
    'Book transport',
    'Book accommodation',
    'Check passport & visa',
    'Sort travel insurance',
    'Plan the itinerary',
    'Pack essentials',
  ],
  health: [
    'Book the appointment',
    'Note symptoms & questions',
    'Bring ID & insurance details',
    'List current medications',
  ],
  finance: [
    'Gather statements & bills',
    'Check amounts & due dates',
    'Set up or confirm payment',
    'File for your records',
  ],
  recipe: ['Gather ingredients', 'Prep & measure', 'Cook the dish', 'Plate & serve'],
}

// A kind whose classification alone yields a useful starter workspace (the
// checklist above). Used by the stage machine to reveal the workspace on
// classification rather than waiting for an extracted date/topic that a bare
// note like "trip to oman" never produces.
export function hasStarterScaffold(kind: NoteKind): boolean {
  return kind in STARTER_CHECKLISTS
}

export function makeTopicChecklist(
  entities: Entities,
  kind?: NoteKind,
): ChecklistItem[] {
  const mk = (text: string): ChecklistItem => ({
    id: uid('chk'),
    key: text.trim().toLowerCase(),
    text,
    done: false,
  })
  const topics = effectiveTopics(entities)
  if (topics.length) return topics.map(mk)
  // No explicit topics in the note — fall back to the kind's starter plan so a
  // freshly classified note still opens with something useful.
  const starter = kind ? STARTER_CHECKLISTS[kind] : undefined
  return starter ? starter.map(mk) : []
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
  // Software builds get the dev backlog; any other project (a presentation, an
  // SEO push, a campaign) gets generic phases that read sensibly for all of them.
  const base: string[] = isSoftwareProject(note.text)
    ? [
        'Define core feature set',
        `Scaffold project (${stack})`,
        'Design data model',
        'Build main UI flow',
        'Wire up persistence',
        'Polish & test',
      ]
    : [
        'Define scope & goals',
        'Research & gather inputs',
        'Outline the plan',
        'Do the core work',
        'Review & refine',
        'Wrap up & share',
      ]
  return base.map((title, i) => ({
    id: uid('task'),
    title,
    column: i === 0 ? 'doing' : 'backlog',
  }))
}

export function makeMilestones(note: Note): Milestone[] {
  const timeline = note.answers['timeline'] || ''
  const titles = isSoftwareProject(note.text)
    ? ['Prototype working', 'Core features done', 'First release']
    : ['Plan set', 'Main work done', 'Delivered']
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

// ---- Buying decision --------------------------------------------------------

function headline(note: Note): string {
  return note.text.trim().split('\n')[0].slice(0, 60) || 'this purchase'
}

function splitList(s: string): string[] {
  return s
    .split(/[,\n;+/]|\band\b/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 1 && x.length < 40)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
}

export interface PurchasePlan {
  product: string
  budget: string // target price / budget to beat
  timing: string
  options: PurchaseOption[]
  places: ChecklistItem[] // where to look (finding the product)
  considerations: ChecklistItem[]
  steps: ChecklistItem[]
}

// A self-contained buying-decision workspace: a target price to beat, options to
// price up and compare, where to look for it, what matters, and the homework.
export function makePurchasePlan(note: Note, entities: Entities): PurchasePlan {
  const product = headline(note)
  const budget = note.answers['budget'] || entities.amounts?.[0] || ''
  const timing = note.answers['timing'] || ''

  const priorities = note.answers['priorities']
  const considerations = (
    priorities && splitList(priorities).length
      ? splitList(priorities)
      : ['Price', 'Reviews & ratings', 'Build quality', 'Warranty', 'Return policy']
  ).map((text) => ({ id: uid('cons'), text, done: false }))

  // Where to look — the "find the product" tool.
  const places = [
    'Amazon',
    "The brand's own store",
    'eBay (new & refurbished)',
    'A price-comparison site',
    'Local stores nearby',
  ].map((text) => ({ id: uid('place'), text, done: false }))

  const steps = [
    'Read recent reviews',
    'Check for a voucher or discount code',
    'Confirm the return & warranty policy',
    'Set a price-drop alert',
  ].map((text) => ({ id: uid('step'), text, done: false }))

  // Seed the comparison with the product from the note; the user adds rivals
  // and fills in prices to track and compare.
  const options: PurchaseOption[] = [
    { id: uid('opt'), name: product, price: '', note: '' },
  ]

  return { product, budget, timing, options, places, considerations, steps }
}

// Pull a number out of a price string like "£799", "1,299.99", "$59" → 799 etc.
export function parsePrice(s?: string): number | null {
  if (!s) return null
  const m = String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}
