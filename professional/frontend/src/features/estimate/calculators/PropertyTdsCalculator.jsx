/**
 * Property TDS Calculator — Income-tax Act, 2025, section 393(1) [Table: Sl. No. 3(i)]
 * (formerly section 194-IA).
 *
 * Frontend-only estimate of the TDS a buyer deducts from a resident seller. Every
 * value starts empty and the seller-PAN choice must be made explicitly. Rule values
 * and official sources are in `propertyTds.js`. It does not file Form 141, generate
 * Form 132, or calculate stamp duty / registration.
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Info, ReceiptIndianRupee } from 'lucide-react'
import { EMPTY_INPUTS, OFFICIAL_LINKS, RULES, calculatePropertyTds, formatDate, formatInr, formatRupees } from './propertyTds.js'
import { Headline, MethodNote, cardClass, inputClass, labelClass, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const K = (key) => `site.calculators.propertyTds.${key}`
const errorText = 'mt-1 block text-[11px] font-bold leading-4 text-[#b45309]'
const hintText = 'mt-1 block text-[11px] font-medium leading-4 text-oc-faint'
const sectionTitle = 'text-xs font-extrabold uppercase tracking-wide text-oc-faint sm:col-span-2'
const warnBorder = '!border-[#d97706]'
const TONES = {
  applicable: { box: 'border-[#9ccfb2] bg-oc-mint text-oc-deep', Icon: CheckCircle2 },
  notApplicable: { box: 'border-[rgba(8,62,43,.12)] bg-oc-sunken text-oc-ink', Icon: Info },
  warning: { box: 'border-[#f0c36d] bg-[#fef3cd] text-[#6b4f00]', Icon: AlertTriangle },
  info: { box: 'border-[#b8d4f0] bg-[#eef5fc] text-[#1e3a5f]', Icon: Info },
}

function NumberInput({ label, value, onChange, error, placeholder, hint }) {
  return (
    <label className={labelClass}>
      {label}
      <span className="relative mt-2 block">
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-sm font-bold text-oc-muted">₹</span>
        <input type="number" inputMode="decimal" min="0" step="any" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} className={`${inputClass} !mt-0 ps-7 ${error ? warnBorder : ''}`} />
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

function Notice({ tone, title, children, testId }) {
  const { box, Icon } = TONES[tone]
  return (
    <section data-testid={testId} className={`rounded-2xl border p-4 sm:p-5 ${box}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <h2 className="font-display text-base font-extrabold leading-6 break-words">{title}</h2>
          <div className="mt-1 text-sm leading-6 break-words">{children}</div>
        </div>
      </div>
    </section>
  )
}

function Row({ label, value, strong = false }) {
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <span className="min-w-0 text-oc-muted">{label}</span>
      <span className={`ms-auto shrink-0 text-end ${strong ? 'font-extrabold' : 'font-bold'} text-oc-ink`}>{value}</span>
    </li>
  )
}

const OfficialLink = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-oc-green underline underline-offset-2 break-all">
    {children}<ExternalLink className="h-3.5 w-3.5 shrink-0" />
  </a>
)

const rupeeHint = (value) => (value !== '' && Number(value) > 0 ? formatRupees(Number(value)) : '')

export default function PropertyTdsCalculator() {
  const { t } = useLanguage()
  // Every value starts empty; PAN availability is never assumed.
  const [form, setForm] = useState(EMPTY_INPUTS)
  const set = (field) => (value) => setForm((current) => ({ ...current, [field]: value }))
  const { status, errors, result } = useMemo(() => calculatePropertyTds(form), [form])
  const err = (field) => (errors[field] ? t(K(errors[field])) : '')
  const threshold = formatInr(RULES.threshold)
  const rate = result?.ratePercent

  return (
    <div className="min-w-0 space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <ReceiptIndianRupee className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t(K('title'))}</h1>
        </div>
        <p className="mt-0.5 text-xs font-bold text-oc-faint">{t(K('subtitle'))}</p>
        <p className="mt-2 text-sm leading-6 text-oc-muted">{t(K('intro'))}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <p className={sectionTitle}>{t(K('sectionTransaction'))}</p>
          <NumberInput label={t(K('salePrice'))} value={form.salePrice} onChange={set('salePrice')} error={err('salePrice')} placeholder={t(K('salePricePlaceholder'))} hint={rupeeHint(form.salePrice) || t(K('salePriceHint'))} />
          <NumberInput label={t(K('stampDutyValue'))} value={form.stampDutyValue} onChange={set('stampDutyValue')} error={err('stampDutyValue')} placeholder={t(K('stampDutyValuePlaceholder'))} hint={rupeeHint(form.stampDutyValue) || t(K('stampDutyValueHint'))} />

          <p className={sectionTitle}>{t(K('sectionSeller'))}</p>
          <label className={labelClass}>
            {t(K('pan'))}
            <select value={form.panAvailable} onChange={(event) => set('panAvailable')(event.target.value)} className={`${selectClass} ${errors.panAvailable ? warnBorder : ''}`}>
              <option value="">{t(K('panSelect'))}</option>
              <option value="yes">{t(K('panYes'))}</option>
              <option value="no">{t(K('panNo'))}</option>
            </select>
            <span className={hintText}>{t(K('panHint'))}</span>
          </label>
          <p className="self-end rounded-xl bg-oc-sunken p-3 text-[11px] font-semibold leading-4 text-oc-muted">{t(K('residentNote'))}</p>

          <p className={sectionTitle}>{t(K('sectionDate'))}</p>
          <DateInput label={t(K('paymentDate'))} value={form.paymentDate} onChange={set('paymentDate')} error={err('paymentDate')} hint={t(K('paymentDateHint'))} />
          <DateInput label={t(K('creditDate'))} value={form.creditDate} onChange={set('creditDate')} error={err('creditDate')} hint={t(K('creditDateHint'))} />
        </div>
      </div>

      {['empty', 'incomplete', 'invalid'].includes(status) && (
        <div className={`${cardClass} text-center`}>
          <p className={`text-sm font-bold ${status === 'invalid' ? 'text-[#b45309]' : 'text-oc-muted'}`}>
            {{ empty: t(K('emptyState')), incomplete: t(K('incompleteState')), invalid: t(K('invalidState')) }[status]}
          </p>
        </div>
      )}

      {status === 'previous' && (
        <Notice tone="warning" title={t(K('previousTitle'))} testId="tds-applicability">
          <p>{t(K('previousBody'), { date: formatDate(result.deductionDate) })}</p>
          <p className="mt-2"><OfficialLink href={OFFICIAL_LINKS.section194IA}>{t(K('previousLink'))}</OfficialLink></p>
        </Notice>
      )}

      {status === 'ok' && result && (
        <>
          {result.applicability === 'applicable' && (
            <Notice tone="applicable" title={t(K('applicableTitle'))} testId="tds-applicability">
              {t(K('applicableBody'), { base: formatRupees(result.tdsBase), threshold })}
            </Notice>
          )}
          {result.applicability === 'notApplicable' && (
            <Notice tone="notApplicable" title={t(K('notApplicableTitle'))} testId="tds-applicability">
              {t(K('notApplicableBody'), { base: formatRupees(result.tdsBase), threshold })}
            </Notice>
          )}
          {result.applicability === 'boundary' && (
            <Notice tone="warning" title={t(K('boundaryTitle'))} testId="tds-applicability">
              <p>{t(K('boundaryBody'))}</p>
              <p className="mt-2 text-xs font-semibold">{t(K('boundaryDetail'))}</p>
            </Notice>
          )}

          {!result.panAvailable && result.applicability !== 'notApplicable' && (
            <Notice tone="warning" title={t(K('noPanTitle'))} testId="pan-warning">
              <p>{t(K('noPanBody'))}</p>
              <p className="mt-2"><OfficialLink href={OFFICIAL_LINKS.section397}>{t(K('linkSection397'))}</OfficialLink></p>
            </Notice>
          )}

          {result.applicability === 'applicable' && (
            <>
              <Headline label={t(K('headline'), { rate })} value={formatRupees(result.tds)} sub={t(K('headlineSub'), { net: formatRupees(result.netToSeller) })} />

              <div className="grid gap-4 lg:grid-cols-2">
                <div className={cardClass}>
                  <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('sellerPaymentTitle'))}</h2>
                  <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                    <Row label={t(K('grossConsideration'))} value={formatRupees(result.salePrice)} />
                    <Row label={t(K('lessTds'), { rate })} value={`− ${formatRupees(result.tds)}`} />
                    <Row label={t(K('netToSeller'))} value={result.tdsExceedsPrice ? `− ${formatRupees(-result.netToSeller)}` : formatRupees(result.netToSeller)} strong />
                  </ul>
                  {result.tdsExceedsPrice && <p className={errorText}>{t(K('tdsExceedsPrice'))}</p>}
                  {result.baseSource === 'stampDutyValue' && <p className={hintText}>{t(K('sdvBaseNote'))}</p>}
                </div>

                <div className={cardClass}>
                  <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('summaryTitle'))}</h2>
                  <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                    <Row label={t(K('salePrice'))} value={formatRupees(result.salePrice)} />
                    <Row label={t(K('stampDutyValue'))} value={formatRupees(result.stampDutyValue)} />
                    <Row label={t(K('tdsBase'))} value={`${formatRupees(result.tdsBase)} · ${t(K(`baseSource.${result.baseSource}`))}`} strong />
                    <Row label={t(K('tdsRate'))} value={`${rate}%`} />
                    <Row label={t(K('tdsDeducted'))} value={formatRupees(result.tds)} strong />
                    <Row label={t(K('netToSeller'))} value={result.tdsExceedsPrice ? `− ${formatRupees(-result.netToSeller)}` : formatRupees(result.netToSeller)} />
                  </ul>
                </div>
              </div>
            </>
          )}

          {result.applicability === 'boundary' && (
            <div className={cardClass}>
              <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('summaryTitle'))}</h2>
              <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                <Row label={t(K('salePrice'))} value={formatRupees(result.salePrice)} />
                <Row label={t(K('stampDutyValue'))} value={formatRupees(result.stampDutyValue)} />
                <Row label={t(K('tdsBase'))} value={formatRupees(result.tdsBase)} strong />
                <Row label={t(K('tdsAmount'))} value={t(K('notDetermined'))} />
              </ul>
            </div>
          )}

          {result.applicability !== 'notApplicable' && (
            <>
              <div className={cardClass} data-testid="tds-deadline">
                <h2 className="font-display text-base font-extrabold text-oc-ink">{t(K('depositTitle'))}</h2>
                <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
                  <Row label={t(K('deductionDate'))} value={`${formatDate(result.deductionDate)} · ${t(K(`deductionFrom.${result.deductionFrom}`))}`} />
                  <Row label={t(K('paymentDeadline'))} value={formatDate(result.paymentDeadline)} strong />
                  <Row label={t(K('certificateDeadline'))} value={formatDate(result.certificateDeadline)} />
                  <Row label={t(K('tan'))} value={t(K('tanValue'))} />
                </ul>
                <MethodNote>{t(K('deadlineNote'))}</MethodNote>
                <p className={hintText}>{t(K('tanVsPan'))}</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Notice tone="info" title={t(K('form141Title'))} testId="form-141">
                  <p>{t(K('form141Body'))}</p>
                  <p className="mt-2"><OfficialLink href={OFFICIAL_LINKS.form141Faq}>{t(K('form141Link'))}</OfficialLink></p>
                </Notice>
                <Notice tone="info" title={t(K('form132Title'))} testId="form-132">
                  <p>{t(K('form132Body'))}</p>
                  <p className="mt-2"><OfficialLink href={OFFICIAL_LINKS.form132Faq}>{t(K('form132Link'))}</OfficialLink></p>
                </Notice>
              </div>
            </>
          )}
        </>
      )}

      {status !== 'empty' && (
        <>
          <MethodNote>{t(K('scope'))}</MethodNote>
          <MethodNote>{t(K('method'))}</MethodNote>
          <MethodNote>
            {t(K('disclaimer'))} {t(K('rulesChange'))}{' '}
            <OfficialLink href={OFFICIAL_LINKS.section393}>{t(K('linkSection393'))}</OfficialLink>
          </MethodNote>
        </>
      )}
    </div>
  )
}
