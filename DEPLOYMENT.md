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
1. Push this project to a GitHub repo.
2. On https://render.com → **New → Web Service** → connect the repo.
3. Settings:
   - **Build command:** `VITE_API_BASE="" npm install && npm run build`
   - **Start command:** `npm start`
   - **Environment variables:** add `ANTHROPIC_API_KEY` (and `AI_MODEL` if you
     want to override the default). Render sets `PORT` automatically.
4. Deploy. Render gives you a public URL like `https://your-app.onrender.com`.

Railway and Fly.io work the same way (same build/start commands + env vars).

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

## Adding subscriptions (Stripe)

**The subscription infrastructure is already built and wired up.** It gates the
Claude AI tools (`/api/suggest`, `/api/generate-feature`, `/api/enrich`) behind
an active Stripe subscription — but only when you turn it on. While
`BILLING_ENABLED=false` (the default) everything is free and nothing is gated,
so you can keep building and testing without paying.

### What's implemented
- **Master switch:** `BILLING_ENABLED` env var. `false` = free mode (default);
  `true` = enforce the paywall.
- **Client identity (no login yet):** the browser generates a stable anonymous
  `clientId` (localStorage `evolve.clientId`) and sends it with every request.
  Subscriptions are keyed by it in `server/.subscriptions.json` (dev-grade flat
  file — see `server/entitlementStore.js`). Swap this store for a real DB +
  accounts when you add login; the record shape already maps onto a users table.
- **Endpoints** (`server/index.js`):
  - `GET /api/billing/status?clientId=…` → `{ billingEnabled, freeMode, subscribed }`.
  - `POST /api/billing/checkout` → creates a Stripe Checkout Session, returns its URL.
  - `POST /api/billing/webhook` → source of truth; handles
    `checkout.session.completed`, `customer.subscription.updated`, and
    `customer.subscription.deleted` (raw-body signature verification).
- **Backend gate (the real one):** the three AI routes return **402** unless
  `hasAccess(clientId)` — never trusts the frontend.
- **Frontend:** when billing is on and the client isn't subscribed, the Claude
  tier shows a 🔒 and routes to checkout, and the "Evolve this note" panel shows
  a Subscribe CTA. In free mode none of this appears.

### Turning it on
1. **Stripe account** → create a Product with a recurring Price (e.g. £5/mo).
   Copy the Price ID (`price_…`) and secret key (`sk_test_…` / `sk_live_…`).
2. Set in `server/.env`: `BILLING_ENABLED=true`, `STRIPE_SECRET_KEY`,
   `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`.
3. **Webhook:** in the Stripe dashboard (or `stripe listen --forward-to
   localhost:8787/api/billing/webhook` for local) point it at
   `/api/billing/webhook` and subscribe to the three events above.
4. Restart the server. The startup log prints the billing state.

### Before charging real money: accounts
The `clientId` approach is per-browser, not per-person — fine for wiring up and
testing, but for production you want real login so a subscription follows the
user across devices. Easiest path for a solo dev: **Supabase Auth** or **Clerk**
(hosted, free tier). Replace `clientId` with the authenticated user id and point
`entitlementStore` at a real database (e.g. Postgres on Render, or Supabase).

---

## Recommended order
1. ✅ Get all tiers working locally.
2. ✅ Subscription infrastructure (free mode by default).
3. Deploy the single service to Render with a test build — confirm it runs publicly.
4. Add accounts (Supabase/Clerk) and swap `clientId` → user id + a real DB.
5. Flip `BILLING_ENABLED=true` with live Stripe keys.
6. Keep improving the local ML and the UI.
