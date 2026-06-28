import { useState } from 'react'
import type {
  ChecklistItem,
  Flashcard,
  Milestone,
  Note,
  ProjectTask,
  Segment,
  StudySession,
} from '../types'
import { SEGMENT_ICON } from '../ui/kindMeta'
import { useStore } from '../store/appStore'
import { relativeDay } from '../store/calendar'

function SegShell({
  seg,
  meta,
  children,
}: {
  seg: Segment
  meta?: string
  children: React.ReactNode
}) {
  return (
    <section className="segment">
      <div className="seg-head">
        <span className="seg-ico">{SEGMENT_ICON[seg.type]}</span>
        <span className="seg-title">{seg.title}</span>
        {!seg.filled ? (
          <span className="seg-forming">
            <span className="pulse" /> forming
          </span>
        ) : meta ? (
          <span className="seg-meta">{meta}</span>
        ) : null}
      </div>
      <div className="seg-body">{children}</div>
    </section>
  )
}

function Skeleton({ rows = 2 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel skel-row" />
      ))}
    </>
  )
}

// ---- Calendar mini block ----------------------------------------------------

function CalendarSeg({ seg }: { seg: Segment }) {
  const iso: string | undefined = seg.data.date
  if (!iso) {
    return (
      <SegShell seg={seg}>
        <Skeleton rows={1} />
      </SegShell>
    )
  }
  const d = new Date(iso + 'T00:00:00')
  return (
    <SegShell seg={seg}>
      <div className="cal-mini">
        <div className="cal-date">
          <span className="d">{d.getDate()}</span>
          <span className="m">
            {d.toLocaleDateString(undefined, { month: 'short' })}
          </span>
        </div>
        <div className="cal-info">
          <div className="ci-title">
            {seg.data.time ? `at ${seg.data.time}` : 'Scheduled'}
          </div>
          <div className="ci-rel">{relativeDay(iso)}</div>
          <div className="added">✓ Added to your calendar</div>
        </div>
      </div>
    </SegShell>
  )
}

// ---- Checklist --------------------------------------------------------------

function ChecklistSeg({ note, seg }: { note: Note; seg: Segment }) {
  const { editSegment } = useStore()
  const items: ChecklistItem[] = seg.data.items ?? []
  if (!items.length)
    return (
      <SegShell seg={seg}>
        <Skeleton rows={3} />
      </SegShell>
    )
  const done = items.filter((i) => i.done).length
  const toggle = (id: string) =>
    editSegment(note.id, seg.id, {
      ...seg.data,
      items: items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    })
  return (
    <SegShell seg={seg} meta={`${done}/${items.length}`}>
      {items.map((i) => (
        <div
          key={i.id}
          className={`check-item ${i.done ? 'done' : ''}`}
          onClick={() => toggle(i.id)}
          style={{ cursor: 'pointer' }}
        >
          <span className={`check-box ${i.done ? 'on' : ''}`}>{i.done ? '✓' : ''}</span>
          <span className="ci-text">{i.text}</span>
        </div>
      ))}
    </SegShell>
  )
}

// ---- Flashcards -------------------------------------------------------------

function FlashFace({
  card,
  onEditBack,
}: {
  card: Flashcard
  onEditBack: (id: string, back: string) => void
}) {
  const [flipped, setFlipped] = useState(false)
  return (
    <div
      className={`flashcard ${flipped ? 'flipped' : ''}`}
      onClick={() => setFlipped((f) => !f)}
    >
      <div className="fc-inner">
        <div className="fc-face">
          <span className="fc-topic">{card.topic}</span>
          <span className="fc-q">{card.front}</span>
          <span className="fc-hint">tap to flip</span>
        </div>
        <div className="fc-face back">
          <span className="fc-topic">{card.topic}</span>
          <textarea
            className="fc-answer"
            value={card.back}
            placeholder="Type the answer…"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onEditBack(card.id, e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

function FlashcardSeg({ note, seg }: { note: Note; seg: Segment }) {
  const { editSegment } = useStore()
  const cards: Flashcard[] = seg.data.cards ?? []
  if (!cards.length)
    return (
      <SegShell seg={seg}>
        <div className="deck">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skel" style={{ height: 110 }} />
          ))}
        </div>
      </SegShell>
    )
  const editBack = (id: string, back: string) =>
    editSegment(note.id, seg.id, {
      ...seg.data,
      cards: cards.map((c) => (c.id === id ? { ...c, back } : c)),
    })
  return (
    <SegShell seg={seg} meta={`${cards.length} cards`}>
      <div className="deck">
        {cards.map((c) => (
          <FlashFace key={c.id} card={c} onEditBack={editBack} />
        ))}
      </div>
    </SegShell>
  )
}

// ---- Study schedule ---------------------------------------------------------

function ScheduleSeg({ seg }: { seg: Segment }) {
  const sessions: StudySession[] = seg.data.sessions ?? []
  if (!sessions.length)
    return (
      <SegShell seg={seg}>
        <Skeleton rows={2} />
      </SegShell>
    )
  return (
    <SegShell seg={seg} meta={`${sessions.length} sessions`}>
      {sessions.map((s) => (
        <div key={s.id} className="sess">
          <span className="sess-date">{relativeDay(s.date)}</span>
          <span className="sess-label">{s.label}</span>
          <span className="sess-topics">
            {s.topics.slice(0, 2).map((t) => (
              <span key={t} className="topic-tag">
                {t}
              </span>
            ))}
          </span>
        </div>
      ))}
    </SegShell>
  )
}

// ---- Project board ----------------------------------------------------------

const COLS: { key: ProjectTask['column']; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'doing', label: 'Doing' },
  { key: 'done', label: 'Done' },
]

function ProjectSeg({ note, seg }: { note: Note; seg: Segment }) {
  const { editSegment } = useStore()
  const tasks: ProjectTask[] = seg.data.tasks ?? []
  const milestones: Milestone[] = seg.data.milestones ?? []
  if (!tasks.length)
    return (
      <SegShell seg={seg}>
        <Skeleton rows={3} />
      </SegShell>
    )

  const advance = (id: string) => {
    const order: ProjectTask['column'][] = ['backlog', 'doing', 'done']
    editSegment(note.id, seg.id, {
      ...seg.data,
      tasks: tasks.map((t) =>
        t.id === id
          ? { ...t, column: order[Math.min(2, order.indexOf(t.column) + 1)] }
          : t,
      ),
    })
  }
  const toggleMs = (id: string) =>
    editSegment(note.id, seg.id, {
      ...seg.data,
      milestones: milestones.map((m) =>
        m.id === id ? { ...m, done: !m.done } : m,
      ),
    })

  const a = note.answers
  return (
    <SegShell seg={seg}>
      <div className="meta-pills">
        {a.stack && <span className="meta-pill">{a.stack}</span>}
        {a.timeline && <span className="meta-pill">{a.timeline}</span>}
        {a.team && <span className="meta-pill">{a.team}</span>}
        {a.goal && <span className="meta-pill">Goal: {a.goal}</span>}
      </div>
      <div className="board">
        {COLS.map((col) => (
          <div key={col.key} className="board-col">
            <h4>{col.label}</h4>
            {tasks
              .filter((t) => t.column === col.key)
              .map((t) => (
                <div
                  key={t.id}
                  className="board-card"
                  onClick={() => advance(t.id)}
                  title="Click to advance"
                >
                  {t.title}
                </div>
              ))}
          </div>
        ))}
      </div>
      {milestones.length > 0 && (
        <div className="milestones">
          <h4>Milestones</h4>
          {milestones.map((m) => (
            <div key={m.id} className="ms-row">
              <span
                className={`check-box ${m.done ? 'on' : ''}`}
                onClick={() => toggleMs(m.id)}
                style={{ cursor: 'pointer' }}
              >
                {m.done ? '✓' : ''}
              </span>
              <span
                style={{
                  fontSize: 13,
                  textDecoration: m.done ? 'line-through' : 'none',
                  color: m.done ? 'var(--ink-faint)' : 'var(--ink)',
                }}
              >
                {m.title}
              </span>
              {m.due && <span className="ms-due">{relativeDay(m.due)}</span>}
            </div>
          ))}
        </div>
      )}
    </SegShell>
  )
}

// ---- Goal tracker -----------------------------------------------------------

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function GoalSeg({ note, seg }: { note: Note; seg: Segment }) {
  const { editSegment } = useStore()
  const days: boolean[] = seg.data.days ?? Array(7).fill(false)
  const toggle = (i: number) => {
    const next = days.map((d, idx) => (idx === i ? !d : d))
    editSegment(note.id, seg.id, {
      ...seg.data,
      days: next,
      streak: next.filter(Boolean).length,
    })
  }
  return (
    <SegShell seg={seg} meta={`${days.filter(Boolean).length} this week`}>
      <div className="meta-pills">
        <span className="meta-pill">{seg.data.cadence}</span>
        {seg.data.target && <span className="meta-pill">Target: {seg.data.target}</span>}
      </div>
      <div className="goal-week">
        {DAYS.map((d, i) => (
          <div
            key={i}
            className={`goal-day ${days[i] ? 'on' : ''}`}
            onClick={() => toggle(i)}
          >
            {d}
          </div>
        ))}
      </div>
    </SegShell>
  )
}

// ---- Event alert ------------------------------------------------------------

function EventSeg({
  seg,
  conflicts,
}: {
  seg: Segment
  conflicts: { title: string; date: string }[]
}) {
  const d = seg.data
  if (!d.eventName)
    return (
      <SegShell seg={seg}>
        <Skeleton rows={2} />
      </SegShell>
    )
  return (
    <SegShell seg={seg} meta={d.category}>
      {d.enriched && (
        <div className="enriched-note">
          <span>✦ identified via broader AI</span>
          {d.summary && <p>{d.summary}</p>}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="alert">
          <span className="a-ico">⚠️</span>
          <div className="a-body">
            You have <b>{conflicts[0].title}</b> during {d.eventName}
            {conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : ''}.
          </div>
        </div>
      )}
      {d.briefing === 'Yes please' && (
        <div className="alert" style={{ background: 'var(--project-soft)', borderColor: 'var(--project)' }}>
          <span className="a-ico">📝</span>
          <div className="a-body">
            A highlights briefing is scheduled for after {d.eventName}.
          </div>
        </div>
      )}
      {d.highlights?.length > 0 && (
        <ul className="highlights">
          {d.highlights.map((h: string) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </SegShell>
  )
}

// ---- Dispatcher -------------------------------------------------------------

export function SegmentView({
  note,
  seg,
  conflicts,
}: {
  note: Note
  seg: Segment
  conflicts: { title: string; date: string }[]
}) {
  switch (seg.type) {
    case 'calendar':
      return <CalendarSeg seg={seg} />
    case 'checklist':
      return <ChecklistSeg note={note} seg={seg} />
    case 'flashcards':
      return <FlashcardSeg note={note} seg={seg} />
    case 'schedule':
      return <ScheduleSeg seg={seg} />
    case 'project-board':
      return <ProjectSeg note={note} seg={seg} />
    case 'goal-tracker':
      return <GoalSeg note={note} seg={seg} />
    case 'event-alert':
      return <EventSeg seg={seg} conflicts={conflicts} />
    default:
      return null
  }
}
