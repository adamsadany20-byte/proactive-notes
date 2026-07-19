import { useEffect } from 'react'
import { AiTierSelector, SpendLimit } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'
import { PushControls } from './PushControls'
import { GoogleConnection } from './GoogleConnection'
import { FeedbackForm } from './FeedbackControls'
import { OwnerAnalytics } from './OwnerAnalytics'
import { isSupabaseEnabled, supabase } from '../services/supabase'
import { XIcon } from '../ui/icons'

// Settings & tools, lifted out of the note list into a sheet that slides in when
// you tap the logo — so the workspace stays about your notes, not the controls.
export function SettingsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="settings-scrim" onClick={onClose}>
      <div
        className="settings-sheet"
        role="dialog"
        aria-label="Settings and tools"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="settings-title">Settings &amp; tools</span>
          <button
            className="settings-x"
            onClick={onClose}
            aria-label="Close settings"
          >
            <XIcon />
          </button>
        </div>
        <div className="settings-body">
          <ThemeToggle />
          <AiTierSelector />
          <PushControls />
          <GoogleConnection />
          <SpendLimit />
          <FeedbackForm />
          <OwnerAnalytics />
          <p className="settings-note">
            Notes evolve as you type. The local engine handles everything; Evolve
            AI is only consulted for richer suggestions and tool generation.
          </p>
          {isSupabaseEnabled && (
            <button
              className="side-signout"
              onClick={() => supabase?.auth.signOut()}
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
