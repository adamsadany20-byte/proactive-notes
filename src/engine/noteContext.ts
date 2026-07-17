import type { Note } from '../types'

// Human-readable field names for the local per-kind answers (the tailored cloud
// questions carry their own wording, so they don't need this map).
const FIELD_LABELS: Record<string, string> = {
  stack: 'Tech stack',
  timeline: 'Timeline',
  team: 'Team',
  goal: 'Main goal',
  budget: 'Budget',
  priorities: 'What matters most',
  timing: 'Needed by',
  cadence: 'How often',
  target: 'Target',
  date: 'Date',
  topics: 'Topics',
  deadline: 'Deadline',
  attend: 'Interest',
  briefing: 'Wants a summary',
  'confidence-level': 'Shakiest on',
}

// A readable summary of everything the user has told us about a note — the
// answered tailored (cloud) questions paired with their original wording, plus
// the local per-kind answers. Fed to the AI so suggestions and generated tools
// USE these details (pre-fill a trip's length, a purchase's budget) instead of
// asking again. Empty string when nothing has been answered yet.
export function collectNoteContext(note: Note): string {
  const lines: string[] = []
  const seen = new Set<string>()

  const tq = note.tailoredQuestions
  if (tq?.questions) {
    for (const q of tq.questions) {
      const a = note.answers[q.field]
      if (a) {
        lines.push(`${q.text.replace(/\?\s*$/, '')}: ${a}`)
        seen.add(q.field)
      }
    }
  }

  for (const [field, value] of Object.entries(note.answers)) {
    // Skip anything already listed above, and any stale `ct:` answer whose
    // question is no longer part of the current tailored set.
    if (seen.has(field) || field.startsWith('ct:') || !value) continue
    lines.push(`${FIELD_LABELS[field] ?? field}: ${value}`)
  }

  return lines.join('\n')
}
