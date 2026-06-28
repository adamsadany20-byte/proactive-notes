import type { DateEntity, Entities } from '../types'
import { matchKnownEvent } from './knowledge'

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

function fmt(d: Date): DateEntity {
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const label = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  return { iso, label, source: '' }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Try to parse a date reference out of free text. Returns the first hit.
export function extractDate(text: string): DateEntity | undefined {
  const t = text.toLowerCase()
  const today = startOfToday()

  // today / tomorrow / tonight
  if (/\b(today|tonight)\b/.test(t)) return withSource(fmt(today), 'today')
  if (/\b(day after tomorrow|overmorrow)\b/.test(t)) {
    const d = new Date(today)
    d.setDate(d.getDate() + 2)
    return withSource(fmt(d), 'day after tomorrow')
  }
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    return withSource(fmt(d), 'tomorrow')
  }
  if (/\byesterday\b/.test(t)) {
    const d = new Date(today)
    d.setDate(d.getDate() - 1)
    return withSource(fmt(d), 'yesterday')
  }

  // "in N days/weeks/months" — written or spelled-out small numbers.
  const inMatch = t.match(
    /\bin (\d+|a|an|one|two|three|four|five|six) (day|days|week|weeks|month|months)\b/,
  )
  if (inMatch) {
    const n = wordToNum(inMatch[1])
    const unit = inMatch[2]
    const d = new Date(today)
    if (unit.startsWith('month')) d.setMonth(d.getMonth() + n)
    else d.setDate(d.getDate() + n * (unit.startsWith('week') ? 7 : 1))
    return withSource(fmt(d), inMatch[0])
  }

  // "next week" / "next month" → roll forward
  if (/\bnext week\b/.test(t)) {
    const d = new Date(today)
    d.setDate(d.getDate() + 7)
    return withSource(fmt(d), 'next week')
  }
  if (/\bnext month\b/.test(t)) {
    const d = new Date(today)
    d.setMonth(d.getMonth() + 1)
    return withSource(fmt(d), 'next month')
  }
  // "end of the month" → last day of the current month
  if (/\b(end of (the )?month|month end|eom)\b/.test(t)) {
    const d = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return withSource(fmt(d), 'end of month')
  }

  // "this weekend" / "weekend" → the upcoming Saturday
  if (/\b(this )?weekend\b/.test(t)) {
    const d = new Date(today)
    let delta = (6 - d.getDay() + 7) % 7
    if (delta === 0) delta = 7
    d.setDate(d.getDate() + delta)
    return withSource(fmt(d), 'this weekend')
  }

  // "next monday" / "on friday" / "this thursday" / bare weekday
  const wdMatch = t.match(
    /\b(next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (wdMatch) {
    const target = WEEKDAYS.indexOf(wdMatch[2])
    const forceNext = (wdMatch[1] || '').trim() === 'next'
    const d = new Date(today)
    let delta = (target - d.getDay() + 7) % 7
    if (delta === 0) delta = 7 // a named weekday means the upcoming one
    if (forceNext && delta <= 7) delta += delta <= 0 ? 7 : 0
    d.setDate(d.getDate() + delta)
    return withSource(fmt(d), wdMatch[0])
  }

  // "3 july" / "july 3" / "3rd of july" / "july 3rd"
  const monthName = MONTHS.find((m) => t.includes(m))
  if (monthName) {
    const mi = MONTHS.indexOf(monthName)
    const dayMatch = t.match(/\b(\d{1,2})(st|nd|rd|th)?\b/)
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 1
    const year = today.getFullYear()
    let d = new Date(year, mi, day)
    if (d < today) d = new Date(year + 1, mi, day) // roll forward
    return withSource(fmt(d), `${monthName} ${day}`)
  }

  // numeric dd/mm or dd-mm
  const numMatch = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/)
  if (numMatch) {
    const day = parseInt(numMatch[1], 10)
    const mon = parseInt(numMatch[2], 10) - 1
    const year = numMatch[3]
      ? normaliseYear(parseInt(numMatch[3], 10))
      : today.getFullYear()
    if (mon >= 0 && mon < 12 && day >= 1 && day <= 31) {
      let d = new Date(year, mon, day)
      if (!numMatch[3] && d < today) d = new Date(year + 1, mon, day)
      return withSource(fmt(d), numMatch[0])
    }
  }

  return undefined
}

function normaliseYear(y: number): number {
  return y < 100 ? 2000 + y : y
}

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
}
function wordToNum(s: string): number {
  return NUM_WORDS[s] ?? (parseInt(s, 10) || 1)
}

function withSource(d: DateEntity, source: string): DateEntity {
  return { ...d, source }
}

export function extractTime(text: string): string | undefined {
  const t = text.toLowerCase()
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (m) {
    let h = parseInt(m[1], 10)
    const min = m[2] ? parseInt(m[2], 10) : 0
    if (m[3] === 'pm' && h < 12) h += 12
    if (m[3] === 'am' && h === 12) h = 0
    return `${pad(h)}:${pad(min)}`
  }
  const m24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
  if (m24) return `${pad(parseInt(m24[1], 10))}:${m24[2]}`
  // Named times of day.
  if (/\bnoon|midday\b/.test(t)) return '12:00'
  if (/\bmidnight\b/.test(t)) return '00:00'
  if (/\b(early )?morning\b/.test(t)) return '09:00'
  if (/\bafternoon\b/.test(t)) return '14:00'
  if (/\b(this )?evening\b/.test(t)) return '18:00'
  if (/\bnight\b/.test(t)) return '20:00'
  return undefined
}

// "for 3 hours", "2-week", "45 mins" → a human duration string.
export function extractDuration(text: string): string | undefined {
  const m = text
    .toLowerCase()
    .match(/\b(\d+(?:\.\d+)?)\s*[- ]?(min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?)\b/)
  if (!m) return undefined
  const n = m[1]
  let unit = m[2]
  if (/^min/.test(unit)) unit = 'min'
  else if (/^h/.test(unit)) unit = 'hour'
  else unit = unit.replace(/s$/, '')
  const plural = parseFloat(n) === 1 ? unit : `${unit}s`
  return `${n} ${plural}`
}

// Money references: $40, £12.50, 100 usd, 20 dollars.
export function extractAmounts(text: string): string[] {
  const out: string[] = []
  const re = /(?:[$£€]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\b\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|gbp|eur|dollars?|pounds?|euros?)\b)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push(m[0].trim())
  return dedupe(out)
}

export function extractUrls(text: string): string[] {
  const re = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})+(?:\/[^\s]*)?)\b/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const u = m[1]
    // Skip bare words that merely contain a dot but no real TLD context, and
    // anything that's actually an email (handled separately).
    if (u.includes('@')) continue
    if (/\.(com|org|net|io|dev|app|co|ai|gov|edu|uk|de|fr)(\/|$)/i.test(u))
      out.push(u)
  }
  return dedupe(out)
}

export function extractEmails(text: string): string[] {
  const re = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi
  return dedupe(text.match(re) ?? [])
}

// People: explicit @mentions plus "with <Name>" / "call <Name>" cues.
export function extractPeople(text: string): string[] {
  const out: string[] = []
  const mention = /@([a-z][a-z0-9_]{1,30})/gi
  let m: RegExpExecArray | null
  while ((m = mention.exec(text))) out.push(`@${m[1]}`)
  const cue =
    /\b(?:with|call|email|meet(?:ing)?(?: with)?|ask|text|ping|see)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g
  while ((m = cue.exec(text))) out.push(m[1])
  return dedupe(out)
}

// Coarse location cues: "in/at/to <Place>" where Place is capitalised, plus a
// few common venue words.
export function extractLocations(text: string): string[] {
  const out: string[] = []
  const re = /\b(?:in|at|to|from)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const place = m[1]
    // Drop matches that are really a weekday/month (e.g. "on Monday" via "to").
    if (WEEKDAYS.includes(place.toLowerCase())) continue
    if (MONTHS.includes(place.toLowerCase())) continue
    out.push(place)
  }
  if (/\b(the )?gym\b/i.test(text)) out.push('the gym')
  if (/\b(the )?office\b/i.test(text)) out.push('the office')
  if (/\b(home|house)\b/i.test(text)) out.push('home')
  return dedupe(out)
}

export function extractPriority(text: string): 'high' | 'medium' | 'low' | undefined {
  const t = text.toLowerCase()
  if (/\b(urgent|asap|critical|emergency|right away|immediately|deadline|due (today|tomorrow)|high priority|!!+)\b/.test(t))
    return 'high'
  if (/\b(soon|important|priority|don'?t forget|remember to)\b/.test(t))
    return 'medium'
  if (/\b(whenever|someday|eventually|no rush|low priority|maybe)\b/.test(t))
    return 'low'
  return undefined
}

// Known academic subjects → helps both classification and topic suggestion.
export const SUBJECT_TOPICS: Record<string, string[]> = {
  maths: ['Algebra', 'Trigonometry', 'Calculus', 'Geometry', 'Probability'],
  math: ['Algebra', 'Trigonometry', 'Calculus', 'Geometry', 'Probability'],
  physics: ['Mechanics', 'Electricity', 'Waves', 'Thermodynamics', 'Optics'],
  chemistry: ['Atomic structure', 'Bonding', 'Organic', 'Acids & bases', 'Rates'],
  biology: ['Cells', 'Genetics', 'Ecology', 'Evolution', 'Physiology'],
  history: ['Causes', 'Key figures', 'Timeline', 'Consequences', 'Sources'],
  geography: ['Rivers', 'Climate', 'Population', 'Tectonics', 'Urbanisation'],
  english: ['Themes', 'Characters', 'Quotes', 'Context', 'Structure'],
  french: ['Vocabulary', 'Tenses', 'Speaking', 'Listening', 'Grammar'],
  spanish: ['Vocabulary', 'Tenses', 'Speaking', 'Listening', 'Grammar'],
  economics: ['Supply & demand', 'Markets', 'Macro', 'Micro', 'Policy'],
  cs: ['Algorithms', 'Data structures', 'Complexity', 'Databases', 'Networks'],
  'computer science': ['Algorithms', 'Data structures', 'Complexity', 'Databases'],
  psychology: ['Memory', 'Development', 'Social', 'Biopsychology', 'Research methods'],
  sociology: ['Family', 'Education', 'Crime', 'Stratification', 'Methods'],
  philosophy: ['Ethics', 'Epistemology', 'Logic', 'Metaphysics', 'Mind'],
  law: ['Contract', 'Tort', 'Criminal', 'Constitutional', 'Cases'],
  accounting: ['Balance sheets', 'Income statements', 'Cash flow', 'Ratios', 'Ledgers'],
  statistics: ['Distributions', 'Hypothesis testing', 'Regression', 'Probability', 'Sampling'],
  business: ['Marketing', 'Finance', 'Operations', 'Strategy', 'HR'],
  german: ['Vocabulary', 'Tenses', 'Speaking', 'Listening', 'Grammar'],
  politics: ['Ideologies', 'Institutions', 'Elections', 'Parties', 'Pressure groups'],
  calculus: ['Limits', 'Derivatives', 'Integrals', 'Series', 'Differential equations'],
  algebra: ['Linear equations', 'Quadratics', 'Functions', 'Matrices', 'Polynomials'],
  geometry: ['Triangles', 'Circles', 'Vectors', 'Transformations', 'Proofs'],
  anatomy: ['Skeletal', 'Muscular', 'Nervous', 'Cardiovascular', 'Respiratory'],
  pharmacology: ['Pharmacokinetics', 'Drug classes', 'Mechanisms', 'Side effects', 'Dosage'],
  medicine: ['Diagnosis', 'Pathology', 'Treatment', 'Anatomy', 'Pharmacology'],
  nursing: ['Patient care', 'Medications', 'Vitals', 'Procedures', 'Ethics'],
  engineering: ['Statics', 'Dynamics', 'Materials', 'Thermodynamics', 'Circuits'],
  marketing: ['Segmentation', 'Branding', 'Channels', 'Pricing', 'Analytics'],
  finance: ['Valuation', 'Risk', 'Portfolios', 'Markets', 'Derivatives'],
  art: ['Composition', 'Colour theory', 'Perspective', 'Media', 'Art history'],
  music: ['Theory', 'Scales', 'Harmony', 'Rhythm', 'Sight-reading'],
  literature: ['Themes', 'Characters', 'Context', 'Devices', 'Structure'],
  programming: ['Syntax', 'Data structures', 'Algorithms', 'Debugging', 'Testing'],
  python: ['Syntax', 'Data structures', 'Functions', 'Libraries', 'OOP'],
  javascript: ['Syntax', 'DOM', 'Async', 'Functions', 'Frameworks'],
}

export function extractSubject(text: string): string | undefined {
  const t = text.toLowerCase()
  for (const subj of Object.keys(SUBJECT_TOPICS)) {
    const re = new RegExp(`\\b${subj}\\b`)
    if (re.test(t)) return subj
  }
  return undefined
}

// Pull explicit topic lists out of a note: comma / "and" / line separated,
// often after a colon ("covers: x, y, z").
export function extractTopics(text: string): string[] {
  let body = text
  const colon = text.match(/(?:cover|covers|topics?|including|on)[:\-]\s*(.+)/i)
  if (colon) body = colon[1]

  const parts = body
    .split(/[,\n]|\band\b|\+|;/i)
    .map((s) => s.trim())
    .filter(isLikelyTopic)

  // Only treat as a topic list if we got at least two clean fragments, or the
  // note clearly used a "topics:" style cue.
  if (colon && parts.length >= 1) return dedupe(parts.map(titleCase))
  if (parts.length >= 2) return dedupe(parts.map(titleCase))
  return []
}

// A fragment is a real topic only if it isn't the note's title (containing
// test/exam-style words) and isn't actually a date reference like "friday".
function isLikelyTopic(s: string): boolean {
  if (s.length <= 1 || s.length >= 40) return false
  if (/\b(test|exam|quiz|revision|revise|study|prep|mock|midterm|finals?|coursework|assignment)\b/i.test(s))
    return false
  if (extractDate(s) || extractTime(s)) return false
  return true
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr))
}

// Lenient split for an answer to "what topics?" — a single chip ("Algebra")
// or a typed list ("algebra, trig, calculus") both become a topic array.
export function topicsFromAnswer(answer: string): string[] {
  if (/^(all of it|not sure|not sure yet)$/i.test(answer.trim())) return []
  return dedupe(
    answer
      .split(/[,\n;+/]|\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40)
      .map(titleCase),
  )
}

export function extractEntities(text: string): Entities {
  const subject = extractSubject(text)
  let topics = extractTopics(text)
  // If the user named a subject but no explicit topics, we leave topics empty
  // here — the question flow will offer the subject's default topics as chips.
  const people = extractPeople(text)
  const locations = extractLocations(text)
  const urls = extractUrls(text)
  const emails = extractEmails(text)
  const amounts = extractAmounts(text)
  const duration = extractDuration(text)
  const priority = extractPriority(text)
  return {
    date: extractDate(text),
    time: extractTime(text),
    topics,
    subject,
    knownEvent: matchKnownEvent(text),
    // Only attach the new extractions when present, keeping the entity object
    // lean for the common case.
    ...(people.length ? { people } : {}),
    ...(locations.length ? { locations } : {}),
    ...(urls.length ? { urls } : {}),
    ...(emails.length ? { emails } : {}),
    ...(amounts.length ? { amounts } : {}),
    ...(duration ? { duration } : {}),
    ...(priority ? { priority } : {}),
  }
}
