import { Clock, Lock } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { dashboardBanner, formatPlanDate } from './subscriptionFormat.js'

// The builder's plan banner, as the server reports it (GET /subscriptions/me): the
// days left of the free trial, the upgrade prompt once it has ended without a paid
// plan, or the renew prompt once a paid plan has lapsed. Display only -- every
// gated endpoint is refused by the server itself.
export default function FreeAccessBanner({ status, onViewPlans }) {
  const { t } = useLanguage()
  const banner = dashboardBanner(status)
  if (!banner) return null
  if (banner.kind === 'trial') {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
        <Clock className="h-4 w-4 shrink-0 text-sky-700" aria-hidden="true" />
        <p className="min-w-[min(100%,14rem)] flex-1 text-sm font-bold text-sky-900">
          {t('subscription.freeAccess.daysLeft', { days: banner.days, date: formatPlanDate(status.free_access_until, activeLocale()) })}
        </p>
        <button type="button" onClick={onViewPlans} className="inline-flex h-8 items-center rounded-lg border border-sky-300 bg-white px-3 text-xs font-extrabold text-sky-800 hover:bg-sky-100">
          {t('subscription.banner.upgradeCta')}
        </button>
      </div>
    )
  }
  const planExpired = banner.kind === 'planExpired'
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      {/* A floor on the text width (here and above) lets the wrapping row put the
          button under the message on a phone, instead of squeezing the message
          to one word a line beside it. */}
      <div className="min-w-[min(100%,14rem)] flex-1">
        <p className="text-sm font-extrabold text-amber-900">{t(planExpired ? 'subscription.planExpired.title' : 'subscription.freeAccess.expiredTitle')}</p>
        <p className="mt-0.5 text-sm font-semibold text-amber-900">{t(planExpired ? 'subscription.planExpired.body' : 'subscription.locked.freeExpired')}</p>
      </div>
      <button type="button" onClick={onViewPlans} className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-xs font-extrabold text-white hover:bg-emerald-700">
        {t(planExpired ? 'subscription.banner.renewCta' : 'subscription.banner.upgradeCta')}
      </button>
    </div>
  )
}
