import { useStore } from '../store/appStore'
import { computeGlobalStreak } from '../store/streak'

// One streak across everything you're tracking. A day only counts when every
// commitment due that day is done — the nudge to do it all, not just one thing.
export function GlobalStreak() {
  const { state } = useStore()
  const g = computeGlobalStreak(state.reminders, state.notes)

  // Nothing to track yet → don't show the banner at all.
  if (!g.hasAny) return null

  const alive = g.current > 0
  const unit = g.current === 1 ? 'day' : 'days'

  const head = alive
    ? g.atRisk
      ? 'Keep it alive'
      : 'On a roll'
    : "Let's begin"

  let sub: string
  if (!g.todayExpected) {
    sub = alive
      ? 'Nothing due today — your streak is safe.'
      : 'Nothing due today.'
  } else if (g.remainingToday === 0) {
    sub = 'Everything done today. Beautifully consistent. ✓'
  } else if (alive) {
    sub = `${g.remainingToday} more to go today to keep your ${g.current}-day streak 🔥`
  } else {
    sub = `Finish all ${g.expectedToday} today to light your streak 🌱`
  }

  return (
    <div
      className={`gstreak ${alive ? 'alive' : ''} ${g.atRisk ? 'at-risk' : ''}`}
    >
      <div className="gstreak-ring">
        <span className="gstreak-flame">{alive ? '🔥' : '🌱'}</span>
        <span key={g.current} className="gstreak-count">
          {g.current}
        </span>
        <span className="gstreak-unit">{unit}</span>
      </div>
      <div className="gstreak-body">
        <div className="gstreak-head">{head}</div>
        <div className="gstreak-sub">{sub}</div>
        {g.todayExpected && (
          <div className="gstreak-progress" aria-hidden>
            {Array.from({ length: g.expectedToday }).map((_, i) => (
              <span
                key={i}
                className={`gstreak-pip ${i < g.doneToday ? 'on' : ''}`}
              />
            ))}
          </div>
        )}
        {g.best > 0 && (
          <div className="gstreak-best">🏆 Best {g.best}</div>
        )}
      </div>
    </div>
  )
}
