import { useEffect } from 'react'
import { useStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { NoteEditor } from './components/NoteEditor'
import { fetchServerConfig, fetchCalendarEvents } from './services/api'

export function App() {
  const { selected, setConfig, setExternalEvents } = useStore()

  // On mount: learn what the backend can do, and pull real calendar events if
  // already connected. Also handle the OAuth redirect (?calendar=connected).
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
      // Clean the OAuth return param out of the URL.
      if (location.search.includes('calendar=')) {
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
            <h2>No note selected</h2>
          </div>
        )}
      </div>

      <CalendarPanel />
    </div>
  )
}
