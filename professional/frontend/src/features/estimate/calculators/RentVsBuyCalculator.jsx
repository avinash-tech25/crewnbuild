/**
 * Rent vs Buy — 10-Year Decision Engine.
 *
 * Frontend-only. Every financial input starts empty and nothing is compared
 * until all required values are entered. The model lives in `rentVsBuy.js`,
 * which reuses Calculator #1's EMI / amortization and the shared verified
 * stamp-duty & registration rates; this file only collects inputs and shows
 * the result.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Scale } from 'lucide-react'
import { EMPTY_INPUTS, STATES, TENURE_LIMITS, calculateRentVsBuy, chargeConfigFor, formatInr, formatSignedInr } from './rentVsBuy.js'
import { Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.rentVsBuy.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const hintText = 'mt-1 block text-[11px] font-medium leading-4 text-oc-faint'
const warnBorder = '!border-[#d97706]'

function NumberInput({ label, value, onChange, error, prefix, suffix, placeholder, hint, step = 'any' }) {
  return (
    <label className={labelClass}>
      {label}
      <span className="relative mt-2 block">
        {prefix && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-bold text-oc-muted">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          className={`${inputClass} !mt-0 ${prefix ? 'ps-7' : ''} ${suffix ? 'pe-12' : ''} ${error ? warnBorder : ''}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-bold text-oc-muted">{suffix}</span>}
      </span>
      {error ? <span className={errorText}>{error}</span> : hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function SectionTitle({ children }) {
  return <p className="text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3">{children}</p>
}

function Row({ label, value, strong = false, rate }) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="text-oc-muted">{label}</span>
      {rate && <span className="rounded-full bg-oc-sunken px-2 py-0.5 text-[11px] font-extrabold text-oc-deep">{rate}</span>}
      <span className={`ms-auto text-end ${strong ? 'font-extrabold text-oc-ink' : 'font-bold text-oc-ink'}`}>{value}</span>
    </li>
  )
}

const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')

export default function RentVsBuyCalculator() {
  const { t } = useLanguage()
  // Every financial input starts empty; nothing is compared until all are filled in.
  const [form, setForm] = useState(EMPTY_INPUTS)
  const [showTable, setShowTable] = useState(false)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const { status, errors, result } = useMemo(() => calculateRentVsBuy(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field]), { min: TENURE_LIMITS.min, max: TENURE_LIMITS.max }) : '')
  const config = chargeConfigFor(form.state)
  const money = (field, placeholderKey, hintKey) => ({ prefix: '₹', value: form[field], onChange: set(field), error: err(field), placeholder: t(K(placeholderKey)), hint: rupeeHint(form[field]) || (hintKey ? t(K(hintKey)) : '') })
  const percent = (field, placeholderKey, hintKey) => ({ suffix: '%', value: form[field], onChange: set(field), error: err(field), placeholder: t(K(placeholderKey)), hint: hintKey ? t(K(hintKey)) : '' })

  const verdictText = result && { buy: t(K('verdictBuy')), rent: t(K('verdictRent')), close: t(K('verdictClose')) }[result.verdict]
  const barMax = result ? Math.max(Math.abs(result.netRentCost), Math.abs(result.netBuyCost), 1) : 1
  const bar = (value) => `${Math.max((Math.abs(value) / barMax) * 100, 2)}%`

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SectionTitle>{t(K('sectionProperty'))}</SectionTitle>
          <NumberInput label={t(K('propertyPrice'))} {...money('propertyPrice', 'propertyPricePlaceholder')} />
          <NumberInput label={t(K('downPayment'))} {...money('downPayment', 'downPaymentPlaceholder')} />
          <NumberInput label={t(K('interestRate'))} {...percent('interestRate', 'interestRatePlaceholder', 'perAnnum')} step="0.05" />
          <NumberInput label={t(K('tenure'))} suffix={t(K('years'))} value={form.tenureYears} onChange={set('tenureYears')} error={err('tenureYears')} placeholder={t(K('tenurePlaceholder'))} step="1" />
          <NumberInput label={t(K('appreciation'))} {...percent('appreciation', 'appreciationPlaceholder', 'assumptionHint')} step="0.1" />

          <SectionTitle>{t(K('sectionRent'))}</SectionTitle>
          <NumberInput label={t(K('monthlyRent'))} {...money('monthlyRent', 'monthlyRentPlaceholder')} />
          <NumberInput label={t(K('rentIncrease'))} {...percent('rentIncrease', 'rentIncreasePlaceholder', 'assumptionHint')} step="0.1" />

          <SectionTitle>{t(K('sectionBuyingCosts'))}</SectionTitle>
          <label className={labelClass}>
            {t(K('state'))}
            <select value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value, areaType: '' }))} className={selectClass}>
              <option value="">{t(K('selectState'))}</option>
              {STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
            <span className={hintText}>{t(K('stateHint'))}</span>
          </label>
          {config && (
            <label className={labelClass}>
              {t(K('areaType'))}
              <select value={form.areaType} onChange={(event) => set('areaType')(event.target.value)} className={`${selectClass} ${errors.areaType ? warnBorder : ''}`}>
                <option value="">{t(K('selectArea'))}</option>
                {config.areaTypes.map((area) => <option key={area} value={area}>{t(K(`areaTypes.${area}`))}</option>)}
              </select>
              {errors.areaType && <span className={errorText}>{err('areaType')}</span>}
            </label>
          )}
          <NumberInput label={t(K('purchaseCosts'))} {...money('purchaseCosts', 'purchaseCostsPlaceholder', 'optionalBlankZero')} />
          <label className={labelClass}>
            {t(K('maintenanceMode'))}
            <select value={form.maintenanceMode} onChange={(event) => set('maintenanceMode')(event.target.value)} className={selectClass}>
              <option value="percent">{t(K('maintenancePercent'))}</option>
              <option value="amount">{t(K('maintenanceAmount'))}</option>
            </select>
          </label>
          {form.maintenanceMode === 'percent'
            ? <NumberInput label={t(K('maintenanceValuePercent'))} {...percent('maintenanceValue', 'maintenancePercentPlaceholder', 'optionalBlankZero')} step="0.05" />
            : <NumberInput label={t(K('maintenanceValueAmount'))} {...money('maintenanceValue', 'maintenanceAmountPlaceholder', 'optionalBlankZero')} />}
          <NumberInput label={t(K('maintenanceIncrease'))} {...percent('maintenanceIncrease', 'maintenanceIncreasePlaceholder', 'maintenanceIncreaseHint')} step="0.1" />

          <SectionTitle>{t(K('sectionExit'))}</SectionTitle>
          <NumberInput label={t(K('sellingCost'))} {...percent('sellingCostPercent', 'sellingCostPlaceholder', 'sellingCostHint')} step="0.1" />
          <NumberInput label={t(K('investmentReturn'))} {...percent('investmentReturn', 'investmentReturnPlaceholder', 'illustrative')} step="0.1" />
        </div>
      </div>

      {status !== 'ok' && (
        <div className={`${cardClass} text-center`}>
          <p className={`text-sm font-bold ${status === 'invalid' ? 'text-[#b45309]' : 'text-oc-muted'}`}>
            {{ empty: t(K('emptyState')), incomplete: t(K('incompleteState')), invalid: t(K('invalidState')) }[status]}
          </p>
        </div>
      )}

      {status === 'ok' && result && (
        <>
          <Headline
            label={t(K('headline'))}
            value={verdictText}
            sub={`${t(K('breakEven'))}: ${result.breakEvenYear ? t(K('yearN'), { year: result.breakEvenYear }) : t(K('notReached'))}`}
          />

          {result.chargesPartial && (
            <div className="rounded-2xl border border-[#f3d38a] bg-[#fef9ec] p-4 text-sm leading-6 text-[#7a5b0c]">
              <p className="font-extrabold">{t(K('partialEstimate'))}</p>
              <p>{result.chargesConfigured ? t(K(result.notIncludedKey)) : t(K('notConfigured'))}</p>
            </div>
          )}

          <div className={cardClass}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('comparisonTitle'))}</h2>
              <span className="rounded-full bg-oc-mint px-3 py-1 text-[11px] font-extrabold text-oc-deep">
                {t(K('winner'))}: {{ buy: t(K('buy')), rent: t(K('rent')), close: t(K('close')) }[result.verdict]}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {[
                { key: 'rent', label: t(K('netRentCost')), value: result.netRentCost, colour: '#2a78d6' },
                { key: 'buy', label: t(K('netBuyCost')), value: result.netBuyCost, colour: '#eb6834' },
              ].map((item) => (
                <div key={item.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-bold text-oc-muted">{item.label}</span>
                    <span className="font-extrabold text-oc-ink">{formatSignedInr(item.value)}{item.value < 0 ? ` (${t(K('netGain'))})` : ''}</span>
                  </div>
                  <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-oc-sunken">
                    <div className="h-full rounded-full" style={{ width: bar(item.value), backgroundColor: item.colour, opacity: item.value < 0 ? 0.45 : 1 }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold text-oc-muted">
              {t(K('differenceLine'), { amount: formatInr(Math.abs(result.difference)), close: formatInr(result.closeThreshold) })}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('rentColumn'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('rentNow'))} value={formatInr(result.years[0].monthlyRent)} />
                <Row label={t(K('rentYear10'))} value={formatInr(result.years[9].monthlyRent)} />
                <Row label={t(K('totalRent'))} value={formatInr(result.totalRent)} strong />
                <Row label={t(K('netRentCost'))} value={formatSignedInr(result.netRentCost)} strong />
              </ul>
              <MethodNote>{t(K('rentNote'))}</MethodNote>
            </div>

            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('buyColumn'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('loanAmount'))} value={formatInr(result.loan)} />
                <Row label={t(K('emi'))} value={formatInr(result.emi)} strong />
                <Row label={t(K('downPayment'))} value={formatInr(result.downPayment)} />
                <Row label={t(K('stampDuty'))} rate={result.chargesConfigured ? `${result.stampDutyPercent}%` : null} value={result.chargesConfigured ? formatInr(result.stampDuty) : t(K('notConfiguredShort'))} />
                <Row label={t(K('registration'))} rate={result.chargesConfigured ? `${result.registrationPercent}%` : null} value={result.chargesConfigured ? formatInr(result.registration) : t(K('notConfiguredShort'))} />
                <Row label={t(K('purchaseCosts'))} value={formatInr(result.purchaseCosts)} />
                <Row label={t(K('emiPaid'), { months: result.emiMonthsPaid })} value={formatInr(result.emiPaid)} />
                <Row label={t(K('interestPaid'))} value={formatInr(result.interestPaid)} />
                <Row label={t(K('principalPaid'))} value={formatInr(result.principalPaid)} />
                <Row label={result.maintenanceConstant ? t(K('maintenanceConstantLabel')) : t(K('maintenanceGrowingLabel'))} value={formatInr(result.maintenancePaid)} />
                <Row label={t(K('buyOutflows'))} value={formatInr(result.buyOutflows)} strong />
                <Row label={t(K('propertyValue'))} value={formatInr(result.propertyValue)} />
                <Row label={t(K('remainingLoan'))} value={formatInr(result.remainingLoan)} />
                <Row label={t(K('sellingCostRow'))} value={formatInr(result.sellingCost)} />
                <Row label={t(K('netSaleEquity'))} value={formatSignedInr(result.netSaleEquity)} strong />
                <Row label={t(K('opportunityCost'))} value={formatInr(result.opportunityCost)} />
                <Row label={t(K('netBuyCost'))} value={formatSignedInr(result.netBuyCost)} strong />
              </ul>
              {result.maintenanceBlank && <p className={hintText}>{t(K('maintenanceBlankNote'))}</p>}
            </div>
          </div>

          <div className={cardClass}>
            <button type="button" onClick={() => setShowTable((open) => !open)} aria-expanded={showTable} className="flex w-full items-center justify-between gap-3 text-start">
              <span className="font-display text-base font-extrabold text-oc-ink">{t(K('tableTitle'))}</span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-oc-muted transition-transform ${showTable ? 'rotate-180' : ''}`} />
            </button>
            {showTable && (
              // The table scrolls inside its card on a narrow screen; the page never does.
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                      {['colYear', 'colMonthlyRent', 'colAnnualRent', 'colCumulativeRent', 'colPropertyValue', 'colRemainingLoan', 'colEquity'].map((key, index) => (
                        <th key={key} className={`py-2 pe-3 ${index === 0 ? 'text-start' : 'text-end'}`}>{t(K(key))}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(8,62,43,.08)]">
                    {result.years.map((row) => (
                      <tr key={row.year} className={result.breakEvenYear === row.year ? 'bg-oc-mint/60' : ''}>
                        <td className="py-2 pe-3 font-bold text-oc-ink">{row.year}</td>
                        <td className="py-2 pe-3 text-end text-oc-muted">{formatInr(row.monthlyRent)}</td>
                        <td className="py-2 pe-3 text-end text-oc-muted">{formatInr(row.annualRent)}</td>
                        <td className="py-2 pe-3 text-end font-bold text-oc-ink">{formatInr(row.cumulativeRent)}</td>
                        <td className="py-2 pe-3 text-end text-oc-muted">{formatInr(row.propertyValue)}</td>
                        <td className="py-2 pe-3 text-end text-oc-muted">{formatInr(row.remainingLoan)}</td>
                        <td className="py-2 text-end font-bold text-oc-ink">{formatSignedInr(row.netSaleEquity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={hintText}>{t(K('tableNote'))}</p>
              </div>
            )}
          </div>

          <MethodNote>{t(K('method'))}</MethodNote>
          <MethodNote>{t(K('excluded'))}</MethodNote>
          <MethodNote>{t(K('disclosure'))}</MethodNote>
        </>
      )}
    </div>
  )
}
