import { useEffect, useState } from 'react'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchBuilderBadge } from '../subscriptionApi.js'

// The mark of an ACTIVE paid builder plan: a restrained green PRO (or PLUS) badge
// for Pro (or Plus), a distinct PREMIUM shield for Premium. `tier` always comes from
// the server (GET /subscriptions/me or /subscriptions/badges); nothing here
// decides it, and an absent tier renders nothing.
export default function TierBadge({ tier, size = 'sm', title = '' }) {
  const { t } = useLanguage()
  if (tier !== 'PRO' && tier !== 'PLUS' && tier !== 'PREMIUM') return null
  const label = t(`subscription.badge.${tier}`)
  // PLUS has no tooltip text of its own; its label stands in.
  const tooltip = title || (tier === 'PLUS' ? label : t(`subscription.badge.${tier}.title`))
  const sizing = size === 'md' ? 'h-7 gap-1.5 px-2.5 text-[11px]' : 'h-5 gap-1 px-1.5 text-[10px]'
  const icon = size === 'md' ? 'h-4 w-4' : 'h-3 w-3'
  // PLUS wears the same green pill as PRO (as on the plan cards).
  return tier !== 'PREMIUM' ? (
    <span title={tooltip} aria-label={tooltip} className={`inline-flex shrink-0 items-center rounded-full bg-emerald-600 font-extrabold uppercase tracking-wide text-white ${sizing}`}>
      <BadgeCheck className={icon} aria-hidden="true" />{label}
    </span>
  ) : (
    <span title={tooltip} aria-label={tooltip} className={`inline-flex shrink-0 items-center rounded-md border border-amber-300 bg-slate-900 font-extrabold uppercase tracking-wide text-amber-300 ${sizing}`}>
      <ShieldCheck className={icon} aria-hidden="true" />{label}
    </span>
  )
}

/** Another builder's mark, looked up on the server (batched across a page). */
export function BuilderTierBadge({ builderId, size = 'sm' }) {
  const [tier, setTier] = useState(null)
  useEffect(() => {
    let live = true
    if (!builderId) return undefined
    fetchBuilderBadge(String(builderId)).then((value) => { if (live) setTier(value) }).catch(() => { if (live) setTier(null) })
    return () => { live = false }
  }, [builderId])
  return <TierBadge tier={tier} size={size} />
}
