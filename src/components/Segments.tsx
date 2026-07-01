import { useState } from 'react'
import type {
  ChecklistItem,
  Flashcard,
  Milestone,
  Note,
  ProjectTask,
  PurchaseOption,
  Segment,
  StudySession,
} from '../types'
import { SEGMENT_ICON } from '../ui/kindMeta'
import { useStore } from '../store/appStore'
import { relativeDay } from '../store/calendar'
import { uid, parsePrice } from '../engine/generate'

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

// ---- Reminders --------------------------------------------------------------

// Human "in 2h" / "overdue 1d" + urgency status for a reminder timestamp.
export function dueInfo(
  iso?: string,
): { label: string; status: 'soon' | 'later' | 'overdue' } | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  const diff = t - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const hrs = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  const rel = mins < 60 ? `${Math.max(1, mins)}m` : hrs < 24 ? `${hrs}h` : `${days}d`
  if (diff < 0) return { label: `overdue ${rel}`, status: 'overdue' }
  return { label: `in ${rel}`, status: hrs < 24 ? 'soon' : 'later' }
}

// Date → the value an <input type="datetime-local"> expects (local, no seconds).
function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`
}

function defaultRemind(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

function ReminderControl({
  item,
  onSet,
}: {
  item: ChecklistItem
  onSet: (remindAt?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const info = dueInfo(item.remindAt)

  return (
    <span className="rem" onClick={(e) => e.stopPropagation()}>
      {item.remindAt ? (
        <button
          className={`rem-pill ${info?.status ?? ''}`}
          onClick={() => setOpen((o) => !o)}
          title="Edit reminder"
        >
          ⏰ {info?.label}
        </button>
      ) : (
        <button
          className="rem-add"
          title="Set a reminder"
          aria-label="Set a reminder"
          onClick={() => {
            onSet(defaultRemind())
            setOpen(true)
            if ('Notification' in window && Notification.permission === 'default') {
              Notification.requestPermission()
            }
          }}
        >
          🔔
        </button>
      )}
      {open && (
        <span className="rem-edit">
          <input
            type="datetime-local"
            value={toLocalInput(item.remindAt)}
            onChange={(e) =>
              onSet(e.target.value ? new Date(e.target.value).toISOString() : undefined)
            }
          />
          <button
            className="rem-clear"
            onClick={() => {
              onSet(undefined)
              setOpen(false)
            }}
          >
            Clear
          </button>
        </span>
      )}
    </span>
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
  const patchItems = (next: ChecklistItem[]) =>
    editSegment(note.id, seg.id, { ...seg.data, items: next })
  const toggle = (id: string) =>
    patchItems(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
  const setReminder = (id: string, remindAt?: string) =>
    patchItems(items.map((i) => (i.id === id ? { ...i, remindAt } : i)))
  return (
    <SegShell seg={seg} meta={`${done}/${items.length}`}>
      {items.map((i) => (
        <div
          key={i.id}
          className={`check-item ${i.done ? 'done' : ''}`}
          onClick={() => toggle(i.id)}
        >
          <span className={`check-box ${i.done ? 'on' : ''}`}>{i.done ? '✓' : ''}</span>
          <span className="ci-text">{i.text}</span>
          <ReminderControl item={i} onSet={(r) => setReminder(i.id, r)} />
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
            <div key={i} className="skel skel-card" />
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
              >
                {m.done ? '✓' : ''}
              </span>
              <span className={`ms-title ${m.done ? 'done' : ''}`}>
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
        <div className="alert briefing">
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

// ---- Buying decision --------------------------------------------------------

function PurchaseSeg({ note, seg }: { note: Note; seg: Segment }) {
  const { editSegment } = useStore()
  const options: PurchaseOption[] = seg.data.options ?? []
  const places: ChecklistItem[] = seg.data.places ?? []
  const considerations: ChecklistItem[] = seg.data.considerations ?? []
  const steps: ChecklistItem[] = seg.data.steps ?? []

  const patch = (next: Partial<typeof seg.data>) =>
    editSegment(note.id, seg.id, { ...seg.data, ...next })

  const editOption = (id: string, field: 'name' | 'price' | 'note', value: string) =>
    patch({
      options: options.map((o) => (o.id === id ? { ...o, [field]: value } : o)),
    })
  const addOption = () =>
    patch({
      options: [...options, { id: uid('opt'), name: '', price: '', note: '' }],
    })
  const removeOption = (id: string) =>
    patch({ options: options.filter((o) => o.id !== id) })

  const toggle = (key: 'places' | 'considerations' | 'steps', id: string) => {
    const list = (seg.data[key] ?? []) as ChecklistItem[]
    patch({
      [key]: list.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    } as any)
  }

  const decided = considerations.filter((c) => c.done).length

  // Price tracking: lowest filled price among options vs the target/budget.
  const priced = options
    .map((o) => ({ o, n: parsePrice(o.price) }))
    .filter((x): x is { o: PurchaseOption; n: number } => x.n != null)
  const best = priced.length
    ? priced.reduce((a, b) => (b.n < a.n ? b : a))
    : null
  const target = parsePrice(seg.data.budget)
  const delta = best && target != null ? target - best.n : null

  return (
    <SegShell seg={seg} meta={seg.data.budget ? `Target ${seg.data.budget}` : undefined}>
      {(seg.data.budget || seg.data.timing) && (
        <div className="meta-pills">
          {seg.data.budget && <span className="meta-pill">Target: {seg.data.budget}</span>}
          {seg.data.timing && <span className="meta-pill">By: {seg.data.timing}</span>}
        </div>
      )}

      {best && (
        <div className={`price-track ${delta != null && delta < 0 ? 'over' : 'under'}`}>
          <span className="pt-label">Best price so far</span>
          <span className="pt-value">{best.o.price}</span>
          <span className="pt-where">{best.o.name || 'an option'}</span>
          {delta != null && (
            <span className="pt-delta">
              {delta >= 0
                ? `${seg.data.budget?.[0] && /[£$€]/.test(seg.data.budget[0]) ? seg.data.budget[0] : ''}${Math.abs(
                    delta,
                  )} under target`
                : `${Math.abs(delta)} over target`}
            </span>
          )}
        </div>
      )}

      <div className="opt-head">Options &amp; prices</div>
      <div className="opt-list">
        {options.map((o) => (
          <div
            key={o.id}
            className={`opt-row ${best && o.id === best.o.id ? 'best' : ''}`}
          >
            <input
              className="opt-name"
              value={o.name}
              placeholder="Option…"
              onChange={(e) => editOption(o.id, 'name', e.target.value)}
            />
            <input
              className="opt-price"
              value={o.price}
              placeholder="Price"
              onChange={(e) => editOption(o.id, 'price', e.target.value)}
            />
            <button
              className="opt-remove"
              title="Remove"
              aria-label="Remove option"
              onClick={() => removeOption(o.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className="opt-add" onClick={addOption}>
        + Add an option
      </button>

      <div className="opt-head spaced">Where to look</div>
      {places.map((p) => (
        <div
          key={p.id}
          className={`check-item ${p.done ? 'done' : ''}`}
          onClick={() => toggle('places', p.id)}
        >
          <span className={`check-box ${p.done ? 'on' : ''}`}>{p.done ? '✓' : ''}</span>
          <span className="ci-text">{p.text}</span>
        </div>
      ))}

      <div className="purchase-cols">
        <div>
          <div className="opt-head">
            What matters {considerations.length > 0 && <span>· {decided}/{considerations.length}</span>}
          </div>
          {considerations.map((c) => (
            <div
              key={c.id}
              className={`check-item ${c.done ? 'done' : ''}`}
              onClick={() => toggle('considerations', c.id)}
            >
              <span className={`check-box ${c.done ? 'on' : ''}`}>{c.done ? '✓' : ''}</span>
              <span className="ci-text">{c.text}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="opt-head">Before you buy</div>
          {steps.map((s) => (
            <div
              key={s.id}
              className={`check-item ${s.done ? 'done' : ''}`}
              onClick={() => toggle('steps', s.id)}
            >
              <span className={`check-box ${s.done ? 'on' : ''}`}>{s.done ? '✓' : ''}</span>
              <span className="ci-text">{s.text}</span>
            </div>
          ))}
        </div>
      </div>
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
    case 'purchase-planner':
      return <PurchaseSeg note={note} seg={seg} />
    default:
      return null
  }
}
