import { useEffect, useRef } from 'react'
import type { InferenceResult, Note, NoteKind } from '../types'
import { useStore } from '../store/appStore'
import { worldKnowledgeGap } from '../engine/worldKnowledge'
import { enrich } from '../services/api'

// Bridges the local engine's escalation signal to the LLM. It fires a world-
// knowledge lookup ONLY when:
//   • the broader-AI toggle is on, and the server has an API key, and
//   • worldKnowledgeGap() decides the local engine genuinely can't place a term.
// Most notes never reach the network — the local ML handles them end to end.
export function useWorldKnowledge(note: Note, result: InferenceResult) {
  const { state, setEnrichment } = useStore()
  const backend = state.settings.aiBackend
  const broaderAi = state.settings.broaderAi
  const aiConfigured = !!state.config?.aiConfigured
  const inFlight = useRef<string | null>(null)

  useEffect(() => {
    if (!broaderAi || !aiConfigured) return

    const gap = worldKnowledgeGap(
      note.text,
      result.entities,
      result.kind,
      result.confidence,
    )
    if (!gap) return
    // Already looked this candidate up (pending or done) — don't repeat.
    if (note.enrichment?.candidate === gap.candidate) return
    if (inFlight.current === gap.candidate) return

    inFlight.current = gap.candidate
    setEnrichment(note.id, { candidate: gap.candidate, status: 'pending' })

    enrich(note.text, gap.candidate, backend).then((r) => {
      inFlight.current = null
      if (!r || !r.configured || r.error) {
        setEnrichment(note.id, { candidate: gap.candidate, status: 'error' })
        return
      }
      setEnrichment(note.id, {
        candidate: gap.candidate,
        status: 'done',
        recognized: r.recognized,
        kind: r.kind as NoteKind,
        name: r.name,
        category: r.category,
        summary: r.summary,
        highlights: r.highlights,
        confidence: r.confidence,
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    note.id,
    note.text,
    result.kind,
    result.confidence,
    broaderAi,
    backend,
    aiConfigured,
    note.enrichment?.candidate,
  ])
}
