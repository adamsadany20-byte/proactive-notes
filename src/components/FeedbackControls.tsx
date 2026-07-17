import { useEffect, useState } from 'react'
import { submitFeedback } from '../services/api'
import { BellIcon, StarSixIcon, XIcon } from '../ui/icons'

// ---- The always-available feedback form (lives in Settings & tools) ---------

export function FeedbackForm() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    const r = await submitFeedback(message, 'form')
    setBusy(false)
    if (r.ok) {
      setDone(true)
      setText('')
    } else {
      setError(r.error || 'Could not send — try again.')
    }
  }

  return (
    <div className="feedback">
      <strong className="fb-label">Feedback</strong>
      {done ? (
        <p className="fb-thanks">Thanks — that really helps. 💛</p>
      ) : (
        <>
          <p className="fb-sub">
            Anything you’d love Evolve to add, or that’s not working? Tell us.
          </p>
          <textarea
            className="fb-input"
            value={text}
            placeholder="A feature idea, a bug, anything…"
            rows={3}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="fb-error">{error}</p>}
          <button
            className="fb-send"
            onClick={send}
            disabled={busy || !text.trim()}
          >
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </>
      )}
    </div>
  )
}

// ---- The occasional "what could we add?" prompt -----------------------------
//
// Shows a gentle, dismissible card once the user has opened the app a handful of
// times, and not more than once a week. "Don't ask again" turns it off for good.
// All state is local to this browser.

const KEY = 'evolve.feedbackPrompt'
const WEEK = 7 * 86400000
const MIN_OPENS = 4

interface PromptState {
  dontAsk?: boolean
  opens?: number
  lastShownAt?: number
  sent?: boolean
}

function readState(): PromptState {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}
function writeState(s: PromptState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

// Called once per app load to count opens and decide whether to surface.
function bumpAndDecide(): boolean {
  const s = readState()
  if (s.dontAsk) return false
  s.opens = (s.opens || 0) + 1
  writeState(s)
  if (s.opens < MIN_OPENS) return false
  if (s.lastShownAt && Date.now() - s.lastShownAt < WEEK) return false
  return true
}

// Module-level guard so the count-and-decide runs exactly once per load, even
// with StrictMode double-invoking effects in dev.
let decided = false

export function FeedbackPrompt() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (decided) return
    decided = true
    if (bumpAndDecide()) {
      writeState({ ...readState(), lastShownAt: Date.now() })
      setOpen(true)
    }
  }, [])
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const close = () => setOpen(false)
  const dontAsk = () => {
    writeState({ ...readState(), dontAsk: true })
    setOpen(false)
  }
  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    const r = await submitFeedback(message, 'prompt')
    setBusy(false)
    if (r.ok) {
      writeState({ ...readState(), sent: true })
      setSent(true)
      setTimeout(() => setOpen(false), 1400)
    }
  }

  return (
    <div className="fb-prompt" role="dialog" aria-label="Quick feedback">
      <button className="fb-prompt-x" onClick={close} aria-label="Close">
        <XIcon />
      </button>
      {sent ? (
        <div className="fb-prompt-thanks">
          <span className="fb-prompt-ico">
            <StarSixIcon />
          </span>
          Thank you — noted. 💛
        </div>
      ) : (
        <>
          <div className="fb-prompt-head">
            <span className="fb-prompt-ico">
              <BellIcon />
            </span>
            <span>What could Evolve do better?</span>
          </div>
          <p className="fb-prompt-sub">
            A feature you wish it had, or anything getting in your way — one line
            is plenty.
          </p>
          <textarea
            className="fb-input"
            value={text}
            placeholder="I wish it could…"
            rows={2}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <div className="fb-prompt-actions">
            <button
              className="fb-send"
              onClick={send}
              disabled={busy || !text.trim()}
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button className="fb-prompt-later" onClick={close}>
              Not now
            </button>
            <button className="fb-prompt-never" onClick={dontAsk}>
              Don’t ask again
            </button>
          </div>
        </>
      )}
    </div>
  )
}
