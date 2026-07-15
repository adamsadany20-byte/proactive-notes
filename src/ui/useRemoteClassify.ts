import { useEffect, useRef } from 'react'
import type { InferenceResult, Note, NoteKind } from '../types'
import { useStore } from '../store/appStore'
import { classifyRemote } from '../services/api'

// The paid classifier's escalation bridge — the mirror of useWorldKnowledge, but
// for kind/topic rather than world facts. It asks Claude to classify a note ONLY
// when the local keyword engine is genuinely unsure, so most notes never reach
// the network. Fires when:
//   • a cloud tier is selected (not Local ML) and the server has a key, and
//   • the user's plan includes the classifier (always true in free mode), and
//   • the local confidence is below the uncertainty line on a real note.
// The result is pinned to the exact text; a later edit re-escalates.
const UNCERTAIN_BELOW = 0.72
const DEBOUNCE_MS = 900

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export function useRemoteClassify(note: Note, result: InferenceResult) {
  const { state, setClassification } = useStore()
  const backend = state.settings.aiBackend
  const aiConfigured = !!state.config?.aiConfigured
  // Undefined (status not loaded) or true → allowed; only an explicit false gates
  // it. In free mode the server reports hasClassifier=true.
  const canClassify = state.billing?.hasClassifier !== false
  const timer = useRef<number | undefined>(undefined)
  const inFlight = useRef<string | null>(null)

  useEffect(() => {
    if (backend === 'local' || !aiConfigured || !canClassify) return
    const text = note.text
    if (wordCount(text) < 2) return
    // Local engine is confident enough — don't spend a call.
    if (result.confidence >= UNCERTAIN_BELOW) return
    // Already resolved (or resolving) for this exact text.
    const rc = note.classification
    if (rc?.forText === text && (rc.status === 'done' || rc.status === 'pending')) return
    if (inFlight.current === text) return

    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      inFlight.current = text
      setClassification(note.id, { forText: text, status: 'pending' })
      classifyRemote(text, result.kind, result.confidence).then((r) => {
        inFlight.current = null
        if (!r || !r.configured || !r.classified || r.error || !r.kind) {
          setClassification(note.id, { forText: text, status: 'error' })
          return
        }
        setClassification(note.id, {
          forText: text,
          status: 'done',
          kind: r.kind as NoteKind,
          topic: r.topic,
          confidence: r.confidence,
        })
      })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    note.id,
    note.text,
    result.kind,
    result.confidence,
    backend,
    aiConfigured,
    canClassify,
    note.classification?.status,
  ])
}
