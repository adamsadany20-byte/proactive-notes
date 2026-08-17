import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Google OAuth token persistence.
//
// Supabase-backed when SUPABASE_SERVICE_ROLE_KEY is set, else a local flat file.
// The flat file does NOT survive a deploy on a PaaS host (Render's filesystem is
// rebuilt on every push), so without Supabase the Google connection silently
// drops on each redeploy: the doc chips fall back to blank docs.new tabs until
// someone reconnects. Same reason entitlements and push targets are in Supabase.
//
// Still single-user (one row, id='default') — same scope as the flat file it
// replaces. Making Google per-user is a separate change.
//
// Needs this table:
//   create table if not exists google_tokens (
//     id text primary key,
//     data jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//   alter table google_tokens enable row level security;   -- service role bypasses
const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '.google-tokens.json')
const ROW_ID = 'default'

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  .trim()
  .replace(/\/$/, '')
const SB_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const useSupabase = !!(SB_URL && SB_KEY)

export const tokenBackend = useSupabase ? 'supabase' : 'file'

const REST = `${SB_URL}/rest/v1/google_tokens`
const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
}

// Small in-process cache so a single request doesn't re-read the row repeatedly.
let cache = null

export async function saveTokens(tokens) {
  cache = tokens
  if (!useSupabase) {
    try {
      writeFileSync(FILE, JSON.stringify(tokens, null, 2))
    } catch (err) {
      console.error('token save error:', err?.message || err)
    }
    return
  }
  try {
    // Upsert on the primary key — same shape as entitlementStore's proven write:
    // resolution=merge-duplicates makes the POST an insert-or-update.
    const r = await fetch(REST, {
      method: 'POST',
      headers: {
        ...sbHeaders,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([
        { id: ROW_ID, data: tokens, updated_at: new Date().toISOString() },
      ]),
    })
    if (!r.ok) console.error('token save failed:', r.status, await r.text())
  } catch (err) {
    console.error('token save error:', err?.message || err)
  }
}

export async function loadTokens() {
  if (cache) return cache
  if (!useSupabase) {
    if (!existsSync(FILE)) return null
    try {
      cache = JSON.parse(readFileSync(FILE, 'utf8'))
      return cache
    } catch {
      return null
    }
  }
  try {
    const r = await fetch(`${REST}?id=eq.${ROW_ID}&select=data`, { headers: sbHeaders })
    if (!r.ok) return null
    const rows = await r.json()
    cache = rows?.[0]?.data ?? null
    return cache
  } catch (err) {
    console.error('token load error:', err?.message || err)
    return null
  }
}

export async function clearTokens() {
  cache = null
  if (!useSupabase) {
    try {
      if (existsSync(FILE)) unlinkSync(FILE)
    } catch (err) {
      console.error('token clear error:', err?.message || err)
    }
    return
  }
  try {
    await fetch(`${REST}?id=eq.${ROW_ID}`, { method: 'DELETE', headers: sbHeaders })
  } catch (err) {
    console.error('token clear error:', err?.message || err)
  }
}
