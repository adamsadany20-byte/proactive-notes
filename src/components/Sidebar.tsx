import { useStore } from '../store/appStore'
import { KIND_META } from '../ui/kindMeta'
import { startCheckout, type AiBackend } from '../services/api'

function preview(text: string): string {
  const first = text.trim().split('\n')[0]
  return first || 'New note'
}

const TIERS: { id: AiBackend; label: string; short: string }[] = [
  { id: 'local', label: 'Local ML', short: 'ML' },
  { id: 'haiku', label: 'Claude', short: 'C' },
]

function AiTierSelector() {
  const { state, setBackend } = useStore()
  const active = state.settings.aiBackend
  const cfg = state.config
  const billing = state.billing

  // Claude is paywalled only when billing is switched on AND this client isn't
  // subscribed. In free mode (the default) `locked` is always false, so the
  // tier works normally and you can keep using everything.
  const locked = !!billing?.billingEnabled && !billing?.subscribed

  // Per-tier availability + status line.
  const status = (id: AiBackend): string => {
    if (id === 'local') return 'Free — deterministic engine, no network'
    if (locked) return 'Subscribe to unlock Claude tools'
    return cfg?.haikuConfigured === false
      ? 'No ANTHROPIC_API_KEY on server'
      : 'Claude for suggestions & tools'
  }

  const unconfigured = (id: AiBackend): boolean =>
    id === 'haiku' && cfg?.haikuConfigured === false

  const onPick = async (id: AiBackend) => {
    // A locked Claude tier sends the user to checkout rather than switching.
    if (id === 'haiku' && locked) {
      const { url, error } = await startCheckout()
      if (url) window.location.href = url
      else if (error) alert(error)
      return
    }
    setBackend(id)
  }

  return (
    <div className="ai-toggle">
      <strong className="ai-tier-label">AI tier</strong>
      <div className="tier-seg" role="radiogroup" aria-label="AI tier">
        {TIERS.map((t) => (
          <button
            key={t.id}
            className={`tier-opt ${active === t.id ? 'on' : ''}`}
            role="radio"
            aria-checked={active === t.id}
            title={status(t.id)}
            onClick={() => onPick(t.id)}
          >
            {t.label}
            {t.id === 'haiku' && locked && <span className="tier-lock"> 🔒</span>}
            {unconfigured(t.id) && <span className="tier-warn"> ·!</span>}
          </button>
        ))}
      </div>
      <span className="ai-toggle-text">{status(active)}</span>
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
            <span className="brand-tag">Notes that think ahead</span>
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
                  <span className="ni-draft">Draft</span>
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
        <p>
          Notes evolve as you type. The local engine handles everything; Claude
          is only consulted for richer suggestions and tool generation.
        </p>
      </div>
    </div>
  )
}
