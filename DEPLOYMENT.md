# Running & Deploying Proactive Notes

## Run both servers locally (one command)

From the **project root**:

```bash
npm install          # first time only (also installs the server's deps)
npm run dev          # starts the frontend (Vite) AND the backend together
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:8787

`Ctrl+C` once stops both. (Under the hood this uses `concurrently`; the two
processes are labelled `web` and `api` in the terminal.)

To run just one:

```bash
npm run dev:web      # frontend only
npm run dev:server   # backend only
```

## API keys

All keys live in `server/.env` (copy `server/.env.example` to `server/.env`):

```
ANTHROPIC_API_KEY=sk-ant-...     # Claude tier
```

Leave it blank — the Claude tier shows "not configured" and the app keeps
working on the always-free Local ML tier.

---

## Deploying (single service — simplest)

The backend can serve the built frontend, so you deploy **one** service.

### How it works
- `npm run build` compiles the frontend into `dist/`.
- When `dist/` exists, the Express server serves it at `/` and the API at `/api/*`.
- The frontend calls the API at the **same origin**, so set `VITE_API_BASE=""`
  at build time.

### Build locally to test the production setup
```bash
VITE_API_BASE="" npm run build      # produces dist/
npm start                           # serves app + API on http://localhost:8787
```
Open http://localhost:8787 — the whole app runs from the one server.

### Deploy to Render (free tier, beginner-friendly)

Easiest path — the repo includes a blueprint (`render.yaml`):

1. Push this project to a GitHub repo.
2. On https://render.com → **New → Blueprint** → connect the repo. Render reads
   `render.yaml` and pre-fills everything.
3. Paste your `ANTHROPIC_API_KEY` when prompted; leave `APP_ORIGIN` blank for now.
4. Deploy. Render gives you a public URL like `https://your-app.onrender.com`.
5. Set `APP_ORIGIN` to that URL (used for Stripe/OAuth redirects) and redeploy.

Manual alternative (**New → Web Service**): build command
`VITE_API_BASE="" npm install && npm run build`, start command `npm start`,
env var `ANTHROPIC_API_KEY`. Render sets `PORT` automatically.

Railway and Fly.io work the same way (same build/start commands + env vars).

**Deploying stays free to test.** `BILLING_ENABLED` defaults to `false`, so the
deployed app is exactly as free as local dev — nothing is gated, no Stripe
account needed. You can keep editing locally and pushing; Render redeploys on
every push to the connected branch. (Note: on Render's free tier the service
sleeps after idle and the first request takes ~30s to wake; also the flat-file
stores under `server/` reset on redeploy — fine for testing, another reason
real accounts + a DB come before charging money.)

### Two-service alternative (Vercel frontend + separate backend)
Only if you want the frontend on a CDN:
- Deploy the **frontend** to Vercel with `VITE_API_BASE=https://your-backend-url`.
- Deploy the **backend** (the `server/` folder) to Render/Railway.
- Set the backend's `APP_ORIGIN` to your Vercel URL (used for Google OAuth redirect).

---

## Enabling Google Calendar in production

The Calendar integration is optional and off until you add credentials. To turn
it on for a live deployment:

1. In the [Google Cloud Console](https://console.cloud.google.com/): create an
   OAuth 2.0 Client (type **Web application**) and **enable the Google Calendar API**.
2. Under the client's **Authorized redirect URIs**, add your production callback —
   it must match `GOOGLE_REDIRECT_URI` **exactly**:
   `https://your-app.onrender.com/auth/google/callback`
3. Set these env vars on the backend:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=https://your-app.onrender.com/auth/google/callback`
   - `APP_ORIGIN=https://your-app.onrender.com` (where the browser lands after OAuth)
4. Redeploy. The Calendar panel will show **Connect Google** once configured.

Notes:
- The redirect URI and the Google Console entry must be **byte-for-byte identical**
  (scheme, host, path) or Google returns `redirect_uri_mismatch`.
- If a user revokes access (or the refresh token expires), the next Calendar call
  detects the dead grant, clears the stored token, and the UI falls back to
  **Connect Google** so they can reconnect — no restart needed.
- Token storage (`server/.google-tokens.json`) is single-user/dev-grade. For a
  real multi-user launch, move to per-user tokens in your accounts database
  (see the accounts step on the roadmap).

---

## Billing (Stripe — recurring subscriptions)

**The billing infrastructure is already built and wired up.** While
`BILLING_ENABLED=false` (the default) everything is free and nothing is gated, so
you can keep building and testing without paying.

> **Replaced the one-time credit model (2026-07-14).** Billing is now two
> **recurring monthly subscriptions**. The old `activate`/`topup` one-time
> endpoints still exist so pre-existing credit accounts keep working, but new
> purchases go through subscriptions.

### The commercial model — three tiers

| Tier | Price | Included each month | Beyond that |
|---|---|---|---|
| **Free** | £0 | Local engine only, no network | — |
| **Classification** | **£2/mo** | **£1** of classifier usage | £2 per £1 (2p per 1p) |
| **Evolve AI** | **£12/mo** | **£5** coding + world knowledge **and £1** classifier — **two separate pools** | £2 per £1, **per pool** |

- Evolve's two pools are metered **independently**: burning through the £5 tools
  pool does not touch the £1 classifier pool, and each overages on its own.
- Every Claude call meters its **actual Anthropic cost** (tokens + web searches,
  converted to GBP pence) into the pool it belongs to.
- **Users can set their own spending limit** on beyond-plan usage. The monthly
  plan fee never counts toward it. Once the limit is hit, paid calls stop with a
  402 (`cap_reached`) rather than billing past what they chose.
- All knobs are env vars — see "New env vars" below.

### Cost reality check
Classification is Haiku with no web search: **~0.12p per call** (measured), i.e.
roughly **800 classifications per £1**. It only fires when the local classifier
is unsure (confidence < 0.72), so most notes never hit it. The expensive routes
are the web-search ones (`/api/recommend` ~20p) — see the world-knowledge notes.

### What's implemented
- **Master switch:** `BILLING_ENABLED` env var. `false` = free mode (default);
  `true` = enforce the paywall.
- **Billing identity:** the Supabase user id when logged in, else a stable
  anonymous `clientId` (localStorage `evolve.clientId`). The server verifies the
  Supabase token (`SUPABASE_JWT_SECRET`) before trusting the id.
- **Store** (`server/entitlementStore.js`): per key — `plan`
  (`none|classifier|evolve`), `aiUsedPence` + `classifierUsedPence` (this
  cycle's two pools), `periodStart`/`periodEnd`, `subscriptionId`, `capPence`.
  With `SUPABASE_SERVICE_ROLE_KEY` set this lives in the Supabase `entitlements`
  table (survives redeploys — **required in production**); otherwise it falls
  back to `server/.subscriptions.json` (dev-grade, resets on redeploy).
- **Owner bypass:** `FREE_CLIENT_IDS` — comma-separated clientIds never billed.
- **Endpoints** (`server/index.js`):
  - `GET /api/billing/status?clientId=…` → `{ billingEnabled, freeMode, plan,
    hasClassifier, hasEvolve, pools: { ai, classifier }, overagePence, capPence,
    periodEnd, pricing }`.
  - `POST /api/billing/checkout` `{ clientId, kind: 'classifier' | 'evolve' }` →
    Stripe Checkout URL, `mode: 'subscription'` with inline recurring
    `price_data` (**no Price objects to create**). `kind: 'activate' | 'topup'`
    still serves legacy one-time credit.
  - `POST /api/billing/webhook` → source of truth (raw-body signature verified).
- **Webhook events handled:**
  - `checkout.session.completed` — starts the plan, sets the billing window.
  - `invoice.paid` (`billing_reason: 'subscription_cycle'`) — bills the ENDING
    cycle's overage as a Stripe invoice item, then **resets both pools** and
    advances the period. (Overage is therefore billed one cycle in arrears.)
  - `customer.subscription.deleted` — downgrades to free.
- **Backend gate (the real one):** `/api/classify` needs **Classification or
  Evolve**; `/api/suggest`, `/api/recommend`, `/api/generate-feature`,
  `/api/enrich` need **Evolve**. Both also stop at the user's spend limit.
  402s carry a `reason` (`no_plan` / `cap_reached` / `no_credit`) so the UI
  shows the right CTA.
- **Frontend:** the sidebar AI-tier control shows three tiers; locked ones show
  🔒 and open a plan-specific confirm modal before Stripe. Subscribers see live
  per-pool usage for the cycle and a beyond-plan spending limit.

### Turning it on
1. **Stripe account** → copy the secret key (`sk_test_…` / `sk_live_…`).
   No Products/Prices to create — Checkout uses inline recurring `price_data`.
2. Set in `server/.env`: `BILLING_ENABLED=true`, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`.
3. **Webhook:** in the Stripe dashboard (or `stripe listen --forward-to
   localhost:8787/api/billing/webhook` locally) point it at
   `/api/billing/webhook` and subscribe to **`checkout.session.completed`,
   `invoice.paid`, and `customer.subscription.deleted`**.
4. **Run the entitlements migration** (see the Accounts section — the
   subscription columns are required).
5. Restart the server. The startup log prints the billing state.

### New env vars (all optional — these are the defaults)
```bash
CLASSIFIER_PRICE_PENCE=200            # Classification plan: £2/mo
CLASSIFIER_INCLUDED_PENCE=100         #   includes £1 of classifier usage
EVOLVE_PRICE_PENCE=1200               # Evolve AI plan: £12/mo
EVOLVE_AI_INCLUDED_PENCE=500          #   includes £5 coding + world knowledge
EVOLVE_CLASSIFIER_INCLUDED_PENCE=100  #   includes £1 classifier
OVERAGE_MARKUP=2                      # charge £2 per £1 of beyond-plan usage
```

### Before charging real money: the checklist
1. **Accounts** (so a subscription follows the person, not the browser): enable
   Supabase Auth (see below). When logged in, the billing key is the Supabase
   user id, so a plan works across devices.
2. **Persistent store:** set `SUPABASE_SERVICE_ROLE_KEY` so plans live in the
   Supabase `entitlements` table instead of the flat file (which resets on
   redeploy and would wipe paying customers' plans).
3. **Run the subscription-columns migration** on `entitlements` (below).
4. **Verified tokens:** set `SUPABASE_JWT_SECRET` so a forged token can't
   impersonate another user's account.

The startup log prints which entitlement backend and auth mode are active — check
it says `Entitlements: Supabase` and `Auth: Supabase JWT signature-verified`
before flipping to live Stripe keys.

---

---

## Accounts & Cross-Device Sync (Supabase)

**Notes are currently per-browser** (stored in localStorage). To enable multi-device sync and per-user accounts:

### Step 1: Create Supabase project
1. Go to https://supabase.com → **New Project**.
2. Enter a project name, password, and region (pick one closest to you).
3. Wait for it to spin up (~1 min). You'll land on the dashboard.

### Step 2: Create database tables (SQL)
In the Supabase dashboard:
1. Click **SQL Editor** (left sidebar).
2. Click **New Query** and paste this SQL:

```sql
create table notes (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table notes enable row level security;
create policy "own notes" on notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table reminders (
  id text primary key,
  user_id uuid not null references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table reminders enable row level security;
create policy "own reminders" on reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Billing entitlements (subscriptions). Keyed by the billing key: the Supabase
-- user id when logged in, else an anonymous clientId. RLS is ON with NO policy,
-- so the browser can never read or grant itself a plan — only the server's
-- service_role key (which bypasses RLS) touches this table.
create table entitlements (
  key text primary key,
  status text not null default 'none',
  -- Recurring-subscription model:
  plan text not null default 'none',                        -- none | classifier | evolve
  ai_used_pence double precision not null default 0,         -- coding + world-knowledge pool, THIS cycle
  classifier_used_pence double precision not null default 0, -- classifier pool, THIS cycle
  period_start timestamptz,                                  -- current billing-cycle window
  period_end timestamptz,
  subscription_id text,                                      -- Stripe subscription id
  -- Shared / legacy:
  credit_pence double precision not null default 0,          -- legacy one-time credit model
  used_pence double precision not null default 0,            -- lifetime usage (all pools)
  paid_pence double precision not null default 0,
  cap_pence double precision not null default 0,   -- user's limit on BEYOND-PLAN usage (0 = none)
  customer_id text,
  updated_at timestamptz not null default now()
);
alter table entitlements enable row level security;

-- Web Push targets (closed-app reminders). Same keying as entitlements. Holds
-- each user's device subscriptions + a projection of their reminder schedule so
-- the server can fire notifications while the app is closed. RLS ON, no policy —
-- only the server's service_role key touches it.
create table push_targets (
  key text primary key,
  subscriptions jsonb not null default '[]',   -- [{endpoint, keys, ua, createdAt}]
  reminders jsonb not null default '[]',        -- projected schedule + completions
  tz_offset int not null default 0,             -- minutes behind UTC
  sent jsonb not null default '{}',             -- dedup log "reminderId@date" -> ts
  updated_at timestamptz not null default now()
);
alter table push_targets enable row level security;
```

> ### ⚠️ Migration: already created `entitlements` before 2026-07-14?
> The recurring-subscription model added columns. **Run this before enabling
> billing** — without it, every subscription write to Supabase fails:
> ```sql
> alter table entitlements add column if not exists plan text not null default 'none';
> alter table entitlements add column if not exists ai_used_pence double precision not null default 0;
> alter table entitlements add column if not exists classifier_used_pence double precision not null default 0;
> alter table entitlements add column if not exists period_start timestamptz;
> alter table entitlements add column if not exists period_end timestamptz;
> alter table entitlements add column if not exists subscription_id text;
> -- from an earlier migration, harmless to re-run:
> alter table entitlements add column if not exists cap_pence double precision not null default 0;
> ```
> Existing rows keep their legacy `credit_pence` and default to `plan='none'`, so
> old credit accounts keep working until they subscribe.

> **Push works without Supabase too.** With no `SUPABASE_SERVICE_ROLE_KEY`, push
> targets fall back to a flat file (`server/.push.json`) — fine for local dev,
> but it resets on redeploy, so create the `push_targets` table before relying on
> reminders in production.

3. Click **Run**. The tables appear in the left sidebar under your database.

### Step 3: Get your Supabase credentials
1. Go to **Settings → API** (left sidebar).
2. Copy:
   - **Project URL** (the https://xxxxx.supabase.co address)
   - **anon public** key (the long string under the anon key)
3. Add these to `server/.env`:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

4. Restart the server: `npm run dev`

### Step 4: Test locally
- The app now shows a sign-in screen when you load http://localhost:5173.
- Click **Send Magic Link** and sign in with any email (no real account needed — Supabase sends you a magic link in the **Console → Logs** tab during dev).
- Create a note. It syncs to Supabase's `notes` table.
- Open the app on a different browser/incognito window → sign in with the **same email** → your notes appear (pulled from Supabase).

### Step 5: Deploy to production
When you deploy to Render:
1. In the Render dashboard, add env vars:
   - `VITE_SUPABASE_URL=https://xxxxx.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=eyJhbGc...`
2. Configure Supabase for your live origin:
   - In **Authentication → URL Configuration** (Supabase dashboard), add your Render URL under **Redirect URLs**: `https://your-app.onrender.com`
3. Redeploy. Magic links now work on the live app.

### Notes
- Without Supabase env vars, the app falls back to localStorage (local-only, no login).
- Supabase Auth is free tier up to 50,000 users (MAU); same for Postgres storage.
- Email authentication (magic link) is free. Google/Apple OAuth also works (just enable it in Supabase → Authentication → Providers).
- Row-level security prevents users from seeing each other's notes — enforced at the database level.

---

## Stripe Billing Setup

**Billing is built and ready — just disabled by default.** To turn it on and start charging:

### Step 1: Create a Stripe account
1. Go to https://stripe.com → **Start now**.
2. Sign up. You'll land in **Test mode** (charges don't go through; fine for testing).
3. Go to **Settings → API keys**. Copy the **Secret key** (starts with `sk_test_`).

### Step 2: Set up the webhook
Stripe needs to tell your server when a payment succeeds. Two options:

**Local testing (easier first time):**
```bash
npm install -g stripe          # install Stripe CLI
stripe login                   # authenticates you
stripe listen --forward-to localhost:8787/api/billing/webhook
```
This prints a signing secret (`whsec_...`). Copy it.

**Production (after you deploy):**
1. In the Stripe dashboard, go to **Developers → Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://your-app.onrender.com/api/billing/webhook`
3. Select events — **all three are required for subscriptions**:
   - `checkout.session.completed` — starts the plan
   - `invoice.paid` — bills last cycle's overage, then resets the usage pools
   - `customer.subscription.deleted` — downgrades to free on cancellation
4. Reveal the signing secret and copy it.

> **No Products or Prices to create.** Checkout builds the £2/mo and £12/mo plans
> from inline recurring `price_data`, so there's nothing to configure in the
> Stripe product catalogue.

### Step 3: Configure the server
Add to `server/.env`:
```
BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...       # from Step 1
STRIPE_WEBHOOK_SECRET=whsec_...      # from Step 2
# Persist plans + verify users (both from Supabase → Settings → API):
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   # service_role key — server-only, secret
SUPABASE_JWT_SECRET=...                # JWT Secret — verifies user tokens
```
Pricing knobs are optional (defaults shown in the Billing section above).

> **Why the two Supabase keys matter for billing:** plans + cycle usage are
> stored in the Supabase `entitlements` table (created in the Accounts SQL above)
> so they **survive redeploys**. Without `SUPABASE_SERVICE_ROLE_KEY` the server
> falls back to a local flat file (`server/.subscriptions.json`) that resets
> whenever the host restarts — fine for testing, but it would **wipe paying
> customers' subscriptions** in production. The startup log tells you which
> backend is active. Also make sure you've run the **subscription-columns
> migration** in the Accounts section, or Supabase writes will fail. On
> Render you only need to add `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_JWT_SECRET`
> (the URL is already there via `VITE_SUPABASE_URL`); set `SUPABASE_URL` too for
> local testing since Vite's root env isn't loaded into the server process.

Optionally tweak the business model (all in `server/.env`):
```
ACTIVATION_PRICE_PENCE=1000          # £10 (default)
ACTIVATION_CREDIT_PENCE=100          # £1 included
TOPUP_PRICE_PENCE=400               # £4 top-up (buys £2 of credit at 2× markup)
TOKEN_MARKUP=2                       # multiply token cost by this
```

### Step 4: Test end-to-end
1. Restart: `npm run dev`
2. Open the app and switch to Claude tier (AI tab).
3. Try to enrich/recommend → you'll hit the 402 paywall.
4. Click **Unlock for £10** → Stripe Checkout loads with test card `4242 4242 4242 4242`, any future date, any CVC.
5. Complete checkout. The webhook fires, your account activates, and credit is added.
6. The app now lets you use Claude without hitting the paywall again (until credit runs out).

### Step 5: Switch to live keys
When you're ready to charge real money:
1. In Stripe, toggle to **Live mode** (top-left toggle).
2. Copy your **Live secret key** (`sk_live_…`).
3. Update `server/.env` and redeploy.
4. ⚠️ **Add your own clientId to `FREE_CLIENT_IDS`** so your own usage stays free even with billing on:
   ```
   FREE_CLIENT_IDS=your-browser-clientid
   ```
   (Find your id in browser DevTools → Application → localStorage → `evolve.clientId`)

### Stripe best practices
- **Test mode is free.** Keep testing before flipping to live.
- **Webhook secret matters.** Without it, Stripe can't prove the message is real, and the webhook is ignored (fine for local `stripe listen`, but on production you MUST set it).
- **Stripe Dashboard → Customers** shows who's activated/topped up and their spending.
- **Chargeback/refund?** Clear their credit in the Supabase `entitlements` table (Table Editor → find their `key` → set `credit_pence`/`status`), or in `server/.subscriptions.json` if you're still on the flat-file fallback. Stripe handles the money; you handle the access.

---

## Closed-app reminders (Web Push)

Reminder notifications that reach the user **even when the browser/app is
closed** — no native app, no App Store. Built on the Web Push standard + a
service worker.

### How it works
1. The browser subscribes (service worker + your VAPID public key) and uploads
   the subscription + a projection of the user's reminder schedule to the server.
2. A **cron pinger** hits `POST /api/cron/tick` every few minutes. The server
   finds every reminder that's due right now (correct weekday/session date, past
   its time in the user's timezone, not yet completed, not already sent today)
   and pushes a notification to that user's devices.
3. The service worker shows the notification and focuses the app when tapped.

While the server is awake it also runs the same sweep on an internal 60-second
timer — so on an **always-on host the pinger is optional**. On a free tier that
sleeps after inactivity, the pinger is what wakes it.

### Setup (5 minutes)

**1. Generate a VAPID key pair** (once — keep it stable forever):
```bash
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys()))"
```
Add both keys to `server/.env` (local) and the Render dashboard (production):
```
VAPID_PUBLIC_KEY=B....
VAPID_PRIVATE_KEY=....
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=some-long-random-string
```
> ⚠️ **Never change the VAPID keys after users subscribe** — it invalidates
> every existing subscription. The private key must stay server-only.

**2. Create the `push_targets` table** in Supabase (see the SQL in the Accounts
section above). Without it, subscriptions fall back to a flat file that resets on
redeploy.

**3. Set up the cron pinger** (free — e.g. [cron-job.org](https://cron-job.org)):
- Create a job that sends `POST` (or GET) to:
  `https://your-app.onrender.com/api/cron/tick?secret=YOUR_CRON_SECRET`
- Interval: every **2–3 minutes**. (Reminders fire at ±one interval, so tighter =
  more punctual. Also keeps a free-tier Render service awake.)

### iPhone requirement (Apple's rule, not ours)
On iOS, Web Push works **only after the user adds the site to their Home Screen**
(Safari → Share → *Add to Home Screen*). A plain Safari tab gets **no** push —
this is an Apple restriction every web reminder app hits. The app detects iOS
Safari and shows the user exactly how to install it. Android needs no install
(just notification permission).

### Verify
- Server startup log shows `Push reminders: configured`.
- In the app sidebar → **🔔 Reminders** → *Turn on reminders* → *Send test*. A
  notification should appear even with the tab in the background.
- `curl -X POST "https://your-app.onrender.com/api/cron/tick?secret=..."` returns
  `{"ok":true,"configured":true,...}`.

---

## Complete End-to-End Deployment Flow

### Timeline

**Phase 1: Local Development (today)**
```bash
npm install
npm run dev
```
- App runs with localStorage + local ML engine.
- No Claude tier, no billing, no login.

**Phase 2: Add Supabase (accounts + sync) [optional]**
1. Create Supabase project + tables (see above).
2. Copy credentials to `server/.env`.
3. Restart → app shows login screen.
4. Notes now sync across your browsers.

**Phase 3: Deploy to Render (public URL)**
```bash
# Push to GitHub first
git add .
git commit -m "pre-deploy"
git push
```
1. On Render → **New → Blueprint** → connect your repo.
2. Paste `ANTHROPIC_API_KEY` (Claude tier).
3. If you added Supabase: also fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy. You get a public URL like `https://your-app.onrender.com`.
5. Update Supabase if needed (Settings → URL Configuration → Redirect URLs → add your Render URL).
6. Test: visit the live app, create a note, verify it works.

**Phase 4: Add Stripe billing (monetize) [optional]**
1. Create Stripe account + get secret key.
2. Set up webhook → copy signing secret.
3. Add to `server/.env` (or Render env vars):
   - `BILLING_ENABLED=true`
   - `STRIPE_SECRET_KEY=sk_test_…`
   - `STRIPE_WEBHOOK_SECRET=whsec_…`
4. Add your browser's `evolve.clientId` to `FREE_CLIENT_IDS` so your testing is free.
5. Push & redeploy: `git add . && git commit && git push`
6. Test: hit the paywall, complete a test payment, confirm you get credit.

**Phase 4b: Closed-app reminders (Web Push) [optional]**
1. Generate a VAPID key pair; add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT`, `CRON_SECRET` to Render.
2. Create the `push_targets` table in Supabase.
3. Point a free cron pinger (cron-job.org) at
   `/api/cron/tick?secret=…` every 2–3 min.
4. Redeploy. Users enable reminders from the sidebar (iPhone: Add to Home Screen
   first). See the "Closed-app reminders" section above.

**Phase 5: Go live (real money)**
1. In Stripe, toggle to **Live mode**.
2. Copy **Live secret key** (`sk_live_…`).
3. Update `STRIPE_SECRET_KEY` in `server/.env` (or Render) to the live key.
4. **Ensure your `FREE_CLIENT_IDS` is set** (so you don't charge yourself).
5. Redeploy.
6. **First real payment:** use a real card (Stripe charges it; you own the money). Verify Stripe Customers shows the charge and your server's `/api/billing/status` shows activation.

### Checklist: Ready to Deploy?
- [ ] `npm install` + `npm run build` works locally
- [ ] `npm start` serves the app on http://localhost:8787
- [ ] GitHub repo exists and is up-to-date
- [ ] `ANTHROPIC_API_KEY` is set in `server/.env` (or ready to paste into Render)
- [ ] (Optional) Supabase project created + credentials in `.env`
- [ ] (Optional) Stripe account created + webhook ready (webhook secret not needed for `stripe listen` during dev)
- [ ] `.gitignore` includes `server/.env`, `server/.subscriptions.json`, and `server/.push.json` (don't commit secrets or local test data)
- [ ] (Optional) For closed-app reminders: VAPID keys set, `push_targets` table created, cron pinger scheduled

---

## Recommended order
1. ✅ Get all tiers working locally.
2. ✅ Billing infrastructure (credit model: £10 activation + £5 credit, £2 per £1 of tokens after — free mode by default).
3. Deploy the single service to Render with a test build — confirm it runs publicly.
4. (Optional) Add accounts (Supabase) and swap localStorage → real DB.
5. (Optional) Flip `BILLING_ENABLED=true` with live Stripe keys (add your own clientId to `FREE_CLIENT_IDS` so your own testing stays free).
6. Keep improving the local ML and the UI.
