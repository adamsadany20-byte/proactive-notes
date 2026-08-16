import { useStore } from '../store/appStore'

// This month's metered usage, shown in Settings. Deliberately shows REAL money —
// the actual token cost the account has run up against each pool's included
// allowance — so what you see here is what the invoice will say. Hidden in free
// mode (billing off) and for accounts with no plan, where nothing is metered.
export function UsageMeter() {
  const { state } = useStore()
  const b = state.billing

  if (!b?.billingEnabled) return null
  const plan = b.plan ?? 'none'
  if (plan === 'none' || !b.pools) return null

  const money = (p: number) => `£${(p / 100).toFixed(2)}`
  const rate = b.pricing?.overageMarkup ?? 1.5
  const overage = b.overagePence ?? 0
  const cap = b.capPence ?? 0

  const pools = [
    { key: 'ai', label: 'Tools & world knowledge', ...b.pools.ai },
    { key: 'classifier', label: 'Classification', ...b.pools.classifier },
  ].filter((p) => p.includedPence > 0)

  return (
    <div className="push-controls">
      <div className="pc-head">
        <span className="pc-title">✦ Usage this month</span>
        <span className="pc-badge on">
          {plan === 'evolve' ? 'Evolve AI' : 'Classification'}
        </span>
      </div>

      {pools.map((p) => {
        const pct = Math.min(100, (p.usedPence / p.includedPence) * 100)
        const over = p.usedPence > p.includedPence
        return (
          <div key={p.key} className="usage-row">
            <div className="usage-line">
              <span>{p.label}</span>
              <span className={over ? 'usage-over' : undefined}>
                {money(p.usedPence)} / {money(p.includedPence)}
              </span>
            </div>
            <div
              className="beta-meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={p.includedPence}
              aria-valuenow={Math.round(p.usedPence)}
              aria-label={`${p.label} usage`}
            >
              <div
                className={`beta-meter-fill${over ? ' is-out' : pct >= 75 ? ' is-low' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}

      {overage > 0 ? (
        <p className="pc-sub">
          You’ve gone <strong>{money(overage)}</strong> beyond what your plan
          includes. That’s added to your next invoice, itemised — usage beyond
          the allowance bills at {rate}× its real token cost.
          {cap > 0 && ` Your ${money(cap)} spend limit stops usage before it goes further.`}
        </p>
      ) : (
        <p className="pc-sub">
          All within your plan — nothing extra to pay. Beyond the included
          allowance, usage bills at {rate}× its real token cost, added to your
          next invoice.
        </p>
      )}
    </div>
  )
}
