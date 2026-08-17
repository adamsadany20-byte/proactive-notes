import { useEffect, useMemo } from 'react'
import type { CalendarEvent, GeneratedApp, Note } from '../types'
import { useStore } from '../store/appStore'
import { DynamicComponentRenderer } from '../ui/DynamicComponentRenderer'
import { KIND_META } from '../ui/kindMeta'
import { XIcon } from '../ui/icons'

// Everything the app knows about ONE subject, gathered in one place.
//
// `Note.topic` is the app's most unusual signal — an unbounded label ("Oman",
// "Sourdough Bread") derived locally per note. Until now it only decorated a
// chip and matched in search. This view cashes it in: every note about the
// subject, their merged calendar, the tools built across them, and every open
// checklist item — so a subject you've written about five times reads as one
// workspace instead of five disconnected notes.

// Topics are free text, so compare them forgivingly.
export function sameTopic(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// How many notes share this topic. Used to decide whether the chip is worth
// making clickable — a topic with one note is just that note.
export function topicNoteCount(notes: Note[], topic?: string): number {
  if (!topic) return 0
  return notes.filter((n) => sameTopic(n.topic, topic)).length
}

interface OpenItem {
  noteId: string
  segmentId: string
  itemId: string
  text: string
}

export function TopicWorkspace({
  topic,
  onClose,
}: {
  topic: string
  onClose: () => void
}) {
  const { state, select, editSegment, updateApp } = useStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const notes = useMemo(
    () => state.notes.filter((n) => sameTopic(n.topic, topic)),
    [state.notes, topic],
  )
  const noteIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes])

  // Every event any of these notes owns, merged and in date order.
  const events: CalendarEvent[] = useMemo(
    () =>
      state.calendar
        .filter((e) => e.noteId && noteIds.has(e.noteId))
        .sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? ''))),
    [state.calendar, noteIds],
  )

  // Tools built across every note on this subject.
  const apps: (GeneratedApp & { noteId: string })[] = useMemo(
    () => notes.flatMap((n) => (n.apps ?? []).map((a) => ({ ...a, noteId: n.id }))),
    [notes],
  )

  // Unticked checklist items from every note on this subject.
  const open: OpenItem[] = useMemo(() => {
    const out: OpenItem[] = []
    for (const n of notes) {
      for (const seg of n.segments ?? []) {
        if (seg.type !== 'checklist' || !seg.filled) continue
        for (const item of (seg.data as any)?.items ?? []) {
          if (item && !item.done && item.text) {
            out.push({ noteId: n.id, segmentId: seg.id, itemId: item.id, text: item.text })
          }
        }
      }
    }
    return out
  }, [notes])

  // Tick an item off from here, writing back through the owning note's segment.
  const toggle = (it: OpenItem) => {
    const note = state.notes.find((n) => n.id === it.noteId)
    const seg = note?.segments.find((s) => s.id === it.segmentId)
    if (!note || !seg) return
    const data: any = seg.data ?? {}
    editSegment(note.id, seg.id, {
      ...data,
      items: (data.items ?? []).map((i: any) =>
        i.id === it.itemId ? { ...i, done: true } : i,
      ),
    })
  }

  const openNote = (id: string) => {
    select(id)
    onClose()
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="settings-scrim" onClick={onClose}>
      <div
        className="topic-sheet"
        role="dialog"
        aria-label={`Everything about ${topic}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="topic-head">
            <span className="topic-name">{topic}</span>
            <span className="topic-count">
              {notes.length} note{notes.length === 1 ? '' : 's'}
              {events.length ? ` · ${events.length} dated` : ''}
              {apps.length ? ` · ${apps.length} tool${apps.length === 1 ? '' : 's'}` : ''}
            </span>
          </span>
          <button className="settings-x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="settings-body topic-body">
          <section className="topic-sec">
            <h3 className="topic-sec-title">Notes</h3>
            <div className="topic-notes">
              {notes.map((n) => {
                const meta = KIND_META[n.kind]
                const title = n.text.trim().split('\n')[0].slice(0, 70) || 'Untitled note'
                return (
                  <button key={n.id} className="topic-note" onClick={() => openNote(n.id)}>
                    <span className="topic-note-title">{title}</span>
                    <span className="topic-note-kind">{meta?.label ?? n.kind}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {events.length > 0 && (
            <section className="topic-sec">
              <h3 className="topic-sec-title">Calendar</h3>
              <ul className="topic-events">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className={`topic-event${e.date < today ? ' is-past' : ''}${
                      e.done ? ' is-done' : ''
                    }`}
                  >
                    <span className="topic-event-date">
                      {e.date.slice(5)}
                      {e.start ? ` ${e.start}` : ''}
                    </span>
                    <span className="topic-event-title">{e.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {open.length > 0 && (
            <section className="topic-sec">
              <h3 className="topic-sec-title">
                Open items <span className="topic-badge">{open.length}</span>
              </h3>
              <ul className="topic-open">
                {open.map((it) => (
                  <li key={`${it.segmentId}-${it.itemId}`}>
                    <button className="topic-tick" onClick={() => toggle(it)}>
                      <span className="topic-box" aria-hidden />
                      <span>{it.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {apps.length > 0 && (
            <section className="topic-sec">
              <h3 className="topic-sec-title">Tools you've built</h3>
              {apps.map((a) => (
                <div className="topic-app" key={`${a.noteId}-${a.id}`}>
                  <div className="topic-app-head">
                    <span className="gen-card-icon">{a.icon}</span>
                    {a.label}
                  </div>
                  {a.code ? (
                    <DynamicComponentRenderer
                      code={a.code}
                      data={a.data}
                      onChange={(data) => updateApp(a.noteId, a.id, { data })}
                      onError={(error) => updateApp(a.noteId, a.id, { error })}
                    />
                  ) : (
                    <p className="topic-empty">
                      {a.error ? 'This tool needs regenerating.' : 'Still building…'}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
