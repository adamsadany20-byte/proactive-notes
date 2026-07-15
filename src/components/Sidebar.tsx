import { useState } from 'react'
import { useStore } from '../store/appStore'
import { KIND_META } from '../ui/kindMeta'
import { PushControls } from './PushControls'
import { ThemeToggle } from './ThemeToggle'
import { UpgradeModal } from './UpgradeModal'
import { SidebarStreak } from './SidebarStreak'
import { isSupabaseEnabled, supabase } from '../services/supabase'
import {
  ChevronIcon,
  PlusIcon,
  SearchIcon,
  TuneIcon,
  XIcon,
} from '../ui/icons'
import {
  startSubscription,
  setSpendCap,
  fetchBillingStatus,
} from '../services/api'
import type { Tier } from '../store/appStore'

function preview(text: string): string {
  const first = text.trim().split('\n')[0]
  return first || 'New note'
}

const TIERS: { id: Tier; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'classifier', label: 'Classification' },
  { id: 'evolve', label: 'Evolve AI' },
]

const gbp = (pence: number | undefined, fallback: number): string =>
  `£${((pence ?? fallback) / 100).toFixed(pence != null && pence % 100 ? 2 : 0)}`

function AiTierSelector() {
  const { state, setTier } = useStore()
  const active = state.settings.tier
  const cfg = state.config
  const billing = state.billing
  const p = billing?.pricing

  // With billing on, a paid tier is locked until the user SUBSCRIBES to it.
  // Lock state keys off the plan, not off hasClassifier/hasEvolve — those go
  // false when a subscriber hits their spend limit, and a capped subscriber
  // should see "limit reached", not a padlock offering to sell them the plan
  // they already own. Free mode (the default) leaves everything unlocked.
  const billingOn = !!billing?.billingEnabled
  const plan = billing?.plan ?? 'none'
  const lockedFor = (id: Tier): boolean => {
    if (!billingOn) return false
    if (id === 'classifier') return plan === 'none'
    if (id === 'evolve') return plan !== 'evolve'
    return false
  }
  // Subscribed but stopped at their own beyond-plan spending limit.
  const capped =
    billingOn &&
    plan !== 'none' &&
    (billing?.capPence ?? 0) > 0 &&
    (billing?.overagePence ?? 0) >= (billing?.capPence ?? 0)
  const unconfigured = (id: Tier): boolean =>
    id !== 'free' && cfg?.haikuConfigured === false

  const classPrice = gbp(p?.classifierPricePence, 200)
  const classIncl = gbp(p?.classifierIncludedPence, 100)
  const evPrice = gbp(p?.evolvePricePence, 1200)
  const evAiIncl = gbp(p?.evolveAiIncludedPence, 500)
  const evClIncl = gbp(p?.evolveClassifierIncludedPence, 100)

  const status = (id: Tier): string => {
    if (id === 'free') return 'Free — deterministic engine, no network'
    if (unconfigured(id)) return 'AI not configured on server'
    if (capped && !lockedFor(id))
      return 'Spending limit reached — raise it below to continue'
    if (id === 'classifier')
      return lockedFor(id)
        ? `${classPrice}/mo — includes ${classIncl} of classifier usage`
        : 'Cloud classification when the local engine is unsure'
    return lockedFor(id)
      ? `${evPrice}/mo — ${evAiIncl} tools + ${evClIncl} classifier included`
      : 'Everything: classification + suggestions & tools'
  }

  // Tapping a locked paid tier opens a confirmation modal (chosen plan) rather
  // than jumping straight to Stripe.
  const [upgradePlan, setUpgradePlan] = useState<'classifier' | 'evolve' | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)

  const onPick = (id: Tier) => {
    if (id !== 'free' && lockedFor(id)) {
      setUpgradePlan(id)
      return
    }
    setTier(id)
  }

  const goToCheckout = async () => {
    if (!upgradePlan) return
    setCheckoutBusy(true)
    const { url, error } = await startSubscription(upgradePlan)
    if (url) {
      window.location.href = url
      return
    }
    setCheckoutBusy(false)
    setUpgradePlan(null)
    if (error) alert(error)
  }

  // Live usage readout for an active paid plan (per-pool, this cycle). All pool
  // figures arrive in pence.
  const pools = billing?.pools
  const poolStr = (pool: { usedPence: number; includedPence: number }) =>
    `£${(pool.usedPence / 100).toFixed(2)} / £${(pool.includedPence / 100).toFixed(0)}`
  const usageLine =
    billingOn && billing?.plan && billing.plan !== 'none' && pools
      ? billing.plan === 'evolve'
        ? `This cycle · tools ${poolStr(pools.ai)} · classifier ${poolStr(pools.classifier)}`
        : `This cycle · classifier ${poolStr(pools.classifier)}`
      : null

  return (
    <div className="ai-toggle">
      <strong className="ai-tier-label">AI tier</strong>
      <div className="tier-seg tier-seg-3" role="radiogroup" aria-label="AI tier">
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
            {lockedFor(t.id) && <span className="tier-lock"> 🔒</span>}
            {unconfigured(t.id) && <span className="tier-warn"> ·!</span>}
          </button>
        ))}
      </div>
      <span className="ai-toggle-text">{status(active)}</span>
      {usageLine && <span className="ai-usage-text">{usageLine}</span>}

      {upgradePlan && (
        <UpgradeModal
          plan={upgradePlan}
          pricing={p}
          busy={checkoutBusy}
          onConfirm={goToCheckout}
          onStayFree={() => {
            setUpgradePlan(null)
            setTier('free')
          }}
        />
      )}
    </div>
  )
}

// A user-set cap on OVERAGE — usage charged beyond the plan's included pools.
// The monthly plan fee itself never counts toward it. Server-enforced on every
// paid call (not just at checkout), so usage stops at the limit rather than
// billing past it. Shown only once a plan is live — before that there's nothing
// to cap.
function SpendLimit() {
  const { state, setBilling } = useStore()
  const billing = state.billing
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!billing?.billingEnabled || !billing?.active) return null

  const capPence = billing.capPence ?? 0
  // What beyond-plan usage has cost this cycle — the figure the cap limits.
  const overagePence = billing.overagePence ?? 0
  const capPounds = (capPence / 100).toFixed(2)
  const overagePounds = (overagePence / 100).toFixed(2)

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
        <span className="sl-title">Extra spending limit</span>
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
          title="A cap on usage charged beyond your plan's included allowance — your monthly plan fee doesn't count toward it"
        >
          {capPence > 0 ? (
            <>
              £{capPounds} beyond your plan · £{overagePounds} used
            </>
          ) : (
            <>No limit on beyond-plan usage — tap to set one</>
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

      {editing && (
        <p className="sl-hint">
          A cap on usage charged <strong>beyond</strong> your plan’s included
          allowance. Your monthly plan fee doesn’t count toward it — set £0 for no
          limit.
        </p>
      )}

      {msg && <p className="sl-msg">{msg}</p>}
    </div>
  )
}

export function Sidebar({ onOpenCalendar }: { onOpenCalendar?: () => void }) {
  const { state, select, createNote, remove } = useStore()

  // The footer tools (AI tier, reminders, spend cap, sign-out) read as clutter
  // on a phone, so there they fold into one "Settings & tools" disclosure.
  // Desktop starts open — the sidebar has room and the controls stay glanceable.
  const [toolsOpen, setToolsOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 980,
  )

  // Live search over the note list — matches note text, its open-ended topic,
  // and its detected kind.
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const notes = q
    ? state.notes.filter(
        (n) =>
          n.text.toLowerCase().includes(q) ||
          (n.topic ?? '').toLowerCase().includes(q) ||
          (KIND_META[n.kind]?.label ?? '').toLowerCase().includes(q),
      )
    : state.notes

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
          <img src="/logo.svg" alt="Evolve" className="brand-logo" />
          <span className="brand-text">
            <span className="brand-name">Evolve</span>
            <span className="brand-tag">Notes that think ahead</span>
          </span>
        </div>
        <button className="icon-btn" title="New note" onClick={createNote}>
          <PlusIcon />
        </button>
      </div>

      <SidebarStreak onOpen={onOpenCalendar} />

      <div className="note-search">
        <SearchIcon className="ns-ico" />
        <input
          className="ns-input"
          type="search"
          value={query}
          placeholder="Search notes…"
          aria-label="Search notes"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            className="ns-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <XIcon />
          </button>
        )}
      </div>

      <div className="note-list">
        {notes.map((n) => {
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
                    {/* The note's open-ended topic reads as its category here;
                        the kind label is the fallback before a topic emerges. */}
                    {n.topic || meta.label}
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
                <XIcon />
              </button>
            </div>
          )
        })}
        {q && notes.length === 0 && (
          <div className="note-empty">No notes match “{query.trim()}”.</div>
        )}
      </div>

      <div className="side-foot">
        <button
          className="side-tools-toggle"
          onClick={() => setToolsOpen((o) => !o)}
          aria-expanded={toolsOpen}
        >
          <TuneIcon className="ico" />
          <span>Settings &amp; tools</span>
          <ChevronIcon className={`chev ${toolsOpen ? 'open' : ''}`} />
        </button>
        <div className={`side-tools ${toolsOpen ? 'open' : ''}`}>
          <div className="side-tools-inner">
            <ThemeToggle />
            <AiTierSelector />
            <PushControls />
            <SpendLimit />
            <p>
              Notes evolve as you type. The local engine handles everything;
              Evolve AI is only consulted for richer suggestions and tool
              generation.
            </p>
            {/* Mobile sign-out lives here (the desktop floating pill is hidden
                on phones via CSS). */}
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
    </div>
  )
}
