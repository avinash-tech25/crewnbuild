/**
 * Home Loan EMI & Eligibility Calculator.
 *
 * Frontend-only and deterministic: every figure comes from `homeLoan.js`
 * (EMI on a reducing balance, the same formula solved for eligibility, and a
 * yearly amortization built month by month). Nothing is saved or sent.
 *
 * Eligibility is labelled an estimate throughout: it rests on one stated
 * affordability assumption (MAX_EMI_SHARE_OF_INCOME), not on any lender's rule.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Landmark } from 'lucide-react'
import {
  DEFAULT_INPUTS, LIMITS, MAX_EMI_SHARE_OF_INCOME, calculateHomeLoan, formatInr, formatPercent,
} from './homeLoan.js'
import { ErrorNote, Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.homeLoan.${key}`
// The same two colours, ring geometry and legend layout as the construction
// estimate's allocation chart, so the breakdown reads as part of the suite.
const PRINCIPAL_COLOUR = '#2a78d6'
const INTEREST_COLOUR = '#eb6834'
const DONUT_SIZE = 200
const DONUT_RADIUS = 70
const DONUT_STROKE = 30
const DONUT_PATH_LENGTH = 100
const DONUT_GAP = (2 / (2 * Math.PI * DONUT_RADIUS)) * DONUT_PATH_LENGTH

/** A ₹ or % field. Kept as a string so it can be emptied; the hint echoes ₹ in Indian grouping. */
function AmountField({ label, value, onChange, error, prefix, suffix, hint, step = 'any', placeholder }) {
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
          className={`${inputClass} !mt-0 ${prefix ? 'ps-7' : ''} ${suffix ? 'pe-9' : ''} ${error ? '!border-[#d97706]' : ''}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-bold text-oc-muted">{suffix}</span>}
      </span>
      {error
        ? <span className="mt-1 block text-[11px] font-bold leading-4 text-[#b45309]">{error}</span>
        : hint && <span className="mt-1 block text-[11px] font-medium leading-4 text-oc-faint">{hint}</span>}
    </label>
  )
}

/** A label / value line of a result card. */
function ValueRow({ label, value, strong = false }) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="text-oc-muted">{label}</span>
      <span className={`ms-auto text-end ${strong ? 'font-extrabold text-oc-ink' : 'font-bold text-oc-ink'}`}>{value}</span>
    </li>
  )
}

const moneyHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')

export default function HomeLoanCalculator() {
  const { t } = useLanguage()
  const [form, setForm] = useState(DEFAULT_INPUTS)
  const [showSchedule, setShowSchedule] = useState(false)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))

  const { errors, warnings, result } = useMemo(() => calculateHomeLoan(form), [form])
  const fieldError = (field) => (errors[field] ? t(K(errors[field]), { min: LIMITS.minRate, max: LIMITS.maxRate, minYears: LIMITS.minTenure, maxYears: LIMITS.maxTenure }) : '')
  const sharePercent = Math.round(MAX_EMI_SHARE_OF_INCOME * 100)

  const slices = result && result.totalPayable > 0
    ? [
      { key: 'principal', label: t(K('principal')), amount: result.loanAmount, colour: PRINCIPAL_COLOUR },
      { key: 'interest', label: t(K('interest')), amount: result.totalInterest, colour: INTEREST_COLOUR },
    ].map((slice, index, all) => {
      const percent = (slice.amount / result.totalPayable) * 100
      const offset = all.slice(0, index).reduce((sum, item) => sum + (item.amount / result.totalPayable) * 100, 0)
      return { ...slice, percent, offset }
    })
    : []

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AmountField label={t(K('propertyValue'))} prefix="₹" value={form.propertyValue} onChange={set('propertyValue')} error={fieldError('propertyValue')} hint={moneyHint(form.propertyValue)} step="10000" />
          <AmountField label={t(K('downPayment'))} prefix="₹" value={form.downPayment} onChange={set('downPayment')} error={fieldError('downPayment')} hint={moneyHint(form.downPayment)} step="10000" />
          <AmountField label={t(K('interestRate'))} suffix="%" value={form.interestRate} onChange={set('interestRate')} error={fieldError('interestRate')} hint={t(K('perAnnum'))} step="0.05" />
          <label className={labelClass}>
            {t(K('tenure'))}
            <select value={form.tenureYears} onChange={(event) => set('tenureYears')(event.target.value)} className={selectClass}>
              {Array.from({ length: LIMITS.maxTenure - LIMITS.minTenure + 1 }, (_, index) => LIMITS.minTenure + index).map((years) => (
                <option key={years} value={String(years)}>{t(K('yearsOption'), { years })}</option>
              ))}
            </select>
            {errors.tenureYears && <span className="mt-1 block text-[11px] font-bold leading-4 text-[#b45309]">{fieldError('tenureYears')}</span>}
          </label>
          <AmountField label={t(K('monthlyIncome'))} prefix="₹" value={form.monthlyIncome} onChange={set('monthlyIncome')} error={fieldError('monthlyIncome')} hint={moneyHint(form.monthlyIncome)} step="1000" />
          <AmountField label={t(K('existingEmis'))} prefix="₹" value={form.existingEmis} onChange={set('existingEmis')} error={fieldError('existingEmis')} hint={moneyHint(form.existingEmis) || t(K('existingEmisHint'))} step="500" placeholder="0" />
        </div>

        {result && <p className="mt-4 text-xs font-semibold text-oc-muted">{t(K('loanAmountLine'), { amount: formatInr(result.loanAmount) })}</p>}
        <ErrorNote>{warnings.map((key) => t(K(key), { share: sharePercent })).join(' ')}</ErrorNote>
      </div>

      {result && (
        <>
          <Headline
            label={t(K('headline'))}
            value={formatInr(result.emi)}
            sub={result.loanAmount > 0
              ? t(K('headlineSub'), { amount: formatInr(result.loanAmount), years: result.tenureYears, rate: result.interestRate })
              : t(K('noLoanNeeded'))}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('summary'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <ValueRow label={t(K('propertyValue'))} value={formatInr(result.propertyValue)} />
                <ValueRow label={t(K('downPayment'))} value={formatInr(result.downPayment)} />
                <ValueRow label={t(K('loanAmount'))} value={formatInr(result.loanAmount)} strong />
                <ValueRow label={t(K('interestRate'))} value={t(K('ratePerAnnum'), { rate: result.interestRate })} />
                <ValueRow label={t(K('tenure'))} value={t(K('tenureValue'), { years: result.tenureYears, months: result.months })} />
                <ValueRow label={t(K('principal'))} value={formatInr(result.loanAmount)} />
                <ValueRow label={t(K('totalInterest'))} value={formatInr(result.totalInterest)} />
                <ValueRow label={t(K('totalPayable'))} value={formatInr(result.totalPayable)} strong />
              </ul>
            </div>

            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('breakdown'))}</h2>
              {slices.length ? (
                <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row">
                  <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="h-36 w-36 shrink-0 -rotate-90" role="img" aria-label={t(K('breakdown'))}>
                    {slices.map((slice) => (
                      <circle
                        key={slice.key}
                        cx={DONUT_SIZE / 2}
                        cy={DONUT_SIZE / 2}
                        r={DONUT_RADIUS}
                        fill="none"
                        stroke={slice.colour}
                        strokeWidth={DONUT_STROKE}
                        pathLength={DONUT_PATH_LENGTH}
                        strokeDasharray={`${Math.max(slice.percent - DONUT_GAP, 0)} ${DONUT_PATH_LENGTH}`}
                        strokeDashoffset={-slice.offset}
                      >
                        <title>{`${slice.label}: ${formatInr(slice.amount)} (${slice.percent.toFixed(1)}%)`}</title>
                      </circle>
                    ))}
                  </svg>
                  <ul className="w-full space-y-2.5">
                    {slices.map((slice) => (
                      <li key={slice.key} className="flex items-center gap-3 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.colour }} />
                        <span className="text-oc-muted">{slice.label}</span>
                        <span className="ms-auto font-extrabold text-oc-ink">{formatInr(slice.amount)}</span>
                        <span className="w-12 text-end text-xs font-bold text-oc-faint">{slice.percent.toFixed(0)}%</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-3 border-t border-[rgba(8,62,43,.08)] pt-2.5 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0" />
                      <span className="font-bold text-oc-ink">{t(K('total'))}</span>
                      <span className="ms-auto font-extrabold text-oc-ink">{formatInr(result.totalPayable)}</span>
                      <span className="w-12" />
                    </li>
                  </ul>
                </div>
              ) : (
                <p className="mt-3 rounded-xl bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">{t(K('noLoanNeeded'))}</p>
              )}

              <h3 className="mt-6 font-display text-sm font-extrabold text-oc-ink">{t(K('ltvTitle'))}</h3>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-oc-sunken" role="img" aria-label={t(K('ltvAria'), { ltv: formatPercent(result.ltvPercent) })}>
                <div className="h-full rounded-full bg-oc-green" style={{ width: `${Math.min(result.ltvPercent, 100)}%` }} />
              </div>
              <ul className="mt-2 divide-y divide-[rgba(8,62,43,.08)]">
                <ValueRow label={t(K('ltv'))} value={formatPercent(result.ltvPercent)} strong />
                <ValueRow label={t(K('yourDownPayment'))} value={`${formatInr(result.downPayment)} · ${formatPercent(result.downPaymentPercent)}`} />
                <ValueRow label={t(K('financedPercent'))} value={formatPercent(result.ltvPercent)} />
              </ul>
            </div>
          </div>

          <div className={cardClass}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('eligibilityTitle'))}</h2>
              <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${result.withinEligibility ? 'bg-oc-mint text-oc-deep' : 'bg-[#fef3cd] text-[#856404]'}`}>
                {result.withinEligibility ? t(K('withinEligibility')) : t(K('aboveEligibility'), { gap: formatInr(result.eligibilityGap) })}
              </span>
            </div>
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              <ValueRow label={t(K('monthlyIncome'))} value={formatInr(result.monthlyIncome)} />
              <ValueRow label={t(K('maxTotalEmi'), { share: sharePercent })} value={formatInr(result.maxTotalEmi)} />
              <ValueRow label={t(K('existingEmis'))} value={formatInr(result.existingEmis)} />
              <ValueRow label={t(K('availableEmi'))} value={formatInr(result.availableEmi)} />
              <ValueRow label={t(K('eligibleLoan'))} value={formatInr(result.eligibleLoan)} strong />
              <ValueRow label={t(K('estimatedEmi'))} value={formatInr(result.emi)} />
            </ul>
            <MethodNote>{t(K('eligibilityDisclaimer'))}</MethodNote>
            <MethodNote>{t(K('eligibilityMethod'), { share: sharePercent })}</MethodNote>
          </div>

          {result.schedule.length > 0 && (
            <div className={cardClass}>
              <button
                type="button"
                onClick={() => setShowSchedule((open) => !open)}
                aria-expanded={showSchedule}
                className="flex w-full items-center justify-between gap-3 text-start"
              >
                <span className="font-display text-base font-extrabold text-oc-ink">{t(K('viewSchedule'))}</span>
                <ChevronDown className={`h-5 w-5 shrink-0 text-oc-muted transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
              </button>
              {showSchedule && (
                <>
                  <p className="mt-1 text-[11px] font-medium leading-4 text-oc-faint">{t(K('scheduleNote'))}</p>
                  {/* The table scrolls inside its card on a narrow screen; the page itself never does. */}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead>
                        <tr className="text-start text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                          <th className="py-2 pe-3 text-start">{t(K('colYear'))}</th>
                          <th className="py-2 pe-3 text-end">{t(K('colOpening'))}</th>
                          <th className="py-2 pe-3 text-end">{t(K('colPrincipal'))}</th>
                          <th className="py-2 pe-3 text-end">{t(K('colInterest'))}</th>
                          <th className="py-2 text-end">{t(K('colClosing'))}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(8,62,43,.08)]">
                        {result.schedule.map((row) => (
                          <tr key={row.year}>
                            <td className="py-2 pe-3 font-bold text-oc-ink">{row.year}</td>
                            <td className="py-2 pe-3 text-end text-oc-muted">{formatInr(row.opening)}</td>
                            <td className="py-2 pe-3 text-end font-bold text-oc-ink">{formatInr(row.principalPaid)}</td>
                            <td className="py-2 pe-3 text-end text-oc-muted">{formatInr(row.interestPaid)}</td>
                            <td className="py-2 text-end text-oc-muted">{formatInr(row.closing)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[rgba(8,62,43,.15)] font-extrabold text-oc-ink">
                          <td className="py-2 pe-3">{t(K('total'))}</td>
                          <td className="py-2 pe-3" />
                          <td className="py-2 pe-3 text-end">{formatInr(result.loanAmount)}</td>
                          <td className="py-2 pe-3 text-end">{formatInr(result.scheduleTotalInterest)}</td>
                          <td className="py-2" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-oc-muted">
                    {t(K('scheduleTotal'), { paid: formatInr(result.scheduleTotalPaid), principal: formatInr(result.loanAmount), interest: formatInr(result.scheduleTotalInterest) })}
                  </p>
                </>
              )}
            </div>
          )}

          <MethodNote>{t(K('method'))}</MethodNote>
        </>
      )}
    </div>
  )
}
