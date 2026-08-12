import { useEffect, useState, type FormEvent } from 'react'
import { submitBetaSignup, fetchBillingStatus } from '../services/api'

// The beta sign-up screen, served at /beta. Two jobs, deliberately in this order:
//   1. Recruit testers who will actively hunt for what's wrong (not just "try it").
//   2. Be completely straight that AI usage costs the owner real money, so nobody
//      is surprised when their allowance runs out — and so testers self-moderate.
// It's a standalone page like Landing: no store, no auth, no app shell.

// What I actually want testers to look for. Concrete prompts beat "any feedback
// welcome" — people answer specific questions and ignore open invitations.
const ASKS = [
  {
    icon: '✎',
    title: 'Where did it misread you?',
    body: 'Write a note and watch what it decides. Wrong category, wrong topic, a tool you didn’t want — those misses are the single most useful thing you can report.',
  },
  {
    icon: '⌁',
    title: 'Where did it waste your time?',
    body: 'Anything slower than doing it yourself, a step that felt pointless, a question you didn’t want to answer. Friction is a bug here.',
  },
  {
    icon: '◇',
    title: 'What did you expect that wasn’t there?',
    body: 'The moment you thought "why can’t it just…" — write that down before you forget it. That sentence is the roadmap.',
  },
  {
    icon: '✕',
    title: 'What actually broke?',
    body: 'Blank screens, spinners that never stop, anything that lost your work. Tell me what you typed and what you saw.',
  },
]

const money = (pence?: number) =>
  pence === undefined ? null : `£${(pence / 100).toFixed(2)}`

export function Beta() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The real allowance from the server, so the number on this page is the number
  // actually enforced — not a figure in marketing copy that can drift out of date.
  const [allowance, setAllowance] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    fetchBillingStatus().then((b) => {
      if (live && b?.beta?.active && b.beta.allowancePence)
        setAllowance(b.beta.allowancePence)
    })
    return () => {
      live = false
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const addr = email.trim()
    if (!addr || busy) return
    setBusy(true)
    setError(null)
    const r = await submitBetaSignup(addr, msg.trim())
    setBusy(false)
    if (r.ok) setDone(true)
    else setError(r.error || 'Something went wrong — please try again.')
  }

  return (
    <div className="landing beta-page">
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
        <span className="beta-badge">Early beta</span>
        <h1 className="lp-h1">Help me find everything that’s wrong with this</h1>
        <p className="lp-lede">
          Evolve turns a few words into a working workspace — calendars,
          checklists, trackers, little tools. It works, but it’s early, and I’d
          rather hear what’s broken now than after I’ve built more on top of it.
        </p>
        <div className="lp-cta-row">
          <a className="lp-primary" href="#join">
            Join the beta
          </a>
          <a className="lp-secondary" href="#cost">
            What it costs me
          </a>
        </div>
      </section>

      <section className="beta-section">
        <h2 className="lp-h2">What I’m asking of you</h2>
        <p className="lp-sub">
          Not a survey — just use it for a real week, for something you actually
          need to get done, and tell me where it let you down.
        </p>
        <div className="beta-asks">
          {ASKS.map((a) => (
            <div className="beta-ask" key={a.title}>
              <span className="beta-ask-ico" aria-hidden>
                {a.icon}
              </span>
              <div>
                <h3 className="beta-ask-title">{a.title}</h3>
                <p className="beta-ask-body">{a.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="beta-note">
          There’s a feedback box in the app (⚙ → Feedback) that reaches me
          directly. Blunt is better than polite — you can’t hurt my feelings
          faster than a bad first impression can.
        </p>
      </section>

      {/* The honest bit. Testers behave better when they know the real numbers,
          and nobody feels tricked when the allowance runs out. */}
      <section className="beta-cost" id="cost">
        <h2 className="lp-h2">Let’s talk about money, honestly</h2>
        <p className="lp-sub">
          The beta is free for you. It is not free for me, and I’d rather explain
          that up front than quietly throttle you later.
        </p>

        <div className="beta-cost-grid">
          <div className="beta-cost-card">
            <span className="beta-cost-k">Free forever</span>
            <span className="beta-cost-v">£0.00</span>
            <p className="beta-cost-b">
              The on-device engine — classifying notes, building checklists,
              calendars, streaks and trackers — runs entirely in your browser.
              No network, no cost, no limit. This is most of the app.
            </p>
          </div>
          <div className="beta-cost-card">
            <span className="beta-cost-k">Costs me a little</span>
            <span className="beta-cost-v">~0.1–1p</span>
            <p className="beta-cost-b">
              Sharper classification and building a custom tool call a small AI
              model. Fractions of a penny each — pennies across a whole week of
              heavy use.
            </p>
          </div>
          <div className="beta-cost-card beta-cost-card--hot">
            <span className="beta-cost-k">Costs me a lot</span>
            <span className="beta-cost-v">~20p</span>
            <p className="beta-cost-b">
              Anything needing live web search — recommendations and
              world-knowledge lookups — runs a bigger model over real search
              results. <strong>One tap ≈ 20p of my money.</strong> Twenty
              testers doing that ten times is £40 out of my pocket, in an
              afternoon.
            </p>
          </div>
        </div>

        <div className="beta-allowance">
          <h3 className="beta-allow-title">
            So here’s the deal
            {allowance !== null && (
              <span className="beta-allow-chip">{money(allowance)} each</span>
            )}
          </h3>
          <p className="beta-allow-body">
            I’m a solo developer paying for this out of pocket, so every tester
            gets a fixed allowance of{' '}
            {allowance !== null ? (
              <strong>{money(allowance)} of real AI spend</strong>
            ) : (
              <strong>real AI spend</strong>
            )}{' '}
            — measured in actual pennies billed to me, not credits I made up.
            You can see exactly how much you’ve used in the app under{' '}
            <strong>⚙ → Beta usage</strong>.
          </p>
          <p className="beta-allow-body">
            <strong>When it runs out, nothing is taken away from you.</strong>{' '}
            The AI features pause; the on-device engine keeps working exactly as
            before. No card, no upsell, no dark pattern — just tell me and I’ll
            top you up if you’re testing something worthwhile.
          </p>
          <p className="beta-allow-body beta-allow-ask">
            All I ask: don’t sit on the web-search features to watch them spin.
            Use them like they’re your money, because they’re somebody’s.
          </p>
        </div>
      </section>

      <section className="lp-interest" id="join">
        <h2 className="lp-h2">Join the beta</h2>
        <p className="lp-sub">
          Leave your email and I’ll send you an invite. Small group on purpose —
          I want to actually read and act on what you send back.
        </p>
        {done ? (
          <p className="lp-thanks">
            You’re on the list — thank you, genuinely. I’ll be in touch shortly
            with your invite. 💛
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
              placeholder="What would you use it for? (helps me prioritise)"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
            {error && <p className="lp-error">{error}</p>}
            <button className="lp-primary lp-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Request an invite'}
            </button>
            <p className="beta-fine">
              Your email is used to send your invite and beta updates — nothing
              else, and no one else sees it.
            </p>
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
