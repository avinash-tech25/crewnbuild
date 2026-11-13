/**
 * Property ROI & Appreciation Calculator.
 *
 * Frontend-only investment-performance analysis from the user's own figures:
 * appreciation, CAGR, rental income, costs, net profit, net ROI and an optional
 * illustrative future value. No market data, assumed rate, tax, loan or IRR.
 * Every input starts empty. The arithmetic is in `propertyRoi.js`.
 */
import { useMemo, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { EMPTY_INPUTS, calculatePropertyRoi, formatInr, formatPct, formatSignedInr, formatYears } from './propertyRoi.js'
import { formatDate } from './propertyTds.js'
import { MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.propertyRoi.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const hintText = 'mt-1 block text-[11px] font-medium leading-4 text-oc-faint'
const sectionTitle = 'text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3'
const warnBorder = '!border-[#d97706]'
const OUTCOME_TONE = {
  positive: 'bg-oc-mint text-oc-deep',
  negative: 'bg-[#fde8e1] text-[#9a3412]',
  breakEven: 'bg-[#fef3cd] text-[#856404]',
}

function NumberInput({ label, value, onChange, error, prefix, suffix, placeholder, hint, step = 'any', allowNegative = false }) {
  return (
    <label className={labelClass}>
      {label}
      <span className="relative mt-2 block">
        {prefix && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-bold text-oc-muted">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min={allowNegative ? undefined : '0'}
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          className={`${inputClass} !mt-0 ${prefix ? 'ps-7' : ''} ${suffix ? 'pe-16' : ''} ${error ? warnBorder : ''}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-bold text-oc-muted">{suffix}</span>}
      </span>
      {error ? <span className={errorText}>{error}</span> : hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function DateInput({ label, value, onChange, error, hint }) {
  return (
    <label className={labelClass}>
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} className={`${inputClass} ${error ? warnBorder : ''}`} />
      {error ? <span className={errorText}>{error}</span> : hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function Row({ label, value, strong = false, tone = '' }) {
  return (
    <li className={`flex items-start gap-3 py-2 text-sm ${tone}`}>
      <span className={`min-w-0 ${tone ? '' : 'text-oc-muted'}`}>{label}</span>
      <span className={`ms-auto shrink-0 text-end ${strong ? 'font-extrabold' : 'font-bold'} ${tone ? '' : 'text-oc-ink'}`}>{value}</span>
    </li>
  )
}

function Tile({ label, value, sub, tone = '' }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-[rgba(8,62,43,.1)] p-4 ${tone || 'bg-white'}`}>
      <p className="text-[11px] font-bold uppercase leading-4 tracking-wide opacity-70">{label}</p>
      <p className="mt-1.5 whitespace-nowrap font-display text-lg font-extrabold leading-tight xl:text-xl">{value}</p>
      {sub && <p className="mt-1 text-[11px] font-semibold leading-4 opacity-70">{sub}</p>}
    </div>
  )
}

const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')
const sign = (value) => (value > 0 ? 'bg-oc-mint text-oc-deep' : value < 0 ? 'bg-[#fde8e1] text-[#9a3412]' : 'bg-white text-oc-ink')

export default function PropertyRoiCalculator() {
  const { t } = useLanguage()
  // Every value starts empty — including the current date; nothing is assumed.
  const [form, setForm] = useState(EMPTY_INPUTS)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const { status, errors, result: r } = useMemo(() => calculatePropertyRoi(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field])) : '')
  const rentEntered = form.monthlyRent !== '' && Number(form.monthlyRent) > 0
  const years = (value) => t(K('yearsUnit'), { years: formatYears(value) })
  const barMax = r ? Math.max(r.purchasePrice, r.currentValue) : 1

  return (
    <div className="min-w-0 space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <p className={sectionTitle}>{t(K('sectionPurchase'))}</p>
          <NumberInput label={t(K('purchasePrice'))} prefix="₹" value={form.purchasePrice} onChange={set('purchasePrice')} error={err('purchasePrice')} placeholder={t(K('purchasePricePlaceholder'))} hint={rupeeHint(form.purchasePrice)} />
          <DateInput label={t(K('purchaseDate'))} value={form.purchaseDate} onChange={set('purchaseDate')} error={err('purchaseDate')} />
          <NumberInput label={t(K('purchaseCosts'))} prefix="₹" value={form.purchaseCosts} onChange={set('purchaseCosts')} error={err('purchaseCosts')} placeholder={t(K('optional'))} hint={rupeeHint(form.purchaseCosts) || t(K('purchaseCostsHint'))} />

          <p className={sectionTitle}>{t(K('sectionCurrent'))}</p>
          <NumberInput label={t(K('currentValue'))} prefix="₹" value={form.currentValue} onChange={set('currentValue')} error={err('currentValue')} placeholder={t(K('currentValuePlaceholder'))} hint={rupeeHint(form.currentValue) || t(K('currentValueHint'))} />
          <DateInput label={t(K('currentDate'))} value={form.currentDate} onChange={set('currentDate')} error={err('currentDate')} hint={t(K('currentDateHint'))} />

          <p className={sectionTitle}>{t(K('sectionRent'))}</p>
          <NumberInput label={t(K('monthlyRent'))} prefix="₹" value={form.monthlyRent} onChange={set('monthlyRent')} error={err('monthlyRent')} placeholder={t(K('optional'))} hint={rupeeHint(form.monthlyRent) || t(K('blankZero'))} />
          <NumberInput label={t(K('vacancyMonths'))} suffix={t(K('monthsUnit'))} value={form.vacancyMonths} onChange={set('vacancyMonths')} error={err('vacancyMonths')} placeholder={t(K('vacancyPlaceholder'))} hint={t(K('vacancyHint'))} />
          {rentEntered && (
            <label className={labelClass}>
              {t(K('rentedEntire'))}
              <select value={form.rentedEntirePeriod} onChange={(event) => set('rentedEntirePeriod')(event.target.value)} className={`${selectClass} ${errors.rentedEntirePeriod ? warnBorder : ''}`}>
                <option value="">{t(K('select'))}</option>
                <option value="yes">{t(K('yes'))}</option>
                <option value="no">{t(K('no'))}</option>
              </select>
              <span className={hintText}>{t(K('rentedEntireHint'))}</span>
            </label>
          )}
          {rentEntered && form.rentedEntirePeriod === 'no' && (
            <NumberInput label={t(K('rentalYears'))} suffix={t(K('yearsShort'))} value={form.rentalYears} onChange={set('rentalYears')} error={err('rentalYears')} placeholder={t(K('rentalYearsPlaceholder'))} hint={t(K('rentalYearsHint'))} step="0.1" />
          )}

          <p className={sectionTitle}>{t(K('sectionExpenses'))}</p>
          <NumberInput label={t(K('annualMaintenance'))} prefix="₹" value={form.annualMaintenance} onChange={set('annualMaintenance')} error={err('annualMaintenance')} placeholder={t(K('optional'))} hint={rupeeHint(form.annualMaintenance) || t(K('annualMaintenanceHint'))} />
          <NumberInput label={t(K('renovationCosts'))} prefix="₹" value={form.renovationCosts} onChange={set('renovationCosts')} error={err('renovationCosts')} placeholder={t(K('optional'))} hint={rupeeHint(form.renovationCosts) || t(K('blankZero'))} />
          <NumberInput label={t(K('otherCosts'))} prefix="₹" value={form.otherCosts} onChange={set('otherCosts')} error={err('otherCosts')} placeholder={t(K('optional'))} hint={rupeeHint(form.otherCosts) || t(K('otherCostsHint'))} />

          <p className={sectionTitle}>{t(K('sectionSelling'))}</p>
          <NumberInput label={t(K('sellingCost'))} suffix="%" value={form.sellingCostPercent} onChange={set('sellingCostPercent')} error={err('sellingCostPercent')} placeholder={t(K('sellingCostPlaceholder'))} hint={t(K('sellingCostHint'))} step="0.1" />

          <p className={sectionTitle}>{t(K('sectionFuture'))}</p>
          <NumberInput label={t(K('futureRate'))} suffix="%" value={form.futureRate} onChange={set('futureRate')} error={err('futureRate')} placeholder={t(K('futureRatePlaceholder'))} hint={t(K('futureRateHint'))} step="0.1" allowNegative />
          <NumberInput label={t(K('projectionYears'))} suffix={t(K('yearsShort'))} value={form.projectionYears} onChange={set('projectionYears')} error={err('projectionYears')} placeholder={t(K('projectionYearsPlaceholder'))} hint={t(K('projectionYearsHint'))} step="1" />
        </div>
      </div>

      {status !== 'ok' && (
        <div className={`${cardClass} text-center`}>
          <p className={`text-sm font-bold ${status === 'invalid' ? 'text-[#b45309]' : 'text-oc-muted'}`}>
            {status === 'incomplete' && (errors.rentedEntirePeriod || form.monthlyRent) && !['purchasePrice', 'purchaseDate', 'currentValue', 'currentDate'].some((f) => form[f] === '')
              ? t(K('incompleteRent'))
              : { empty: t(K('emptyState')), incomplete: t(K('incompleteState')), invalid: t(K('invalidState')) }[status]}
          </p>
        </div>
      )}

      {status === 'ok' && r && (
        <>
          <section className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-oc-deep p-5 text-white sm:p-7" data-testid="roi-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[#b9d8c5]">{t(K('summaryTitle'))}</p>
              <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${OUTCOME_TONE[r.outcome]}`}>{t(K(`outcome.${r.outcome}`))}</span>
            </div>
            <p className="mt-1 text-xs font-semibold text-[#b9d8c5]">{t(K('ownedFor'), { years: formatYears(r.yearsOwned), from: formatDate(r.purchaseDate), to: formatDate(r.currentDate) })}</p>
            {r.valueDecreased && <p className="mt-3 rounded-xl bg-[#fde8e1] px-3 py-2 text-xs font-extrabold text-[#9a3412]">{t(K('valueDecreased'))}</p>}
            <div className="mt-4 grid grid-cols-1 gap-3 text-oc-ink min-[420px]:grid-cols-2 lg:grid-cols-3">
              <Tile label={t(K('currentValue'))} value={formatInr(r.currentValue)} />
              <Tile label={t(K('grossAppreciation'))} value={formatSignedInr(r.grossAppreciation)} sub={formatPct(r.appreciationPercent, { signed: true })} tone={sign(r.grossAppreciation)} />
              <Tile label={t(K('cagr'))} value={formatPct(r.cagrPercent, { signed: true })} sub={t(K('cagrSub'))} tone={sign(r.cagrPercent)} />
              <Tile label={t(K('netProfit'))} value={formatSignedInr(r.netProfit)} tone={sign(Math.round(r.netProfit))} />
              <Tile label={t(K('netRoi'))} value={formatPct(r.netRoi, { signed: true })} sub={t(K('netRoiSub'))} tone={sign(Math.round(r.netProfit))} />
              {r.rentEntered && <Tile label={t(K('grossYield'))} value={formatPct(r.grossYieldOnPurchase)} sub={t(K('grossYieldSub'))} />}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('performanceTitle'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('purchasePrice'))} value={formatInr(r.purchasePrice)} />
                <Row label={t(K('purchaseCosts'))} value={formatInr(r.purchaseCosts)} />
                <Row label={t(K('maintenanceTotal'), { years: formatYears(r.yearsOwned) })} value={formatInr(r.totalMaintenance)} />
                <Row label={t(K('renovationCosts'))} value={formatInr(r.renovationCosts)} />
                <Row label={t(K('otherCosts'))} value={formatInr(r.otherCosts)} />
                <Row label={t(K('totalInvested'))} value={formatInr(r.totalInvestedCost)} strong />
              </ul>
              <ul className="mt-1 border-t-2 border-[rgba(8,62,43,.15)] divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('currentValue'))} value={formatInr(r.currentValue)} />
                <Row label={t(K('sellingCostRow'), { percent: formatPct(r.sellingCostPercent) })} value={`− ${formatInr(r.sellingCost)}`} />
                <Row label={t(K('netSaleValue'))} value={formatInr(r.netSaleValue)} />
                <Row label={t(K('grossRentalIncome'))} value={`+ ${formatInr(r.totalGrossRent)}`} />
                <Row label={t(K('netProfit'))} value={formatSignedInr(r.netProfit)} strong tone={`rounded-lg px-2 ${OUTCOME_TONE[r.outcome]}`} />
              </ul>
              <p className={hintText}>{t(K('netProfitFormula'))}</p>
            </div>

            <div className="space-y-4">
              <div className={cardClass}>
                <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('appreciationTitle'))}</h2>
                <div className="mt-4 space-y-3">
                  {[{ key: 'purchase', label: t(K('purchaseValue')), value: r.purchasePrice, colour: '#2a78d6' }, { key: 'current', label: t(K('currentValue')), value: r.currentValue, colour: r.valueDecreased ? '#dc2626' : '#16a34a' }].map((item) => (
                    <div key={item.key}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-bold text-oc-muted">{item.label}</span>
                        <span className="font-extrabold text-oc-ink">{formatInr(item.value)}</span>
                      </div>
                      <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-oc-sunken">
                        <div className="h-full rounded-full" style={{ width: `${Math.max((item.value / barMax) * 100, 2)}%`, backgroundColor: item.colour }} />
                      </div>
                    </div>
                  ))}
                </div>
                <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                  <Row label={t(K('grossAppreciation'))} value={formatSignedInr(r.grossAppreciation)} strong />
                  <Row label={t(K('appreciationPercent'))} value={formatPct(r.appreciationPercent, { signed: true })} />
                  <Row label={t(K('cagr'))} value={formatPct(r.cagrPercent, { signed: true })} />
                </ul>
              </div>

              <div className={cardClass} data-testid="rental-summary">
                <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('rentalTitle'))}</h2>
                {r.rentEntered ? (
                  <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                    <Row label={t(K('monthlyRent'))} value={formatInr(r.monthlyRent)} />
                    <Row label={t(K('annualGrossRent'), { months: formatYears(12 - r.vacancyMonths) })} value={formatInr(r.annualGrossRent)} />
                    <Row label={t(K('rentalPeriod'))} value={r.rentedEntirePeriod === 'yes' ? t(K('rentalPeriodEntire'), { years: formatYears(r.rentalYears) }) : years(r.rentalYears)} />
                    <Row label={t(K('totalGrossRent'))} value={formatInr(r.totalGrossRent)} strong />
                    <Row label={t(K('yieldOnPurchase'))} value={formatPct(r.grossYieldOnPurchase)} />
                    <Row label={t(K('yieldOnCurrent'))} value={formatPct(r.grossYieldOnCurrent)} />
                  </ul>
                ) : (
                  <p className="mt-3 rounded-xl bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">{t(K('noRent'))}</p>
                )}
                {r.rentEntered && <p className={hintText}>{t(K('yieldNote'))}</p>}
              </div>
            </div>
          </div>

          {r.projection ? (
            <div className={cardClass} data-testid="future-projection">
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('futureTitle'))}</h2>
              <p className="mt-0.5 text-xs font-semibold text-oc-faint">{t(K('futureSub'))}</p>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('currentValue'))} value={formatInr(r.currentValue)} />
                <Row label={t(K('expectedRate'))} value={formatPct(r.projection.ratePercent, { signed: true })} />
                <Row label={t(K('projectionPeriod'))} value={years(r.projection.years)} />
                <Row label={t(K('futureValue'))} value={formatInr(r.projection.futureValue)} strong />
                <Row label={t(K('futureAdditional'))} value={formatSignedInr(r.projection.futureGrossAppreciation)} />
                <Row label={t(K('futureTotal'))} value={formatSignedInr(r.projection.futureTotalAppreciation)} />
              </ul>
              <MethodNote>{t(K('futureNote'))}</MethodNote>
            </div>
          ) : r.projectionPartial && (
            <div className={`${cardClass} text-center`}><p className="text-sm font-bold text-oc-muted">{t(K('futurePartial'))}</p></div>
          )}

          <MethodNote>{t(K('method'))}</MethodNote>
          <MethodNote>{t(K('disclosure1'))} {t(K('disclosure2'))} {t(K('disclosure3'))} {t(K('noTax'))}</MethodNote>
        </>
      )}
    </div>
  )
}
