// ---------------------------------------------------------------------------
// Document sensing — "you might want a Google Doc / Sheet / Slides for this".
//
// A pure, deterministic, local-only detector (mirrors patterns.ts / topics.ts):
// it reads a note's text + kind and decides whether a real document would help,
// and which type. No network. The result drives a one-tap chip under the editor
// (see DocSuggestion.tsx); the actual file is created server-side against the
// user's Google account, or falls back to a blank docs.new/sheets.new tab.
// ---------------------------------------------------------------------------
import type { Note, NoteKind } from '../types'

export type DocType = 'doc' | 'sheet' | 'slides'

export interface DocSuggestion {
  type: DocType
  // Human title we'll give the created file (derived from the note's topic/text).
  title: string
  // Why we're suggesting it — shown as the chip's supporting line.
  reason: string
  confidence: number // 0..1
}

export interface DocMeta {
  label: string // "Google Doc"
  short: string // "Doc"
  verb: string // "Start a doc"
  icon: string // emoji glyph for the chip
}

export const DOC_META: Record<DocType, DocMeta> = {
  doc: { label: 'Google Doc', short: 'Doc', verb: 'Start a doc', icon: '📄' },
  sheet: {
    label: 'Google Sheet',
    short: 'Sheet',
    verb: 'Start a sheet',
    icon: '📊',
  },
  slides: {
    label: 'Google Slides',
    short: 'Slides',
    verb: 'Start slides',
    icon: '🖼️',
  },
}

// Explicit phrases that name a document type outright. These are the strongest
// signal — if the user literally wrote "presentation" we don't need to guess.
const EXPLICIT: Record<DocType, RegExp> = {
  slides:
    /\b(presentation|slide\s?deck|slides?|slideshow|pitch\s?deck|keynote|powerpoint|deck for|present(ing|ation)? to|talk|lecture|seminar|webinar)\b/i,
  sheet:
    /\b(spreadsheet|budget|expenses?|cost breakdown|track(ing|er)?\s+(spend|expenses|costs?)|invoice|ledger|accounts?|inventory|timetable|roster|price comparison|compare prices|data table|table of (costs|prices|numbers))\b/i,
  doc: /\b(essay|report|write[-\s]?up|draft|cover letter|proposal|memo|documentation|blog post|article|meeting notes|minutes|dissertation|thesis|white ?paper|case study|résumé|resume|\bcv\b)\b/i,
}

// Weaker, kind-based leanings: some note kinds usually want a particular doc.
const KIND_LEAN: Partial<Record<NoteKind, DocType>> = {
  finance: 'sheet', // budgets / bills → a sheet
  purchase: 'sheet', // comparing options → a comparison sheet
}

// Words that hint a *writing* task even without an explicit noun.
const WRITE_HINT = /\b(write|writing|outline|summar(y|ise|ize)|notes on|draft)\b/i
// Words that hint tabular / numeric data even without "spreadsheet".
const TABLE_HINT =
  /\b(compare|comparison|column|rows?|per month|monthly|quarterly|£\d|\$\d|\d+\s?(kg|km|reps|calories))\b/i

// Pull a short, human title for the file from the note. Prefer the derived
// topic; fall back to the first meaningful line, capped so Drive titles stay tidy.
function titleFor(note: Note): string {
  const topic = note.topic?.trim()
  if (topic) return topic.replace(/\s+/g, ' ').slice(0, 80)
  const firstLine =
    note.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 2) || 'Untitled'
  return firstLine.replace(/\s+/g, ' ').slice(0, 80)
}

// Decide whether — and what — to suggest. Returns null when nothing fits, so a
// plain note never nags. Explicit type words win; otherwise we fall back to a
// kind lean, and only then to soft writing/table hints. Deterministic.
export function detectDocNeed(note: Note): DocSuggestion | null {
  const text = note.text
  if (text.trim().length < 12) return null // too little to act on

  const title = titleFor(note)

  // 1) Explicit noun — highest confidence. Check slides first (most specific),
  //    then sheet, then doc, so "pitch deck spreadsheet" leans to the deck.
  for (const type of ['slides', 'sheet', 'doc'] as DocType[]) {
    if (EXPLICIT[type].test(text)) {
      return { type, title, reason: reasonFor(type, 'explicit'), confidence: 0.92 }
    }
  }

  // 2) Kind-based lean — e.g. a finance note usually wants a sheet.
  const lean = KIND_LEAN[note.kind]
  if (lean) {
    return { type: lean, title, reason: reasonFor(lean, 'kind'), confidence: 0.66 }
  }

  // 3) Soft hints — only fire on longer notes so we don't guess from a stub.
  if (text.trim().length >= 40) {
    if (TABLE_HINT.test(text))
      return { type: 'sheet', title, reason: reasonFor('sheet', 'hint'), confidence: 0.55 }
    if (WRITE_HINT.test(text))
      return { type: 'doc', title, reason: reasonFor('doc', 'hint'), confidence: 0.55 }
  }

  return null
}

function reasonFor(type: DocType, from: 'explicit' | 'kind' | 'hint'): string {
  if (type === 'slides')
    return from === 'explicit'
      ? 'This reads like a presentation'
      : 'Slides might help you present this'
  if (type === 'sheet')
    return from === 'kind'
      ? 'Numbers like these are easier in a sheet'
      : from === 'explicit'
        ? 'This reads like a spreadsheet'
        : 'Looks like it wants columns'
  return from === 'explicit'
    ? 'This reads like a document'
    : 'A doc gives you room to write'
}

// The blank-document fallback URL, used when the app isn't connected to Google.
// These create a fresh file in whatever Google account the browser is signed in
// to (title/content can't be pre-filled this way — that needs the API path).
export function blankDocUrl(type: DocType): string {
  return {
    doc: 'https://docs.new',
    sheet: 'https://sheets.new',
    slides: 'https://slides.new',
  }[type]
}
