import { useEffect, useState } from 'react'
import { BellRing, Check, House, ShieldCheck, Timer, X } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { CardChip, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import { formatDistance } from '../../../shared/constants/tracking.js'
import { formatRupees } from '../../../shared/utils/money.js'
import { formatCountdown, hasEstimate } from '../offerFormat.js'

/**
 * One job request, before it has been accepted.
 *
 * It says what the work is: the service booked, the trade, which part of the
 * property, how far away it is in a straight line, and the price it was booked
 * at. That is everything the offer the backend sends carries.
 *
 * There is no customer name, no phone number, no address and no map -- the offer
 * has none of those. A technician takes the job or passes on it; they learn where
 * it is, and who it is for, only once they have committed to going.
 *
 * The price is the booking's quoted price, labelled as such. Beside it, when the
 * server sends one, is the ESTIMATED earning: that price less the commission
 * configured now, worked out by the server with the same split completion uses.
 * It is display only -- the earning itself is recorded at completion, at the
 * rate then -- so it is labelled an estimate and never computed here.
 *
 * There is no ETA: before acceptance Partner has only a straight-line distance,
 * and a travel time guessed from that would be invented.
 *
 * Decline answers the existing decline endpoint (`onAnswer(id, false)`). Letting
 * the request lapse still works exactly as before and has the same effect: either
 * way it moves on to the next technician.
 */

function parseUtc(value) {
  if (!value) return null
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
}

/** Seconds left to answer. The server expires it on its own clock regardless. */
function useSecondsLeft(expiresAt) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  const expiry = parseUtc(expiresAt)
  return expiry ? Math.max(0, Math.ceil((expiry.getTime() - now) / 1000)) : null
}

export default function OfferCard({ offer, busy, onAnswer }) {
  const secondsLeft = useSecondsLeft(offer.expires_at)
  const type = technicianTypeByCode(offer.technician_type)
  const tradeLabel = type?.label ?? offer.technician_type
  const urgent = secondsLeft !== null && secondsLeft <= 10
  const hasPrice = offer.quoted_amount !== null && offer.quoted_amount !== undefined
  const estimate = hasEstimate(offer)
  const hasDistance = offer.distance_meters !== null && offer.distance_meters !== undefined

  // The time left to answer is this request's status: amber, red in the last ten seconds.
  const countdown = secondsLeft !== null && (
    <span
      data-card-part="status"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 font-display text-sm font-extrabold tabular-nums ${
        urgent ? 'border-rose-700 bg-rose-700 text-white' : 'border-amber-200 bg-amber-50 text-amber-800'
      }`}
      role="timer"
      aria-label={`${secondsLeft} seconds left to answer`}
      data-testid="offer-countdown"
    >
      <Timer className="h-4 w-4" aria-hidden="true" /> {formatCountdown(secondsLeft)}
    </span>
  )

  return (
    <ListCard
      testId="offer-card"
      highlighted
      title={offer.service_name || `${tradeLabel} job`}
      subtitle={(
        <span className="inline-flex items-center gap-1.5 font-bold text-oc-deep">
          <BellRing className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" /> New job request
        </span>
      )}
      label={offer.service_name || `${tradeLabel} job`}
      status={countdown}
      rows={[
        hasPrice && { key: 'price', label: 'Service price', value: formatRupees(offer.quoted_amount) },
        estimate && {
          key: 'estimate',
          label: 'Estimated earning',
          title: formatRupees(offer.estimated_net_amount),
          value: <span data-testid="offer-estimate">{formatRupees(offer.estimated_net_amount)}</span>,
        },
        hasDistance && { key: 'distance', label: 'Distance', value: `≈ ${formatDistance(offer.distance_meters)}` },
      ]}
      chips={[
        <CardChip key="trade" tone="green">{tradeLabel}</CardChip>,
        offer.work_area && <CardChip key="area" icon={House}>{offer.work_area}</CardChip>,
      ]}
      secondary={(
        <button
          type="button"
          className={cardButtonClass('danger')}
          disabled={Boolean(busy)}
          onClick={() => onAnswer(offer.booking_id, false)}
        >
          <X className="h-4 w-4" /> Decline
        </button>
      )}
      primary={(
        <button
          type="button"
          className={cardButtonClass('primary')}
          disabled={Boolean(busy)}
          onClick={() => onAnswer(offer.booking_id, true)}
        >
          {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Accept Job
        </button>
      )}
    >
      <p className="flex items-start gap-1.5 rounded-xl bg-oc-sunken px-3 py-2 text-xs text-oc-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-oc-green" />
        <span>
          The distance is a straight line from where you are.
          {estimate && ' The estimated earning is the service price less the current platform commission; what you earn is recorded when you complete the job.'}
          {' '}The customer's name, address and phone number are shared once you accept. If you do not answer, the
          request passes to another technician on its own.
        </span>
      </p>
    </ListCard>
  )
}
