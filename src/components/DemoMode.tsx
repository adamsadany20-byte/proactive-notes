import { useStore } from '../store/appStore'

// Owner-only switch for demoing the TIME-based features without waiting for the
// history they need.
//
// The learned rhythm normally wants 8+ completions and stale nudges want 5 days
// of silence. Those aren't permissions — they're the thresholds that make the
// statement true, which is why this is a clearly-labelled preview rather than a
// silent unlock: everything it reveals is badged "Demo" in the panel, and the
// rhythm line says outright how little data it's extrapolating from.
//
// Hidden entirely for non-owners, and TodayPanel re-checks ownership before
// applying it, so a stray localStorage edit elsewhere can't switch it on.
export function DemoMode() {
  const { state, setDemoMode } = useStore()
  const isOwner = !!state.billing?.owner || !!state.config?.owner
  if (!isOwner) return null

  const on = !!state.settings.demoMode

  return (
    <div className="push-controls">
      <div className="pc-head">
        <span className="pc-title">✦ Demo mode</span>
        {on && <span className="pc-badge on">On</span>}
      </div>
      <p className="pc-sub">
        Shows the time-based features straight away instead of waiting for the
        history behind them — the learned rhythm and the “still open” nudges.
        Anything surfaced early is labelled <strong>Demo</strong>, so it can’t be
        mistaken for a real pattern.
      </p>
      <div className="pc-actions">
        {on ? (
          <button className="pc-off" onClick={() => setDemoMode(false)}>
            Turn off
          </button>
        ) : (
          <button className="pc-enable" onClick={() => setDemoMode(true)}>
            Turn on for demos
          </button>
        )}
      </div>
      <p className="pc-sub">
        Only you see this — it’s tied to your owner account.
      </p>
    </div>
  )
}
