/**
 * Contractor Quote Verification.
 *
 * Frontend-only. The user's contractor quote is checked against the user's
 * OWN benchmark rate — no rate, price or per-city figure lives here. Every
 * amount starts empty; nothing is shown until area, floors, quote and benchmark
 * are entered. The arithmetic is in `contractorQuote.js`.
 */
import { useMemo, useState } from 'react'
import { FileCheck } from 'lucide-react'
import {
  COST_CATEGORIES, CONSTRUCTION_TYPES, EMPTY_INPUTS, calculateContractorQuote, convertQuoteValue, formatInr, formatSignedInr, formatSignedPercent,
} from './contractorQuote.js'
import { Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.contractorQuote.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const hintText = 'mt-1 block text-[11px] font-medium leading-4 text-oc-faint'
const warnBorder = '!border-[#d97706]'
const STATUS_TONE = {
  below: 'bg-oc-mint text-oc-deep',
  close: 'bg-oc-mint text-oc-deep',
  moderate: 'bg-[#fef3cd] text-[#856404]',
  above: 'bg-[#fde8e1] text-[#9a3412]',
}

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
          className={`${inputClass} !mt-0 ${prefix ? 'ps-7' : ''} ${suffix ? 'pe-16' : ''} ${error ? warnBorder : ''}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-bold text-oc-muted">{suffix}</span>}
      </span>
      {error ? <span className={errorText}>{error}</span> : hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function SelectInput({ label, value, onChange, options, hint }) {
  return (
    <label className={labelClass}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function Row({ label, value, strong = false, tone = '' }) {
  return (
    <li className={`flex items-center gap-3 py-2 text-sm ${tone}`}>
      <span className={tone ? '' : 'text-oc-muted'}>{label}</span>
      <span className={`ms-auto text-end ${strong ? 'font-extrabold' : 'font-bold'} ${tone ? '' : 'text-oc-ink'}`}>{value}</span>
    </li>
  )
}

const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')

export default function ContractorQuoteCalculator() {
  const { t } = useLanguage()
  // Every amount starts empty; nothing is verified until the required values are in.
  const [form, setForm] = useState(EMPTY_INPUTS)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  // One stored quote value: switching the basis converts it with the area, never keeps two.
  const setBasis = (basis) => setForm((current) => ({ ...current, quoteBasis: basis, quoteValue: convertQuoteValue(current.quoteValue, current.quoteBasis, basis, current.area) }))
  const { status, errors, result } = useMemo(() => calculateContractorQuote(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field])) : '')
  const perSqft = t(K('perSqft'))
  const tristate = ['unknown', 'yes', 'no'].map((value) => ({ value, label: t(K(`tristate.${value}`)) }))

  const barMax = result ? Math.max(result.totalQuote, result.benchmarkTotal) : 1

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3">{t(K('sectionProject'))}</p>
          <NumberInput label={t(K('area'))} suffix={t(K('sqft'))} value={form.area} onChange={set('area')} error={err('area')} placeholder={t(K('areaPlaceholder'))} />
          <NumberInput label={t(K('floors'))} value={form.floors} onChange={set('floors')} error={err('floors')} placeholder={t(K('floorsPlaceholder'))} step="1" />
          <SelectInput label={t(K('constructionType'))} value={form.constructionType} onChange={set('constructionType')} options={CONSTRUCTION_TYPES.map((value) => ({ value, label: t(K(`constructionTypes.${value}`)) }))} />

          <p className="text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3">{t(K('sectionQuote'))}</p>
          <SelectInput
            label={t(K('quoteBasis'))}
            value={form.quoteBasis}
            onChange={setBasis}
            options={[{ value: 'total', label: t(K('basisTotal')) }, { value: 'rate', label: t(K('basisRate')) }]}
            hint={t(K('basisHint'))}
          />
          <NumberInput
            label={form.quoteBasis === 'total' ? t(K('quoteTotal')) : t(K('quoteRate'))}
            prefix="₹"
            suffix={form.quoteBasis === 'rate' ? perSqft : undefined}
            value={form.quoteValue}
            onChange={set('quoteValue')}
            error={err('quoteValue')}
            placeholder={form.quoteBasis === 'total' ? t(K('quoteTotalPlaceholder')) : t(K('quoteRatePlaceholder'))}
            hint={rupeeHint(form.quoteValue)}
          />
          <NumberInput label={t(K('benchmark'))} prefix="₹" suffix={perSqft} value={form.benchmarkRate} onChange={set('benchmarkRate')} error={err('benchmarkRate')} placeholder={t(K('benchmarkPlaceholder'))} hint={t(K('benchmarkHint'))} />

          <p className="text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3">{t(K('sectionBreakdown'))}</p>
          {COST_CATEGORIES.map((key) => (
            <NumberInput key={key} label={t(K(`category.${key}`))} prefix="₹" value={form[key]} onChange={set(key)} error={err(key)} placeholder={t(K('optionalPlaceholder'))} hint={rupeeHint(form[key]) || t(K('blankZero'))} />
          ))}

          <p className="text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2 lg:col-span-3">{t(K('sectionOptional'))}</p>
          <NumberInput label={t(K('margin'))} suffix="%" value={form.marginPercent} onChange={set('marginPercent')} error={err('marginPercent')} placeholder={t(K('marginPlaceholder'))} hint={t(K('marginHint'))} step="0.1" />
          <SelectInput label={t(K('gst'))} value={form.gstIncluded} onChange={set('gstIncluded')} options={tristate} />
          <SelectInput label={t(K('contingency'))} value={form.contingencyIncluded} onChange={set('contingencyIncluded')} options={tristate} hint={t(K('contingencyHint'))} />
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
            value={formatInr(result.totalQuote)}
            sub={t(K('headlineSub'), { rate: formatInr(result.quotedRate), status: t(K(`status.${result.quoteStatus}`)) })}
          />

          <div className={cardClass}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('benchmarkTitle'))}</h2>
              <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${STATUS_TONE[result.quoteStatus]}`}>{t(K(`status.${result.quoteStatus}`))}</span>
            </div>
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              <Row label={t(K('quotedRate'))} value={`${formatInr(result.quotedRate)} ${perSqft}`} strong />
              <Row label={t(K('yourBenchmark'))} value={`${formatInr(result.benchmarkRate)} ${perSqft}`} />
              <Row label={t(K('differencePerSqft'))} value={`${formatSignedInr(result.differencePerSqft)} ${perSqft}`} strong />
              <Row label={t(K('differencePercent'))} value={formatSignedPercent(result.differencePercent)} strong />
            </ul>
            <div className="mt-4 space-y-3">
              {[
                { key: 'benchmark', label: t(K('yourBenchmarkTotal')), value: result.benchmarkTotal, colour: '#2a78d6' },
                { key: 'quote', label: t(K('contractorQuote')), value: result.totalQuote, colour: '#eb6834' },
              ].map((item) => (
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
            <MethodNote>{t(K('statusNote'))}</MethodNote>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('breakdownTitle'))}</h2>
                {result.partialBreakdown && <span className="rounded-full bg-[#fef3cd] px-3 py-1 text-[11px] font-extrabold text-[#856404]">{t(K('partialBreakdown'))}</span>}
              </div>
              {result.breakdownEntered ? (
                <>
                  <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                    {result.categories.map((item) => (
                      <Row key={item.key} label={t(K(`category.${item.key}`))} value={`${formatInr(item.amount)} — ${item.percentOfQuote.toFixed(1)}%`} />
                    ))}
                  </ul>
                  <ul className="mt-1 border-t-2 border-[rgba(8,62,43,.15)]">
                    <Row label={t(K('contractorQuote'))} value={formatInr(result.totalQuote)} />
                    <Row label={t(K('enteredBreakdown'))} value={`${formatInr(result.breakdownTotal)} — ${result.breakdownCoveragePercent.toFixed(1)}%`} strong />
                    {result.breakdownExceedsQuote
                      ? <Row label={t(K('breakdownExceeds'))} value={formatInr(-result.remainingAmount)} strong tone="rounded-lg bg-[#fde8e1] px-2 text-[#9a3412]" />
                      : <Row label={t(K('remaining'))} value={formatInr(result.remainingAmount)} strong />}
                  </ul>
                  {result.breakdownExceedsQuote && <p className="mt-2 text-xs font-bold text-[#9a3412]">{t(K('breakdownExceedsNote'))}</p>}
                  {result.partialBreakdown && <p className={hintText}>{t(K('partialNote'))}</p>}
                </>
              ) : (
                <p className="mt-3 rounded-xl bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">{t(K('noBreakdown'))}</p>
              )}
              {result.marginEntered && (
                <ul className="mt-3 border-t border-[rgba(8,62,43,.08)]">
                  <Row label={t(K('estimatedMargin'), { percent: result.marginPercent })} value={formatInr(result.estimatedMargin)} />
                </ul>
              )}
            </div>

            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('projectCheck'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('area'))} value={`${result.area.toLocaleString('en-IN')} ${t(K('sqft'))}`} />
                <Row label={t(K('floors'))} value={String(result.floors)} />
                <Row label={t(K('constructionType'))} value={t(K(`constructionTypes.${result.constructionType}`))} />
                <Row label={t(K('contractorQuote'))} value={formatInr(result.totalQuote)} />
                <Row label={t(K('calculatedRate'))} value={`${formatInr(result.quotedRate)} ${perSqft}`} />
                <Row label={t(K('benchmarkRate'))} value={`${formatInr(result.benchmarkRate)} ${perSqft}`} />
                <Row label={t(K('benchmarkTotal'))} value={formatInr(result.benchmarkTotal)} />
                <Row label={t(K('quoteDifference'))} value={formatSignedInr(result.quoteDifference)} strong />
              </ul>
              <ul className="mt-3 space-y-1.5 text-xs font-semibold text-oc-muted">
                <li>{t(K(`gstStatement.${result.gstIncluded}`))}</li>
                <li>{t(K(`contingencyStatement.${result.contingencyIncluded}`))}</li>
              </ul>
            </div>
          </div>

          <MethodNote>{t(K('method'))}</MethodNote>
          <MethodNote>{t(K('disclaimer'))}</MethodNote>
        </>
      )}
    </div>
  )
}
