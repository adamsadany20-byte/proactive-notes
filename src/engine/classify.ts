import type { Entities, NoteKind } from '../types'

interface Scored {
  kind: NoteKind
  score: number
}

// Each kind's signals are ordered strongest-first. The first regex is the
// "primary" intent signal (weighted highest); later ones are supporting cues.
// Scoring counts how MANY distinct keywords hit (density), not just whether one
// did — so a note packed with academic language outscores one with a single
// incidental match, which makes the classifier markedly more discriminating.
const PRIMARY_WEIGHT = 1.0
const SUPPORT_WEIGHT = 0.65

// Count non-overlapping matches of a (possibly non-global) pattern.
function countMatches(re: RegExp, text: string): number {
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g')
  const m = text.match(g)
  return m ? m.length : 0
}

// Diminishing-returns contribution: 1 hit = weight, more hits add less each.
// Caps so a keyword-stuffed note can't run away with the score.
function signalScore(hits: number, weight: number): number {
  if (hits <= 0) return 0
  return weight * (1 + Math.min(2, hits - 1) * 0.4)
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
    /\b(wwdc|gdc|ces|comic ?con|sxsw|coachella|glastonbury|olympics|world cup|euros|wimbledon|nba finals|keynote|conference|convention|concert|gig|festival|match|fixture|game|race|grand prix|f1|super bowl|premiere|launch event|expo|summit|wedding|engagement|party|birthday|anniversary|meetup|gala|ceremony|graduation|reunion|recital|screening|exhibition|opening|hackathon|retreat|webinar|workshop|showcase|musical|play|theatre|theater|tournament|playoffs?|derby)\b/,
    /\b(attend|attending|going to|go to|tickets?|rsvp|livestream|reserve|reservation|catch the)\b/,
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
  // A deliberate buying decision about a SPECIFIC product — distinct from a quick
  // shopping list (those stay `tasks`). The primary signals are considered-purchase
  // phrases or "buy/get a <thing>", not a bare "buy milk".
  purchase: [
    /\b(thinking of (buying|getting)|looking to buy|want to buy|wanna buy|need to buy|planning to buy|in the market for|shopping for|should i (buy|get)|deciding (between|on)|upgrade (my|to)|treat myself to|splurge on|invest in a|buy(ing)? (a|an|the|some|new|myself)|get(ting)? (a|an|the|a new|myself a)|new (phone|laptop|car|tv|headphones|camera|console|watch|bike|mattress|desk|chair|monitor|tablet|fridge|sofa|gpu|pc))\b/,
    /\b(budget|price|prices|pricing|cost|deal|deals|discount|on sale|review|reviews|rating|ratings|warranty|brand|model|specs?|compare|comparison|refurbished|second-?hand|cheaper|worth it|value for money|vs)\b/,
  ],
  // Health & wellbeing — clinical/medical, distinct from a fitness *habit* (goal).
  health: [
    /\b(doctor|doctor'?s|dr\.?|gp|dentist|dentist'?s|clinic|hospital|a&e|checkup|check-?up|physio|physiotherapy|therapist|therapy|counsell?ing|prescription|medication|meds|pills?|tablets?|dose|dosage|vaccine|vaccination|jab|blood test|blood pressure|scan|x-?ray|mri|ultrasound|symptoms?|diagnosis|surgery|operation|recovery|injury|migraine|allerg(y|ies)|mental health|anxiety|wellbeing|cholesterol)\b/,
    /\b(health|healthy|medical|patient|nhs|referral|specialist|consultant|nurse|pharmacy|refill|appointment|appt|sick|unwell|ill|feeling|pain|sore)\b/,
  ],
  // Money admin — bills, tax, statements. A savings *habit* stays a goal.
  finance: [
    /\b(bill|bills|invoice|rent|mortgage|loan|repayment|instal?ments?|tax|taxes|hmrc|vat|refund|isa|pension|401k|payslip|paycheck|salary|expenses?|subscription|direct debit|standing order|overdraft|credit card|bank statement|statement|reimburse(ment)?|utilities|council tax)\b/,
    /\b(money|cash|pay(ing|ment)?|owe|owed|afford|financ(e|es|ial)|account|balance|spending|due|renew(al)?|premium|quote|insurance)\b/,
  ],
  // A trip to plan — itinerary + packing. Trips route here, not to `event`.
  travel: [
    /\b(trip|holiday|vacation|getaway|flight|flights|fly(ing)?|itinerary|airbnb|hotel|hostel|check-?in|layover|passport|visa|road ?trip|backpacking|cruise|excursion|sightseeing|destination|abroad|overseas|weekend away)\b/,
    /\b(travel|travell?ing|book(ed)? (a )?(flight|hotel|room|trip)|departure|arrival|boarding|terminal|luggage|suitcase|currency|jet ?lag|tour|guidebook|packing)\b/,
  ],
  // A recipe / meal to cook — ingredients + steps.
  recipe: [
    /\b(recipe|cook|cooking|bake|baking|roast|grill|fry(ing)?|saute|simmer|braise|meal prep|dish|cuisine|ingredients?|marinade|sauce|dough|batter|preheat|oven|serves \d|prep time|cook time|leftovers)\b/,
    /\b(flour|sugar|butter|eggs?|garlic|onion|tomato|chicken|beef|pork|pasta|rice|curry|soup|stew|cake|bread|salad|tablespoons?|teaspoons?|grams?|\bml\b|\bcups?\b|pinch of|cloves?|fillet|dinner|lunch|breakfast)\b/,
  ],
  // A watch / read / listen list.
  media: [
    /\b(watchlist|watch list|binge|rewatch|movie|movies|film|films|tv series|series|tv show|episode|season|netflix|disney\+?|prime video|hbo|documentary|anime|reading list|novel|audiobook|podcast|album|playlist)\b/,
    /\b(to watch|to read|to listen|watching|reading|listening|queue|backlog|recommend(ed|ation)?|must-?watch|must-?read|chapter|author|director|genre|trailer|soundtrack)\b/,
  ],
}

export function classify(
  text: string,
  entities: Entities,
): { kind: NoteKind; confidence: number } {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'unknown', confidence: 0 }

  const lower = text.toLowerCase()
  const scores: Scored[] = []
  for (const kind of Object.keys(SIGNALS) as Array<keyof typeof SIGNALS>) {
    let score = 0
    SIGNALS[kind].forEach((re, i) => {
      const hits = countMatches(re, lower)
      score += signalScore(hits, i === 0 ? PRIMARY_WEIGHT : SUPPORT_WEIGHT)
    })
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
  // A place cue strongly reinforces a trip once travel language is present.
  if (entities.locations?.length && hasSignal(scores, 'travel')) bump(scores, 'travel', 1)
  // Money cues lean towards a purchase decision, then money admin (finance),
  // then goals (budget/save), then tasks (pay/buy). A price next to buying
  // language is a strong purchase signal.
  if (entities.amounts?.length) {
    if (hasSignal(scores, 'purchase')) bump(scores, 'purchase', 1)
    else if (hasSignal(scores, 'finance')) bump(scores, 'finance', 1)
    else if (hasSignal(scores, 'goal')) bump(scores, 'goal', 0.5)
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

  // Confidence blends absolute signal strength, the lead over the runner-up
  // (how decisive the win is), and note length. The margin term means an
  // ambiguous note scoring evenly across kinds reads as lower confidence even
  // when each kind matched something — a more honest, better-calibrated number.
  const words = trimmed.split(/\s+/).length
  const lengthFactor = Math.min(1, words / 12)
  const lead = top.score - runnerUp
  const margin = top.score > 0 ? lead / top.score : 0 // 0 = tie, 1 = uncontested
  let confidence =
    0.42 + // a matched signal already means decent confidence on short input
    Math.min(0.26, top.score * 0.07) +
    Math.min(0.16, lead * 0.07) +
    margin * 0.08 +
    lengthFactor * 0.12
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
