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
ANTHROPIC_API_KEY=sk-ant-...     # Claude Haiku tier
GOOGLE_GEMINI_API_KEY=AIza...    # Gemini tier
GROQ_API_KEY=gsk_...             # Groq tier
```

Leave any blank — that tier shows "not configured" and the app keeps working on
the others (and on the always-free Local ML tier).

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
   - **Environment variables:** add `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_API_KEY`,
     `GROQ_API_KEY` (and `AI_MODEL`, `GEMINI_MODEL`, `GROQ_MODEL` if you want to
     override the defaults). Render sets `PORT` automatically.
4. Deploy. Render gives you a public URL like `https://your-app.onrender.com`.

Railway and Fly.io work the same way (same build/start commands + env vars).

### Two-service alternative (Vercel frontend + separate backend)
Only if you want the frontend on a CDN:
- Deploy the **frontend** to Vercel with `VITE_API_BASE=https://your-backend-url`.
- Deploy the **backend** (the `server/` folder) to Render/Railway.
- Set the backend's `APP_ORIGIN` to your Vercel URL (used for Google OAuth redirect).

---

## Adding subscriptions (Stripe)

The app already has the tier system the paywall will gate on:
`settings.aiBackend` = `local | gemini | haiku | groq`. Local ML is the free
tier; the cloud tiers are what you charge for.

### The pieces you'll add
1. **Stripe account** → create a Product with a recurring Price (e.g. £5/mo).
   Copy the Price ID (`price_...`) and your secret key (`sk_live_...` / `sk_test_...`).
2. **Backend: checkout endpoint** — `POST /api/checkout` creates a Stripe Checkout
   Session and returns its URL; the frontend redirects the user there.
   ```js
   // server/index.js (sketch)
   import Stripe from 'stripe'
   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
   app.post('/api/checkout', async (req, res) => {
     const session = await stripe.checkout.sessions.create({
       mode: 'subscription',
       line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
       success_url: `${process.env.APP_ORIGIN}/?paid=1`,
       cancel_url: `${process.env.APP_ORIGIN}/`,
     })
     res.json({ url: session.url })
   })
   ```
3. **Backend: webhook** — `POST /api/stripe/webhook` listens for
   `checkout.session.completed` and `customer.subscription.deleted` to mark a
   user as subscribed / unsubscribed. Store that status (needs a small database
   once you have real users — e.g. Postgres on Render, or Supabase).
4. **Gate the tiers** — before allowing a cloud tier, check subscription status.
   Two layers:
   - **Frontend:** if not subscribed, the Gemini/Claude/Groq toggles show
     "Upgrade" and call `/api/checkout` instead of switching.
   - **Backend (the real gate):** `/api/suggest`, `/api/generate-feature`,
     `/api/enrich` verify the user is subscribed before calling a paid model.
     Never trust the frontend alone for paywalls.

### Prerequisite: user accounts
Subscriptions need to know *who* is subscribed, which means login. Easiest path
for a solo dev: **Supabase Auth** or **Clerk** (hosted, free tier) — they give
you login + a user ID you attach the Stripe customer to. This is the one larger
piece to add before charging money.

---

## Recommended order
1. ✅ Get all tiers working locally (current step).
2. Deploy the single service to Render with a test build — confirm it runs publicly.
3. Add accounts (Supabase/Clerk).
4. Add Stripe checkout + webhook + backend gating.
5. Keep improving the local ML and the UI.
