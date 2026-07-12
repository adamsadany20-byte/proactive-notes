import { useEffect, useRef } from 'react'
import type { Note } from '../types'
import { useStore } from '../store/appStore'
import { useInference } from '../ui/useInference'
import { useWorldKnowledge } from '../ui/useWorldKnowledge'
import { useVoiceInput } from '../ui/useVoiceInput'
import { KIND_META, tintVars } from '../ui/kindMeta'
import { ContextualPrompt } from './ContextualPrompt'
import { SmartSuggestions } from './SmartSuggestions'
import { SegmentView } from './Segments'
import { detectListPattern } from '../engine/patterns'
import { eventConflicts } from '../store/reconcile'
import { FeatureGenerator } from '../ui/FeatureGenerator'
import { KIND_ICONS, MicIcon, StarSixIcon } from '../ui/icons'

export function NoteEditor({ note }: { note: Note }) {
  const { state, setText, answer, skip, appendText } = useStore()
  const result = useInference(note)
  useWorldKnowledge(note, result)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Voice-memo dictation → appended to the note's current text. Runs entirely
  // on-device via the Web Speech API; no cloud involved.
  const voice = useVoiceInput((t) => appendText(note.id, t))

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

  // Append a list-continuation marker to the note and drop the caret right after
  // it. Shared by the chip click and the Tab shortcut so both feel identical.
  const insertContinuation = (text: string) => {
    setText(note.id, note.text.replace(/\s+$/, '') + text)
    const ta = taRef.current
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      })
    }
  }

  // Tab accepts a pending list continuation — like editor autocomplete. Only
  // hijacks Tab when the caret is at the very end (so it never interrupts an
  // edit earlier in the note) and a suggestion actually exists.
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey) return
    const ta = e.currentTarget
    if (ta.selectionStart !== ta.value.length || ta.selectionStart !== ta.selectionEnd)
      return
    const sug = detectListPattern(note.text)
    if (!sug) return
    e.preventDefault()
    insertContinuation(sug.insert)
  }

  return (
    <>
      <div
        className={`note-card ${recognised ? 'tinted' : ''}`}
        style={tintVars(result.kind)}
      >
        {(recognised && meta.label) || note.enrichment?.status === 'pending' ? (
          <div className="editor-top">
            {recognised && meta.label && (
              <span className="ambient">
                <span className="pulse" />
                {(() => {
                  const KindIcon = KIND_ICONS[result.kind]
                  return KindIcon ? <KindIcon className="ico" /> : null
                })()}
                {meta.label}
                <span className="conf">
                  {Math.round(result.confidence * 100)}%
                </span>
              </span>
            )}
            {note.enrichment?.status === 'pending' && (
              <span className="ambient world">
                <span className="pulse" />
                <StarSixIcon className="ico" /> looking into that…
              </span>
            )}
          </div>
        ) : null}

        <textarea
          ref={taRef}
          className="note-text"
          value={note.text}
          placeholder="Start with a few words — a goal, an event, a trip you’re planning… I’ll shape the rest around it."
          spellCheck={false}
          autoFocus
          onChange={(e) => setText(note.id, e.target.value)}
          onKeyDown={onEditorKeyDown}
        />

        {voice.supported && (
          <div className="editor-tools">
            <button
              type="button"
              className={`etool ${voice.listening ? 'recording' : ''}`}
              title={voice.listening ? 'Stop dictation' : 'Dictate a voice memo'}
              onClick={voice.toggle}
            >
              <MicIcon className="etool-ico" live={voice.listening} />
              <span className="etool-label">
                {voice.listening ? 'Listening…' : 'Speak'}
              </span>
              {voice.listening && (
                <span className="etool-wave" aria-hidden>
                  <i /><i /><i /><i />
                </span>
              )}
            </button>
          </div>
        )}

        <SmartSuggestions note={note} onInsert={insertContinuation} />

        {showPrompt && result.nextQuestion && (
          <ContextualPrompt
            question={result.nextQuestion}
            onAnswer={(field, value) => answer(note.id, field, value)}
            onSkip={(field) => skip(note.id, field)}
          />
        )}
      </div>

      {showWorkspace && (
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

      {note.text.trim().length >= 3 && (
        <div className="workspace" style={tintVars(result.kind)}>
          <FeatureGenerator note={note} />
        </div>
      )}
    </>
  )
}
