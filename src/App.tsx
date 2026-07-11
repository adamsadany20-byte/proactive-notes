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

  // Mobile: only one pane is on screen at a time, chosen by the bottom tab bar.
  // On desktop this state is inert — CSS shows all three columns regardless.
  const [mobileView, setMobileView] = useState<'notes' | 'editor' | 'calendar'>(
    'notes',
  )
  // Picking (or creating) a note jumps you to the editor pane on mobile. Guard
  // the very first render so a reload with a note already selected doesn't yank
  // the user straight past the note list.
  const prevSelectedId = useRef(selected?.id)
  useEffect(() => {
    if (selected?.id && selected.id !== prevSelectedId.current) {
      setMobileView('editor')
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

      {/* Mobile-only pane switcher. Hidden on desktop via CSS. */}
      <nav className="mobile-tabbar" aria-label="Views">
        <button
          className={`mtab ${mobileView === 'notes' ? 'on' : ''}`}
          aria-current={mobileView === 'notes'}
          onClick={() => setMobileView('notes')}
        >
          <span className="mtab-ico">📝</span>
          <span className="mtab-label">Notes</span>
        </button>
        <button
          className={`mtab ${mobileView === 'editor' ? 'on' : ''}`}
          aria-current={mobileView === 'editor'}
          onClick={() => setMobileView('editor')}
        >
          <span className="mtab-ico">✎</span>
          <span className="mtab-label">Write</span>
        </button>
        <button
          className={`mtab ${mobileView === 'calendar' ? 'on' : ''}`}
          aria-current={mobileView === 'calendar'}
          onClick={() => setMobileView('calendar')}
        >
          <span className="mtab-ico">📆</span>
          <span className="mtab-label">Calendar</span>
          {streak.current > 0 && (
            <span
              className={`mtab-streak ${streak.atRisk ? 'at-risk' : ''}`}
              aria-label={`${streak.current} day streak`}
            >
              🔥{streak.current}
            </span>
          )}
        </button>
      </nav>
    </div>
  )
}
