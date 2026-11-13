import { BadgeCheck, CalendarDays, Check, FlaskConical, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatRupees } from '../receiptFormat.js'
import { planAction } from './subscriptionFormat.js'
import { CARD_BADGES, OFFERS, annualSaving, offerCardLines, offerPrice, planCardLines } from './subscriptionOffers.js'

// Four independent cards: Free, Pro (Monthly), Plus (Premium tier, Monthly) and
// Premium (Premium tier, Annual). Each paid card is ONE purchasable option with its
// own price, access period and button. Every card lists exactly its locations,
// leads per location and camera quality, from the server's plan
// (/subscriptions/plans); the amount charged is decided by the server when the
// order is created.
const CARD_STYLE = {
  FREE: { card: 'border-slate-200', bar: 'bg-slate-200', check: 'text-slate-400' },
  PRO_MONTHLY: { card: 'border-emerald-300 ring-1 ring-emerald-100', bar: 'bg-emerald-500', check: 'text-emerald-600' },
  PREMIUM_MONTHLY: { card: 'border-slate-300 ring-1 ring-amber-100', bar: 'bg-gradient-to-r from-slate-900 via-slate-700 to-amber-400', check: 'text-slate-900' },
  PREMIUM_ANNUAL: { card: 'border-slate-300 ring-1 ring-amber-100', bar: 'bg-gradient-to-r from-slate-900 via-slate-700 to-amber-400', check: 'text-slate-900' },
}

function SectionLabel({ children }) {
  return <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{children}</p>
}

function Mark({ badge }) {
  const { t } = useLanguage()
  if (badge === 'PREMIUM') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-slate-900 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-300">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />{t('subscription.badge.PREMIUM')}
      </span>
    )
  }
  if (badge === 'PRO') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
        <BadgeCheck className="h-3 w-3" aria-hidden="true" />{t('subscription.badge.PRO')}
      </span>
    )
  }
  if (badge === 'PLUS') {
    // The same pill as PRO (Plus is a paid plan, not Premium's shield).
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
        <BadgeCheck className="h-3 w-3" aria-hidden="true" />{t('subscription.badge.PLUS')}
      </span>
    )
  }
  return null
}

function Card({ styleKey, heading, price, includedLabel, features, action }) {
  const style = CARD_STYLE[styleKey]
  return (
    <article className={`relative flex flex-col gap-5 overflow-hidden rounded-2xl border bg-white p-6 shadow-sm md:row-span-4 md:grid md:grid-rows-subgrid md:gap-y-5 ${style.card}`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${style.bar}`} aria-hidden="true" />
      {/* 1 heading */}<div>{heading}</div>
      {/* 2 price and access period */}<div>{price}</div>
      {/* 3 what is included */}
      <div>
        <SectionLabel>{includedLabel}</SectionLabel>
        <ul className="mt-2 grid gap-2 text-sm">
          {features.map(({ key, text, strong }) => (
            <li key={key} className={`flex items-start gap-2 ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
              <Check className={`mt-0.5 h-4 w-4 shrink-0 ${style.check}`} aria-hidden="true" />{text}
            </li>
          ))}
        </ul>
      </div>
      {/* 4 one action, aligned at the bottom of every card */}<div className="mt-auto w-full md:self-end">{action}</div>
    </article>
  )
}

export default function PlanCards({ catalogue, status = null, renderAction, renderFreeAction }) {
  const { t } = useLanguage()
  const testMode = Boolean(catalogue?.test_mode)
  const saving = annualSaving(catalogue)
  const current = (offer) => status && ['ACTIVE', 'GRACE'].includes(status.status)
    && status.plan_code === offer.planCode && status.current_period?.duration_code === offer.durationCode

  const freeCard = (
    <Card
      key="FREE"
      styleKey="FREE"
      heading={<h3 className="text-lg font-extrabold text-slate-950">{t('subscription.plan.FREE')}</h3>}
      price={(
        <>
          <p className="text-3xl font-extrabold leading-none tracking-tight text-slate-950">{formatRupees(0)}</p>
          <p className="mt-2 text-xs font-bold text-slate-500">{t('subscription.price.noBilling')}</p>
        </>
      )}
      includedLabel={t('subscription.inherits.FREE')}
      features={planCardLines(catalogue, 'FREE').map(({ key, values }) => ({ key, text: t(key, values) }))}
      action={renderFreeAction ? renderFreeAction() : null}
    />
  )

  const offerCards = OFFERS.map((offer) => {
    const price = offerPrice(catalogue, offer)
    const action = planAction(offer.planCode, status, price)
    return (
      <Card
        key={offer.id}
        styleKey={offer.id}
        heading={(
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-extrabold text-slate-950">{t(`subscription.offer.${offer.id}.name`)}</h3>
            <Mark badge={CARD_BADGES[offer.id]} />
            {current(offer) && (
              <span className="ms-auto rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('subscription.cta.current')}</span>
            )}
          </div>
        )}
        price={price ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-3xl font-extrabold leading-none tracking-tight text-slate-950">{formatRupees(price)}</p>
              {testMode && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-amber-800">
                  <FlaskConical className="h-3 w-3" aria-hidden="true" />{t('subscription.price.testBadge')}
                </span>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-600">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />{t(`subscription.offer.${offer.id}.access`)}
            </p>
            {offer.id === 'PREMIUM_ANNUAL' && saving && (
              <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                {t('subscription.offer.annualSaving', { amount: formatRupees(saving.saving), full: formatRupees(saving.full) })}
              </p>
            )}
          </>
        ) : (
          <p className="text-lg font-extrabold text-slate-400">{t('subscription.price.notSet')}</p>
        )}
        includedLabel={t('subscription.compare.included')}
        features={offerCardLines(catalogue, offer).map(({ key, values }) => ({ key, text: t(key, values) }))}
        action={renderAction ? renderAction(offer, action, price) : null}
      />
    )
  })

  return (
    // md+: every card is a 4-row subgrid, so headings, prices, limit
    // lists and buttons line up across the cards in a row (two per row
    // on tablets, all four on wide screens).
    <div className="grid gap-5 md:grid-cols-2 md:gap-x-5 md:gap-y-5 xl:grid-cols-4">
      {freeCard}
      {offerCards}
    </div>
  )
}
