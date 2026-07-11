import { useEffect, useRef, useState } from 'react'
import type { Note } from '../types'
import { useStore } from '../store/appStore'
import { useInference } from '../ui/useInference'
import { useWorldKnowledge } from '../ui/useWorldKnowledge'
import { KIND_META, tintVars } from '../ui/kindMeta'
import { ContextualPrompt } from './ContextualPrompt'
import { SmartSuggestions } from './SmartSuggestions'
import { SegmentView } from './Segments'
import { eventConflicts } from '../store/reconcile'
import { FeatureGenerator } from '../ui/FeatureGenerator'
import { MindMap } from './MindMap'

export function NoteEditor({ note }: { note: Note }) {
  const { state, setText, answer, skip } = useStore()
  const result = useInference(note)
  useWorldKnowledge(note, result)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [mode, setMode] = useState<'write' | 'map'>('write')

  // Auto-grow the textarea without ever moving the caret.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.max(92, ta.scrollHeight) + 'px'
  }, [note.text])

  const meta = KIND_META[result.kind]
  const recognised = result.kind !== 'unknown' && result.confidence >= 0.4
  const showPrompt =
    !!result.nextQuestion &&
    (result.stage === 'prompt' ||
      result.stage === 'emerge' ||
      result.stage === 'workspace')
  const showWorkspace =
    (result.stage === 'emerge' || result.stage === 'workspace') &&
    note.segments.length > 0

  const conflicts = eventConflicts(note, result, state.calendar).map((e) => ({
    title: e.title,
    date: e.date,
  }))

  return (
    <>
      <div
        className={`note-card ${recognised ? 'tinted' : ''}`}
        style={tintVars(result.kind)}
      >
        <div className="editor-top">
          {mode === 'write' && recognised && meta.label && (
            <span className="ambient">
              <span className="pulse" />
              {meta.icon} {meta.label}
              <span className="conf">{Math.round(result.confidence * 100)}%</span>
            </span>
          )}
          {mode === 'write' && note.enrichment?.status === 'pending' && (
            <span className="ambient world">
              <span className="pulse" />✦ looking into that…
            </span>
          )}
          <div className="mode-seg" role="tablist" aria-label="Note mode">
            {(['write', 'map'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={`mode-opt ${mode === m ? 'on' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'write' ? '✎ Write' : '✦ Map'}
              </button>
            ))}
          </div>
        </div>

        {mode === 'write' ? (
          <textarea
            ref={taRef}
            className="note-text"
            value={note.text}
            placeholder="Start with a few words — a goal, an event, a trip you’re planning… I’ll shape the rest around it."
            spellCheck={false}
            autoFocus
            onChange={(e) => setText(note.id, e.target.value)}
          />
        ) : (
          <MindMap note={note} />
        )}

        {mode === 'write' && (
          <SmartSuggestions
            note={note}
            onInsert={(text) => {
              setText(note.id, note.text.replace(/\s+$/, '') + text)
              const ta = taRef.current
              if (ta) {
                requestAnimationFrame(() => {
                  ta.focus()
                  ta.setSelectionRange(ta.value.length, ta.value.length)
                })
              }
            }}
          />
        )}

        {mode === 'write' && showPrompt && result.nextQuestion && (
          <ContextualPrompt
            question={result.nextQuestion}
            onAnswer={(field, value) => answer(note.id, field, value)}
            onSkip={(field) => skip(note.id, field)}
          />
        )}
      </div>

      {mode === 'write' && showWorkspace && (
        <div className="workspace" style={tintVars(result.kind)}>
          {note.segments.map((seg) => (
            <SegmentView
              key={seg.id}
              note={note}
              seg={seg}
              conflicts={conflicts}
            />
          ))}
        </div>
      )}

      {mode === 'write' && note.text.trim().length >= 3 && (
        <div className="workspace" style={tintVars(result.kind)}>
          <FeatureGenerator note={note} />
        </div>
      )}
    </>
  )
}
