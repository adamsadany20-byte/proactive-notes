// ---------------------------------------------------------------------------
// Local pattern recognition — free, deterministic, on-device intelligence that
// runs in the Local ML tier with no network call. Two families:
//   1. List continuation — spot an ordered list the user is writing (1) 2) 3),
//      a) b) c), 1a) 1b) 1c), Step 1 / Step 2, bullets…) and offer the next
//      marker so they can keep going with one tap.
//   2. Shopping lists — recognise a grocery/shopping list, pull the items out,
//      and (with the habit log) learn when the user usually shops so we can
//      suggest a time instead of asking every time.
// All pure functions so they're trivially testable and side-effect free.
// ---------------------------------------------------------------------------

// ---- List continuation ------------------------------------------------------

export interface ListPattern {
  // Human label for the next marker, e.g. "1d)" or "4." or "•".
  label: string
  // The text to append to continue the list — a newline + the next marker + a
  // trailing space, ready for the user to type into.
  insert: string
  // How many consecutive marked lines we found (confidence signal).
  runLength: number
}

// Non-empty lines of a note, trimmed of trailing whitespace only.
function lines(text: string): string[] {
  return text.replace(/\s+$/, '').split('\n')
}

function nextLetter(ch: string): { ch: string; carried: boolean } {
  if (ch === 'z') return { ch: 'a', carried: true }
  if (ch === 'Z') return { ch: 'A', carried: true }
  return { ch: String.fromCharCode(ch.charCodeAt(0) + 1), carried: false }
}

// A parsed leading marker on a single line, plus how to render the *next* one.
interface Marker {
  // A signature identifying the marker family + separator so we can tell
  // whether two lines belong to the same list.
  family: string
  // Whether the line had real content after the marker.
  hasContent: boolean
  // Render the marker that should follow this one.
  next: () => string
}

// Recognise the leading marker of one line. Returns undefined for plain text.
function parseMarker(line: string): Marker | undefined {
  const s = line.trimStart()

  // Compound "1a)" / "1B)" — a number then a letter then a separator. The
  // letter advances (a→b), rolling to the next number when it passes z.
  let m = s.match(/^(\d+)([a-z])([.)\]:])\s*(.*)$/i)
  if (m) {
    const num = parseInt(m[1], 10)
    const letter = m[2]
    const sep = m[3]
    const rest = m[4]
    return {
      family: `compound${sep}`,
      hasContent: rest.trim().length > 0,
      next: () => {
        const { ch, carried } = nextLetter(letter)
        const n = carried ? num + 1 : num
        const resetLetter = carried
          ? letter === letter.toUpperCase()
            ? 'A'
            : 'a'
          : ch
        return `${n}${resetLetter}${sep}`
      },
    }
  }

  // Plain number "1)" / "1." / "1:" — increment the number.
  m = s.match(/^(\d+)([.)\]:])\s*(.*)$/)
  if (m) {
    const num = parseInt(m[1], 10)
    const sep = m[2]
    const rest = m[3]
    return {
      family: `num${sep}`,
      hasContent: rest.trim().length > 0,
      next: () => `${num + 1}${sep}`,
    }
  }

  // Single letter "a)" / "B." — increment the letter, preserving case.
  m = s.match(/^([a-z])([.)\]:])\s+(.*)$/i)
  if (m) {
    const letter = m[1]
    const sep = m[2]
    const rest = m[3]
    return {
      family: `alpha${sep}`,
      hasContent: rest.trim().length > 0,
      next: () => `${nextLetter(letter).ch}${sep}`,
    }
  }

  // Prefixed counter "Step 1" / "Q1" / "Task 3" — bump the trailing number.
  m = s.match(/^([A-Za-z][A-Za-z ]*?)\s?(\d+)([.)\]:])?\s*(.*)$/)
  if (m && /^(step|q|question|task|item|part|day|week|round|phase|level)$/i.test(m[1].trim())) {
    const prefix = m[1].trim()
    const num = parseInt(m[2], 10)
    const sep = m[3] ?? ''
    const rest = m[4]
    const spaced = /\s$/.test(s.slice(0, s.length - rest.length - (m[3]?.length ?? 0)))
    return {
      family: `prefixed:${prefix.toLowerCase()}${sep}`,
      hasContent: rest.trim().length > 0,
      next: () => `${prefix}${spaced ? ' ' : ''}${num + 1}${sep}`,
    }
  }

  // Bullets and checkboxes — repeat the same marker.
  m = s.match(/^([-*•▪‣·])\s+(.*)$/)
  if (m) {
    const bullet = m[1]
    return {
      family: `bullet${bullet}`,
      hasContent: m[2].trim().length > 0,
      next: () => bullet,
    }
  }
  m = s.match(/^(\[[ xX]?\])\s+(.*)$/)
  if (m) {
    return {
      family: 'checkbox',
      hasContent: m[2].trim().length > 0,
      next: () => '[ ]',
    }
  }

  return undefined
}

// Detect an ordered/bulleted list the user is in the middle of writing and
// return the next marker to continue it. Offers only when the last line is a
// real, content-bearing list item (so we don't nag on an empty "1)").
export function detectListPattern(text: string): ListPattern | undefined {
  const all = lines(text)
  if (!all.length) return undefined

  // Find the last non-empty line — that's the one we'd continue from.
  let i = all.length - 1
  while (i >= 0 && all[i].trim() === '') i--
  if (i < 0) return undefined

  const last = parseMarker(all[i])
  if (!last) return undefined

  // Count the consecutive run of same-family markers ending at the last line.
  let runLength = 1
  for (let j = i - 1; j >= 0; j--) {
    if (all[j].trim() === '') break
    const prev = parseMarker(all[j])
    if (!prev || prev.family !== last.family) break
    runLength++
  }

  // Guard against nagging: only offer the next marker once the current item has
  // real content — never while an empty "2)" is still waiting to be filled.
  if (!last.hasContent) return undefined

  const marker = last.next()
  // Preserve the leading indentation of the item we're continuing.
  const indent = all[i].match(/^(\s*)/)?.[1] ?? ''
  return {
    label: marker,
    insert: `\n${indent}${marker} `,
    runLength,
  }
}

// ---- Shopping lists ---------------------------------------------------------

// A compact grocery/household lexicon. A hit strengthens the "this is a shopping
// list" read; it's not exhaustive — the structural cues below do most of the work.
const GROCERY_WORDS = [
  'milk', 'eggs', 'bread', 'butter', 'cheese', 'yoghurt', 'yogurt', 'flour',
  'sugar', 'salt', 'pepper', 'rice', 'pasta', 'cereal', 'oats', 'coffee', 'tea',
  'juice', 'water', 'soda', 'beer', 'wine', 'chicken', 'beef', 'pork', 'fish',
  'salmon', 'bacon', 'ham', 'sausages', 'mince', 'apples', 'bananas', 'oranges',
  'grapes', 'berries', 'strawberries', 'tomatoes', 'potatoes', 'onions',
  'garlic', 'carrots', 'lettuce', 'spinach', 'broccoli', 'peppers', 'cucumber',
  'avocado', 'lemon', 'lime', 'beans', 'peas', 'corn', 'oil', 'vinegar',
  'ketchup', 'mayo', 'mustard', 'honey', 'jam', 'peanut butter', 'chocolate',
  'biscuits', 'cookies', 'crisps', 'chips', 'snacks', 'nappies', 'diapers',
  'toilet paper', 'kitchen roll', 'detergent', 'soap', 'shampoo', 'toothpaste',
  'washing up liquid', 'bin bags', 'tin foil', 'clingfilm', 'napkins',
]

const SHOPPING_CUES =
  /\b(shopping list|grocery list|groceries|shopping|to buy|need to buy|things to (buy|get)|pick up from (the )?(shop|store|supermarket|tesco|asda|aldi|lidl|sainsbury'?s|walmart|target|costco|whole foods|trader joe'?s))\b/i

export interface ShoppingList {
  isShoppingList: boolean
  items: string[]
  // 0..1 — how strongly this reads as a shopping list.
  confidence: number
}

// Strip a leading list marker / checkbox off an item so we store the bare thing.
function stripMarker(line: string): string {
  return line
    .trim()
    .replace(/^(\d+[a-z]?[.)\]:]|[a-z][.)\]:]|[-*•▪‣·]|\[[ xX]?\])\s+/i, '')
    .trim()
}

// Pull candidate items out of a note body: bulleted/numbered lines, or a single
// comma-separated line ("milk, eggs, bread").
function extractItems(text: string): string[] {
  const raw = text.replace(SHOPPING_CUES, '').replace(/[:]/g, '\n')
  const byLine = raw
    .split('\n')
    .map(stripMarker)
    .filter(Boolean)

  // If it collapsed to one line but that line is a comma list, split it.
  const flat: string[] = []
  for (const seg of byLine) {
    if (seg.includes(',') || /\band\b/i.test(seg)) {
      seg
        .split(/,|\band\b/i)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => flat.push(s))
    } else {
      flat.push(seg)
    }
  }

  return Array.from(
    new Set(
      flat
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length >= 2 && s.length <= 40)
        // Drop fragments that are obviously not items (verbs of intent, dates).
        .filter((s) => !/^(buy|get|need|remember|todo|to do|list)$/i.test(s)),
    ),
  ).slice(0, 40)
}

// Recognise a shopping list. Fires on an explicit cue, or on a short list whose
// items are dominated by grocery vocabulary.
export function detectShoppingList(text: string): ShoppingList {
  const empty: ShoppingList = { isShoppingList: false, items: [], confidence: 0 }
  if (!text.trim()) return empty

  const hasCue = SHOPPING_CUES.test(text)
  const items = extractItems(text)
  if (items.length < 2 && !hasCue) return empty

  const lower = text.toLowerCase()
  const groceryHits = GROCERY_WORDS.filter((w) =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower),
  ).length

  // Confidence: an explicit cue is worth a lot; otherwise lean on how many
  // items look like groceries relative to the list size.
  let confidence = 0
  if (hasCue) confidence += 0.55
  if (items.length >= 3) confidence += 0.15
  confidence += Math.min(0.4, groceryHits * 0.12)

  const isShoppingList = confidence >= 0.5 && items.length >= 2
  return { isShoppingList, items, confidence: Math.min(1, confidence) }
}

// ---- Shopping cadence (temporal personalisation) ----------------------------

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

function partOfDay(hour: number): string {
  if (hour < 12) return 'mornings'
  if (hour < 17) return 'afternoons'
  if (hour < 21) return 'evenings'
  return 'nights'
}

export interface ShoppingCadence {
  weekday: number // 0..6
  hour: number // 0..23
  // "Tuesday evenings"
  label: string
  // ISO date (YYYY-MM-DD) of the next upcoming occurrence of that weekday.
  nextIso: string
  // "HH:MM" suggested time.
  time: string
  // How many past shops backed this inference.
  support: number
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Learn a weekly shopping rhythm from the timestamps of past shops. Returns a
// cadence only once there's a repeated dominant weekday (>=2 shops on it) — so
// we never invent a habit from a single trip.
export function describeCadence(timestamps: number[]): ShoppingCadence | undefined {
  if (timestamps.length < 2) return undefined

  const byWeekday = new Map<number, number[]>() // weekday -> hours
  for (const ts of timestamps) {
    const d = new Date(ts)
    const wd = d.getDay()
    const arr = byWeekday.get(wd) ?? []
    arr.push(d.getHours())
    byWeekday.set(wd, arr)
  }

  // Dominant weekday = the one with the most shops (ties: most recent wins by
  // virtue of insertion order being irrelevant — pick highest count).
  let best: { wd: number; hours: number[] } | undefined
  for (const [wd, hours] of byWeekday) {
    if (!best || hours.length > best.hours.length) best = { wd, hours }
  }
  if (!best || best.hours.length < 2) return undefined

  const hour = Math.round(
    best.hours.reduce((a, b) => a + b, 0) / best.hours.length,
  )

  // Next upcoming date of that weekday (today counts as "next week" so we always
  // point forward).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let delta = (best.wd - today.getDay() + 7) % 7
  if (delta === 0) delta = 7
  const next = new Date(today)
  next.setDate(next.getDate() + delta)

  return {
    weekday: best.wd,
    hour,
    label: `${WEEKDAY_NAMES[best.wd]} ${partOfDay(hour)}`,
    nextIso: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`,
    time: `${pad(hour)}:00`,
    support: best.hours.length,
  }
}
