import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Dev-grade single-user token persistence. For a real multi-user deployment
// this would be a per-user row in a database, not a flat file.
const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '.google-tokens.json')

export function saveTokens(tokens) {
  writeFileSync(FILE, JSON.stringify(tokens, null, 2))
}

export function loadTokens() {
  if (!existsSync(FILE)) return null
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return null
  }
}

export function clearTokens() {
  if (existsSync(FILE)) unlinkSync(FILE)
}
