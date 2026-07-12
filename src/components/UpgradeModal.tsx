import type { BillingStatus } from '../services/api'
import { StarSixIcon } from '../ui/icons'

// A confirmation step shown when the user taps the locked Evolve AI tier, so they
// choose the paid plan deliberately instead of being dropped straight onto
// Stripe. Two paths: continue to payment, or stay on the free Local ML tier.
export function UpgradeModal({
  kind,
  pricing,
  busy,
  onConfirm,
  onStayFree,
}: {
  kind: 'activate' | 'topup'
  pricing?: BillingStatus['pricing']
  busy: boolean
  onConfirm: () => void
  onStayFree: () => void
}) {
  const activation = ((pricing?.activationPence ?? 1000) / 100).toFixed(0)
  const included = ((pricing?.includedCreditPence ?? 500) / 100).toFixed(2)
  const topup = ((pricing?.topupPence ?? 400) / 100).toFixed(2)
  const topupCredit = (
    (pricing?.topupPence ?? 400) /
    (pricing?.tokenMarkup ?? 2) /
    100
  ).toFixed(2)
  const isTopup = kind === 'topup'

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
          {isTopup ? 'Top up your AI credit?' : 'Switch to Evolve AI?'}
        </h2>

        {isTopup ? (
          <p className="modal-lead">
            You’ve used up your included AI credit. Add more to keep using Evolve
            AI for suggestions, world knowledge and tool generation.
          </p>
        ) : (
          <p className="modal-lead">
            Evolve AI adds smarter suggestions, live world knowledge, and on-the-fly
            tool generation — on top of everything the free engine already does.
          </p>
        )}

        <ul className="modal-points">
          {isTopup ? (
            <li>
              <strong>£{topup}</strong> adds <strong>£{topupCredit}</strong> of AI
              usage
            </li>
          ) : (
            <>
              <li>
                <strong>£{activation}</strong> one-time — includes{' '}
                <strong>£{included}</strong> of AI usage
              </li>
              <li>Top up later only if you want more — never automatic</li>
            </>
          )}
          <li>Set a spending limit anytime so you’re always in control</li>
        </ul>

        <div className="modal-actions">
          <button className="modal-primary" onClick={onConfirm} disabled={busy}>
            {busy
              ? 'Opening secure checkout…'
              : isTopup
                ? `Continue — £${topup}`
                : `Continue — £${activation}`}
          </button>
          <button className="modal-secondary" onClick={onStayFree} disabled={busy}>
            Stay on the free tier
          </button>
        </div>

        <p className="modal-fineprint">
          Secure payment by Stripe. The free Local ML engine keeps working either
          way — it runs entirely on your device.
        </p>
      </div>
    </div>
  )
}
