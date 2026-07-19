import { useState } from 'react'
import { useStore } from '../store/appStore'
import {
  connectGoogle,
  disconnectGoogle,
  fetchServerConfig,
} from '../services/api'

// The small multicolour Google "G", inlined so it needs no asset.
function GoogleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  )
}

// Google connection status for document creation. Reuses the push-controls
// styling for a consistent settings section. Hidden entirely when the server has
// no Google credentials, so it never clutters a deployment that isn't set up.
export function GoogleConnection() {
  const { state, setConfig } = useStore()
  const [busy, setBusy] = useState(false)

  const cfg = state.config
  if (!cfg?.googleConfigured) return null

  const connected = !!cfg.googleConnected

  const refresh = async () => {
    const c = await fetchServerConfig()
    if (c) setConfig(c)
  }

  const disconnect = async () => {
    setBusy(true)
    await disconnectGoogle()
    await refresh()
    setBusy(false)
  }

  return (
    <div className="push-controls">
      <div className="pc-head">
        <span className="pc-title">
          <GoogleGlyph /> Google
        </span>
        {connected && <span className="pc-badge on">Connected</span>}
      </div>

      {connected ? (
        <>
          <p className="pc-sub">
            Notes can spin up Google Docs, Sheets &amp; Slides in your account,
            pre-filled and linked back to the note.
          </p>
          <div className="pc-actions">
            <button className="pc-off" onClick={disconnect} disabled={busy}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pc-sub">
            Connect Google to create Docs, Sheets &amp; Slides from your notes.
            Signing in with Google grants this automatically.
          </p>
          <button className="pc-enable" onClick={connectGoogle} disabled={busy}>
            Connect Google
          </button>
        </>
      )}
    </div>
  )
}
