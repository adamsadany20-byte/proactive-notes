import type { Entities, NoteKind } from '../types'

interface Scored {
  kind: NoteKind
  score: number
}

// Keyword signals per kind. Each hit adds weight. Short, natural notes are
// expected — so even a single strong keyword can classify.
const SIGNALS: Record<Exclude<NoteKind, 'unknown' | 'general'>, RegExp[]> = {
  academic: [
    /\b(test|exam|quiz|midterm|final|finals|revision|revise|study|studying|studied|mock|coursework|assignment|homework|essay|dissertation|thesis|viva|defense|defence|presentation|lecture|tutorial|seminar|module|unit|term|semester|grade|grades|gpa|gcse|a-?levels?|ib|sat|act|gre|gmat|mcat|lsat|toefl|ielts|board exam|entrance exam|finals week|cram|flashcards?|past papers?|syllabus|curriculum)\b/,
    /\b(maths?|mathematics|physics|chemistry|biology|science|history|geography|english|literature|french|spanish|german|italian|mandarin|latin|economics|psychology|sociology|philosophy|politics|law|accounting|statistics|calculus|algebra|geometry|trigonometry|business( studies)?|art|music|cs|computer science|programming|coding|anatomy|physiology|pharmacology|medicine|nursing|engineering|further maths)\b/,
    /\b(memori[sz]e|learn for|prepare for (the|my)? ?(test|exam)|chapter \d+|unit \d+|professor|lecturer|teacher|classmate|grade \d+)\b/,
  ],
  event: [
    /\b(wwdc|gdc|ces|comic ?con|sxsw|coachella|glastonbury|olympics|world cup|euros|wimbledon|nba finals|keynote|conference|convention|concert|gig|festival|match|fixture|game|race|grand prix|f1|super bowl|premiere|launch event|expo|summit|wedding|engagement|party|birthday|anniversary|meetup|gala|ceremony|graduation|reunion|recital|screening|exhibition|opening|hackathon|retreat|webinar|workshop|showcase|show|musical|play|theatre|theater|tournament|playoffs?|finals?|derby|interview|appointment|doctor'?s? appointment|dentist|flight|train|trip|holiday|vacation|getaway)\b/,
    /\b(watch|watching|attend|attending|going to|go to|tickets?|rsvp|livestream|stream|streaming|book(ed)?|reserve|reservation|catch the)\b/,
  ],
  project: [
    /\b(app|application|website|web ?app|site|platform|tool|build|building|develop|developing|create|creating|prototype|poc|mvp|startup|saas|side project|hobby project|game|api|sdk|cli|extension|plugin|bot|dashboard|landing page|portfolio|redesign|rebuild|refactor|migration|integration|backend|frontend|fullstack|database|schema|infra|infrastructure|pipeline|ml model|ai model|model|library|package|module|component|feature|microservice)\b/,
    /\b(stack|tech stack|architecture|deploy|deployment|hosting|launch|ship|shipping|release|roadmap|backlog|sprint|milestone|repo|repository|codebase|git|pull request|pr|bug|ticket|user story|wireframe|mockup|design doc)\b/,
  ],
  goal: [
    /\b(goal|goals|resolution|habit|habits|learn|learning|get better at|improve|level up|master|get into|pick up|build the habit|train|training|fitness|gym|workout|exercise|run|running|jog|cycling|swim|swimming|yoga|pilates|marathon|10k|5k|steps|diet|dieting|nutrition|calories|macros|fast|fasting|save|saving|savings|budget|invest|investing|debt|read more|reading|meditate|meditation|mindfulness|sleep|hydrate|water intake|journal|journaling|stretch|quit|cut down|give up|lose weight|gain muscle|bulk|cut|drink less|stop smoking)\b/,
    /\b(daily|every day|everyday|weekly|monthly|nightly|each morning|routine|streak|consistently|stick to|track|tracking|each (day|week|morning|night)|times? a (day|week)|per (day|week))\b/,
  ],
  tasks: [
    /\b(todo|to-?do|to do|task|tasks|checklist|list|shopping( list)?|grocery|groceries|buy|purchase|order|pack|packing|errands?|chores?|prep|prepare|organi[sz]e|tidy|clean|sort out|pick up|drop off|return|renew|book|schedule|email|send|call|phone|reply|respond|text|message|follow up|submit|file|pay|cancel|fix|finish|complete|wrap up|remember to|don'?t forget|need to|have to|must)\b/,
    /(^|\n)\s*(?:[-*•]|\[[ x]?\]|\d+[.)]|\bstep \d+)\s+/i, // bullet / checkbox / numbered lines
  ],
}

export function classify(
  text: string,
  entities: Entities,
): { kind: NoteKind; confidence: number } {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'unknown', confidence: 0 }

  const scores: Scored[] = []
  for (const kind of Object.keys(SIGNALS) as Array<keyof typeof SIGNALS>) {
    let score = 0
    for (const re of SIGNALS[kind]) {
      if (re.test(text.toLowerCase())) score += 1
    }
    if (score > 0) scores.push({ kind, score })
  }

  // Entity-driven boosts.
  if (entities.knownEvent) bump(scores, 'event', 2)
  if (entities.subject) bump(scores, 'academic', 1.5)
  if (entities.date && hasSignal(scores, 'academic')) bump(scores, 'academic', 1)
  if (entities.date && hasSignal(scores, 'event')) bump(scores, 'event', 0.5)
  // A bare date + time with no other signal usually means a scheduled event.
  if (entities.date && entities.time && scores.length === 0) bump(scores, 'event', 1)
  // People / locations lean towards something happening (an event/meeting).
  if (entities.people?.length && hasSignal(scores, 'event')) bump(scores, 'event', 0.5)
  if (entities.locations?.length && hasSignal(scores, 'event')) bump(scores, 'event', 0.5)
  // Money cues lean towards tasks (pay/buy) or goals (budget/save).
  if (entities.amounts?.length) {
    if (hasSignal(scores, 'goal')) bump(scores, 'goal', 0.5)
    else bump(scores, 'tasks', 0.5)
  }
  // Recurrence cues reinforce a habit/goal reading.
  if (entities.duration && hasSignal(scores, 'goal')) bump(scores, 'goal', 0.5)
  // Urgent, action-oriented notes lean towards tasks.
  if (entities.priority === 'high' && hasSignal(scores, 'tasks')) bump(scores, 'tasks', 0.5)

  // A note that's clearly a list of short lines → tasks.
  const lineCount = trimmed.split('\n').filter((l) => l.trim()).length
  if (lineCount >= 3) bump(scores, 'tasks', 1)

  scores.sort((a, b) => b.score - a.score)

  if (scores.length === 0) {
    // No special signal. Treat very short notes as still-unknown so the UI waits
    // rather than committing to "general" prematurely.
    const words = trimmed.split(/\s+/).length
    return { kind: words >= 4 ? 'general' : 'unknown', confidence: words >= 4 ? 0.4 : 0.2 }
  }

  const top = scores[0]
  const runnerUp = scores[1]?.score ?? 0

  // Confidence blends signal strength, lead over runner-up, and note length.
  const words = trimmed.split(/\s+/).length
  const lengthFactor = Math.min(1, words / 12)
  const lead = top.score - runnerUp
  let confidence =
    0.45 + // a matched signal already means decent confidence on short input
    Math.min(0.25, top.score * 0.08) +
    Math.min(0.15, lead * 0.08) +
    lengthFactor * 0.15
  confidence = Math.min(0.98, confidence)

  return { kind: top.kind, confidence }
}

function bump(scores: Scored[], kind: NoteKind, by: number) {
  const found = scores.find((s) => s.kind === kind)
  if (found) found.score += by
  else scores.push({ kind, score: by })
}

function hasSignal(scores: Scored[], kind: NoteKind): boolean {
  return scores.some((s) => s.kind === kind && s.score > 0)
}
