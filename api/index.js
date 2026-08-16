// Vercel serverless entry point.
//
// The whole Express app is exported as ONE function rather than split into a
// file-per-route, so the API behaves identically on Vercel and on a normal Node
// host (`npm start`). vercel.json rewrites /api/* and /auth/* here; everything
// else is served statically from dist/ by Vercel's CDN.
//
// server/index.js gates its process-shaped bits (app.listen, static serving, the
// 60s push timer) on process.env.VERCEL, so importing it here is side-effect free.
export { default } from '../server/index.js'
