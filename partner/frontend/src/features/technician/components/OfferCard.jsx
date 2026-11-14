import { useEffect, useState } from 'react'
import { BellRing, Check, House, IndianRupee, Navigation, ShieldCheck, Timer, Wallet, X } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
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

function Fact({ icon: Icon, label, value, tone = 'bg-oc-sunken text-oc-green', testid }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-oc-line bg-white px-3 py-2" data-testid={testid}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-oc-muted">{label}</span>
        <span className="block truncate font-display text-base font-extrabold text-oc-ink">{value}</span>
      </span>
    </div>
  )
}

export default function OfferCard({ offer, busy, onAnswer }) {
  const secondsLeft = useSecondsLeft(offer.expires_at)
  const type = technicianTypeByCode(offer.technician_type)
  const tradeLabel = type?.label ?? offer.technician_type
  const urgent = secondsLeft !== null && secondsLeft <= 10
  const hasPrice = offer.quoted_amount !== null && offer.quoted_amount !== undefined
  const estimate = hasEstimate(offer)

  return (
    <article className="card overflow-hidden border-oc-green/40 ring-2 ring-oc-green/20" data-testid="offer-card">
      <div className="flex items-center gap-2 bg-oc-mint px-4 py-2.5 text-oc-deep sm:px-5">
        <BellRing className="h-4 w-4 shrink-0 animate-pulse" />
        <span className="min-w-0 flex-1 truncate font-display text-sm font-extrabold uppercase tracking-wide">New job request</span>
        {secondsLeft !== null && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 font-display text-base font-extrabold tabular-nums ${
              urgent ? 'bg-red-600 text-white' : 'bg-oc-amber text-oc-deep'
            }`}
            role="timer"
            aria-label={`${secondsLeft} seconds left to answer`}
            data-testid="offer-countdown"
          >
            <Timer className="h-4 w-4" /> {formatCountdown(secondsLeft)}
          </span>
        )}
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 gap-4">
          {type?.heroImage && <img src={type.heroImage} alt="" className="hidden h-20 w-auto shrink-0 sm:block" />}
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h3 className="font-display text-lg font-extrabold leading-snug text-oc-ink">
                {offer.service_name || `${tradeLabel} job`}
              </h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-oc-mint px-2.5 py-0.5 text-xs font-extrabold text-oc-green">{tradeLabel}</span>
                {offer.work_area && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-oc-sunken px-2.5 py-0.5 text-xs font-bold text-oc-ink">
                    <House className="h-3 w-3" /> {offer.work_area}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 xl:grid-cols-3">
              {hasPrice && (
                <Fact icon={IndianRupee} label="Service price" value={formatRupees(offer.quoted_amount)} />
              )}
              {estimate && (
                <Fact icon={Wallet} label="Estimated earning" value={formatRupees(offer.estimated_net_amount)} tone="bg-oc-mint text-oc-green" testid="offer-estimate" />
              )}
              {offer.distance_meters !== null && offer.distance_meters !== undefined && (
                <Fact icon={Navigation} label="Distance" value={`≈ ${formatDistance(offer.distance_meters)}`} tone="bg-red-50 text-red-600" />
              )}
            </div>

            <p className="flex items-start gap-1.5 rounded-xl bg-oc-sunken px-3 py-2 text-xs text-oc-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-oc-green" />
              <span>
                The distance is a straight line from where you are.
                {estimate && ' The estimated earning is the service price less the current platform commission; what you earn is recorded when you complete the job.'}
                {' '}The customer's name, address and phone number are shared once you accept. If you do not answer, the
                request passes to another technician on its own.
              </span>
            </p>
          </div>
        </div>

        {/* Side by side with Decline on the left, as before; on a wide screen the
            two stack beside the details, Accept on top. */}
        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-col-reverse">
          <button
            type="button"
            className="btn-ghost px-6 py-3"
            disabled={Boolean(busy)}
            onClick={() => onAnswer(offer.booking_id, false)}
          >
            <X className="h-4 w-4" /> Decline
          </button>
          <button
            type="button"
            className="btn-primary px-8 py-3"
            disabled={Boolean(busy)}
            onClick={() => onAnswer(offer.booking_id, true)}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Accept Job
          </button>
        </div>
      </div>
    </article>
  )
}
