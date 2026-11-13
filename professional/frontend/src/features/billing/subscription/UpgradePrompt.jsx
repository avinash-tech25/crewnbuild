import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { formatRupees } from '../receiptFormat.js'
import { fetchSubscriptionPlans } from '../subscriptionApi.js'
import { savePendingPlan } from './pendingPlan.js'
import { formatPlanDate } from './subscriptionFormat.js'
import { offerById, offerPrice } from './subscriptionOffers.js'
import { offerLocationLine, upgradeOfferIds, upgradeWaitsForPlanEnd } from './planLimits.js'

/**
 * The offer buttons, priced from the server: choosing one remembers it and opens
 * Plan & billing. On a locations prompt each button also states that plan's own
 * location allowance from the server's catalogue (Pro "Up to 3 locations", Plus and
 * Premium "Unlimited locations").
 */
export function OfferChoices({ offerIds, showLocationLimits = false }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [catalogue, setCatalogue] = useState(null)

  useEffect(() => {
    if (offerIds.length === 0) return undefined
    let live = true
    fetchSubscriptionPlans().then((data) => { if (live) setCatalogue(data) }).catch(() => { if (live) setCatalogue({ plans: [] }) })
    return () => { live = false }
  }, [offerIds.length])

  const choose = (offer) => {
    savePendingPlan(offer.planCode, offer.durationCode)
    navigate('/contractor/subscription')
  }
  const priceLabel = (offer) => {
    const amount = offerPrice(catalogue, offer)
    if (amount === null) return t('subscription.price.notSet')
    return t(offer.durationCode === 'ANNUAL' ? 'subscription.limit.perYear' : 'subscription.limit.perMonth', { price: formatRupees(amount) })
  }
  if (offerIds.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {offerIds.map((id) => {
        const offer = offerById(id)
        return (
          <button key={id} type="button" onClick={() => choose(offer)}
            className={`inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-xs font-extrabold text-white transition ${offer.planCode === 'BUSINESS' ? 'bg-slate-900 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {t(`subscription.offer.${id}.name`)} · {catalogue ? priceLabel(offer) : '…'}
            {showLocationLimits && catalogue && offerLocationLine(catalogue, id)
              ? ` (${t(offerLocationLine(catalogue, id).key, offerLocationLine(catalogue, id).values)})` : ''}
          </button>
        )
      })}
    </div>
  )
}

// Shown only when a limit is reached (locations, leads in one location) or HD is
// asked for without it. Choosing an offer only REMEMBERS it (pendingPlan) and opens
// Plan & billing, where the builder pays for exactly that plan and period; the
// account and its Builder role are never changed here, and nothing activates
// before the server has verified the payment.
export default function UpgradePrompt({ kind, planCode = 'FREE', limit = null, pincode = '', status = null, compact = false }) {
  const { t } = useLanguage()
  const offerIds = upgradeOfferIds(kind, planCode)

  const message = kind === 'locations'
    ? t(`subscription.limit.reached.locations.${planCode === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'FREE'}`, { limit })
    : kind === 'leads'
      ? t('subscription.limit.reached.leads', { limit, pincode })
      : t('subscription.limit.reached.hd')

  const waits = offerIds.some((id) => upgradeWaitsForPlanEnd(status, offerById(id)?.planCode))

  return (
    <div role="status" className={`rounded-xl border border-amber-200 bg-amber-50/80 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-500 text-white" aria-hidden="true"><Lock className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-950">{message}</p>
          {waits && status?.coverage_end && (
            <p className="mt-1 text-xs font-semibold text-amber-900">{t('subscription.limit.afterCurrent', { date: formatPlanDate(status.coverage_end, activeLocale()) })}</p>
          )}
          <OfferChoices offerIds={offerIds} showLocationLimits={kind === 'locations'} />
        </div>
      </div>
    </div>
  )
}
