import { useStore } from '../store/appStore'
import { KIND_META } from '../ui/kindMeta'
import type { AiBackend } from '../services/api'

function preview(text: string): string {
  const first = text.trim().split('\n')[0]
  return first || 'New note'
}

const TIERS: { id: AiBackend; label: string; short: string }[] = [
  { id: 'local', label: 'Local ML', short: 'ML' },
  { id: 'gemini', label: 'Gemini', short: 'G' },
  { id: 'haiku', label: 'Claude', short: 'H' },
  { id: 'groq', label: 'Groq', short: 'Gq' },
]

function AiTierSelector() {
  const { state, setBackend } = useStore()
  const active = state.settings.aiBackend
  const cfg = state.config

  // Per-tier availability + status line.
  const status = (id: AiBackend): string => {
    if (id === 'local') return 'Free — deterministic engine, no network'
    if (id === 'gemini')
      return cfg?.geminiConfigured === false
        ? 'No GOOGLE_GEMINI_API_KEY on server'
        : 'Google Gemini for suggestions & tools'
    if (id === 'groq')
      return cfg?.groqConfigured === false
        ? 'No GROQ_API_KEY on server'
        : 'Groq (Llama) for suggestions & tools'
    return cfg?.haikuConfigured === false
      ? 'No ANTHROPIC_API_KEY on server'
      : 'Claude Haiku for suggestions & tools'
  }

  const unconfigured = (id: AiBackend): boolean =>
    (id === 'gemini' && cfg?.geminiConfigured === false) ||
    (id === 'haiku' && cfg?.haikuConfigured === false) ||
    (id === 'groq' && cfg?.groqConfigured === false)

  return (
    <div className="ai-toggle">
      <strong style={{ display: 'block', marginBottom: 6 }}>AI tier</strong>
      <div className="tier-seg" role="radiogroup" aria-label="AI tier">
        {TIERS.map((t) => (
          <button
            key={t.id}
            className={`tier-opt ${active === t.id ? 'on' : ''}`}
            role="radio"
            aria-checked={active === t.id}
            title={status(t.id)}
            onClick={() => setBackend(t.id)}
          >
            {t.label}
            {unconfigured(t.id) && <span className="tier-warn"> ·!</span>}
          </button>
        ))}
      </div>
      <span className="ai-toggle-text" style={{ display: 'block', marginTop: 6 }}>
        {status(active)}
      </span>
    </div>
  )
}

export function Sidebar() {
  const { state, select, createNote, remove } = useStore()

  const handleDelete = (e: React.MouseEvent, id: string, text: string) => {
    e.stopPropagation()
    // Only confirm when there's real content to lose.
    if (text.trim() && !window.confirm('Delete this note and its workspace?'))
      return
    remove(id)
  }

  return (
    <div className="col col-side">
      <div className="side-head">
        <div className="brand">
          <span className="dot" />
          <span className="brand-text">
            <span className="brand-name">Evolve</span>
            <span className="brand-tag">Enhance your notes</span>
          </span>
        </div>
        <button className="icon-btn" title="New note" onClick={createNote}>
          +
        </button>
      </div>

      <div className="note-list">
        {state.notes.map((n) => {
          const meta = KIND_META[n.kind]
          const recognised = n.kind !== 'unknown' && n.confidence >= 0.4
          return (
            <div
              key={n.id}
              className={`note-item ${n.id === state.selectedId ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => select(n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') select(n.id)
              }}
            >
              <span className="ni-title">
                {n.text.trim() ? preview(n.text) : 'Untitled note'}
              </span>
              <span className="ni-sub">
                {recognised && meta.label ? (
                  <span
                    className="kind-chip"
                    style={{
                      background: meta.tintSoft,
                      color: meta.tintInk,
                    }}
                  >
                    {meta.label}
                  </span>
                ) : (
                  <span style={{ opacity: 0.6 }}>Draft</span>
                )}
                {n.segments.length > 0 && <span>· {n.segments.length} blocks</span>}
              </span>
              <button
                className="note-delete"
                title="Delete note"
                aria-label="Delete note"
                onClick={(e) => handleDelete(e, n.id, n.text)}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      <div className="side-foot">
        <AiTierSelector />
        <p style={{ marginTop: 12 }}>
          Notes evolve as you type. The local engine handles everything; a cloud
          tier (Gemini or Claude) is only consulted for richer suggestions and
          tool generation.
        </p>
      </div>
    </div>
  )
}
