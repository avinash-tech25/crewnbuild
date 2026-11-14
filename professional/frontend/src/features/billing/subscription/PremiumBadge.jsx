import TierBadge from './TierBadge.jsx'
import { activeBadge } from './subscriptionOffers.js'

// The signed-in builder's own mark in the dashboard header: PRO (Pro), PLUS (Plus)
// or the PREMIUM shield (Premium). Rendered only from the server's verified status:
// a selected plan, a pending payment, an expired plan or no plan renders nothing.
export default function PremiumBadge({ status, onClick = null }) {
  const tier = activeBadge(status)
  if (!tier) return null
  const badge = <TierBadge tier={tier} size="md" />
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-full transition hover:opacity-90">{badge}</button>
  ) : badge
}
