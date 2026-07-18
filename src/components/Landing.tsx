import { useState, type FormEvent } from 'react'
import { submitInterest } from '../services/api'

// A marketing landing page to gauge interest — served at /welcome, so ad traffic
// lands here rather than in the app. The email form saves to the same backend as
// feedback (source: "interest"), so signups are a real, durable signal.
const FEATURES = [
  {
    icon: '✶',
    title: 'Turns words into a workspace',
    body: 'Type "trip to Oman" and Evolve builds the calendar, checklist and trackers around it — automatically.',
  },
  {
    icon: '✦',
    title: 'Builds little tools for you',
    body: 'Ask for a packing list, a budget tracker, a study planner — it writes a working tool, tailored to your note.',
  },
  {
    icon: '◎',
    title: 'Streaks that keep you going',
    body: 'One streak across everything you commit to, with gentle nudges and a flame that grows as you show up.',
  },
  {
    icon: '◆',
    title: 'Private by default',
    body: 'The on-device engine handles everything offline; AI only steps in when you ask it to.',
  },
]

export function Landing() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const addr = email.trim()
    if (!addr || busy) return
    setBusy(true)
    setError(null)
    const r = await submitInterest(addr, msg.trim())
    setBusy(false)
    if (r.ok) setDone(true)
    else setError(r.error || 'Something went wrong — please try again.')
  }

  return (
    <div className="landing">
      <header className="lp-nav">
        <div className="lp-brand">
          <img src="/logo.svg" alt="" className="lp-logo" />
          <span className="lp-name">Evolve</span>
        </div>
        <a className="lp-try" href="/">
          Open the app →
        </a>
      </header>

      <section className="lp-hero">
        <img src="/logo.svg" alt="Evolve" className="lp-hero-logo" />
        <h1 className="lp-h1">Notes that think ahead</h1>
        <p className="lp-lede">
          Write a few words. Evolve turns them into a living workspace —
          calendars, checklists, trackers, streaks, even little apps — so your
          notes actually move things forward.
        </p>
        <div className="lp-cta-row">
          <a className="lp-primary" href="/">
            Try it free
          </a>
          <a className="lp-secondary" href="#interest">
            Get launch updates
          </a>
        </div>
      </section>

      <section className="lp-features">
        {FEATURES.map((f) => (
          <div className="lp-feature" key={f.title}>
            <span className="lp-feat-ico" aria-hidden>
              {f.icon}
            </span>
            <h3 className="lp-feat-title">{f.title}</h3>
            <p className="lp-feat-body">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="lp-interest" id="interest">
        <h2 className="lp-h2">Want in early?</h2>
        <p className="lp-sub">
          Leave your email and we’ll tell you the moment it’s ready — and shape it
          around what you’d actually use it for.
        </p>
        {done ? (
          <p className="lp-thanks">
            You’re on the list — thank you. We’ll be in touch. 💛
          </p>
        ) : (
          <form className="lp-form" onSubmit={submit}>
            <input
              className="lp-input"
              type="email"
              required
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="lp-input"
              placeholder="What would you use it for? (optional)"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
            {error && <p className="lp-error">{error}</p>}
            <button className="lp-primary lp-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Keep me posted'}
            </button>
          </form>
        )}
      </section>

      <footer className="lp-foot">
        <span>Evolve — notes that think ahead</span>
        <a href="/">Open the app</a>
      </footer>
    </div>
  )
}
