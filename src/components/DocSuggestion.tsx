import { useMemo, useState } from 'react'
import type { DocLink, Note } from '../types'
import { useStore } from '../store/appStore'
import {
  detectDocNeed,
  blankDocUrl,
  DOC_META,
  type DocType,
} from '../engine/docs'
import { createGoogleDoc, connectGoogle } from '../services/api'
import { XIcon } from '../ui/icons'

// Senses when a note would benefit from a Google Doc / Sheet / Slides and offers
// a one-tap "start one" chip under the editor. When Google is connected the file
// is created for real — titled and seeded with the note's content — and linked
// back onto the note; otherwise it falls back to opening a blank docs.new tab.
// Already-created docs are always listed so the note remembers them.
export function DocSuggestion({ note }: { note: Note }) {
  const { state, attachDoc, declineDoc } = useStore()
  const [busy, setBusy] = useState<DocType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const suggestion = useMemo(() => detectDocNeed(note), [note.text, note.topic, note.kind])
  const docs = note.docs ?? []
  const connected = !!state.config?.googleConnected
  const configured = !!state.config?.googleConfigured

  // Suppress the offer for a type the user dismissed, or one we already made a
  // (real, non-blank) file for — but keep offering after a blank fallback so a
  // connected user can still create the linked version.
  const declined = note.docsDeclined ?? []
  const hasRealDoc = (t: DocType) =>
    docs.some((d) => d.type === t && !d.blank)
  const showOffer =
    !!suggestion &&
    !declined.includes(suggestion.type) &&
    !hasRealDoc(suggestion.type)

  if (!showOffer && docs.length === 0) return null

  async function create(type: DocType, title: string) {
    setError(null)
    setBusy(type)
    try {
      if (connected) {
        const res = await createGoogleDoc({ type, title, seed: note.text })
        if (res.ok && res.doc) {
          const link: DocLink = {
            id: res.doc.id,
            type,
            title: res.doc.title,
            url: res.doc.url,
            createdAt: Date.now(),
          }
          attachDoc(note.id, link)
          window.open(res.doc.url, '_blank', 'noopener')
          return
        }
        // Fall through to the blank path on not_connected; surface others.
        if (res.error && res.error !== 'not_connected') {
          setError("Couldn't create the file — try again in a moment.")
          return
        }
      }
      // Fallback: open a blank Google file (can't pre-fill or link it back).
      window.open(blankDocUrl(type), '_blank', 'noopener')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="docsug" role="group" aria-label="Documents">
      {showOffer && suggestion && (
        <div className={`docsug-offer docsug-${suggestion.type}`}>
          <button
            className="docsug-main"
            disabled={busy !== null}
            onClick={() => create(suggestion.type, suggestion.title)}
            title={`Create a ${DOC_META[suggestion.type].label} for “${suggestion.title}”`}
          >
            <span className="docsug-ico" aria-hidden>
              {DOC_META[suggestion.type].icon}
            </span>
            <span className="docsug-text">
              <span className="docsug-verb">
                {busy === suggestion.type
                  ? 'Creating…'
                  : DOC_META[suggestion.type].verb}
              </span>
              <span className="docsug-reason">{suggestion.reason}</span>
            </span>
          </button>

          {/* Offer the other two types too, in case the guess was off. */}
          <div className="docsug-alts">
            {(['doc', 'sheet', 'slides'] as DocType[])
              .filter((t) => t !== suggestion.type)
              .map((t) => (
                <button
                  key={t}
                  className="docsug-alt"
                  disabled={busy !== null}
                  onClick={() => create(t, suggestion.title)}
                  title={`Create a ${DOC_META[t].label} instead`}
                >
                  {DOC_META[t].icon} {DOC_META[t].short}
                </button>
              ))}
          </div>

          <button
            className="docsug-dismiss"
            aria-label="Not now"
            disabled={busy !== null}
            onClick={() => declineDoc(note.id, suggestion.type)}
          >
            <XIcon />
          </button>
        </div>
      )}

      {error && <p className="docsug-error">{error}</p>}

      {showOffer && configured && !connected && (
        <p className="docsug-hint">
          <button className="docsug-link" onClick={connectGoogle}>
            Connect Google
          </button>{' '}
          to create titled, pre-filled files linked to this note.
        </p>
      )}

      {docs.length > 0 && (
        <ul className="docsug-list">
          {docs.map((d) => (
            <li key={d.id} className={`docsug-item docsug-${d.type}`}>
              <a href={d.url} target="_blank" rel="noopener noreferrer">
                <span className="docsug-ico" aria-hidden>
                  {DOC_META[d.type].icon}
                </span>
                <span className="docsug-item-title">{d.title}</span>
                <span className="docsug-open" aria-hidden>
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
