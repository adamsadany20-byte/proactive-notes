import type { BillingStatus } from '../services/api'
import { StarSixIcon } from '../ui/icons'

// A confirmation step shown when the user taps a locked paid tier, so they
// choose the plan deliberately instead of being dropped straight onto Stripe.
// Two paths: continue to the monthly subscription, or stay on the free tier.
export function UpgradeModal({
  plan,
  pricing,
  busy,
  onConfirm,
  onStayFree,
}: {
  plan: 'classifier' | 'evolve'
  pricing?: BillingStatus['pricing']
  busy: boolean
  onConfirm: () => void
  onStayFree: () => void
}) {
  // Decide the precision on the RESOLVED value so sub-pound amounts (a 50p
  // included allowance) render "£0.50" instead of rounding up to "£1".
  const gbp = (pence: number | undefined, fallback: number) => {
    const v = pence ?? fallback
    return `£${(v / 100).toFixed(v % 100 ? 2 : 0)}`
  }
  const markup = pricing?.overageMarkup ?? 2
  const isEvolve = plan === 'evolve'

  const price = isEvolve
    ? gbp(pricing?.evolvePricePence, 600)
    : gbp(pricing?.classifierPricePence, 100)
  const classIncl = gbp(
    isEvolve ? pricing?.evolveClassifierIncludedPence : pricing?.classifierIncludedPence,
    50,
  )
  const aiIncl = gbp(pricing?.evolveAiIncludedPence, 250)

  return (
    <div
      className="modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
      onClick={onStayFree}
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-emblem" aria-hidden>
          <StarSixIcon />
        </div>
        <h2 className="modal-title" id="upgrade-title">
          {isEvolve ? 'Subscribe to Evolve AI?' : 'Subscribe to Classification?'}
        </h2>

        {isEvolve ? (
          <p className="modal-lead">
            Everything Evolve does: cloud classification when the local engine is
            unsure, plus smarter suggestions, live world knowledge, and on-the-fly
            tool generation — billed monthly.
          </p>
        ) : (
          <p className="modal-lead">
            When the on-device classifier isn’t sure, Claude steps in to label the
            note accurately. Just classification — nothing else changes.
          </p>
        )}

        <ul className="modal-points">
          {isEvolve ? (
            <>
              <li>
                <strong>{price}/month</strong> — includes <strong>{aiIncl}</strong> of
                coding &amp; world knowledge and <strong>{classIncl}</strong> of
                classifier usage
              </li>
              <li>
                Each pool is metered separately; beyond it, £{markup} per £1 of usage
              </li>
            </>
          ) : (
            <>
              <li>
                <strong>{price}/month</strong> — includes <strong>{classIncl}</strong>{' '}
                of classifier usage
              </li>
              <li>Beyond that, £{markup} per £1 of usage — only if you go over</li>
            </>
          )}
          <li>Cancel anytime — the free Local ML engine keeps working</li>
        </ul>

        <div className="modal-actions">
          <button className="modal-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Opening secure checkout…' : `Subscribe — ${price}/mo`}
          </button>
          <button className="modal-secondary" onClick={onStayFree} disabled={busy}>
            Stay on the free tier
          </button>
        </div>

        <p className="modal-fineprint">
          Secure recurring payment by Stripe. The free Local ML engine runs entirely
          on your device and keeps working either way.
        </p>
      </div>
    </div>
  )
}
