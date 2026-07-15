import type { Entities, NoteKind } from '../types'

// ---------------------------------------------------------------------------
// Emergent topic — the OPEN-ENDED half of classification.
//
// A note's `kind` is a bounded, behavioural label (it decides which tools to
// build). Its `topic` is not bounded at all: it's whatever the note is about —
// "Sourdough bread", "Japan", "Marathon training", "React portfolio". We derive
// it locally and deterministically (no network, no LLM) by pulling the most
// salient phrase out of the note, so the app can present unlimited categories
// without a fixed list and without calling Claude for every note.
//
// The technique is classic lightweight keyword extraction: drop stopwords and
// intent verbs, then score the remaining content words by frequency, whether
// they read as a proper noun (capitalised mid-sentence), whether they sit in a
// domain lexicon, and how early they appear — and prefer an adjacent pair when
// two strong words touch ("marathon training"). It's heuristic, but on the
// short notes this app sees it lands a sensible label the large majority of the
// time, and it degrades to `undefined` (no label) rather than to nonsense.
// ---------------------------------------------------------------------------

// Words that never make a good topic on their own: articles, prepositions,
// pronouns, auxiliaries, quantifiers, and the "intent" verbs people open notes
// with ("I want to buy…", "need to plan…", "thinking of getting…"). Stripping
// these lets the actual subject noun win.
const STOP = new Set(
  (
    'a an the this that these those my your his her its our their some any each every ' +
    'i me we us you he she it they them mine yours ours ' +
    'and or but so then than as if because while when where why how what which who whom ' +
    'to of in on at by for from with without into onto over under about around near up down off out ' +
    'is am are was were be been being do does did doing done have has had having will would can could ' +
    'shall should may might must ' +
    'want wanted wanting need needed needing get getting got gonna wanna gotta going go goes went ' +
    'buy buying bought purchase purchasing plan planning planned make making made start starting started ' +
    'try trying do finish finishing set setting sort sorting take taking put putting keep keeping ' +
    'new more most very really just also too like maybe please lets let ' +
    'today tomorrow tonight morning afternoon evening night day days week weeks month months year years ' +
    'daily weekly monthly nightly soon later now next ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'jan feb mar apr may jun jul aug sep oct nov dec ' +
    'am pm thing things stuff bit lot lots'
  ).split(/\s+/),
)

// A compact cross-domain lexicon. A hit doesn't decide the topic — it only nudges
// scoring toward the meaningful noun (so "bake sourdough" centres on "sourdough",
// "trip to Japan" on "Japan"). The list is intentionally partial; the salient
// phrase, not this set, is what gets returned, which is why topics stay open.
const DOMAIN = new Set(
  (
    'marathon workout gym fitness yoga pilates run running cycling swim swimming diet nutrition ' +
    'recipe cook cooking bake baking dinner lunch breakfast meal sourdough pasta curry cake bread soup ' +
    'trip travel flight holiday vacation itinerary hotel hostel passport paris tokyo japan italy spain ' +
    'budget savings invest investing debt mortgage rent salary pension tax expenses ' +
    'portfolio website app startup novel painting photography guitar piano album podcast ' +
    'movie film series show book books reading watchlist album playlist ' +
    'wedding birthday party interview appointment meeting conference ' +
    'garden home kitchen renovation move house flat apartment ' +
    'laptop phone camera headphones car bike mattress desk console monitor'
  ).split(/\s+/),
)

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

interface Tok {
  w: string // original-cased word
  lower: string
  idx: number // position in the token stream
  content: boolean // survives stopword/length filtering
  proper: boolean // capitalised mid-sentence → likely a proper noun
}

// Pull the strongest one- or two-word phrase out of the note's opening line.
function salientPhrase(text: string): string | undefined {
  const firstLine = text.split('\n')[0]
  const raw = firstLine.match(/[A-Za-z][A-Za-z'-]{1,}/g) ?? []
  if (!raw.length) return undefined

  const toks: Tok[] = raw.map((w, i) => {
    const lower = w.toLowerCase()
    return {
      w,
      lower,
      idx: i,
      content: lower.length > 2 && !STOP.has(lower),
      proper: i > 0 && /^[A-Z]/.test(w),
    }
  })

  const freq = new Map<string, number>()
  for (const t of toks) if (t.content) freq.set(t.lower, (freq.get(t.lower) ?? 0) + 1)

  const score = (t: Tok): number => {
    if (!t.content) return 0
    let s = 1
    s += (freq.get(t.lower)! - 1) * 0.6 // repetition = importance
    if (t.proper) s += 1.3 // a named thing is usually the subject
    if (DOMAIN.has(t.lower)) s += 0.8
    s += Math.max(0, 0.8 - t.idx * 0.06) // earlier words weigh a little more
    return s
  }

  let best: { phrase: string; score: number } | null = null
  const consider = (phrase: string, s: number) => {
    if (!best || s > best.score) best = { phrase, score: s }
  }

  for (let i = 0; i < toks.length; i++) {
    if (!toks[i].content) continue
    consider(toks[i].w, score(toks[i]))
    // Adjacent content pair → a two-word topic ("marathon training").
    if (i + 1 < toks.length && toks[i + 1].content) {
      consider(`${toks[i].w} ${toks[i + 1].w}`, score(toks[i]) + score(toks[i + 1]) + 0.5)
    }
    // A run of consecutive proper nouns is one name — keep it whole ("Dune Part
    // Two", "New York"), up to three words, rather than truncating to a pair.
    if (toks[i].proper) {
      const run: Tok[] = []
      for (let j = i; j < toks.length && run.length < 3 && toks[j].proper && toks[j].content; j++)
        run.push(toks[j])
      if (run.length >= 2) {
        const s = run.reduce((a, t) => a + score(t), 0) + 0.5 * (run.length - 1)
        consider(run.map((t) => t.w).join(' '), s)
      }
    }
  }

  return best ? titleCase((best as { phrase: string }).phrase) : undefined
}

function cleanLocation(loc: string): string {
  return titleCase(loc.replace(/^\s*(the|at|in|to|near)\s+/i, '').trim())
}

// The note's open-ended topic label, or undefined when nothing salient stands
// out (short/empty notes). Prefers the strongest concrete signal first, then
// falls back to salient-phrase extraction.
export function deriveTopic(
  text: string,
  entities: Entities,
  kind: NoteKind,
): string | undefined {
  const trimmed = text.trim()
  if (trimmed.length < 3) return undefined

  // A recognised real-world event names itself.
  if (entities.knownEvent?.name) return entities.knownEvent.name
  // Academic notes are about their subject.
  if (kind === 'academic' && entities.subject) return titleCase(entities.subject)
  // A trip is about where you're going.
  if (kind === 'travel' && entities.locations?.length)
    return cleanLocation(entities.locations[0])

  const salient = salientPhrase(trimmed)
  if (salient) return salient

  // Fallbacks when the opening line was all stopwords.
  if (entities.subject) return titleCase(entities.subject)
  if (entities.topics?.length) return entities.topics[0]
  if (entities.locations?.length) return cleanLocation(entities.locations[0])
  return undefined
}
