import { useEffect, useMemo, useRef, useState } from 'react'
import type { InferenceResult, Note } from '../types'
import { infer } from '../engine/inference'
import { useStore } from '../store/appStore'

// Drives the staged, debounced inference described in the spec:
//   • A short debounce (~450ms of inactivity) runs lightweight inference and
//     surfaces the ambient classification signal — Stage 1.
//   • A longer pause (~1100ms) flips `paused`, which lets the contextual prompt
//     and further stages appear — Stages 2-4.
// Inference never runs on every keystroke; the text cursor is never touched.
const SHORT_MS = 450
const LONG_MS = 1100

export function useInference(note: Note): InferenceResult {
  const { reassess } = useStore()
  const [paused, setPaused] = useState(true)
  const lastText = useRef(note.text)
  const t1 = useRef<number | undefined>(undefined)
  const t2 = useRef<number | undefined>(undefined)

  useEffect(() => {
    // Only react to genuine text edits — not to store updates that rewrite the
    // note object (segment edits, calendar sync) while the text is unchanged.
    if (note.text === lastText.current) return
    lastText.current = note.text
    setPaused(false)

    window.clearTimeout(t1.current)
    window.clearTimeout(t2.current)

    t1.current = window.setTimeout(() => {
      reassess(note.id, false)
    }, SHORT_MS)
    t2.current = window.setTimeout(() => {
      setPaused(true)
      reassess(note.id, true)
    }, LONG_MS)

    return () => {
      window.clearTimeout(t1.current)
      window.clearTimeout(t2.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.text, note.id])

  // Live, render-time inference for the UI (pure + cheap). The store holds the
  // persisted derivation; this gives us the current question + stage.
  return useMemo(() => infer(note, { paused }), [note, paused])
}
