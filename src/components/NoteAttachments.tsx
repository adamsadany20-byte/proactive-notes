import { useState } from 'react'
import type { Note } from '../types'
import { useStore } from '../store/appStore'

// Thumbnails for a note's attached images. Shows the vision result (what the
// image is) as a caption once analysis lands, an "analyzing" shimmer while it
// runs, and a tap-to-enlarge lightbox. Removing an image doesn't touch the note
// text the analysis may have added — the user can edit that as they like.
export function NoteAttachments({ note }: { note: Note }) {
  const { removeAttachment } = useStore()
  const attachments = note.attachments ?? []
  const [zoom, setZoom] = useState<string | null>(null)

  if (!attachments.length) return null

  return (
    <>
      <div className="attachments">
        {attachments.map((a) => (
          <figure key={a.id} className={`attachment ${a.status}`}>
            <button
              className="att-thumb"
              onClick={() => setZoom(a.dataUrl)}
              title="View image"
            >
              <img src={a.dataUrl} alt={a.description ?? 'Attached image'} />
              {a.status === 'analyzing' && (
                <span className="att-analyzing">
                  <span className="att-spinner" />
                  Reading…
                </span>
              )}
            </button>
            <button
              className="att-remove"
              title="Remove image"
              aria-label="Remove image"
              onClick={() => removeAttachment(note.id, a.id)}
            >
              ✕
            </button>
            <figcaption className="att-caption">
              {a.status === 'error'
                ? (a.error ?? "Couldn't read this image")
                : a.description
                  ? a.description
                  : a.status === 'analyzing'
                    ? 'Identifying…'
                    : 'Image'}
            </figcaption>
          </figure>
        ))}
      </div>

      {zoom && (
        <div className="att-lightbox" onClick={() => setZoom(null)} role="dialog">
          <img src={zoom} alt="Attached image" />
        </div>
      )}
    </>
  )
}
