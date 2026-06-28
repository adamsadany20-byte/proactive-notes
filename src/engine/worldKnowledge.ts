import type { Entities, NoteKind } from '../types'

export interface KnowledgeGap {
  candidate: string
}

// Common words that are capitalized in notes but aren't world-knowledge entities
// — keeps the escalation signal from firing on ordinary nouns.
const COMMON = new Set([
  'dinner',
  'lunch',
  'breakfast',
  'meeting',
  'call',
  'email',
  'today',
  'tomorrow',
  'tonight',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'app',
  'idea',
  'project',
  'test',
  'exam',
  'notes',
  'todo',
  'list',
  'plan',
  'goal',
  'buy',
  'the',
  'and',
  'for',
  'with',
])

function isAcronym(tok: string): boolean {
  // 2–6 chars, all caps, optionally a trailing digit (WWDC, GDC, CES, F1, GDC).
  return /^[A-Z][A-Z0-9]{1,5}$/.test(tok)
}

function isProperNoun(tok: string): boolean {
  return /^[A-Z][A-Za-z][A-Za-z'’.:-]{2,}$/.test(tok) && !COMMON.has(tok.toLowerCase())
}

// Find the most salient token the local engine couldn't place — an acronym or a
// proper noun. Acronyms win because they're the strongest "I don't know this"
// signal in a short note.
function salientUnknownToken(text: string): string | undefined {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9'’.:-]*/g) || []
  const acronym = tokens.find(isAcronym)
  if (acronym) return acronym
  const proper = tokens.find(isProperNoun)
  return proper
}

// The escalation gate. Returns a gap ONLY when the local ML engine is uncertain
// AND there's a salient real-world-looking term it couldn't resolve. Confident
// local classifications (academic, project, goal, tasks) never escalate — the
// LLM is reserved for exactly the cases the local engine admits it can't handle.
export function worldKnowledgeGap(
  text: string,
  entities: Entities,
  kind: NoteKind,
  confidence: number,
): KnowledgeGap | null {
  // Already resolved locally — no world knowledge needed.
  if (entities.knownEvent || entities.subject) return null
  // Only the genuinely ambiguous classifications are candidates for escalation.
  if (kind !== 'unknown' && kind !== 'general' && kind !== 'event') return null
  // The local engine is confident enough; don't spend an LLM call.
  if (confidence >= 0.8) return null

  const candidate = salientUnknownToken(text)
  if (!candidate) return null
  return { candidate }
}
