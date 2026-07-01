import { useEffect } from 'react'
import { useStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { NoteEditor } from './components/NoteEditor'
import {
  fetchServerConfig,
  fetchCalendarEvents,
  fetchBillingStatus,
} from './services/api'
import { useReminders } from './ui/useReminders'

export function App() {
  const { selected, setConfig, setExternalEvents, setBilling } = useStore()
  const { toast, dismiss } = useReminders()

  // On mount: learn what the backend can do, pull real calendar events if
  // already connected, and check subscription status. Also handle redirects
  // (?calendar=connected from OAuth, ?billing=success from Stripe checkout).
  useEffect(() => {
    let cancelled = false
    async function init() {
      const cfg = await fetchServerConfig()
      if (!cancelled && cfg) {
        setConfig(cfg)
        if (cfg.calendarConnected) {
          const events = await fetchCalendarEvents()
          if (!cancelled) setExternalEvents(events)
        }
      }
      const billing = await fetchBillingStatus()
      if (!cancelled && billing) setBilling(billing)
      // Clean OAuth / billing return params out of the URL.
      if (/[?&](calendar|billing)=/.test(location.search)) {
        history.replaceState({}, '', location.pathname)
      }
    }
    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app">
      <Sidebar />

      <div className="col col-main">
        {selected ? (
          <NoteEditor key={selected.id} note={selected} />
        ) : (
          <div className="empty">
            <h2>A blank page, full of potential</h2>
            <p className="hint">
              Pick a note from the left, or press <code>+</code> to start
              something new.
            </p>
          </div>
        )}
      </div>

      <CalendarPanel />

      {toast && (
        <div className="toast" role="status">
          <span className="toast-ico">⏰</span>
          <span className="toast-text">{toast}</span>
          <button className="toast-x" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
