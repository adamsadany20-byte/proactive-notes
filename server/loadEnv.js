// Loads server/.env BEFORE any other server module is imported.
//
// Why a separate module: ES modules evaluate all `import`s before the importing
// file's body runs. Modules like push.js / entitlementStore.js read
// `process.env` at import time, so if dotenv.config() only ran in index.js's
// body, those reads would happen first and see nothing. Importing THIS file as
// the very first import guarantees the .env is populated before anyone reads it.
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })
