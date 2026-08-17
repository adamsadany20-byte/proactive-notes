import { useMemo } from 'react'
import { useStore } from '../store/appStore'
import { collectToday, todaySummary, type TodayItem, type TodayKind } from '../store/today'

// "What should I do right now", merged across every note.
//
// Everything here already existed in the app — it just lived in five different
// places, so the user was the one holding it together. The top item is called
// out as "Start here" because a ranked list still leaves you choosing; naming
// one thing is the difference between a list and a recommendation.

const META: Record<TodayKind, { icon: string; label: string }> = {
  overdue: { icon: '⚠', label: 'Overdue' },
  due: { icon: '◷', label: 'Due today' },
  commitment: { icon: '🔥', label: 'Streak' },
  session: { icon: '✎', label: 'Study' },
  event: { icon: '◆', label: 'Calendar' },
  doing: { icon: '▸', label: 'In progress' },
  stale: { icon: '◌', label: 'Forgotten' },
}

export function TodayPanel() {
  const { state, select, editSegment, toggleOccurrence } = useStore()

  const items = useMemo(
    () => collectToday(state.notes, state.calendar, state.reminders),
    [state.notes, state.calendar, state.reminders],
  )

  if (!items.length) return null

  // Tick something off without leaving the panel.
  const complete = (it: TodayItem) => {
    if (it.reminderId) {
      toggleOccurrence(it.reminderId, new Date().toISOString().slice(0, 10))
      return
    }
    if (!it.segmentId || !it.itemId) return
    const note = state.notes.find((n) => n.id === it.noteId)
    const seg = note?.segments.find((s) => s.id === it.segmentId)
    if (!note || !seg) return
    const data: any = seg.data ?? {}
    if (seg.type === 'project-board') {
      editSegment(note.id, seg.id, {
        ...data,
        tasks: (data.tasks ?? []).map((t: any) =>
          t.id === it.itemId ? { ...t, column: 'done' } : t,
        ),
      })
      return
    }
    editSegment(note.id, seg.id, {
      ...data,
      items: (data.items ?? []).map((i: any) =>
        i.id === it.itemId ? { ...i, done: true } : i,
      ),
    })
  }

  const canTick = (it: TodayItem) => !!it.reminderId || (!!it.segmentId && !!it.itemId)
  const [first, ...rest] = items

  return (
    <section className="today" aria-label="What to do now">
      <div className="today-head">
        <h2 className="today-title">Now</h2>
        <span className="today-sum">{todaySummary(items)}</span>
      </div>

      {/* The single next thing. A ranked list still makes you choose. */}
      <div className={`today-hero is-${first.kind}`}>
        <span className="today-hero-tag">Start here</span>
        <button className="today-hero-text" onClick={() => select(first.noteId)}>
          {first.text}
        </button>
        <div className="today-hero-foot">
          <span className="today-meta">
            {META[first.kind].icon} {META[first.kind].label}
            {first.when ? ` · ${first.when}` : ''}
          </span>
          {canTick(first) && (
            <button className="today-tick" onClick={() => complete(first)}>
              Done
            </button>
          )}
        </div>
      </div>

      {rest.length > 0 && (
        <ul className="today-rest">
          {rest.map((it) => (
            <li key={it.id} className={`today-row is-${it.kind}`}>
              {canTick(it) ? (
                <button
                  className="today-box"
                  aria-label={`Mark "${it.text}" done`}
                  onClick={() => complete(it)}
                />
              ) : (
                <span className="today-dot" aria-hidden>
                  {META[it.kind].icon}
                </span>
              )}
              <button
                className="today-row-text"
                onClick={() => it.noteId && select(it.noteId)}
                disabled={!it.noteId}
              >
                {it.text}
              </button>
              {it.when && <span className="today-when">{it.when}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
