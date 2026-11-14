import { CalendarDays, Check, FlaskConical } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatRupees } from '../receiptFormat.js'
import { Mark } from './PlanCards.jsx'
import { planAction } from './subscriptionFormat.js'
import { CARD_BADGES, OFFERS, annualSaving, offerCardLines, offerPrice, planCardLines } from './subscriptionOffers.js'

// The public plans section's cards (landing page #plans and the sign-up plan step):
// the same four options, prices, limit lines, marks and actions as PlanCards, laid out
// as a showcase. Display only: every price and entitlement is still the server's.
//
// From md up every card is a subgrid over the same four rows -- heading, price block,
// what is included, action -- so each part starts at the same height in every card and
// the buttons line up at the bottom. The price block reserves the savings line's space
// in every card, so Premium's saving never pushes its own rows down.

// The recommended plan: Plus.
export const RECOMMENDED_OFFER = 'PREMIUM_MONTHLY'

const SUFFIX_KEYS = { MONTHLY: 'subscription.limit.perMonth', ANNUAL: 'subscription.limit.perYear' }

const sameLine = (left, right) => Boolean(left && right && left.key === right.key
  && JSON.stringify(left.values || {}) === JSON.stringify(right.values || {}))

function ShowcaseCard({ id, recommended = false, gold = false, heading, price, includedLabel, lines, action, t }) {
  return (
    <article
      data-testid="plan-card"
      data-plan={id}
      data-recommended={recommended ? 'true' : undefined}
      aria-label={recommended ? `${heading.name} — ${t('subscription.plans.mostPopular')}` : heading.name}
      className={`relative flex flex-col gap-5 rounded-2xl bg-white p-6 transition duration-200 motion-safe:hover:-translate-y-1 motion-reduce:transition-none md:row-span-4 md:grid md:grid-rows-subgrid md:gap-y-5 ${
        recommended
          ? 'order-first border-2 border-oc-deep shadow-[0_24px_60px_-28px_rgba(8,62,43,0.55)] md:order-none'
          : 'border border-slate-200 shadow-sm hover:shadow-md'
      }`}
    >
      {/* Premium's thin gold line; Plus's "Most popular" label sits on its border. */}
      {gold && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-oc-amber" aria-hidden="true" />}
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-oc-deep px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white shadow-sm">
          {t('subscription.plans.mostPopular')}
        </span>
      )}
      {/* 1 name and mark */}
      <div className="flex min-h-[28px] flex-wrap items-center gap-2">
        <h3 className="text-lg font-extrabold text-slate-950">{heading.name}</h3>
        {heading.mark}
        {heading.extra}
      </div>
      {/* 2 price, billing line and the reserved savings line */}
      <div>{price}</div>
      {/* 3 what is included */}
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600">{includedLabel}</p>
        <ul className="mt-3 grid auto-rows-[minmax(1.5rem,auto)] gap-2.5 text-sm">
          {lines.map(({ key, text, strong }) => (
            <li key={key} className={`flex items-start gap-2.5 ${strong ? 'font-extrabold text-slate-950' : 'font-medium text-slate-700'}`}>
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" strokeWidth={3} aria-hidden="true" />{text}
            </li>
          ))}
        </ul>
      </div>
      {/* 4 one action, pinned to the bottom of every card */}
      <div className="mt-auto w-full md:self-end">{action}</div>
    </article>
  )
}

function PriceBlock({ amount, suffix, billing, saving, testMode, t }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <p className="text-4xl font-extrabold leading-none tracking-tight text-slate-950">{amount}</p>
        {suffix && <span className="text-sm font-bold text-slate-600">{suffix}</span>}
        {testMode && (
          <span className="ms-1 inline-flex items-center gap-1 self-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            <FlaskConical className="h-3 w-3" aria-hidden="true" />{t('subscription.price.testBadge')}
          </span>
        )}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />{billing}
      </p>
      {/* The same height in every card, filled only where there is a saving. */}
      <div className="mt-2 flex h-6 items-center">
        {saving && (
          <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800 ring-1 ring-emerald-200">
            {saving}
          </span>
        )}
      </div>
    </>
  )
}

export default function PlanShowcase({ catalogue, status = null, renderAction, renderFreeAction }) {
  const { t } = useLanguage()
  const testMode = Boolean(catalogue?.test_mode)
  const saving = annualSaving(catalogue)
  const current = (offer) => status && ['ACTIVE', 'GRACE'].includes(status.status)
    && status.plan_code === offer.planCode && status.current_period?.duration_code === offer.durationCode

  // Each card's lines in card order, so a line that improves on the card before it can be bold.
  const freeLines = planCardLines(catalogue, 'FREE')
  const offerLines = OFFERS.map((offer) => offerCardLines(catalogue, offer))
  const withEmphasis = (lines, previous) => lines.map((line, index) => ({
    key: line.key,
    text: t(line.key, line.values),
    strong: Boolean(previous) && !sameLine(line, previous[index]),
  }))

  const freeCard = (
    <ShowcaseCard
      key="FREE"
      id="FREE"
      t={t}
      heading={{ name: t('subscription.plan.FREE') }}
      price={<PriceBlock amount={formatRupees(0)} billing={t('subscription.price.noBilling')} t={t} />}
      includedLabel={t('subscription.inherits.FREE')}
      lines={withEmphasis(freeLines, null)}
      action={renderFreeAction ? renderFreeAction() : null}
    />
  )

  const offerCards = OFFERS.map((offer, index) => {
    const price = offerPrice(catalogue, offer)
    const action = planAction(offer.planCode, status, price)
    const name = t(`subscription.offer.${offer.id}.name`)
    const suffix = SUFFIX_KEYS[offer.durationCode] ? t(SUFFIX_KEYS[offer.durationCode], { price: '' }).trim() : ''
    return (
      <ShowcaseCard
        key={offer.id}
        id={offer.id}
        t={t}
        recommended={offer.id === RECOMMENDED_OFFER}
        gold={offer.id === 'PREMIUM_ANNUAL'}
        heading={{
          name,
          mark: <Mark badge={CARD_BADGES[offer.id]} />,
          extra: current(offer) && (
            <span className="ms-auto rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white">{t('subscription.cta.current')}</span>
          ),
        }}
        price={price ? (
          <PriceBlock
            amount={formatRupees(price)}
            suffix={suffix}
            billing={t(`subscription.offer.${offer.id}.access`)}
            saving={offer.id === 'PREMIUM_ANNUAL' && saving
              ? t('subscription.offer.annualSaving', { amount: formatRupees(saving.saving), full: formatRupees(saving.full) })
              : null}
            testMode={testMode}
            t={t}
          />
        ) : (
          <p className="text-lg font-extrabold text-slate-500">{t('subscription.price.notSet')}</p>
        )}
        includedLabel={t('subscription.compare.included')}
        lines={withEmphasis(offerLines[index], index === 0 ? freeLines : offerLines[index - 1])}
        action={renderAction ? renderAction(offer, action, price) : null}
      />
    )
  })

  return (
    // Four in a row on wide screens, two by two on tablets, one column on phones with
    // the recommended plan first (its own `order-first`).
    <div className="grid gap-6 pt-3 md:grid-cols-2 md:gap-x-6 md:gap-y-8 xl:grid-cols-4">
      {freeCard}
      {offerCards}
    </div>
  )
}
