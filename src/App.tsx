import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { NoteEditor } from './components/NoteEditor'
import { fetchServerConfig, fetchBillingStatus } from './services/api'
import { useReminders } from './ui/useReminders'
import { usePushSync } from './ui/usePushSync'
import { computeGlobalStreak } from './store/streak'

export function App() {
  const { state, selected, setConfig, setBilling } = useStore()
  const { toast, dismiss } = useReminders()
  usePushSync()

  // Mobile: one section is shown at a time, chosen from the top nav. On desktop
  // this state is inert — CSS shows all three columns regardless.
  const [mobileView, setMobileView] = useState<'notes' | 'editor' | 'calendar'>(
    'notes',
  )
  // Navigating a section scrolls back to the top of the page, so it reads like
  // moving between pages of a site rather than swapping a native app screen.
  const goto = (v: 'notes' | 'editor' | 'calendar') => {
    setMobileView(v)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  // Picking (or creating) a note jumps you to the editor on mobile. Guard the
  // very first render so a reload with a note already selected doesn't yank the
  // user straight past the note list.
  const prevSelectedId = useRef(selected?.id)
  useEffect(() => {
    if (selected?.id && selected.id !== prevSelectedId.current) {
      setMobileView('editor')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    prevSelectedId.current = selected?.id
  }, [selected?.id])

  // Ambient momentum on the mobile Calendar tab: a flame badge so the streak is
  // visible from anywhere, not only once you open the calendar.
  const streak = computeGlobalStreak(state.reminders, state.notes)

  // On mount: learn what the backend can do and check subscription status. Also
  // clean the ?billing=success return param from Stripe checkout out of the URL.
  useEffect(() => {
    let cancelled = false
    async function init() {
      const cfg = await fetchServerConfig()
      if (!cancelled && cfg) setConfig(cfg)
      const billing = await fetchBillingStatus()
      if (!cancelled && billing) setBilling(billing)
      if (/[?&]billing=/.test(location.search)) {
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
    <div className="app" data-mobile-view={mobileView}>
      {/* Mobile-only top navigation — a website-style header, hidden on desktop
          via CSS (where the three columns are always visible). */}
      <header className="mnav">
        <div className="mnav-brand">
          <img src="/logo.svg" alt="" className="mnav-logo" />
          <span className="mnav-name">Evolve</span>
        </div>
        <nav className="mnav-links" aria-label="Sections">
          <button
            className={mobileView === 'notes' ? 'on' : ''}
            aria-current={mobileView === 'notes'}
            onClick={() => goto('notes')}
          >
            Notes
          </button>
          <button
            className={mobileView === 'editor' ? 'on' : ''}
            aria-current={mobileView === 'editor'}
            onClick={() => goto('editor')}
          >
            Write
          </button>
          <button
            className={mobileView === 'calendar' ? 'on' : ''}
            aria-current={mobileView === 'calendar'}
            onClick={() => goto('calendar')}
          >
            Calendar
            {streak.current > 0 && (
              <span
                className={`mnav-streak ${streak.atRisk ? 'at-risk' : ''}`}
                aria-label={`${streak.current} day streak`}
              >
                🔥{streak.current}
              </span>
            )}
          </button>
        </nav>
      </header>

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
