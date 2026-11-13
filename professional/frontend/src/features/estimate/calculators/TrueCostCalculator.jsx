/**
 * True Cost of Property Calculator.
 *
 * Frontend-only and driven entirely by what the user enters: the property
 * price starts empty and nothing is calculated until it is filled in. Every
 * figure comes from `trueCost.js`; government charges come only from its
 * verified configuration, and a location without one is a partial estimate.
 */
import { useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'
import { BUYER_TYPES, CHARGE_MODES, EMPTY_INPUTS, GOVERNMENT_CHARGES, PROPERTY_TYPES, STATES, calculateTrueCost, formatInr } from './trueCost.js'
import { Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.trueCost.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const hintText = 'mt-1 block text-[11px] font-medium leading-4 text-oc-faint'

/** A ₹ or % amount, kept as a string so it can be empty; the hint echoes ₹ in Indian grouping. */
function AmountInput({ label, value, onChange, error, prefix, suffix, placeholder, hint }) {
  return (
    <label className={labelClass}>
      {label}
      <span className="relative mt-2 block">
        {prefix && <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-bold text-oc-muted">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          className={`${inputClass} !mt-0 ${prefix ? 'ps-7' : ''} ${suffix ? 'pe-9' : ''} ${error ? '!border-[#d97706]' : ''}`}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-bold text-oc-muted">{suffix}</span>}
      </span>
      {error ? <span className={errorText}>{error}</span> : hint && <span className={hintText}>{hint}</span>}
    </label>
  )
}

function SelectInput({ label, value, onChange, options, error, placeholder }) {
  return (
    <label className={labelClass}>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} className={`${selectClass} ${error ? '!border-[#d97706]' : ''}`}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {error && <span className={errorText}>{error}</span>}
    </label>
  )
}

function Row({ label, value, strong = false, muted = false }) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className={muted ? 'text-oc-faint' : 'text-oc-muted'}>{label}</span>
      <span className={`ms-auto text-end ${strong ? 'font-extrabold text-oc-ink' : 'font-bold text-oc-ink'}`}>{value}</span>
    </li>
  )
}

// Shown under a ₹ field once something is typed, so a long number is readable.
const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')

export default function TrueCostCalculator() {
  const { t } = useLanguage()
  // Every amount starts empty; the optional charges start at "None".
  const [form, setForm] = useState(EMPTY_INPUTS)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const { status, errors, result } = useMemo(() => calculateTrueCost(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field])) : '')
  const configured = GOVERNMENT_CHARGES[form.state] || null

  const modeOptions = CHARGE_MODES.map((mode) => ({ value: mode, label: t(K(`mode.${mode}`)) }))
  const chargeValueField = (prefix, mode, value, field, label) => (mode === 'none' ? null : (
    <AmountInput
      label={label}
      value={value}
      onChange={set(field)}
      error={err(field)}
      prefix={mode === 'fixed' ? '₹' : undefined}
      suffix={mode === 'percent' ? '%' : undefined}
      placeholder={mode === 'percent' ? t(K(`${prefix}PercentPlaceholder`)) : t(K(`${prefix}FixedPlaceholder`))}
      hint={mode === 'fixed' ? rupeeHint(value) : t(K('percentOfPrice'))}
    />
  ))

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AmountInput label={t(K('propertyPrice'))} prefix="₹" value={form.propertyPrice} onChange={set('propertyPrice')} error={err('propertyPrice')} placeholder={t(K('propertyPricePlaceholder'))} hint={rupeeHint(form.propertyPrice)} />
          <SelectInput label={t(K('propertyType'))} value={form.propertyType} onChange={set('propertyType')} error={err('propertyType')} options={PROPERTY_TYPES.map((type) => ({ value: type, label: t(K(`propertyTypes.${type}`)) }))} />
          <SelectInput label={t(K('state'))} value={form.state} onChange={(value) => setForm((current) => ({ ...current, state: value, areaType: '' }))} error={err('state')} placeholder={t(K('selectState'))} options={STATES.map((state) => ({ value: state, label: state }))} />
          <label className={labelClass}>
            {t(K('city'))}
            <input
              type="text"
              value={form.city}
              onChange={(event) => set('city')(event.target.value)}
              placeholder={t(K('cityPlaceholder'))}
              aria-invalid={Boolean(errors.city)}
              className={`${inputClass} ${errors.city ? '!border-[#d97706]' : ''}`}
            />
            {errors.city && <span className={errorText}>{err('city')}</span>}
          </label>
          {configured && (
            <SelectInput
              label={t(K('areaType'))}
              value={form.areaType}
              onChange={set('areaType')}
              error={err('areaType')}
              placeholder={t(K('selectArea'))}
              options={configured.areaTypes.map((area) => ({ value: area, label: t(K(`areaTypes.${area}`)) }))}
            />
          )}
          <SelectInput label={t(K('buyerType'))} value={form.buyerType} onChange={set('buyerType')} error={err('buyerType')} placeholder={t(K('selectBuyer'))} options={BUYER_TYPES.map((type) => ({ value: type, label: t(K(`buyerTypes.${type}`)) }))} />
        </div>

        <div className="mt-6 border-t border-[rgba(8,62,43,.08)] pt-5">
          <p className="text-xs font-extrabold uppercase tracking-wide text-oc-faint">{t(K('optional'))}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectInput label={t(K('homeLoan'))} value={form.homeLoan} onChange={set('homeLoan')} options={[{ value: 'no', label: t(K('no')) }, { value: 'yes', label: t(K('yes')) }]} />
            {form.homeLoan === 'yes' && (
              <AmountInput label={t(K('downPayment'))} prefix="₹" value={form.downPayment} onChange={set('downPayment')} error={err('downPayment')} placeholder={t(K('downPaymentPlaceholder'))} hint={rupeeHint(form.downPayment)} />
            )}
            <AmountInput label={t(K('initialSetup'))} prefix="₹" value={form.initialSetup} onChange={set('initialSetup')} error={err('initialSetup')} placeholder={t(K('initialSetupPlaceholder'))} hint={rupeeHint(form.initialSetup)} />
            <SelectInput label={t(K('brokerage'))} value={form.brokerageMode} onChange={set('brokerageMode')} options={modeOptions} />
            {chargeValueField('brokerage', form.brokerageMode, form.brokerageValue, 'brokerageValue', t(K('brokerageValue')))}
            <SelectInput label={t(K('legal'))} value={form.legalMode} onChange={set('legalMode')} options={modeOptions} />
            {chargeValueField('legal', form.legalMode, form.legalValue, 'legalValue', t(K('legalValue')))}
          </div>
        </div>
      </div>

      {status === 'empty' && (
        <div className={`${cardClass} text-center`}>
          <p className="text-sm font-bold text-oc-muted">{t(K('emptyState'))}</p>
        </div>
      )}
      {status === 'invalid' && (
        <div className={`${cardClass} text-center`}>
          <p className="text-sm font-bold text-[#b45309]">{t(K('fixFields'))}</p>
        </div>
      )}

      {status === 'ok' && result && (
        <>
          <Headline
            label={t(K('headline'))}
            value={formatInr(result.totalCost)}
            sub={`${t(K('headlineSub'), { additional: formatInr(result.additionalCost), percent: result.additionalCostPercent.toFixed(2) })}${result.partial ? ` · ${t(K('partialEstimate'))}` : ''}`}
          />

          {result.partial && (
            <div className="rounded-2xl border border-[#f3d38a] bg-[#fef9ec] p-4 text-sm leading-6 text-[#7a5b0c]">
              <p className="font-extrabold">{t(K('partialEstimate'))}</p>
              <p>{result.governmentConfigured ? t(K(result.notIncludedKey)) : t(K('notConfigured'))}</p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('breakdown'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('propertyPrice'))} value={formatInr(result.price)} />
                <Row
                  label={result.governmentConfigured ? t(K('stampDutyAt'), { percent: result.stampDutyPercent }) : t(K('stampDuty'))}
                  value={result.governmentConfigured ? formatInr(result.stampDuty) : t(K('notConfiguredShort'))}
                  muted={!result.governmentConfigured}
                />
                <Row
                  label={result.governmentConfigured ? t(K('registrationAt'), { percent: result.registrationPercent }) : t(K('registration'))}
                  value={result.governmentConfigured ? formatInr(result.registration) : t(K('notConfiguredShort'))}
                  muted={!result.governmentConfigured}
                />
                <Row label={t(K('brokerage'))} value={formatInr(result.brokerage)} />
                <Row label={t(K('legal'))} value={formatInr(result.legal)} />
                <Row label={t(K('initialSetup'))} value={formatInr(result.initialSetup)} />
              </ul>
              <ul className="mt-1 border-t-2 border-[rgba(8,62,43,.15)]">
                <Row label={t(K('total'))} value={formatInr(result.totalCost)} strong />
                <Row label={t(K('additionalCosts'))} value={formatInr(result.additionalCost)} />
                <Row label={t(K('additionalCostPercent'))} value={`${result.additionalCostPercent.toFixed(2)}%`} />
              </ul>
            </div>

            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{result.homeLoan ? t(K('loanTitle')) : t(K('cashTitle'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                {result.homeLoan && <Row label={t(K('downPayment'))} value={formatInr(result.downPayment)} />}
                {result.homeLoan && <Row label={t(K('loanAmount'))} value={formatInr(result.loanAmount)} />}
                <Row label={t(K('governmentCharges'))} value={formatInr(result.governmentCharges)} />
                <Row label={t(K('otherCharges'))} value={formatInr(result.brokerage + result.legal + result.initialSetup)} />
                <Row label={t(K('initialCash'))} value={formatInr(result.initialCash)} strong />
              </ul>
              <MethodNote>{result.homeLoan ? t(K('loanNote')) : t(K('cashNote'))}</MethodNote>
            </div>
          </div>

          <MethodNote>
            {result.governmentConfigured ? `${t(K(result.sourceKey))} ` : ''}{t(K('method'))}
          </MethodNote>
        </>
      )}
    </div>
  )
}
