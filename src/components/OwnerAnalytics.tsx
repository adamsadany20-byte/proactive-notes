import { useEffect, useState } from 'react'
import { useStore } from '../store/appStore'
import { fetchAnalyticsSummary, type AnalyticsSummary } from '../services/api'

// Owner-only product analytics — a compact view of how the app is being used
// across clients. Rendered only when the server flagged this client as an owner
// (config.owner), and the summary endpoint is itself owner-gated, so a
// non-owner who somehow rendered this would get nothing back.
export function OwnerAnalytics() {
  const { state } = useStore()
  const isOwner = state.config?.owner === true
  const [data, setData] = useState<AnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    const s = await fetchAnalyticsSummary()
    setData(s)
    setLoading(false)
  }

  // Load once when the panel is first expanded.
  useEffect(() => {
    if (open && !data && !loading) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!isOwner) return null

  const eventRows = data
    ? Object.entries(data.byName).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="owner-analytics">
      <button
        className="oa-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <strong className="oa-title">Analytics</strong>
        <span className="oa-badge">Owner</span>
        <span className={`oa-chev ${open ? 'open' : ''}`}>⌄</span>
      </button>

      {open && (
        <div className="oa-body">
          <div className="oa-tools">
            <button className="oa-refresh" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {!data && !loading && (
            <p className="oa-empty">No data yet.</p>
          )}

          {data && (
            <>
              <div className="oa-stats">
                <div className="oa-stat">
                  <span className="oa-num">{data.distinctClients}</span>
                  <span className="oa-cap">clients</span>
                </div>
                <div className="oa-stat">
                  <span className="oa-num">{data.totalEvents}</span>
                  <span className="oa-cap">events</span>
                </div>
                <div className="oa-stat">
                  <span className="oa-num">{data.feedbackCount}</span>
                  <span className="oa-cap">feedback</span>
                </div>
              </div>

              {eventRows.length > 0 && (
                <ul className="oa-events">
                  {eventRows.map(([name, count]) => (
                    <li key={name} className="oa-event">
                      <span className="oa-event-name">{name}</span>
                      <span className="oa-event-count">{count}</span>
                    </li>
                  ))}
                </ul>
              )}

              {data.recentFeedback.length > 0 && (
                <div className="oa-feedback">
                  <div className="oa-sub">Recent feedback</div>
                  <ul className="oa-fb-list">
                    {data.recentFeedback.map((f, i) => (
                      <li key={i} className="oa-fb-item">
                        <span className="oa-fb-src">{f.source}</span>
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
