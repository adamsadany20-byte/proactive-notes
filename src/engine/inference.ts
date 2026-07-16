import type { AgentQuestion, Entities, InferenceResult, Note, NoteKind, Stage } from '../types'
import { extractDate, extractEntities, topicsFromAnswer } from './entities'
import { classify } from './classify'
import { hasStarterScaffold } from './generate'
import { deriveTopic } from './topics'
import { nextQuestion } from './questions'

// Fold answers the user gave (via chips / free text) back into the entity set,
// so an answered date or topic list feeds the generators exactly like one typed
// into the note body would. Without this, "When is it? → This Friday" would
// never reach the calendar block.
function mergeAnswers(entities: Entities, note: Note): Entities {
  const merged = { ...entities, topics: [...entities.topics] }
  if (!merged.date && note.answers.date) {
    const d = extractDate(note.answers.date)
    if (d) merged.date = d
  }
  if (!merged.topics.length && note.answers.topics) {
    merged.topics = topicsFromAnswer(note.answers.topics)
  }
  return merged
}

// Fields that must be known before a note's workspace is considered "complete".
// (For events with no date we fall back to requiring a date below.)
const ESSENTIAL: Record<string, string[]> = {
  academic: ['date'],
  event: [],
  project: ['stack'],
  goal: ['cadence'],
  tasks: [],
  purchase: [],
}

function fieldSatisfied(field: string, note: Note, entities: Entities): boolean {
  if (field in note.answers) return true
  if (field === 'date' && entities.date) return true
  if (field === 'topics' && entities.topics.length) return true
  return false
}

function essentialPending(
  kind: NoteKind,
  note: Note,
  entities: Entities,
): boolean {
  let fields = ESSENTIAL[kind] ?? []
  if (kind === 'event' && !entities.knownEvent) fields = ['date']
  return fields.some((f) => !fieldSatisfied(f, note, entities))
}

// Has the note produced anything concrete we could start building a feature
// from? (A named subject alone is only a classification signal, not yet data.)
function featureReady(note: Note, entities: Entities): boolean {
  return (
    !!entities.date ||
    entities.topics.length > 0 ||
    !!entities.knownEvent ||
    Object.keys(note.answers).length > 0
  )
}

// Do we have enough to fully populate every segment this kind would generate?
function allSegmentsFilled(
  kind: NoteKind,
  note: Note,
  entities: Entities,
): boolean {
  const topics =
    entities.topics.length > 0 || !!entities.subject || 'topics' in note.answers
  switch (kind) {
    case 'academic':
      return !!entities.date && topics
    case 'event':
      return !!entities.knownEvent || !!entities.date
    case 'project':
      return 'stack' in note.answers && 'timeline' in note.answers
    case 'goal':
      return 'cadence' in note.answers
    case 'tasks':
      return true
    case 'purchase':
      return true
    default:
      return featureReady(note, entities)
  }
}

function computeStage(
  kind: NoteKind,
  confidence: number,
  note: Note,
  entities: Entities,
  paused: boolean,
  hasQuestion: boolean,
): Stage {
  if (kind === 'unknown' || confidence < 0.4) return 'idle'

  // A purchase is actionable the instant it's recognised — the product itself is
  // the seed. The same holds for kinds with a starter scaffold (travel, health,
  // finance, recipe): classification alone yields a useful checklist, so reveal
  // the workspace immediately instead of waiting for a date/topic a bare note
  // ("trip to oman") never produces.
  const ready =
    kind === 'purchase' || hasStarterScaffold(kind)
      ? true
      : featureReady(note, entities)
  const essential = essentialPending(kind, note, entities)
  const filled = allSegmentsFilled(kind, note, entities)

  if (ready && !essential && filled) return 'workspace'
  if (ready) return 'emerge'
  if (paused && hasQuestion) return 'prompt'
  return 'classify'
}

export interface InferOptions {
  paused: boolean
}

// When the LLM has recognized a real-world reference, fold it into the result:
// override the kind, and for events inject a synthetic known-event so the event
// flow (highlights, alert) triggers. We mark it synthetic so no fabricated dated
// calendar entries are created from it.
function applyEnrichment(
  note: Note,
  kind: NoteKind,
  confidence: number,
  entities: Entities,
): { kind: NoteKind; confidence: number } {
  const e = note.enrichment
  if (!e || e.status !== 'done' || !e.recognized || !e.kind) {
    return { kind, confidence }
  }
  if (e.kind === 'event' && !entities.knownEvent) {
    entities.knownEvent = {
      id: 'enriched',
      name: e.name || e.candidate,
      aliases: [],
      startOffsetDays: 0,
      durationDays: 0,
      startTime: '',
      endTime: '',
      category: e.category || 'Event',
      highlights: e.highlights || [],
      synthetic: true,
    }
  }
  return { kind: e.kind, confidence: Math.max(confidence, e.confidence ?? 0.85) }
}

// The next cloud-tailored question to ask: the first one (pinned to the current
// text) the user hasn't answered or skipped. Undefined when there are none, the
// result is stale, or all are handled — the caller then falls back to local ones.
function nextTailoredQuestion(note: Note): AgentQuestion | undefined {
  const tq = note.tailoredQuestions
  if (!tq || tq.status !== 'done' || tq.forText !== note.text || !tq.questions)
    return undefined
  const handled = new Set([...note.askedFields, ...Object.keys(note.answers)])
  return tq.questions.find((q) => !handled.has(q.field))
}

export function infer(note: Note, opts: InferOptions): InferenceResult {
  const rawEntities = extractEntities(note.text)
  const base = classify(note.text, rawEntities)
  const entities = mergeAnswers(rawEntities, note)
  const enriched = applyEnrichment(note, base.kind, base.confidence, entities)
  let kind = enriched.kind
  let confidence = enriched.confidence

  // Paid cloud classification (Classification/Evolve tiers) is the most accurate
  // signal — let it override the local guess. Only when it was computed for the
  // CURRENT note text, so a result from earlier text never mis-labels the note.
  const rc = note.classification
  const rcActive = rc?.status === 'done' && rc.forText === note.text && !!rc.kind
  if (rcActive && rc?.kind) {
    kind = rc.kind
    confidence = Math.max(confidence, rc.confidence ?? 0.9)
  }

  // On the paid tiers the cloud writes basic questions tailored to the note's
  // topic; ask those first (that's what the user is paying the classifier for),
  // then fall back to the local per-kind questions.
  const q =
    kind === 'unknown' || confidence < 0.4
      ? undefined
      : nextTailoredQuestion(note) ?? nextQuestion(note, kind, entities)
  const stage = computeStage(
    kind,
    confidence,
    note,
    entities,
    opts.paused,
    !!q,
  )
  // The open-ended label for what this note is about. Derived locally from the
  // text + entities — independent of the bounded `kind`, so it isn't limited to
  // a fixed set (and never needs the LLM).
  const topic =
    kind === 'unknown' || confidence < 0.4
      ? undefined
      : (rcActive && rc?.topic) || deriveTopic(note.text, entities, kind)
  return { kind, topic, confidence, entities, nextQuestion: q, stage }
}
