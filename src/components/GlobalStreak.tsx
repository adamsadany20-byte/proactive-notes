import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/appStore'
import {
  computeGlobalStreak,
  todaysCommitments,
  weekRhythm,
  nextMilestone,
  isMilestone,
  todayIso,
} from '../store/streak'

// A ring of radiating sparks played when the day is completed / a milestone lands.
function TodayBurst() {
  const sparks = Array.from({ length: 12 })
  return (
    <div className="today-burst" aria-hidden>
      {sparks.map((_, i) => (
        <span
          key={i}
          className="tb-spark"
          style={{ ['--a' as any]: `${(360 / sparks.length) * i}deg` }}
        />
      ))}
      <span className="tb-pulse" />
    </div>
  )
}

// The one streak across everything you're tracking, reframed as a daily ritual:
// a living ring, this week's rhythm, the next milestone to reach for, and — the
// heart of it — today's actual commitments as a checklist you tick off right
// here. A day only counts when every commitment due that day is done.
export function GlobalStreak() {
  const { state, toggleOccurrence } = useStore()
  const g = computeGlobalStreak(state.reminders, state.notes)
  const commitments = todaysCommitments(state.reminders, state.notes)
  const week = weekRhythm(state.reminders, state.notes)
  const milestone = nextMilestone(g.current)

  const [celebrate, setCelebrate] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  // Nothing to track yet → don't show the card at all.
  if (!g.hasAny) return null

  const alive = g.current > 0
  const unit = g.current === 1 ? 'day' : 'days'
  const today = todayIso()

  const head = alive ? (g.atRisk ? 'Keep it alive' : 'On a roll') : "Let's begin"

  const fire = () => {
    setCelebrate(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCelebrate(false), 1800)
  }

  const toggle = (reminderId: string, done: boolean) => {
    // Completing the last one due today closes the day — celebrate it.
    if (!done && g.remainingToday === 1) fire()
    toggleOccurrence(reminderId, today)
  }

  let sub: string
  if (!g.todayExpected) {
    sub = alive ? 'Nothing due today — your streak is safe.' : 'Nothing due today.'
  } else if (g.remainingToday === 0) {
    sub = 'Every commitment done today ✓'
  } else if (alive) {
    sub = `${g.doneToday}/${g.expectedToday} done · ${g.remainingToday} to keep it alive`
  } else {
    sub = `Finish all ${g.expectedToday} to light your streak`
  }

  return (
    <div
      className={`today ${alive ? 'alive' : ''} ${g.atRisk ? 'at-risk' : ''} ${
        celebrate ? 'celebrate' : ''
      } ${celebrate && isMilestone(g.current) ? 'milestone' : ''}`}
    >
      <div className="today-top">
        <div className="today-ring">
          {celebrate && <TodayBurst />}
          <span className="today-flame">{alive ? '🔥' : '🌱'}</span>
          <span key={g.current} className="today-count">
            {g.current}
          </span>
          <span className="today-unit">{unit}</span>
        </div>
        <div className="today-headline">
          <div className="today-title">{head}</div>
          <div className="today-sub">{sub}</div>
          <div className="today-week" aria-label="This week">
            {week.map((d) => (
              <span
                key={d.iso}
                className={`tw-day ${d.complete ? 'done' : ''} ${
                  d.isToday ? 'now' : ''
                } ${d.isFuture ? 'future' : ''} ${d.missed ? 'missed' : ''}`}
              >
                <span className="tw-dot" />
                <span className="tw-label">{d.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {g.todayExpected && commitments.length > 0 && (
        <div className="today-list" aria-label="Today's commitments">
          {commitments.map((c) => (
            <button
              key={c.reminderId}
              className={`today-item ${c.done ? 'done' : ''}`}
              onClick={() => toggle(c.reminderId, c.done)}
              title={c.done ? 'Tap to undo' : 'Tap to mark done'}
            >
              <span className="ti-check">{c.done ? '✓' : ''}</span>
              <span className="ti-title">{c.title}</span>
              <span className="ti-hint">
                {c.done ? 'done' : c.mode === 'sessions' ? 'session' : 'today'}
              </span>
            </button>
          ))}
        </div>
      )}

      {(milestone || g.best > 0) && (
        <div className="today-foot">
          {alive && milestone && (
            <span className="today-milestone">
              🔥 {milestone.remaining} to {milestone.label}
            </span>
          )}
          {g.best > 0 && <span className="today-best">🏆 Best {g.best}</span>}
        </div>
      )}
    </div>
  )
}
