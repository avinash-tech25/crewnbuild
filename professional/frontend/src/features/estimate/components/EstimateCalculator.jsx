/**
 * Public construction cost estimator, reached from the landing page's existing
 * "Get Free Estimate" action (`/estimate`).
 *
 * Structure follows the two-step calculator pattern the product team referenced:
 * step 1 collects the location, step 2 the project specification, and the result
 * leads with the total and the per-sq.ft rate before breaking the cost down by
 * resource. Nothing about the landing page or the route changed.
 *
 * Every number shown comes back from the existing `POST /estimates/calculate`
 * (`estimate_calculation()` in the backend). No rate, multiplier or percentage
 * is computed here. The two charts each walk a list that endpoint returns:
 *
 *   `resource_allocation`  the doughnut — one slice per resource bought on site
 *   `cost_phases`          the bars — one row per build phase
 *
 * Neither chart names a resource or a phase and neither fixes a share, so a
 * different breakdown renders without a change to this file. The percentages
 * beside them are recomputed from the amounts, so what is printed is always
 * what is drawn.
 *
 * Those phase bars are a COST distribution, never a schedule. The application
 * holds no per-stage duration, so none is shown or implied: only the overall
 * `estimated_duration_days`, which is real, appears above the chart.
 */
import { useMemo, useState } from 'react'
import { Calculator, ChevronLeft, ChevronRight, Printer, RotateCcw, Share2 } from 'lucide-react'
import { calculateVerifiedEstimate } from '../estimateApi.js'
import { FLOOR_OPTIONS, floorOption } from '../../../shared/utils/floorOptions.js'
import { PROJECT_COUNTRIES, projectCityOptions, projectStateOptions } from '../../../shared/utils/projectLocations.js'
import { ESTIMATE_LOCATION, evaluateEstimateLocation } from '../../../shared/utils/estimateLocationMatch.js'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { useLanguage as useLandingLanguage } from '../../public-site/components/landing/useLanguage.js'

const FLOOR_KEYS = {
  G: 'site.estimate.floor.g',
  'G+1': 'site.estimate.floor.g1',
  'G+2': 'site.estimate.floor.g2',
  'G+3': 'site.estimate.floor.g3',
  'G-1': 'site.estimate.floor.gm1',
  'G-2': 'site.estimate.floor.gm2',
  'G-3': 'site.estimate.floor.gm3',
  DUPLEX: 'site.estimate.floor.duplex',
  MANSION: 'site.estimate.floor.mansion',
}

const INDIA_BUILDING_TYPES = [
  { value: 'RESIDENTIAL', labelRes: 'site.estimate.buildingRes', label: 'Residential' },
  { value: 'COMMERCIAL', labelRes: 'site.estimate.buildingComm', label: 'Commercial' },
]

// Physical unit conversion, not pricing data. The backend's `plot_area` is
// always square feet, so this is the single place an entry made in square
// metres is converted on its way into the existing payload.
const SQ_FT_PER_SQ_METER = 10.7639
const UNIT_SQFT = 'SQFT'
const UNIT_SQM = 'SQM'

function toSquareFeet(area, unit) {
  const value = Number(area)
  if (!Number.isFinite(value) || value <= 0) return 0
  return unit === UNIT_SQM ? value * SQ_FT_PER_SQ_METER : value
}

const TOTAL_STEPS = 2

// The message for each location-verification outcome (estimateLocationMatch.js),
// also used for the server's own refusal codes.
const LOCATION_MESSAGE_KEYS = {
  [ESTIMATE_LOCATION.INVALID_PIN]: 'site.estimate.loc.invalidPin',
  [ESTIMATE_LOCATION.NOT_FOUND]: 'site.estimate.loc.notFound',
  [ESTIMATE_LOCATION.STATE_MISMATCH]: 'site.estimate.loc.stateMismatch',
  [ESTIMATE_LOCATION.CITY_MISMATCH]: 'site.estimate.loc.cityMismatch',
  [ESTIMATE_LOCATION.CITY_UNCONFIRMED]: 'site.estimate.loc.cityUnconfirmed',
  [ESTIMATE_LOCATION.UNAVAILABLE]: 'site.estimate.loc.unavailable',
}

const selectClass = 'mt-2 h-11 w-full rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)] disabled:bg-oc-sunken disabled:text-oc-faint'
const inputClass = 'mt-2 h-11 w-full rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-oc-faint focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)]'
const labelClass = 'block text-xs font-bold text-oc-muted'
const primaryButtonClass = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-oc-green px-6 text-sm font-extrabold text-white shadow-[0_11px_25px_rgba(18,107,69,.18)] transition hover:bg-oc-deep hover:-translate-y-[2px] disabled:opacity-50'
const ghostButtonClass = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-5 text-sm font-extrabold text-oc-muted transition hover:border-oc-green hover:text-oc-deep'

// Gridline / label positions along the phase axis, as fractions of its span. A
// drawing scale, not business data -- the axis ceiling itself is read off the
// phases the API returned, and the bars are positioned from their own shares.
const AXIS_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

// Slice colours, assigned to resource rows in this fixed order and never cycled.
// The order is the mechanism that keeps neighbouring slices apart for colour-
// blind readers, so it is not a cosmetic list: validated as a set against a
// white surface, worst adjacent CVD dE 9.1, worst normal-vision dE 19.6. Three
// of them fall under 3:1 contrast on white, which is why every slice is also
// named and valued in the legend rather than identified by its colour alone.
const SLICE_COLOURS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
]
// A row past the validated order takes the neutral rather than a repeated hue:
// a cycled colour would claim an identity another slice already owns.
const SLICE_NEUTRAL = '#61736a'
const sliceColour = (index) => SLICE_COLOURS[index] ?? SLICE_NEUTRAL

// Donut geometry. `pathLength` renormalises every arc to 100 units, so a slice
// is drawn straight from its percentage with no circumference arithmetic.
const DONUT_SIZE = 200
const DONUT_RADIUS = 70
const DONUT_STROKE = 30
const DONUT_PATH_LENGTH = 100
// Roughly 2px of surface between slices, in those renormalised units.
const DONUT_GAP = (2 / (2 * Math.PI * DONUT_RADIUS)) * DONUT_PATH_LENGTH

export default function EstimateCalculator() {
  const { t } = useLanguage()
  const { text } = useLandingLanguage()
  const [step, setStep] = useState(1)
  const [country, setCountry] = useState('India')
  const [form, setForm] = useState({
    state: '',
    city: '',
    pincode: '',
    area: '',
    unit: UNIT_SQFT,
    floors: 'G',
    construction_type: 'CONTRACTOR',
    building_type: 'RESIDENTIAL',
    finishing_type: 'standard',
    budget: 0,
  })
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const countryFloors = FLOOR_OPTIONS
  const countryBuildingTypes = INDIA_BUILDING_TYPES
  const pincodeMaxLength = 6
  const pincodePlaceholder = '500001'

  // The application's existing location data. Cities depend on the selected
  // state, so no state -> city mapping is defined here.
  const stateOptions = useMemo(() => projectStateOptions(country), [country])
  const cityOptions = useMemo(() => projectCityOptions(country, form.state), [country, form.state])

  const pincodeLookupState = usePincodeAreaLookup(form.pincode, undefined, country)

  // Worked out afresh on every render from the CURRENT country, state, city,
  // PIN and lookup result -- never stored -- so changing any of them takes
  // back an earlier "verified" at once, and a lookup that answered for a
  // different PIN is never used (see estimateLocationMatch.js).
  const locationCheck = evaluateEstimateLocation({
    country,
    state: form.state,
    city: form.city,
    pincode: form.pincode,
    lookupState: pincodeLookupState,
    cityOptions,
  })
  const locationVerified = locationCheck.status === ESTIMATE_LOCATION.VERIFIED
  // What to say under the fields right now. Nothing while the PIN is still
  // being typed (the field's own hint covers that).
  const pinTyped = form.pincode.length === pincodeMaxLength
  const locationNote = (() => {
    if (locationVerified) return ''
    if (pincodeLookupState.status === 'loading' && form.state && form.city) return t('site.estimate.loc.verifying')
    if (locationCheck.status === ESTIMATE_LOCATION.INVALID_PIN) return pinTyped ? t('site.estimate.loc.invalidPin') : ''
    const key = LOCATION_MESSAGE_KEYS[locationCheck.status]
    return key ? t(key) : ''
  })()

  const handleCountryChange = (nextCountry) => {
    setCountry(nextCountry)
    setForm((current) => ({
      ...current,
      state: '',
      city: '',
      pincode: '',
      floors: 'G',
      building_type: 'RESIDENTIAL',
    }))
    setResult(null)
    setMessage('')
    setNotice('')
    setStep(1)
  }

  const goToSpecification = () => {
    if (!form.state) return setMessage(t('site.estimate.errState'))
    if (!form.city) return setMessage(t('site.estimate.errCity'))
    // Re-checked at the moment of the click against the values on screen, so
    // a quick click while a lookup runs (or after one failed) never passes.
    if (!locationVerified) {
      if (locationCheck.status === ESTIMATE_LOCATION.PENDING) return setMessage(t('site.estimate.loc.verifying'))
      return setMessage(t(LOCATION_MESSAGE_KEYS[locationCheck.status] || 'site.estimate.loc.unavailable'))
    }
    setMessage('')
    return setStep(2)
  }

  const resetAll = () => {
    setForm({
      state: '',
      city: '',
      pincode: '',
      area: '',
      unit: UNIT_SQFT,
      floors: 'G',
      construction_type: 'CONTRACTOR',
      building_type: 'RESIDENTIAL',
      finishing_type: 'standard',
      budget: 0,
    })
    setResult(null)
    setMessage('')
    setNotice('')
    setStep(1)
  }

  const calculate = async (event) => {
    event.preventDefault()
    setMessage('')
    setNotice('')
    setResult(null)
    const squareFeet = toSquareFeet(form.area, form.unit)
    const selectedFloor = floorOption(form.floors)
    if (squareFeet <= 0) return setMessage(t('site.estimate.errArea'))
    if (!selectedFloor) return setMessage(t('site.estimate.errFloor'))
    if (!locationVerified) {
      // The location changed or was never verified: back to step 1.
      setStep(1)
      return setMessage(t(LOCATION_MESSAGE_KEYS[locationCheck.status] || 'site.estimate.loc.verifying'))
    }
    setBusy(true)
    try {
      // The server verifies the location again, then returns every figure
      // from the same estimate calculation as before.
      setResult(await calculateVerifiedEstimate({
        country,
        state: form.state,
        city: form.city,
        pincode: form.pincode,
        plot_area: squareFeet,
        floors: selectedFloor.floors,
        floor_type: selectedFloor.value,
        construction_type: form.construction_type,
        building_type: form.building_type,
        finishing_type: form.finishing_type,
        budget: form.budget,
      }))
    } catch (error) {
      const detail = error.response?.data?.detail
      const locationKey = LOCATION_MESSAGE_KEYS[detail?.code]
      if (locationKey) {
        // The server refused the location: show it in the user's language
        // and return to the location step.
        setStep(1)
        setMessage(t(locationKey))
      } else {
        setMessage((typeof detail === 'string' && detail) || t('site.estimate.errCalc'))
      }
    } finally {
      setBusy(false)
    }
    return undefined
  }

  const formatMoney = (value) => {
    const amount = Math.round(Number(value || 0))
    return `₹${amount.toLocaleString('en-IN')}`
  }

  const floorLabel = (value) => {
    const key = FLOOR_KEYS[value]
    if (key) return t(key)
    const floors = Number(value || 1)
    return `${floors} ${floors === 1 ? t('site.estimate.result.floor') : t('site.estimate.result.floors')}`
  }

  // Cost by resource, exactly as the endpoint broke it down. The component names
  // no resource and fixes no share: it walks whatever rows come back, so a
  // different resource set renders here without a change.
  const allocation = (Array.isArray(result?.resource_allocation) ? result.resource_allocation : [])
    .map((row) => ({ label: row.name, amount: Number(row.amount || 0) }))
  const allocationTotal = allocation.reduce((sum, row) => sum + row.amount, 0)
  const allocationShare = (amount) => (allocationTotal > 0 ? (amount / allocationTotal) * 100 : 0)

  // The same rows laid end to end around the ring. `offset` is the share of the
  // slices before this one, which is where its arc starts.
  const allocationSlices = allocation.reduce((slices, row, index) => {
    const previous = slices[slices.length - 1]
    return [...slices, {
      ...row,
      percent: allocationShare(row.amount),
      offset: previous ? previous.offset + previous.percent : 0,
      colour: sliceColour(index),
    }]
  }, [])

  // Cost per build phase, straight from the response, falling back to the
  // three-stage escrow view if the API predates the phase breakdown. As with the
  // slices above, the component never names a phase or fixes a share.
  //
  // Bars all start at zero so their lengths are directly comparable. The axis is
  // a percentage of total cost, never a day scale -- the application holds no
  // per-stage duration, so none is claimed.
  const phases = Array.isArray(result?.cost_phases) && result.cost_phases.length > 0
    ? result.cost_phases
    : (Array.isArray(result?.construction_stages) ? result.construction_stages : [])
  const phaseRows = phases.map((phase) => ({ ...phase, percent: Number(phase.share || 0) * 100 }))

  // Axis ceiling read off the data and rounded up to a whole 5%, so the bars
  // fill the track instead of huddling at the left of a 0-100 scale that no
  // single phase ever approaches.
  const phasePeak = phaseRows.reduce((peak, row) => Math.max(peak, row.percent), 0)
  const phaseAxisMax = Math.max(5, Math.ceil(phasePeak / 5) * 5)

  const convertedArea = toSquareFeet(form.area, form.unit)
  const convertedAreaHint = form.unit === UNIT_SQM && convertedArea > 0
    ? t('site.estimate.areaConverted', { value: Math.round(convertedArea).toLocaleString('en-IN') })
    : ''

  // Uses only what is already on screen — no second calculation, no request.
  const shareSummary = () => {
    if (!result) return ''
    return [
      t('site.estimate.shareTitle'),
      `${t('site.estimate.result.total')}: ${formatMoney(result.estimated_cost)}`,
      `${t('site.estimate.result.perSqft')}: ${formatMoney(result.rate_per_sqft)}`,
      `${t('site.estimate.result.builtUp')}: ${Number(result.built_up_area).toLocaleString('en-IN')} sq.ft`,
      `${t('site.estimate.result.rateZone')}: ${result.rate_zone}`,
      ...allocation.map((row) => `${row.label}: ${formatMoney(row.amount)}`),
    ].join('\n')
  }

  const share = async () => {
    const summary = shareSummary()
    if (!summary) return
    setNotice('')
    try {
      if (navigator.share) {
        await navigator.share({ title: t('site.estimate.shareTitle'), text: summary })
        return
      }
      await navigator.clipboard.writeText(summary)
      setNotice(t('site.estimate.shareCopied'))
    } catch (error) {
      // Dismissing the system share sheet is a choice, not a failure.
      if (error?.name === 'AbortError') return
      setNotice(t('site.estimate.shareFailed'))
    }
  }

  const summaryRows = result
    ? [
      [t('site.estimate.result.floorConfig'), floorLabel(result.floor_type)],
      [t('site.estimate.result.builtUp'), `${Number(result.built_up_area).toLocaleString('en-IN')} sq.ft`],
      [t('site.estimate.result.rateZone'), result.rate_zone],
      [t('site.estimate.result.locationAdj'), Number(result.location_multiplier).toLocaleString('en-IN', { style: 'percent', maximumFractionDigits: 0 })],
      [t('site.estimate.result.subtotal'), formatMoney(result.construction_subtotal)],
      // The contingency the total already includes, so subtotal + contingency
      // visibly adds up to the headline figure.
      [t('site.estimate.result.contingency'), formatMoney(result.contingency_estimate)],
      [t('site.estimate.result.duration'), t('site.estimate.result.days', { days: result.estimated_duration_days })],
    ]
    : []

  // The resource ring is labelled an indicative split of the total, since the
  // estimate calculates no material quantities.
  const allocationTitle = t('site.estimate.result.allocationIndicative')

  return (
    <div className="overflow-x-clip bg-oc-paper font-display text-oc-ink" id="top">
      {/* Wrapped rather than modified: the shared site header is hidden when
          the estimate is printed, without touching the component itself. */}
      <div className="print:hidden">
        <SiteHeader text={text} brandHref="/" />
      </div>

      <main className="pt-[clamp(108px,14vh,156px)] max-wide:pt-[92px] print:pt-0">
        <section className="px-4 pb-20 sm:px-6 print:px-0 print:pb-0">
          <div className="mx-auto max-w-3xl">
            <div className="text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200"><Calculator className="h-4 w-4" />{t('site.estimate.badge')}</span>
              <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">{t('site.estimate.title')}</h1>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{t('site.estimate.sub')}</p>
            </div>

            {/* ------------------------------------------------- steps */}
            {!result && (
              <form onSubmit={calculate} className="mt-8 rounded-2xl border border-[rgba(8,62,43,.1)] bg-white p-5 shadow-[0_8px_30px_-8px_rgba(15,23,42,.06)] sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(8,62,43,.1)] pb-4">
                  <div className="flex items-center gap-2">
                    {[1, 2].map((index) => (
                      <span
                        key={index}
                        className={`grid h-7 w-7 place-items-center rounded-full text-xs font-extrabold transition ${
                          step === index ? 'bg-oc-green text-white' : 'bg-oc-sunken text-oc-faint'
                        }`}
                      >
                        {index}
                      </span>
                    ))}
                    <span className="ms-1 text-sm font-extrabold text-oc-ink">
                      {step === 1 ? t('site.estimate.stepLocation') : t('site.estimate.details')}
                    </span>
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wide text-oc-faint">
                    {t('site.estimate.step', { current: step, total: TOTAL_STEPS })}
                  </span>
                </div>

                {step === 1 && (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className={labelClass}>{t('site.estimate.country')}
                      <select value={country} onChange={(event) => handleCountryChange(event.target.value)} className={selectClass}>
                        {PROJECT_COUNTRIES.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    <label className={labelClass}>{t('site.estimate.state')}
                      <select
                        value={form.state}
                        onChange={(event) => { setMessage(''); setForm((current) => ({ ...current, state: event.target.value, city: '' })) }}
                        className={selectClass}
                      >
                        <option value="">{t('site.estimate.statePh')}</option>
                        {stateOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>

                    <label className={labelClass}>{t('site.estimate.city')}
                      <select
                        value={form.city}
                        onChange={(event) => { setMessage(''); update('city', event.target.value) }}
                        disabled={!form.state}
                        className={selectClass}
                      >
                        <option value="">{form.state ? t('site.estimate.cityPh') : t('site.estimate.cityFirst')}</option>
                        {cityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>

                    <label className={labelClass}>{t('site.estimate.pincode')}
                      <input
                        value={form.pincode}
                        onChange={(event) => { setMessage(''); update('pincode', event.target.value.replace(/\D/g, '').slice(-pincodeMaxLength)) }}
                        inputMode="numeric"
                        maxLength={pincodeMaxLength}
                        placeholder={pincodePlaceholder}
                        className={inputClass}
                      />
                      <PincodeAreaHint lookupState={pincodeLookupState} />
                    </label>

                    {/* The PIN checked against the selected state AND city. */}
                    {(locationNote || !locationVerified) && (
                      <p
                        role={locationNote && pincodeLookupState.status !== 'loading' ? 'alert' : undefined}
                        className={`sm:col-span-2 text-[12px] font-semibold ${locationNote && pincodeLookupState.status !== 'loading' ? 'text-warm' : 'text-oc-faint'}`}
                      >
                        {locationNote || t('site.estimate.loc.needAll')}
                      </p>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <span className={labelClass}>{t('site.estimate.area')}</span>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                        <input
                          required
                          type="number"
                          min="1"
                          step="any"
                          value={form.area}
                          onChange={(event) => update('area', event.target.value)}
                          placeholder={t('site.estimate.areaPh')}
                          className={`${inputClass} mt-0 flex-1`}
                        />
                        <div className="inline-flex shrink-0 rounded-xl border border-[rgba(8,62,43,.15)] bg-oc-sunken p-1">
                          {[[UNIT_SQFT, t('site.estimate.unitSqft')], [UNIT_SQM, t('site.estimate.unitSqm')]].map(([value, unitLabel]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => update('unit', value)}
                              aria-pressed={form.unit === value}
                              className={`h-9 rounded-lg px-4 text-xs font-extrabold transition ${
                                form.unit === value ? 'bg-oc-green text-white shadow-[0_8px_18px_-10px_rgba(18,107,69,.8)]' : 'text-oc-muted hover:text-oc-deep'
                              }`}
                            >
                              {unitLabel}
                            </button>
                          ))}
                        </div>
                      </div>
                      <span className="mt-1 block text-[11px] font-medium leading-4 text-oc-faint">
                        {convertedAreaHint || t('site.estimate.areaHint')}
                      </span>
                    </div>

                    <label className={labelClass}>{t('site.estimate.floors')}
                      <select required value={form.floors} onChange={(event) => update('floors', event.target.value)} className={selectClass}>
                        {countryFloors.map((option) => <option key={option.value} value={option.value}>{floorLabel(option.value)}</option>)}
                      </select>
                    </label>

                    <label className={labelClass}>{t('site.estimate.buildingType')}
                      <select value={form.building_type} onChange={(event) => update('building_type', event.target.value)} className={selectClass}>
                        {countryBuildingTypes.map((buildingType) => (
                          <option key={buildingType.value} value={buildingType.value}>
                            {buildingType.labelRes ? t(buildingType.labelRes) : buildingType.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className={`${labelClass} sm:col-span-2`}>{t('site.estimate.finishing')}
                      <select value={form.finishing_type} onChange={(event) => update('finishing_type', event.target.value)} className={selectClass}>
                        <option value="standard">{t('site.estimate.finStd')}</option>
                        <option value="premium">{t('site.estimate.finPrem')}</option>
                      </select>
                    </label>
                  </div>
                )}

                {message && <p className="mt-4 rounded-xl bg-[#fef3cd] px-4 py-3 text-sm font-bold text-[#856404]">{message}</p>}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {step === 1 ? (
                    <button type="button" onClick={goToSpecification} disabled={!locationVerified} className={primaryButtonClass}>
                      {t('site.estimate.next')}<ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setMessage(''); setStep(1) }} className={ghostButtonClass}>
                        <ChevronLeft className="h-4 w-4" />{t('site.estimate.back')}
                      </button>
                      <button disabled={busy} type="submit" className={primaryButtonClass}>
                        <Calculator className="h-4 w-4" />{busy ? t('site.estimate.calculating') : t('site.estimate.calc')}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={resetAll} className={`${ghostButtonClass} ms-auto`}>
                    <RotateCcw className="h-4 w-4" />{t('site.estimate.reset')}
                  </button>
                </div>
              </form>
            )}

            {/* ------------------------------------------------ result */}
            {result && (
              <div className="mt-8 space-y-4">
                <section className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-oc-deep p-5 text-white shadow-[0_8px_30px_-8px_rgba(15,23,42,.06)] sm:p-7">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#b9d8c5]">{t('site.estimate.result.total')}</p>
                  <p className="mt-2 font-display text-4xl font-extrabold leading-none text-white">{formatMoney(result.estimated_cost)}</p>
                  {/* Uses the existing range template, so both bounds are
                      substituted rather than shown as placeholders. */}
                  <p className="mt-2 text-xs font-semibold text-[#b9d8c5]">
                    {t('site.estimate.result.range', {
                      low: formatMoney(result.estimated_range_low),
                      high: formatMoney(result.estimated_range_high),
                    })}
                  </p>
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#b9d8c5]">{t('site.estimate.result.perSqft')}</p>
                    <p className="mt-1 font-display text-2xl font-extrabold text-white">{formatMoney(result.rate_per_sqft)}</p>
                  </div>
                </section>

                {allocationSlices.length > 0 && (
                  <section className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-white p-5 shadow-[0_8px_30px_-8px_rgba(15,23,42,.06)] sm:p-7">
                    <h2 className="font-display text-lg font-extrabold text-oc-ink">{allocationTitle}</h2>
                    <p className="mt-1 text-[11px] font-medium leading-4 text-oc-faint">{t('site.estimate.result.allocationNote')}</p>

                    {/* Ring above the legend on a phone, beside it from `sm` up. */}
                    <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:gap-7">
                      <svg
                        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
                        className="h-44 w-44 shrink-0 -rotate-90"
                        role="img"
                        aria-label={allocationTitle}
                      >
                        {allocationSlices.map((slice) => (
                          <circle
                            key={slice.label}
                            cx={DONUT_SIZE / 2}
                            cy={DONUT_SIZE / 2}
                            r={DONUT_RADIUS}
                            fill="none"
                            stroke={slice.colour}
                            strokeWidth={DONUT_STROKE}
                            // Renormalised to 100, so the arc IS the percentage.
                            // The dash gap is oversized on purpose: it only has
                            // to outrun the ring so the pattern never repeats.
                            pathLength={DONUT_PATH_LENGTH}
                            strokeDasharray={`${Math.max(slice.percent - DONUT_GAP, 0)} ${DONUT_PATH_LENGTH}`}
                            strokeDashoffset={-slice.offset}
                          >
                            <title>{`${slice.label}: ${formatMoney(slice.amount)} (${slice.percent.toFixed(1)}%)`}</title>
                          </circle>
                        ))}
                      </svg>

                      {/* Every slice is named and valued here, so identity never
                          rests on colour alone -- which is also what earns the
                          lighter slices their place against a white surface. */}
                      <ul className="w-full space-y-2.5">
                        {allocationSlices.map((slice) => (
                          <li key={slice.label} className="flex items-center gap-3 text-sm">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: slice.colour }}
                            />
                            <span className="text-oc-muted">{slice.label}</span>
                            <span className="ms-auto font-extrabold text-oc-ink">{formatMoney(slice.amount)}</span>
                            <span className="w-12 text-end text-xs font-bold text-oc-faint">
                              {slice.percent.toFixed(0)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </section>
                )}

                {phaseRows.length > 0 && (
                  <section className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-white p-5 shadow-[0_8px_30px_-8px_rgba(15,23,42,.06)] sm:p-7">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h2 className="font-display text-lg font-extrabold text-oc-ink">{t('site.estimate.result.stages')}</h2>
                      <span className="rounded-full bg-oc-sunken px-3 py-1 text-[11px] font-extrabold text-oc-deep">
                        {t('site.estimate.result.overallDuration', { days: result.estimated_duration_days })}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-medium leading-4 text-oc-faint">{t('site.estimate.result.stagesNote')}</p>
                    <p className="mt-1 text-[11px] font-medium leading-4 text-oc-faint">{t('site.estimate.result.stagesSameTotal')}</p>

                    {/* Narrow screens scroll the chart sideways rather than
                        crushing the bars into unreadable slivers. */}
                    <div className="mt-5 overflow-x-auto">
                      <div className="sm:min-w-[460px]">
                        {phaseRows.map((phase) => (
                          <div key={phase.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1 sm:flex-nowrap">
                            <span className="shrink-0 truncate text-[13px] font-extrabold text-oc-ink sm:w-40">{phase.name}</span>

                            {/* `order-last` + `w-full` drop the bar onto its own
                                line while the row is wrapping; from `sm` up it
                                returns to the middle column it has always been. */}
                            <span className="relative order-last h-6 w-full overflow-hidden rounded-lg bg-oc-sunken sm:order-none sm:w-auto sm:flex-1">
                              {/* Quarter gridlines: an axis, not data. */}
                              {AXIS_FRACTIONS.slice(1, -1).map((fraction) => (
                                <span key={fraction} className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${fraction * 100}%` }} />
                              ))}
                              {/* Anchored at zero, so bar lengths compare
                                  directly. Width is the phase's share measured
                                  against the axis ceiling, not against 100%. */}
                              <span
                                className="absolute inset-y-0 start-0 rounded-e-lg bg-gradient-to-r from-oc-green to-ocbrand-400 shadow-[0_6px_14px_-8px_rgba(18,107,69,.9)]"
                                style={{ width: `${(phase.percent / phaseAxisMax) * 100}%` }}
                                title={`${phase.name}: ${formatMoney(phase.amount)} (${phase.percent.toFixed(1)}%)`}
                              />
                            </span>

                            <span className="ms-auto shrink-0 text-[13px] font-extrabold text-oc-ink sm:ms-0 sm:w-32 sm:text-end">{formatMoney(phase.amount)}</span>
                            <span className="shrink-0 text-xs font-bold text-oc-faint sm:w-12 sm:text-end">{phase.percent.toFixed(1)}%</span>
                          </div>
                        ))}

                        {/* Percentage-of-cost scale, aligned to the bar track.
                            Ticks are cut from the same ceiling the bars are
                            drawn against, so the axis cannot disagree with them. */}
                        <div className="mt-2 flex items-center gap-3">
                          <span className="hidden w-40 shrink-0 sm:block" />
                          <span className="relative h-4 flex-1">
                            {AXIS_FRACTIONS.map((fraction) => (
                              <span
                                key={fraction}
                                // Edge labels tuck inside the track while the
                                // column spacers are hidden, so the chart never
                                // overflows on a phone. From `sm` up the spacers
                                // return and every tick centres as before.
                                className="absolute top-0 -translate-x-1/2 text-[10px] font-bold text-oc-faint first:translate-x-0 last:-translate-x-full sm:first:-translate-x-1/2 sm:last:-translate-x-1/2"
                                style={{ left: `${fraction * 100}%` }}
                              >
                                {Math.round(phaseAxisMax * fraction)}%
                              </span>
                            ))}
                          </span>
                          <span className="hidden w-32 shrink-0 sm:block" />
                          <span className="hidden w-12 shrink-0 sm:block" />
                        </div>
                        <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-oc-faint">
                          {t('site.estimate.result.shareOfCost')}
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                <section className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-white p-5 shadow-[0_8px_30px_-8px_rgba(15,23,42,.06)] sm:p-7">
                  <h2 className="font-display text-lg font-extrabold text-oc-ink">{t('site.estimate.result.summary')}</h2>
                  <dl className="mt-4 space-y-2.5 text-sm">
                    {summaryRows.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4">
                        <dt className="text-oc-muted">{label}</dt>
                        <dd className="text-end font-extrabold text-oc-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-5 rounded-xl bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">
                    {result.disclaimer}
                    <> {t('site.estimate.result.gstNote')}</>
                  </p>
                </section>

                {notice && <p className="rounded-xl bg-oc-mint px-4 py-3 text-sm font-bold text-oc-deep print:hidden">{notice}</p>}

                <div className="flex flex-wrap items-center gap-3 print:hidden">
                  <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
                    <Printer className="h-4 w-4" />{t('site.estimate.print')}
                  </button>
                  <button type="button" onClick={share} className={ghostButtonClass}>
                    <Share2 className="h-4 w-4" />{t('site.estimate.share')}
                  </button>
                  <button type="button" onClick={resetAll} className={`${ghostButtonClass} ms-auto`}>
                    <RotateCcw className="h-4 w-4" />{t('site.estimate.reset')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
