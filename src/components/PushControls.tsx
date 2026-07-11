import { useEffect, useState } from 'react'
import { useStore } from '../store/appStore'
import {
  pushState,
  enablePush,
  disablePush,
  sendTestPush,
  syncReminderSchedule,
  isIOS,
  type PushState,
} from '../services/push'

// The reminders-notification control in the sidebar. Lets the user turn on
// closed-app push, sends a test, and surfaces the one case we can't code around:
// on iOS, push only works once the site is added to the Home Screen.
export function PushControls() {
  const { state } = useStore()
  const [status, setStatus] = useState<PushState | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    pushState().then((s) => live && setStatus(s))
    return () => {
      live = false
    }
  }, [])

  const enable = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const next = await enablePush()
      setStatus(next)
      if (next === 'granted') {
        // Immediately upload the current schedule so reminders can start firing.
        await syncReminderSchedule(state.reminders, state.notes)
        setMsg('On — you’ll be nudged even when the app is closed.')
      } else if (next === 'denied') {
        setMsg('Notifications are blocked. Enable them in your browser settings.')
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        // The browser granted permission but we couldn't finish subscribing
        // (e.g. the server rejected it). Say so instead of silently reverting to
        // the "Turn on reminders" button, which reads as if nothing happened.
        setMsg('Almost there — couldn’t reach the reminders server. Please try again.')
      }
      // else: the user dismissed the OS prompt without choosing — leave the
      // button in place with no error so they can try again.
    } catch {
      setMsg('Something went wrong turning on reminders. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setMsg(null)
    await disablePush()
    setStatus('default')
    setMsg('Reminders off on this device.')
    setBusy(false)
  }

  const test = async () => {
    setBusy(true)
    setMsg(null)
    const r = await sendTestPush()
    setMsg(r.ok ? 'Test sent — check your notifications.' : r.error || 'Could not send test.')
    setBusy(false)
  }

  if (status === 'loading') return null

  // On a plain desktop browser with no push support, don't clutter the UI.
  if (status === 'unsupported') return null

  return (
    <div className="push-controls">
      <div className="pc-head">
        <span className="pc-title">🔔 Reminders</span>
        {status === 'granted' && <span className="pc-badge on">On</span>}
      </div>

      {status === 'ios-needs-install' && (
        <div className="pc-ios">
          <p className="pc-sub">
            To get reminders when the app is closed on iPhone, add Evolve to your
            Home Screen:
          </p>
          <ol className="pc-steps">
            <li>
              Tap the <strong>Share</strong> button <span aria-hidden>􀈂</span> in
              Safari
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>
            </li>
            <li>Open Evolve from the new icon, then turn reminders on here</li>
          </ol>
        </div>
      )}

      {status === 'unconfigured' && (
        <p className="pc-sub">
          Closed-app reminders aren’t set up on the server yet. They’ll work as
          soon as push is configured.
        </p>
      )}

      {(status === 'default' || status === 'denied') && (
        <>
          <p className="pc-sub">
            Get nudged for your streaks and study sessions even when Evolve is
            closed{isIOS() ? '' : ' — no app install needed'}.
          </p>
          <button className="pc-enable" onClick={enable} disabled={busy || status === 'denied'}>
            {busy ? 'Enabling…' : 'Turn on reminders'}
          </button>
        </>
      )}

      {status === 'granted' && (
        <div className="pc-actions">
          <button className="pc-test" onClick={test} disabled={busy}>
            Send test
          </button>
          <button className="pc-off" onClick={disable} disabled={busy}>
            Turn off
          </button>
        </div>
      )}

      {msg && <p className="pc-msg">{msg}</p>}
    </div>
  )
}
