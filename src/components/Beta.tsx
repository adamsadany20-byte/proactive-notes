import { useEffect, useState, type FormEvent } from 'react'
import {
  submitBetaSignup,
  fetchBillingStatus,
  type BillingStatus,
} from '../services/api'

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

// Keep pence only when they matter: 600 -> "£6", 50 -> "£0.50". Never round a
// sub-pound figure up to "£1" — this page quotes real prices.
const money = (pence?: number) =>
  pence === undefined
    ? null
    : `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`

export function Beta() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Pull the real rates from the server so this page can never quote a price
  // different from the one actually charged.
  const [pricing, setPricing] = useState<BillingStatus['pricing'] | null>(null)

  useEffect(() => {
    let live = true
    fetchBillingStatus().then((b) => {
      if (live && b?.pricing) setPricing(b.pricing)
    })
    return () => {
      live = false
    }
  }, [])

  // Fall back to the current defaults if the server can't be reached, so the
  // page still says something true rather than rendering blanks.
  const rate = pricing?.overageMarkup ?? 1.5
  const classPrice = pricing?.classifierPricePence ?? 100
  const classIncl = pricing?.classifierIncludedPence ?? 50
  const evPrice = pricing?.evolvePricePence ?? 600
  const evAiIncl = pricing?.evolveAiIncludedPence ?? 250
  const evClIncl = pricing?.evolveClassifierIncludedPence ?? 50

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

        {/* What you'd actually pay. Three tiers, stated plainly. */}
        <h3 className="beta-plans-head">What you’d pay</h3>
        <div className="beta-cost-grid beta-plans">
          <div className="beta-cost-card">
            <span className="beta-cost-k">Free</span>
            <span className="beta-cost-v">£0</span>
            <p className="beta-cost-b">
              The whole on-device engine, forever. No account needed, no limit,
              nothing metered. If you never want to spend a penny, stop here —
              this tier is genuinely the bulk of the app.
            </p>
          </div>
          <div className="beta-cost-card">
            <span className="beta-cost-k">Classification</span>
            <span className="beta-cost-v">{money(classPrice)}<span className="beta-per">/mo</span></span>
            <p className="beta-cost-b">
              Sharper, cloud-backed reading of your notes when the local engine
              isn’t sure. Includes <strong>{money(classIncl)}</strong> of
              classifier usage each month — roughly{' '}
              {Math.round(classIncl / 0.12)} classifications.
            </p>
          </div>
          <div className="beta-cost-card beta-cost-card--hot">
            <span className="beta-cost-k">Evolve AI</span>
            <span className="beta-cost-v">{money(evPrice)}<span className="beta-per">/mo</span></span>
            <p className="beta-cost-b">
              Everything: custom tool generation, world knowledge, web search.
              Includes <strong>{money(evAiIncl)}</strong> of tool &amp;
              knowledge usage <em>and</em> <strong>{money(evClIncl)}</strong> of
              classification, metered as two separate pots.
            </p>
          </div>
        </div>

        <div className="beta-allowance">
          <h3 className="beta-allow-title">
            How usage beyond your plan works
            <span className="beta-allow-chip">{rate}× tokens</span>
          </h3>

          <p className="beta-allow-body">
            Your monthly fee already covers the usage listed above. You only pay
            more if you go <em>past</em> it — and then only for what you actually
            use, at <strong>{rate}× what the tokens genuinely cost me</strong>.
            That margin covers the Anthropic bill, Stripe’s cut and hosting; it
            isn’t a markup for its own sake, and there’s no separate “beta rate”
            that quietly expires on you later.
          </p>

          <p className="beta-allow-body">
            <strong>In real money.</strong> The expensive action is a web-search
            lookup at about 20p of raw cost, which bills you{' '}
            <strong>~{Math.round(20 * rate)}p</strong>. Everything else —
            classifying a note, building a tool — is a penny or less, so on
            Evolve AI you’d have to run{' '}
            <strong>~{Math.round(evAiIncl / (20 * rate))} web searches</strong>{' '}
            in a month before paying anything above {money(evPrice)} at all.
          </p>

          <p className="beta-allow-body">
            <strong>How and when you’re billed.</strong> Overage isn’t charged
            the moment it happens — it’s totalled at the end of your monthly
            cycle and added to your <em>next</em> invoice, itemised. Both pots
            reset each cycle. Cancel any time and the subscription simply stops
            at the end of the period you’ve paid for.
          </p>

          <p className="beta-allow-body beta-allow-ask">
            <strong>You’re never charged by surprise.</strong> Set a spend limit
            in Settings and usage <em>stops</em> at that figure rather than
            billing past it — it caps overage only, never the plan fee. Your
            running total is visible in the app under{' '}
            <strong>⚙ → Settings</strong> at any time: the same numbers I see,
            no rounding in my favour. And if you’d rather spend nothing, the
            on-device engine keeps doing the bulk of the work for free.
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
        <span className="lp-foot-links">
          <a href="/privacy">Privacy</a>
          <a href="/">Open the app</a>
        </span>
      </footer>
    </div>
  )
}
