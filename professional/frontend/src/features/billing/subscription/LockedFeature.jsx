import { Lock } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { planNameKey } from './subscriptionFormat.js'
import { featureOfferIds } from './planLimits.js'
import { OfferChoices } from './UpgradePrompt.jsx'

// Shown in place of a premium feature the server refused. Never blocks anything
// else on the page; it only explains and offers the way to the plans.
export default function LockedFeature({ reason, onViewPlans, compact = false }) {
  const { t } = useLanguage()
  const requiredPlan = reason?.requiredPlan || 'PROFESSIONAL'
  const message = reason?.kind === 'expired'
    ? t('subscription.locked.expired')
    : reason?.kind === 'freeExpired'
      ? t('subscription.locked.freeExpired')
      : t('subscription.locked.required', { plan: t(planNameKey(requiredPlan)) })
  return (
    <div className={`rounded-xl border border-emerald-200 bg-emerald-50/70 ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-emerald-900">{t('subscription.locked.title')}</p>
          <p className="mt-1 text-sm font-semibold text-emerald-800">{message}</p>
          {/* A Pro feature: Pro and both Premium options; a Premium feature: Premium only. */}
          {reason?.kind !== 'expired' && <OfferChoices offerIds={featureOfferIds(requiredPlan)} />}
          {onViewPlans && (
            <button type="button" onClick={onViewPlans} className="mt-3 inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-xs font-extrabold text-white transition hover:bg-emerald-700">
              {reason?.kind === 'expired' ? t('subscription.cta.renew') : t('subscription.locked.cta')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
