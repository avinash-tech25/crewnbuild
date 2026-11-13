/**
 * Stamp Duty & Registration Calculator.
 *
 * Frontend-only and driven entirely by what the user enters: the property
 * value starts empty and nothing is calculated until it is filled in. Rates
 * come only from the shared verified configuration (`propertyCharges.js`, via
 * `stampDuty.js`) and are always shown beside the amounts they produce.
 */
import { useMemo, useState } from 'react'
import { Stamp } from 'lucide-react'
import { BUYER_TYPES, EMPTY_INPUTS, PROPERTY_TYPES, STATES, calculateStampDuty, chargeConfigFor, formatInr } from './stampDuty.js'
import { Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.stampDuty.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const warnBorder = '!border-[#d97706]'

function Field({ label, error, children }) {
  return (
    <label className={labelClass}>
      {label}
      {children}
      {error && <span className={errorText}>{error}</span>}
    </label>
  )
}

function Row({ label, rate, value, strong = false, muted = false }) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <span className={muted ? 'text-oc-faint' : 'text-oc-muted'}>{label}</span>
      {rate && <span className="rounded-full bg-oc-sunken px-2 py-0.5 text-[11px] font-extrabold text-oc-deep">{rate}</span>}
      <span className={`ms-auto text-end ${strong ? 'font-extrabold text-oc-ink' : 'font-bold text-oc-ink'}`}>{value}</span>
    </li>
  )
}

// Shown under the value once something is typed, so a long number is readable.
const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatInr(Number(value)) : '')

export default function StampDutyCalculator() {
  const { t } = useLanguage()
  // Every input starts empty; nothing is calculated until a value is entered.
  const [form, setForm] = useState(EMPTY_INPUTS)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const { status, errors, result } = useMemo(() => calculateStampDuty(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field])) : '')
  const config = chargeConfigFor(form.state)
  const pct = (value) => `${value}%`

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Stamp className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t(K('propertyValue'))} error={err('propertyValue')}>
            <span className="relative mt-2 block">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-bold text-oc-muted">₹</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={form.propertyValue}
                placeholder={t(K('propertyValuePlaceholder'))}
                onChange={(event) => set('propertyValue')(event.target.value)}
                aria-invalid={Boolean(errors.propertyValue)}
                className={`${inputClass} !mt-0 ps-7 ${errors.propertyValue ? warnBorder : ''}`}
              />
            </span>
            {!errors.propertyValue && rupeeHint(form.propertyValue) && <span className="mt-1 block text-[11px] font-medium leading-4 text-oc-faint">{rupeeHint(form.propertyValue)}</span>}
          </Field>
          <Field label={t(K('state'))} error={err('state')}>
            <select value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value, areaType: '' }))} className={`${selectClass} ${errors.state ? warnBorder : ''}`}>
              <option value="">{t(K('selectState'))}</option>
              {STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
          </Field>
          <Field label={t(K('city'))} error={err('city')}>
            <input type="text" value={form.city} placeholder={t(K('cityPlaceholder'))} onChange={(event) => set('city')(event.target.value)} className={`${inputClass} ${errors.city ? warnBorder : ''}`} />
          </Field>
          {config && (
            <Field label={t(K('areaType'))} error={err('areaType')}>
              <select value={form.areaType} onChange={(event) => set('areaType')(event.target.value)} className={`${selectClass} ${errors.areaType ? warnBorder : ''}`}>
                <option value="">{t(K('selectArea'))}</option>
                {config.areaTypes.map((area) => <option key={area} value={area}>{t(K(`areaTypes.${area}`))}</option>)}
              </select>
            </Field>
          )}
          <Field label={t(K('propertyType'))} error={err('propertyType')}>
            <select value={form.propertyType} onChange={(event) => set('propertyType')(event.target.value)} className={selectClass}>
              {PROPERTY_TYPES.map((type) => <option key={type} value={type}>{t(K(`propertyTypes.${type}`))}</option>)}
            </select>
          </Field>
          <Field label={t(K('buyerType'))} error={err('buyerType')}>
            <select value={form.buyerType} onChange={(event) => set('buyerType')(event.target.value)} className={selectClass}>
              <option value="">{t(K('selectBuyer'))}</option>
              {BUYER_TYPES.map((type) => <option key={type} value={type}>{t(K(`buyerTypes.${type}`))}</option>)}
            </select>
          </Field>
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
          {result.configured && (
            <Headline
              label={t(K('headline'))}
              value={formatInr(result.total)}
              sub={`${t(K('effectiveLine'), { percent: result.effectivePercent.toFixed(2) })}${result.partial ? ` · ${t(K('partialEstimate'))}` : ''}`}
            />
          )}

          {result.partial && (
            <div className="rounded-2xl border border-[#f3d38a] bg-[#fef9ec] p-4 text-sm leading-6 text-[#7a5b0c]">
              <p className="font-extrabold">{t(K('partialEstimate'))}</p>
              <p>{result.configured ? t(K(result.notIncludedKey)) : t(K('notConfigured'))}</p>
            </div>
          )}

          <div className={cardClass}>
            <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('breakdown'))}</h2>
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              <Row label={t(K('propertyValue'))} value={formatInr(result.value)} />
              <Row
                label={t(K('stampDuty'))}
                rate={result.configured ? pct(result.stampDutyPercent) : null}
                value={result.configured ? formatInr(result.stampDuty) : t(K('notConfiguredShort'))}
                muted={!result.configured}
              />
              <Row
                label={t(K('registration'))}
                rate={result.configured ? pct(result.registrationPercent) : null}
                value={result.configured ? formatInr(result.registration) : t(K('notConfiguredShort'))}
                muted={!result.configured}
              />
            </ul>
            {result.configured && (
              <ul className="mt-1 border-t-2 border-[rgba(8,62,43,.15)]">
                <Row label={t(K('total'))} value={formatInr(result.total)} strong />
                <Row label={t(K('effective'))} value={`${result.effectivePercent.toFixed(2)}%`} />
              </ul>
            )}
          </div>

          <MethodNote>
            {result.configured ? `${t(K(result.sourceKey))} ` : ''}{t(K('method'))}
          </MethodNote>
        </>
      )}
    </div>
  )
}
