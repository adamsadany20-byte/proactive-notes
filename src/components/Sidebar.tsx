import { useState } from 'react'
import { useStore } from '../store/appStore'
import { KIND_META } from '../ui/kindMeta'
import {
  startCheckout,
  setSpendCap,
  fetchBillingStatus,
  type AiBackend,
} from '../services/api'

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

  // Claude is paywalled only when billing is switched on AND this client can't
  // use it (not activated, or credit used up). In free mode (the default)
  // `locked` is always false, so the tier works normally.
  const locked = !!billing?.billingEnabled && !billing?.subscribed
  const outOfCredit = locked && !!billing?.active
  const credit = ((billing?.creditPence ?? 0) / 100).toFixed(2)
  const activationFee = ((billing?.pricing?.activationPence ?? 1000) / 100).toFixed(0)
  const includedCredit = (
    (billing?.pricing?.includedCreditPence ?? 500) / 100
  ).toFixed(2)

  // Per-tier availability + status line.
  const status = (id: AiBackend): string => {
    if (id === 'local') return 'Free — deterministic engine, no network'
    if (outOfCredit) return 'AI credit used up — top up to continue'
    if (locked)
      return `Unlock for £${activationFee} — includes £${includedCredit} of AI credit`
    if (cfg?.haikuConfigured === false) return 'No ANTHROPIC_API_KEY on server'
    return billing?.billingEnabled && billing?.active
      ? `Claude tools · £${credit} credit left`
      : 'Claude for suggestions & tools'
  }

  const unconfigured = (id: AiBackend): boolean =>
    id === 'haiku' && cfg?.haikuConfigured === false

  const onPick = async (id: AiBackend) => {
    // A locked Claude tier sends the user to checkout rather than switching.
    if (id === 'haiku' && locked) {
      const { url, error } = await startCheckout(outOfCredit ? 'topup' : 'activate')
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

// A user-set spending cap so nobody overspends on top-ups. Server-enforced at
// checkout; shown only when billing is switched on.
function SpendLimit() {
  const { state, setBilling } = useStore()
  const billing = state.billing
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!billing?.billingEnabled) return null

  const capPence = billing.capPence ?? 0
  const paidPence = billing.paidPence ?? 0
  const capPounds = (capPence / 100).toFixed(2)
  const paidPounds = (paidPence / 100).toFixed(2)

  const save = async (pounds: string) => {
    const pence = Math.max(0, Math.round(parseFloat(pounds || '0') * 100))
    setBusy(true)
    setMsg(null)
    const r = await setSpendCap(pence)
    setBusy(false)
    if (r.error) {
      setMsg(r.error)
      return
    }
    // Re-pull status so the displayed limit + spent totals are authoritative.
    const fresh = await fetchBillingStatus()
    if (fresh) setBilling(fresh)
    setEditing(false)
    setValue('')
  }

  return (
    <div className="spend-limit">
      <div className="sl-head">
        <span className="sl-title">Spending limit</span>
        {capPence > 0 && !editing && (
          <button
            className="sl-link"
            onClick={() => save('0')}
            disabled={busy}
            title="Remove your spending limit"
          >
            Remove
          </button>
        )}
      </div>

      {!editing ? (
        <button
          className="sl-current"
          onClick={() => {
            setValue(capPence > 0 ? (capPence / 100).toString() : '')
            setEditing(true)
          }}
        >
          {capPence > 0 ? (
            <>
              £{capPounds} max · £{paidPounds} spent
            </>
          ) : (
            <>No limit — tap to set one</>
          )}
        </button>
      ) : (
        <form
          className="sl-edit"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) save(value)
          }}
        >
          <span className="sl-prefix">£</span>
          <input
            className="sl-input"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="20"
            autoFocus
            aria-label="Maximum you want to spend, in pounds"
          />
          <button className="sl-save" type="submit" disabled={busy}>
            {busy ? '…' : 'Save'}
          </button>
          <button
            className="sl-cancel"
            type="button"
            onClick={() => {
              setEditing(false)
              setMsg(null)
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {msg && <p className="sl-msg">{msg}</p>}
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
        <SpendLimit />
        <p>
          Notes evolve as you type. The local engine handles everything; Claude
          is only consulted for richer suggestions and tool generation.
        </p>
      </div>
    </div>
  )
}
