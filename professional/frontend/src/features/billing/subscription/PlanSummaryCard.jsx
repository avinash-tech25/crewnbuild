import { CalendarClock, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { currentTier } from './planComparison.js'
import { formatPlanDate, statusKey } from './subscriptionFormat.js'
import { offerNameKey } from './subscriptionOffers.js'

// The builder's plan at a glance on the dashboard home: a compact row with the tier
// in force, until when (the server's dates, GET /subscriptions/me, already loaded by
// the dashboard) and a link to Plan & billing. The plan's benefits and reports live
// on the Plan & billing page, not here.
export default function PlanSummaryCard({ subscription, onNavigate }) {
  const { t } = useLanguage()
  const { status, loading, error, refresh } = subscription || {}

  if (!status) {
    if (loading) {
      return <div className="my-4 h-12 animate-pulse rounded-xl border border-slate-200 bg-slate-100" aria-busy="true" aria-label={t('subscription.panel.loading')} />
    }
    if (error) {
      return (
        <div role="alert" className="my-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-sm font-bold text-rose-800">{t('subscription.panel.loadFailed')}</p>
          <button type="button" onClick={refresh} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 text-xs font-extrabold text-rose-800 hover:bg-rose-100">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('subscription.retry')}
          </button>
        </div>
      )
    }
    return null
  }
  // Plans are not sold in this region: nothing to show or offer.
  if (status.region_supported === false) return null

  const paid = currentTier(status) !== 'FREE'
  const date = (iso) => formatPlanDate(iso, activeLocale())
  const planName = paid ? t(offerNameKey(status.plan_code, status.current_period?.duration_code)) : t('subscription.plan.FREE')

  return (
    <section aria-labelledby="plan-summary-title" className="my-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{t('subscription.summary.title')}</span>
          <span id="plan-summary-title" className="font-extrabold text-slate-950">{planName}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
            <CalendarClock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {paid ? t('subscription.panel.validUntil', { date: date(status.coverage_end) }) : t(statusKey(status.status))}
          </span>
        </p>
        {status.status === 'GRACE' && <p className="mt-0.5 text-xs font-bold text-amber-600">{t('subscription.panel.graceUntil', { date: date(status.grace_until) })}</p>}
        {(status.queued_periods || []).map((period) => (
          <p key={period.id} className="mt-0.5 text-xs text-slate-500">{t('subscription.panel.renewalQueued', { date: date(period.period_start) })}</p>
        ))}
      </div>
      <button type="button" onClick={() => onNavigate?.('subscription')}
        className={`inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-xs font-extrabold transition ${paid ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50' : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}>
        {paid ? t('subscription.summary.managePlan') : t('subscription.summary.comparePlans')}
      </button>
    </section>
  )
}
