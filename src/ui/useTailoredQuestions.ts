import { useEffect, useRef } from 'react'
import type { AgentQuestion, InferenceResult, Note } from '../types'
import { useStore } from '../store/appStore'
import { fetchTailoredQuestions } from '../services/api'

// The paid classifier's "it actually engages with your note" bridge: on the
// Classifier/Evolve tiers, once a note has classified, Claude writes 2-3 basic
// questions tailored to its topic. Unlike useRemoteClassify this is NOT gated on
// local uncertainty — the whole point is that the classifier ALWAYS asks — so it
// fires for any recognised note with a little content, debounced and pinned to
// the exact text. Free (Local ML) tier never reaches the network here.
const DEBOUNCE_MS = 1000
const MIN_WORDS = 3

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

// Map the server's bare {text, chips} into AgentQuestions with stable fields.
// Keying the field on the question text means answering a question suppresses
// only that exact question — a re-fetch for edited text won't collide with, or
// wrongly re-ask, an already-answered one.
function toAgentQuestions(
  raw: { text: string; chips?: string[] }[],
): AgentQuestion[] {
  return raw.map((q, i) => ({
    id: `ctq-${i}`,
    field: `ct:${q.text.trim().toLowerCase()}`,
    text: q.text,
    chips: q.chips && q.chips.length ? q.chips : undefined,
    placeholder: q.chips && q.chips.length ? undefined : 'Type your answer',
  }))
}

export function useTailoredQuestions(note: Note, result: InferenceResult) {
  const { state, setTailoredQuestions } = useStore()
  const backend = state.settings.aiBackend
  const aiConfigured = !!state.config?.aiConfigured
  // Undefined (status not loaded) or true → allowed; only an explicit false gates
  // it. In free mode the server reports hasClassifier=true.
  const canClassify = state.billing?.hasClassifier !== false
  const timer = useRef<number | undefined>(undefined)
  const inFlight = useRef<string | null>(null)

  const recognised = result.kind !== 'unknown' && result.confidence >= 0.4

  useEffect(() => {
    if (backend === 'local' || !aiConfigured || !canClassify) return
    const text = note.text
    if (!recognised || wordCount(text) < MIN_WORDS) return
    // Already resolved (or resolving) for this exact text.
    const tq = note.tailoredQuestions
    if (tq?.forText === text && (tq.status === 'done' || tq.status === 'pending')) return
    if (inFlight.current === text) return

    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      inFlight.current = text
      setTailoredQuestions(note.id, { forText: text, status: 'pending' })
      fetchTailoredQuestions(text, result.kind, result.topic).then((r) => {
        inFlight.current = null
        if (!r || !r.configured || r.error) {
          setTailoredQuestions(note.id, { forText: text, status: 'error' })
          return
        }
        setTailoredQuestions(note.id, {
          forText: text,
          status: 'done',
          questions: toAgentQuestions(r.questions),
        })
      })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    note.id,
    note.text,
    result.kind,
    result.topic,
    recognised,
    backend,
    aiConfigured,
    canClassify,
    note.tailoredQuestions?.status,
  ])
}
