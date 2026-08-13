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
  // Pull the real rates from the server so this page can never quote a price
  // different from the one actually charged.
  const [markup, setMarkup] = useState<number | null>(null)
  const [standard, setStandard] = useState<number | null>(null)
  const [plans, setPlans] = useState<{
    classifier?: number
    evolve?: number
    evolveAiIncluded?: number
  } | null>(null)

  useEffect(() => {
    let live = true
    fetchBillingStatus().then((b) => {
      if (!live || !b?.pricing) return
      if (b.pricing.overageMarkup) setMarkup(b.pricing.overageMarkup)
      if (b.pricing.standardMarkup) setStandard(b.pricing.standardMarkup)
      setPlans({
        classifier: b.pricing.classifierPricePence,
        evolve: b.pricing.evolvePricePence,
        evolveAiIncluded: b.pricing.evolveAiIncludedPence,
      })
    })
    return () => {
      live = false
    }
  }, [])

  // Fall back to the documented rates if the server can't be reached, so the
  // page still says something true rather than rendering blanks.
  const rate = markup ?? 1.5
  const normal = standard ?? 2

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
            What it costs
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
          I’m one person, not a funded company, so I can’t absorb everyone’s AI
          bill. Instead of hiding that, here is exactly what things cost and
          exactly what you’d pay.
        </p>

        <div className="beta-cost-grid">
          <div className="beta-cost-card">
            <span className="beta-cost-k">Free forever</span>
            <span className="beta-cost-v">£0.00</span>
            <p className="beta-cost-b">
              The on-device engine — classifying notes, building checklists,
              calendars, streaks and trackers — runs entirely in your browser.
              No network, no cost, no limit. This is most of the app, and it
              stays free whatever you decide.
            </p>
          </div>
          <div className="beta-cost-card">
            <span className="beta-cost-k">Costs pennies</span>
            <span className="beta-cost-v">~0.1–1p</span>
            <p className="beta-cost-b">
              Sharper classification and building a custom tool call a small AI
              model. Fractions of a penny per call — pennies across a whole week
              of heavy use.
            </p>
          </div>
          <div className="beta-cost-card beta-cost-card--hot">
            <span className="beta-cost-k">The expensive one</span>
            <span className="beta-cost-v">~20p</span>
            <p className="beta-cost-b">
              Anything using live web search — recommendations and
              world-knowledge lookups — runs a bigger model over real search
              results. <strong>About 20p of raw cost per tap.</strong> This is
              the one worth being deliberate with.
            </p>
          </div>
        </div>

        <div className="beta-allowance">
          <h3 className="beta-allow-title">
            Beta deal: you pay {rate}× cost, not {normal}×
            <span className="beta-allow-chip">{rate}× tokens</span>
          </h3>
          <p className="beta-allow-body">
            The paid tiers are unchanged
            {plans?.classifier && plans?.evolve ? (
              <>
                {' '}
                — <strong>{money(plans.classifier)}/mo</strong> for sharper
                classification, <strong>{money(plans.evolve)}/mo</strong> for
                Evolve AI
                {plans.evolveAiIncluded
                  ? ` (which includes ${money(plans.evolveAiIncluded)} of usage)`
                  : ''}
              </>
            ) : null}
            . What changes for testers is the rate on usage{' '}
            <em>beyond</em> what your plan includes: normally{' '}
            <strong>{normal}×</strong> what the tokens actually cost, but{' '}
            <strong>{rate}×</strong> for you — real cost plus{' '}
            {Math.round((rate - 1) * 100)}%, which covers the bill without
            profiting off you while you’re doing me a favour.
          </p>
          <p className="beta-allow-body">
            In real money: that ~20p web-search call bills you{' '}
            <strong>~{Math.round(20 * rate)}p</strong> instead of ~
            {Math.round(20 * normal)}p. The small stuff stays under a penny.
            Your metered usage is visible in the app at any time under{' '}
            <strong>⚙ → Settings</strong> — the same numbers I see, no rounding
            in my favour.
          </p>
          <p className="beta-allow-body beta-allow-ask">
            You’re never charged by surprise: set a spend limit in Settings and
            usage stops there rather than billing past it. And if you’d rather
            spend nothing at all, the on-device engine does the bulk of the work
            for free — permanently.
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
