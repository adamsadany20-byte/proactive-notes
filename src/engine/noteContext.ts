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

  // Everything the engine has ALREADY worked out about this note. Without this
  // the generator only ever saw the raw answers, so it rebuilt things the app
  // had already extracted and produced generic tools. Feeding the classification,
  // the entities and what's already on screen is what makes a generated tool
  // specific to this note and complementary to the rest of the workspace.
  const facts = describeFacts(note)
  if (facts.length) lines.push('', 'What the app already knows:', ...facts)

  const existing = describeWorkspace(note)
  if (existing.length) {
    lines.push(
      '',
      'Already on screen for this note (do NOT rebuild these — complement them):',
      ...existing,
    )
  }

  return lines.join('\n')
}

// The classification + deterministic extractions, as plain lines.
function describeFacts(note: Note): string[] {
  const out: string[] = []
  if (note.topic) out.push(`- Subject: ${note.topic}`)
  if (note.kind && note.kind !== 'unknown' && note.kind !== 'general') {
    out.push(`- Category: ${note.kind}`)
  }
  const e = note.entities
  if (!e) return out
  if (e.date) out.push(`- Date: ${e.date.label} (${e.date.iso})`)
  if (e.time) out.push(`- Time: ${e.time}`)
  if (e.duration) out.push(`- Duration: ${e.duration}`)
  if (e.subject) out.push(`- Focus: ${e.subject}`)
  if (e.topics?.length) out.push(`- Topics: ${e.topics.join(', ')}`)
  if (e.people?.length) out.push(`- People: ${e.people.join(', ')}`)
  if (e.locations?.length) out.push(`- Places: ${e.locations.join(', ')}`)
  if (e.amounts?.length) out.push(`- Amounts: ${e.amounts.join(', ')}`)
  if (e.priority) out.push(`- Priority: ${e.priority}`)
  return out
}

// What the note already renders, so a new tool adds to the workspace instead of
// duplicating the checklist/calendar/board that's sitting right above it.
function describeWorkspace(note: Note): string[] {
  const out: string[] = []
  for (const seg of note.segments ?? []) {
    if (!seg.filled) continue
    const d: any = seg.data ?? {}
    const items: string[] = Array.isArray(d.items)
      ? d.items.map((i: any) => i?.text).filter(Boolean)
      : []
    switch (seg.type) {
      case 'checklist':
        out.push(`- Checklist (${items.length}): ${items.slice(0, 6).join(', ')}`)
        break
      case 'schedule':
        out.push(`- Study schedule: ${(d.sessions ?? []).length} sessions planned`)
        break
      case 'flashcards':
        out.push(`- Flashcards: ${(d.cards ?? []).length} cards`)
        break
      case 'project-board':
        out.push(`- Project board: ${(d.tasks ?? []).length} tasks`)
        break
      case 'purchase-planner':
        out.push(`- Purchase planner: ${(d.options ?? []).length} options compared`)
        break
      default:
        out.push(`- ${seg.title || seg.type}`)
    }
  }
  const built = (note.apps ?? []).map((a) => a.label).filter(Boolean)
  if (built.length) out.push(`- Tools already built: ${built.join(', ')}`)
  return out
}
