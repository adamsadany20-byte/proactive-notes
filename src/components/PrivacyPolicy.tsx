// The privacy notice, served at /privacy and linked from Settings.
//
// Written against what the code ACTUALLY does, not a template — every claim here
// was checked against the data flows (see the audit in CLAUDE.md). If you change
// what's collected, sent to a third party, or retained, change this too: a
// privacy notice that doesn't match the system is worse than none.
//
// PLACEHOLDERS marked [[LIKE THIS]] MUST be filled in before publishing. They're
// facts only the operator knows (legal identity, contact address), and inventing
// them would make the notice false.

// Last substantive update. Bump when the content changes.
const UPDATED = '17 August 2026'

const OPERATOR = '[[YOUR NAME OR COMPANY]]'
const CONTACT = '[[YOUR CONTACT EMAIL]]'
const COUNTRY = '[[YOUR COUNTRY, e.g. the United Kingdom]]'

export function PrivacyPolicy() {
  return (
    <div className="landing legal-page">
      <header className="lp-nav">
        <div className="lp-brand">
          <img src="/logo.svg" alt="" className="lp-logo" />
          <span className="lp-name">Evolve</span>
        </div>
        <a className="lp-try" href="/">
          Open the app →
        </a>
      </header>

      <article className="legal">
        <h1 className="legal-h1">Privacy Policy</h1>
        <p className="legal-meta">Last updated: {UPDATED}</p>

        <div className="legal-callout">
          <strong>The short version.</strong> Most of Evolve runs entirely on your
          own device and sends nothing anywhere. If you sign in, your notes are
          stored so they sync across your devices. If you turn on the paid AI
          features, the text of the note you're working on is sent to Anthropic
          to generate a response. We don't sell your data, we don't advertise,
          and we don't build profiles to target you.
        </div>

        <h2 className="legal-h2">1. Who is responsible for your data</h2>
        <p>
          Evolve ("the app") is operated by {OPERATOR}, based in {COUNTRY}. For
          the purposes of UK/EU data protection law we are the <em>data
          controller</em> for the personal data described here.
        </p>
        <p>
          For any privacy question or to exercise your rights, contact{' '}
          <strong>{CONTACT}</strong>. We aim to respond within 30 days, which is
          the statutory deadline.
        </p>

        <h2 className="legal-h2">2. The local-first bit (most of the app)</h2>
        <p>
          Evolve's core engine — classifying your notes, extracting dates,
          building checklists, calendars, trackers and streaks — runs{' '}
          <strong>entirely in your browser</strong>. That processing involves no
          network request and no server, and we never see it. If you use the app
          without signing in and without the paid tiers, your notes stay on your
          device in browser storage and are not transmitted to us at all.
        </p>

        <h2 className="legal-h2">3. What we collect, why, and our legal basis</h2>
        <div className="legal-tablewrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Why</th>
                <th>Legal basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Account</strong> — your email address, and a user ID.
                  If you sign in with Google, we receive your email and basic
                  profile from Google.
                </td>
                <td>To create your account and sync your data across devices.</td>
                <td>Performance of a contract</td>
              </tr>
              <tr>
                <td>
                  <strong>Your notes</strong> — the full text of notes you write,
                  plus anything derived from them (checklists, calendar entries,
                  reminders, tools the AI generated for you and the data you
                  enter into them).
                </td>
                <td>
                  To store your notes and make them available on your other
                  devices. Only stored on our servers if you are signed in.
                </td>
                <td>Performance of a contract</td>
              </tr>
              <tr>
                <td>
                  <strong>Reminder schedules and push subscriptions</strong> —
                  reminder titles and times, your device's push endpoint, browser
                  user-agent, and your time-zone offset.
                </td>
                <td>
                  To send reminder notifications when the app is closed. Only if
                  you switch reminders on.
                </td>
                <td>Consent (you grant it in the browser prompt)</td>
              </tr>
              <tr>
                <td>
                  <strong>Billing</strong> — subscription status, your plan, the
                  amount of AI usage you've run up, and identifiers from Stripe.{' '}
                  <strong>We never see or store your card details</strong> —
                  those go directly to Stripe.
                </td>
                <td>To take payment and apply your plan and spending limit.</td>
                <td>
                  Contract; and legal obligation for keeping financial records
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Feedback</strong> — anything you type into the feedback
                  box or the beta signup form, plus your email if you give one.
                </td>
                <td>To read and act on what you tell us.</td>
                <td>Consent</td>
              </tr>
              <tr>
                <td>
                  <strong>Product analytics</strong> — a small set of event names
                  (app opened, note created, tool built, plan changed) with an
                  anonymous device ID.{' '}
                  <strong>
                    Note: if you type a request into the "build me a tool" box,
                    the text of that request is recorded with the event.
                  </strong>
                </td>
                <td>To understand which features are used and what to improve.</td>
                <td>Legitimate interests (see section 9)</td>
              </tr>
              <tr>
                <td>
                  <strong>Google account access</strong> — if you connect Google,
                  an access token allowing the app to create documents.
                </td>
                <td>
                  To create Docs, Sheets and Slides for you. The permission
                  requested is limited to files this app creates — it cannot see
                  the rest of your Drive.
                </td>
                <td>Consent</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="legal-h2">4. What gets sent to an AI provider</h2>
        <p>
          This is the part worth reading carefully. When you use a paid tier, or
          any AI feature, we send the following to <strong>Anthropic</strong> (the
          company behind Claude) so it can generate a response:
        </p>
        <ul className="legal-list">
          <li>
            the text of the note you are working on, and any answers you've given
            about it;
          </li>
          <li>
            for world-knowledge and recommendation features, a{' '}
            <strong>web search query derived from your note</strong>, which is run
            against a search provider through Anthropic.
          </li>
        </ul>
        <p>
          Anthropic processes this to return a result and, under its commercial
          terms, <strong>does not use it to train its models</strong>. We do not
          send your email address or account identity with it.
        </p>
        <p>
          <strong>If you stay on the free tier, none of this happens</strong> —
          no note text leaves your device for AI processing.
        </p>

        <h2 className="legal-h2">5. Who else your data reaches</h2>
        <p>
          We use these providers to run the service. They process data on our
          instructions under a data processing agreement.
        </p>
        <div className="legal-tablewrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>What for</th>
                <th>Where</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Supabase</td>
                <td>Database and sign-in — your notes and account live here</td>
                <td>Ireland (EU)</td>
              </tr>
              <tr>
                <td>Render</td>
                <td>Hosting for our server, which requests pass through</td>
                <td>United States (Virginia)</td>
              </tr>
              <tr>
                <td>Anthropic</td>
                <td>AI processing (see section 4)</td>
                <td>United States</td>
              </tr>
              <tr>
                <td>Stripe</td>
                <td>Payments and card processing</td>
                <td>United States / worldwide</td>
              </tr>
              <tr>
                <td>Google</td>
                <td>Sign-in, and creating documents if you connect it</td>
                <td>United States / worldwide</td>
              </tr>
              <tr>
                <td>
                  Your browser vendor's push service (Apple, Google or Mozilla)
                </td>
                <td>Delivering reminder notifications to your device</td>
                <td>Varies</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <strong>We do not sell your personal data</strong>, share it with
          advertisers, or use it for advertising profiling.
        </p>

        <h2 className="legal-h2">6. International transfers</h2>
        <p>
          Our database is in the EU (Ireland), but our server and several
          providers are in the <strong>United States</strong>. When your data is
          transferred outside the UK/EEA, that transfer is covered by the
          providers' Standard Contractual Clauses and, where applicable, the UK
          International Data Transfer Addendum and the EU–US Data Privacy
          Framework. You can ask us for details of the safeguards in place.
        </p>

        <h2 className="legal-h2">7. How long we keep it</h2>
        <ul className="legal-list">
          <li>
            <strong>Notes and reminders</strong> — until you delete them, or until
            you delete your account. Deleting a note removes it from our database
            on the next sync.
          </li>
          <li>
            <strong>Account</strong> — until you ask us to delete it.
          </li>
          <li>
            <strong>Billing records</strong> — six years after the transaction,
            because tax law requires us to keep them.
          </li>
          <li>
            <strong>Feedback</strong> — up to 24 months.
          </li>
          <li>
            <strong>Analytics events</strong> — a rolling window of the most
            recent 20,000 events; older ones are discarded automatically.
          </li>
          <li>
            <strong>Push subscriptions</strong> — until you turn reminders off or
            the subscription stops working, at which point it is deleted
            automatically.
          </li>
        </ul>

        <h2 className="legal-h2">8. Your rights</h2>
        <p>Under UK/EU data protection law you have the right to:</p>
        <ul className="legal-list">
          <li>
            <strong>Access</strong> a copy of the personal data we hold about you;
          </li>
          <li>
            <strong>Rectify</strong> anything inaccurate;
          </li>
          <li>
            <strong>Erase</strong> your data ("right to be forgotten");
          </li>
          <li>
            <strong>Restrict</strong> or <strong>object to</strong> our
            processing, including profiling based on legitimate interests;
          </li>
          <li>
            <strong>Portability</strong> — receive your data in a machine-readable
            format;
          </li>
          <li>
            <strong>Withdraw consent</strong> at any time, where we rely on it
            (for example, turning reminders off).
          </li>
        </ul>
        <p>
          To exercise any of these, email <strong>{CONTACT}</strong>. This is free
          and we'll respond within 30 days.
        </p>
        <p>
          You also have the right to complain to a supervisory authority. In the
          UK that is the Information Commissioner's Office (
          <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">
            ico.org.uk
          </a>
          ); in the EU, your national data protection authority.
        </p>

        <h2 className="legal-h2">9. Automated processing and profiling</h2>
        <p>
          Evolve classifies your notes and learns simple patterns from your
          behaviour (for example, that you tend to plan shopping on a particular
          weekday) in order to make suggestions. This happens{' '}
          <strong>on your device</strong> and is used only to decide what to show
          you.
        </p>
        <p>
          There is <strong>no automated decision-making that produces legal or
          similarly significant effects</strong> about you within the meaning of
          Article 22. You can object to profiling by using the free tier, which
          disables the cloud features entirely.
        </p>

        <h2 className="legal-h2">10. Storage on your device</h2>
        <p>
          Evolve uses your browser's local storage — not advertising cookies — to
          hold your notes, your settings, and an anonymous device ID used to
          associate your subscription and usage. This is{' '}
          <strong>strictly necessary</strong> for the app to function, which is
          why there is no cookie banner. We set no third-party advertising or
          tracking cookies. Clearing your browser storage erases local data; if
          you're signed in, your synced notes remain in your account.
        </p>

        <h2 className="legal-h2">11. Security</h2>
        <p>
          Data is encrypted in transit (HTTPS). Database access is protected by
          row-level security, so one account cannot read another's rows.
          Sign-in tokens are cryptographically verified. Card details never reach
          our servers. No system is perfectly secure, but if a breach occurs that
          risks your rights and freedoms we will notify the relevant authority
          within 72 hours and tell you where the law requires it.
        </p>

        <h2 className="legal-h2">12. Children</h2>
        <p>
          Evolve is not directed at children. You must be at least{' '}
          <strong>13</strong> years old to use it (16 in some EU countries). We do
          not knowingly collect data from children below that age; if you believe
          we have, contact us and we'll delete it.
        </p>

        <h2 className="legal-h2">13. Changes</h2>
        <p>
          If we change this policy we'll update the date at the top, and for
          significant changes we'll tell you in the app or by email before they
          take effect.
        </p>

        <h2 className="legal-h2">14. Contact</h2>
        <p>
          Questions, requests, or complaints: <strong>{CONTACT}</strong>.
        </p>
      </article>

      <footer className="lp-foot">
        <span>Evolve — notes that think ahead</span>
        <a href="/">Open the app</a>
      </footer>
    </div>
  )
}
