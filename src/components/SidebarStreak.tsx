import { useStore } from '../store/appStore'
import { computeGlobalStreak } from '../store/streak'
import { StreakFlameIcon, SproutIcon } from '../ui/icons'

// A compact, always-present streak strip woven into the top of the sidebar (the
// primary column / Notes view), so the streak lives where you actually work
// rather than only in the calendar. Glanceable here; the full interactive ritual
// stays in the Calendar's Today card, which this opens on tap.
export function SidebarStreak({ onOpen }: { onOpen?: () => void }) {
  const { state } = useStore()
  const g = computeGlobalStreak(state.reminders, state.notes)

  // Nothing tracked yet → don't show anything (no clutter for new users).
  if (!g.hasAny) return null

  const alive = g.current > 0

  const title = alive
    ? g.atRisk
      ? 'Keep it alive'
      : 'On a roll'
    : "Let's begin"

  let sub: string
  if (!g.todayExpected) {
    sub = alive ? 'Nothing due — safe' : 'Nothing due today'
  } else if (g.remainingToday === 0) {
    sub = 'All done today ✓'
  } else {
    sub = `${g.remainingToday} left today`
  }

  return (
    <button
      type="button"
      className={`side-streak ${alive ? 'alive' : ''} ${g.atRisk ? 'at-risk' : ''}`}
      onClick={onOpen}
      title="Open your streak"
    >
      <span className="ss-badge">
        <span className="ss-flame">
          {alive ? <StreakFlameIcon /> : <SproutIcon />}
        </span>
        <span className="ss-count">{g.current}</span>
      </span>
      <span className="ss-body">
        <span className="ss-title">{title}</span>
        <span className="ss-sub">{sub}</span>
      </span>
      {g.todayExpected && g.expectedToday > 0 && (
        <span className="ss-pips" aria-hidden>
          {Array.from({ length: Math.min(g.expectedToday, 6) }).map((_, i) => (
            <span key={i} className={`ss-pip ${i < g.doneToday ? 'on' : ''}`} />
          ))}
        </span>
      )}
    </button>
  )
}
