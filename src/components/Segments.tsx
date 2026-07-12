import { useEffect, useRef, useState } from 'react'
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
import {
  SEGMENT_ICONS,
  BellIcon,
  ChevronIcon,
  ClockIcon,
  FlameIcon,
  SproutIcon,
  StarSixIcon,
  TargetIcon,
  TrophyIcon,
  TuneIcon,
} from '../ui/icons'
import { useStore } from '../store/appStore'
import { relativeDay } from '../store/calendar'
import {
  cadenceLabel,
  candidateOccurrenceCount,
  computeStreak,
  computeGlobalStreak,
  nextOccurrence,
  trailItems,
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
} from '../store/streak'
import { uid, parsePrice } from '../engine/generate'

// Segment types that need the full workspace width; everything else sits in a
// two-column grid so the whole workspace is visible with far less scrolling.
const WIDE_SEGMENTS = new Set<Segment['type']>([
  'flashcards',
  'project-board',
  'purchase-planner',
])

function SegShell({
  seg,
  meta,
  children,
}: {
  seg: Segment
  meta?: string
  children: React.ReactNode
}) {
  // Collapsible: the header always shows the gist (title + meta), so a
  // collapsed segment still tells you what's inside at a glance.
  const [open, setOpen] = useState(true)
  const wide = WIDE_SEGMENTS.has(seg.type)
  const Icon = SEGMENT_ICONS[seg.type]
  return (
    <section className={`segment ${wide ? 'wide' : ''} ${open ? '' : 'closed'}`}>
      <button
        className="seg-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? 'Collapse' : 'Expand'}
      >
        <span className="seg-ico">
          <Icon />
        </span>
        <span className="seg-title">{seg.title}</span>
        {!seg.filled ? (
          <span className="seg-forming">
            <span className="pulse" /> forming
          </span>
        ) : meta ? (
          <span className="seg-meta">{meta}</span>
        ) : null}
        <span className={`seg-chevron ${open ? 'open' : ''}`} aria-hidden>
          <ChevronIcon />
        </span>
      </button>
      <div className="seg-collapse">
        <div className="seg-collapse-inner">
          <div className="seg-body">{children}</div>
        </div>
      </div>
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
          <ClockIcon className="rem-ico" /> {info?.label}
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
          <BellIcon />
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

  // Edits are preserved by the reconciler's merge (it only ever appends new
  // topics from the note) so nothing here needs to freeze the list. Deleting an
  // item records its topic in `dismissed` so the note won't re-add it.
  const patchItems = (next: ChecklistItem[]) =>
    editSegment(note.id, seg.id, { ...seg.data, items: next })
  const toggle = (id: string) =>
    patchItems(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
  const setReminder = (id: string, remindAt?: string) =>
    patchItems(items.map((i) => (i.id === id ? { ...i, remindAt } : i)))
  const setText = (id: string, text: string) =>
    patchItems(items.map((i) => (i.id === id ? { ...i, text } : i)))
  const addItem = () =>
    patchItems([...items, { id: uid('chk'), text: '', done: false }])
  const removeItem = (id: string) => {
    const gone = items.find((i) => i.id === id)
    const key = gone?.key ?? gone?.text.trim().toLowerCase()
    const dismissed = key
      ? Array.from(new Set([...(seg.data.dismissed ?? []), key]))
      : seg.data.dismissed
    editSegment(note.id, seg.id, {
      ...seg.data,
      items: items.filter((i) => i.id !== id),
      dismissed,
    })
  }

  const done = items.filter((i) => i.done).length

  return (
    <SegShell seg={seg} meta={items.length ? `${done}/${items.length}` : undefined}>
      {items.map((i) => (
        <div key={i.id} className={`check-item editable ${i.done ? 'done' : ''}`}>
          <button
            className={`check-box ${i.done ? 'on' : ''}`}
            onClick={() => toggle(i.id)}
            aria-label={i.done ? 'Mark not done' : 'Mark done'}
          >
            {i.done ? '✓' : ''}
          </button>
          <input
            className="ci-edit"
            value={i.text}
            placeholder="Describe this item…"
            onChange={(e) => setText(i.id, e.target.value)}
          />
          <ReminderControl item={i} onSet={(r) => setReminder(i.id, r)} />
          <button
            className="ci-del"
            onClick={() => removeItem(i.id)}
            title="Remove item"
            aria-label="Remove item"
          >
            ✕
          </button>
        </div>
      ))}
      {items.length === 0 && (
        <div className="list-empty">Nothing here yet — add your first item.</div>
      )}
      <button className="list-add" onClick={addItem}>
        + Add item
      </button>
    </SegShell>
  )
}

// ---- Flashcards -------------------------------------------------------------

function FlashFace({
  card,
  onEditFront,
  onEditBack,
  onDelete,
}: {
  card: Flashcard
  onEditFront: (id: string, front: string) => void
  onEditBack: (id: string, back: string) => void
  onDelete: (id: string) => void
}) {
  const [flipped, setFlipped] = useState(false)
  return (
    <div className={`flashcard ${flipped ? 'flipped' : ''}`}>
      <button
        className="fc-del"
        title="Remove card"
        aria-label="Remove card"
        onClick={() => onDelete(card.id)}
      >
        ✕
      </button>
      <div className="fc-inner" onClick={() => setFlipped((f) => !f)}>
        <div className="fc-face">
          <span className="fc-topic">{card.topic}</span>
          <textarea
            className="fc-q-edit"
            value={card.front}
            placeholder="Type the question…"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onEditFront(card.id, e.target.value)}
          />
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

  // The reconciler's merge preserves edited cards and only appends cards for new
  // topics, so edits don't need to freeze the deck. Deleting the last card of a
  // topic records that topic in `dismissed` so the note won't refill it.
  const patchCards = (next: Flashcard[]) =>
    editSegment(note.id, seg.id, { ...seg.data, cards: next })
  const editFront = (id: string, front: string) =>
    patchCards(cards.map((c) => (c.id === id ? { ...c, front } : c)))
  const editBack = (id: string, back: string) =>
    patchCards(cards.map((c) => (c.id === id ? { ...c, back } : c)))
  const addCard = () => {
    const topic = cards[cards.length - 1]?.topic ?? note.entities?.subject ?? 'New'
    patchCards([...cards, { id: uid('fc'), topic, front: '', back: '' }])
  }
  const removeCard = (id: string) => {
    const gone = cards.find((c) => c.id === id)
    const remaining = cards.filter((c) => c.id !== id)
    let dismissed: string[] = seg.data.dismissed ?? []
    if (gone) {
      const key = gone.topic.trim().toLowerCase()
      const topicRemains = remaining.some((c) => c.topic.trim().toLowerCase() === key)
      if (!topicRemains) dismissed = Array.from(new Set([...dismissed, key]))
    }
    editSegment(note.id, seg.id, { ...seg.data, cards: remaining, dismissed })
  }

  if (!cards.length)
    return (
      <SegShell seg={seg}>
        <div className="deck">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skel skel-card" />
          ))}
          <button className="fc-add" onClick={addCard}>
            + Add card
          </button>
        </div>
      </SegShell>
    )

  return (
    <SegShell seg={seg} meta={`${cards.length} cards`}>
      <div className="deck">
        {cards.map((c) => (
          <FlashFace
            key={c.id}
            card={c}
            onEditFront={editFront}
            onEditBack={editBack}
            onDelete={removeCard}
          />
        ))}
        <button className="fc-add" onClick={addCard}>
          + Add card
        </button>
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

// ---- Streak tracker ---------------------------------------------------------

// A ring of radiating sparks played when a streak is kept alive.
function StreakBurst() {
  const sparks = Array.from({ length: 12 })
  return (
    <div className="streak-burst" aria-hidden>
      {sparks.map((_, i) => (
        <span
          key={i}
          className="spark"
          style={{ ['--a' as any]: `${(360 / sparks.length) * i}deg` }}
        />
      ))}
      <span className="ring-pulse" />
    </div>
  )
}

// Shown before a streak exists: when a note has more than one recurrence
// laddering up to a wider goal (habit check-ins, or study sessions before a
// test), invite the user to start tracking a streak.
function StreakInvite({ note, seg }: { note: Note; seg: Segment }) {
  const { startStreak, declineStreak } = useStore()
  const sessions = note.kind === 'academic'
  const count = candidateOccurrenceCount(note)
  const meta = sessions
    ? `${count} sessions`
    : cadenceLabel(
        /* recompute label from a candidate schedule */ (() => {
          const c = (note.answers.cadence ?? '').toLowerCase()
          if (c.includes('week') && (c.includes('3') || c.includes('×') || c.includes('x')))
            return [1, 3, 5]
          if (c.includes('weekday')) return [1, 2, 3, 4, 5]
          if (c.includes('weekly')) return [new Date().getDay()]
          return [0, 1, 2, 3, 4, 5, 6]
        })(),
      )

  // Only offer once it would add more than one occurrence. Otherwise (or once
  // declined) fall back to a quiet opt-in link.
  const worthy = count > 1 && !note.streakDeclined

  if (!worthy) {
    return (
      <SegShell seg={seg} meta={meta}>
        <button className="streak-start-link" onClick={() => startStreak(note.id)}>
          <FlameIcon className="ico" /> Start a streak
        </button>
      </SegShell>
    )
  }

  return (
    <SegShell seg={seg} meta={meta}>
      <div className="streak-invite">
        <div className="si-ring" aria-hidden>
          <FlameIcon />
        </div>
        <div className="si-body">
          <div className="si-head">
            {sessions ? 'Track your prep as a streak?' : 'Turn this into a streak?'}
          </div>
          <div className="si-sub">
            {sessions ? (
              <>
                You’ve got <b>{count}</b> study sessions before this — check each
                one off and keep the streak going to stay on plan.
              </>
            ) : (
              <>
                This goal repeats — I’ll add <b>{count}</b> check-ins to your
                calendar over the next two weeks. Track a streak to stay
                consistent.
              </>
            )}
          </div>
          <div className="si-actions">
            <button className="si-go" onClick={() => startStreak(note.id)}>
              Start a streak
            </button>
            <button className="si-no" onClick={() => declineStreak(note.id)}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </SegShell>
  )
}

function StreakSeg({ note, seg }: { note: Note; seg: Segment }) {
  const { state, toggleOccurrence, updateReminder } = useStore()
  const reminder = state.reminders.find((r) => r.noteId === note.id)

  const [editing, setEditing] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const streak = reminder ? computeStreak(reminder, note) : null

  // Clean up the celebration timer on unmount.
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current)
    },
    [],
  )

  const fireCelebration = () => {
    setCelebrate(true)
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => setCelebrate(false), 1700)
  }

  if (!reminder || !streak) {
    // No streak yet — offer to start one (the "start a streak?" prompt lives
    // here, gated on the note having more than one recurrence).
    return <StreakInvite note={note} seg={seg} />
  }

  const sessions = reminder.mode === 'sessions'
  const trail = trailItems(reminder, note, streak)
  const next = sessions ? streak.actionableDate : nextOccurrence(reminder)

  // The headline number is the ONE global streak across every commitment — not a
  // separate streak per topic. This note's controls below just feed into it.
  const global = computeGlobalStreak(state.reminders, state.notes)
  const alive = global.current > 0
  const unit = global.current === 1 ? 'day' : 'days'

  // Complete the next actionable occurrence (celebrating a fresh completion).
  const doAction = () => {
    if (!streak.actionableDate) return
    const willComplete = !reminder.completions.includes(streak.actionableDate)
    if (willComplete) fireCelebration()
    toggleOccurrence(reminder.id, streak.actionableDate)
  }

  const actionLabel = !streak.actionableDate
    ? null
    : sessions
      ? `Complete session · ${relativeDay(streak.actionableDate).toLowerCase()}`
      : 'Mark today done'

  return (
    <SegShell seg={seg} meta={sessions ? 'Study plan' : cadenceLabel(reminder.weekdays)}>
      <div
        className={`streak ${alive ? 'alive' : ''} ${global.atRisk ? 'at-risk' : ''} ${
          celebrate ? 'celebrate' : ''
        }`}
      >
        <div className="streak-ring">
          {celebrate && <StreakBurst />}
          <span className="streak-flame">
            {alive ? <FlameIcon /> : <SproutIcon />}
          </span>
          <span key={global.current} className="streak-count">
            {global.current}
          </span>
          <span className="streak-unit">{unit}</span>
        </div>

        <div className="streak-side">
          <div className="streak-head">
            {alive ? (global.atRisk ? 'Keep it alive' : 'On a roll') : "Let's begin"}
            <span className="streak-scope"> · streak across everything</span>
          </div>
          <div className="streak-sub">
            {streak.atRisk
              ? 'Check in to keep your streak alive.'
              : streak.todayDone
                ? 'Done for today. Beautifully consistent.'
                : streak.actionableDate
                  ? sessions
                    ? 'A session is ready — check it off.'
                    : 'Mark today done to add to your streak.'
                  : `Next check-in ${
                      next ? relativeDay(next).toLowerCase() : 'soon'
                    }`}
            {global.todayExpected && global.remainingToday > 0 && (
              <>
                {' '}
                <span className="streak-remaining">
                  {global.remainingToday} left today across all commitments.
                </span>
              </>
            )}
          </div>
          {global.best > 0 && (
            <div className="streak-best">
              <TrophyIcon className="sb-ico" /> Best streak {global.best}
            </div>
          )}
        </div>
      </div>

      <div className="streak-trail" aria-label="Recent occurrences">
        {trail.map((o) => (
          <div
            key={o.iso}
            className={`trail-dot ${o.done ? 'on' : ''} ${
              o.marker ? o.marker : ''
            }`}
            title={`${relativeDay(o.iso)}${o.done ? ' · done' : ''}`}
            onClick={() => {
              const willComplete = !o.done
              if (willComplete) fireCelebration()
              toggleOccurrence(reminder.id, o.iso)
            }}
          >
            <span className="td-mark">{o.done ? '✓' : ''}</span>
            <span className="td-label">{o.label}</span>
          </div>
        ))}
      </div>

      {streak.actionableDate ? (
        <button className="streak-btn go" onClick={doAction}>
          {actionLabel}
        </button>
      ) : streak.todayDone && !sessions ? (
        <button
          className="streak-btn done"
          onClick={() => toggleOccurrence(reminder.id, streak.actionableDate ?? new Date().toISOString().slice(0, 10))}
        >
          ✓ Completed today · tap a day to adjust
        </button>
      ) : (
        <div className="streak-rest">
          {sessions
            ? '🎉 Every session done — you’re fully prepped.'
            : `Rest day · next check-in ${
                next ? relativeDay(next).toLowerCase() : 'soon'
              }`}
        </div>
      )}

      {!sessions && (
        <>
          <button className="streak-editlink" onClick={() => setEditing((e) => !e)}>
            {editing ? (
              'Done'
            ) : (
              <>
                <TuneIcon className="ico" /> Schedule & reminder
              </>
            )}
          </button>
          {editing && (
            <div className="streak-editor">
              <div className="se-label">Repeats on</div>
              <div className="se-days">
                {WEEKDAY_LABELS.map((d, i) => (
                  <button
                    key={i}
                    className={`se-day ${reminder.weekdays.includes(i) ? 'on' : ''}`}
                    title={WEEKDAY_FULL[i]}
                    onClick={() => {
                      const set = new Set(reminder.weekdays)
                      if (set.has(i)) set.delete(i)
                      else set.add(i)
                      updateReminder(reminder.id, { weekdays: [...set].sort() })
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="se-time-row">
                <span className="se-label">Remind at</span>
                <input
                  className="se-time"
                  type="time"
                  value={reminder.time}
                  onChange={(e) =>
                    updateReminder(reminder.id, { time: e.target.value || '09:00' })
                  }
                />
              </div>
              {reminder.target && (
                <div className="se-target">Target: {reminder.target}</div>
              )}
            </div>
          )}
        </>
      )}

      {sessions && reminder.target && (
        <div className="streak-plan-target">
          <TargetIcon className="ico" /> {reminder.target}
        </div>
      )}
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
          <span>
            <StarSixIcon className="ico" /> identified via broader AI
          </span>
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
    case 'streak-tracker':
      return <StreakSeg note={note} seg={seg} />
    case 'event-alert':
      return <EventSeg seg={seg} conflicts={conflicts} />
    case 'purchase-planner':
      return <PurchaseSeg note={note} seg={seg} />
    default:
      return null
  }
}
