import { useStore } from '../store/appStore'

// The in-app beta allowance meter, shown in Settings. Deliberately shows REAL
// money (the actual Anthropic spend this tester has caused), not an abstract
// credit score — the whole point is that testers can see the true cost of what
// they're doing and moderate themselves. Hidden unless the server is in beta
// mode, so it never appears in a normal deployment.
export function BetaUsage() {
  const { state } = useStore()
  const beta = state.billing?.beta

  if (!beta?.active) return null

  const allowance = beta.allowancePence ?? 0
  const used = beta.usedPence ?? 0
  const remaining = beta.remainingPence ?? 0
  const pct = allowance > 0 ? Math.min(100, (used / allowance) * 100) : 0
  const money = (p: number) => `£${(p / 100).toFixed(2)}`
  // Warn before they hit the wall, so running out is never a surprise.
  const low = !beta.exhausted && remaining <= allowance * 0.25

  return (
    <div className="push-controls">
      <div className="pc-head">
        <span className="pc-title">✦ Beta usage</span>
        {beta.exhausted ? (
          <span className="pc-badge">Used up</span>
        ) : (
          <span className="pc-badge on">{money(remaining)} left</span>
        )}
      </div>

      <div
        className="beta-meter"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-valuenow={Math.round(used)}
        aria-label="Beta AI allowance used"
      >
        <div
          className={`beta-meter-fill${beta.exhausted ? ' is-out' : low ? ' is-low' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="pc-sub">
        You’ve used <strong>{money(used)}</strong> of your {money(allowance)} AI
        allowance — that’s real money billed to me, shown exactly as it lands.
      </p>

      {beta.exhausted ? (
        <p className="pc-sub">
          The cloud AI is paused for you now. Everything on-device — notes,
          checklists, calendars, streaks and trackers — still works as normal.
          Reply to your beta email if you need more to finish testing something.
        </p>
      ) : (
        <p className="pc-sub">
          Web-search features (recommendations, world knowledge) cost about{' '}
          <strong>20p a tap</strong>; everything else is fractions of a penny.
          When this runs out the on-device engine keeps working.
        </p>
      )}
    </div>
  )
}
