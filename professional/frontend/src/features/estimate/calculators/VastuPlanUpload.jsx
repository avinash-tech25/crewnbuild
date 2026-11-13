/**
 * "Upload Your Plan" — the second, independent way to run a Vastu check.
 *
 * The existing direction calculator asks which way each room faces. This block
 * asks instead for the plan itself, and works the direction out from geometry:
 * where a room sits relative to the centre of the plan, once the plan's own
 * orientation is known.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do, and why
 * ---------------------------------------------------------------------------
 * It does not detect rooms automatically. This project has no vision or OCR
 * capability of any kind — there is no image-analysis service, no model client
 * and no such dependency anywhere in the codebase — so nothing here could read
 * a floor plan and name its rooms. Rather than print invented detections, the
 * plan is shown at a workable size and the person marks the centre and each
 * room on it. Everything after that point is computed, not guessed:
 *
 *   direction of a room = the bearing from the centre point to the room marker,
 *                         rotated by the orientation the user confirmed
 *
 * so the result depends on the uploaded plan, the orientation, the centre and
 * the marked positions. The same inputs always give the same answer.
 *
 * Orientation and centre start from the two assumptions that hold for most
 * plans — drawn north-up, building centred in the drawing — so the only thing
 * left to do is mark the rooms. Both are labelled as starting points on screen
 * and both remain editable; neither is applied silently.
 *
 * Scoring is not reimplemented here. The marked rooms are turned into the same
 * `{ component: direction }` shape the manual calculator produces and handed to
 * the same `evaluateVastu` engine, so both routes share one set of rules, one
 * set of bands and one methodology.
 *
 * Nothing is uploaded or stored: the file is read into an object URL in the
 * browser and released again. No endpoint, no table, no column, no migration.
 *
 * PDF is deliberately not accepted — rendering one needs a PDF library this
 * frontend does not have, and adding a dependency for it is outside an additive
 * UI change. The field says so rather than failing silently on a .pdf.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, MapPin, Upload, X } from 'lucide-react'
import {
  VASTU_COMPONENTS,
  VASTU_DIRECTIONS,
  evaluateVastu,
} from './vastuRules.js'
import {
  ErrorNote,
  Headline,
  MethodNote,
  cardClass,
  labelClass,
  placementAdvice,
  selectClass,
} from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// The eight zones in bearing order, 45° apart starting at North. Index × 45 is
// the zone's bearing, which is what makes the arithmetic below a lookup rather
// than a table of special cases.
const BEARING_ORDER = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

// Matches the 10 MB ceiling the rest of the application already applies to
// uploads, so the two do not disagree about what is too large.
const MAX_BYTES = 10 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png']

// The rooms that must be marked before a score is produced. Taken from the
// shared rule set, so this and the manual calculator can never disagree about
// what is required.
const REQUIRED_COMPONENTS = VASTU_COMPONENTS.filter((component) => component.required)

const TONE_CLASS = {
  good: 'bg-oc-mint text-oc-deep',
  warn: 'bg-[#fef3cd] text-[#856404]',
  bad: 'bg-[#fdecea] text-[#a12622]',
}

/**
 * The compass zone a marked point falls in.
 *
 * `topKey` is the real-world direction the top edge of the plan faces, so the
 * bearing measured on screen is rotated by that amount to get the real bearing.
 * Sizes are used rather than percentages so a non-square plan does not skew the
 * angle.
 */
export function zoneFor(centre, point, topKey, dims) {
  const dx = (point.x - centre.x) * dims.w
  const dy = (point.y - centre.y) * dims.h
  if (dx === 0 && dy === 0) return null // exactly on the centre: no direction
  // Screen bearing, 0° = up the page, increasing clockwise.
  const screenBearing = (Math.atan2(dx, -dy) * 180) / Math.PI
  const topOffset = BEARING_ORDER.indexOf(topKey) * 45
  const absolute = (screenBearing + topOffset + 360) % 360
  return BEARING_ORDER[Math.round(absolute / 45) % 8]
}

export default function VastuPlanUpload() {
  const { t } = useLanguage()
  const [plan, setPlan] = useState(null)        // { url, name, dims }
  const [fileError, setFileError] = useState('')
  const [topKey, setTopKey] = useState('')      // set to a stated default on upload
  const [centre, setCentre] = useState(null)    // { x, y } as 0..1 of the image
  const [placing, setPlacing] = useState(null)  // 'centre' | component key
  const [marks, setMarks] = useState({})        // { componentKey: {x,y} }
  const [analysed, setAnalysed] = useState(false)
  const imageRef = useRef(null)

  // The object URL belongs to this component; release it when the plan changes
  // or the block goes away so the browser does not hold the file open.
  useEffect(() => () => { if (plan?.url) URL.revokeObjectURL(plan.url) }, [plan])

  const chooseFile = (file) => {
    setFileError('')
    if (!file) return
    if (!ACCEPTED.includes(file.type)) {
      setFileError(t('site.calculators.plan.errType'))
      return
    }
    if (file.size > MAX_BYTES) {
      setFileError(t('site.calculators.plan.errSize'))
      return
    }
    if (plan?.url) URL.revokeObjectURL(plan.url)
    // A new plan invalidates everything measured against the old one.
    setPlan({ url: URL.createObjectURL(file), name: file.name, dims: { w: 1, h: 1 } })
    // Start from the two assumptions that hold for most plans rather than
    // asking for them: plans are usually drawn north-up, and the centre of the
    // drawing is usually the centre of the building. Both are stated on screen
    // and both stay editable, so this is a starting point rather than a guess
    // presented as fact.
    setTopKey('n')
    setCentre({ x: 0.5, y: 0.5 })
    setMarks({})
    setPlacing(null)
    setAnalysed(false)
  }

  const measure = useCallback(() => {
    const node = imageRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setPlan((current) => (current ? { ...current, dims: { w: rect.width, h: rect.height } } : current))
  }, [])

  useEffect(() => {
    if (!plan?.url) return undefined
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [plan?.url, measure])

  const clickPlan = (event) => {
    if (!placing) return
    const rect = event.currentTarget.getBoundingClientRect()
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
    if (placing === 'centre') setCentre(point)
    else setMarks((current) => ({ ...current, [placing]: point }))
    setPlacing(null)
  }

  const clearMark = (key) => setMarks((current) => {
    const next = { ...current }
    delete next[key]
    return next
  })

  // Every marked room, with the direction worked out from the plan itself.
  const placements = useMemo(() => {
    if (!plan || !centre || !topKey) return []
    return VASTU_COMPONENTS
      .filter((component) => marks[component.key])
      .map((component) => ({
        component,
        point: marks[component.key],
        direction: zoneFor(centre, marks[component.key], topKey, plan.dims),
      }))
      .filter((item) => item.direction)
  }, [plan, centre, topKey, marks])

  // Handed to the same engine the manual calculator uses — same rules, same
  // bands, same wording. Nothing about the scoring lives in this file.
  const result = useMemo(
    () => evaluateVastu(Object.fromEntries(placements.map((item) => [item.component.key, item.direction]))),
    [placements],
  )

  // Counted from the marks themselves, so it is right even before an
  // orientation makes the directions computable.
  const markedRequired = REQUIRED_COMPONENTS.filter((component) => marks[component.key]).length

  const ready = Boolean(plan && topKey && centre && result.ready)
  const blockers = []
  if (!plan) blockers.push(t('site.calculators.plan.blockerUpload'))
  if (plan && !topKey) blockers.push(t('site.calculators.plan.blockerTop'))
  if (plan && !centre) blockers.push(t('site.calculators.plan.blockerCentre'))
  if (plan && topKey && centre && result.missing.length) {
    blockers.push(t('site.calculators.plan.blockerMark', {
      list: result.missing.map((item) => t(`site.calculators.vastu.component.${item.key}`)).join(', '),
    }))
  }

  // Zone guides drawn over the plan: eight boundaries and eight labels, placed
  // from the confirmed centre and orientation. Everything here is computed, so
  // it cannot show a zone the analysis did not use.
  const guides = useMemo(() => {
    if (!centre || !topKey || !plan) return null
    const { w, h } = plan.dims
    const cx = centre.x * w
    const cy = centre.y * h
    const reach = Math.hypot(w, h)
    const topOffset = BEARING_ORDER.indexOf(topKey) * 45
    const at = (deg, radius) => {
      const rad = ((deg - topOffset) * Math.PI) / 180
      return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) }
    }
    return {
      lines: Array.from({ length: 8 }, (unused, index) => at(22.5 + index * 45, reach)),
      labels: BEARING_ORDER.map((key, index) => ({ key, ...at(index * 45, Math.min(w, h) * 0.34) })),
      cx, cy,
    }
  }, [centre, topKey, plan])

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-oc-green" />
        <h2 className="font-display text-lg font-extrabold text-oc-ink">{t('site.calculators.plan.title')}</h2>
      </div>
      <p className="mt-1 text-sm leading-6 text-oc-muted">
        {t('site.calculators.plan.intro')}
      </p>

      {/* ---------------------------------------------------------- 1. upload */}
      <label className={`${labelClass} mt-5 block`}>
        {t('site.calculators.plan.step1')} <span className="font-semibold text-oc-faint">{t('site.calculators.plan.step1Hint')}</span>
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={(event) => chooseFile(event.target.files?.[0])}
          className="mt-2 block w-full cursor-pointer rounded-xl border border-[rgba(8,62,43,.15)] bg-white p-2 text-sm font-semibold text-oc-ink file:mr-3 file:rounded-lg file:border-0 file:bg-oc-mint file:px-3 file:py-2 file:text-xs file:font-extrabold file:text-oc-deep"
        />
      </label>
      <ErrorNote>{fileError}</ErrorNote>

      {plan && (
        <>
          {/* ----------------------------------------------- 2. orientation */}
          <label className={`${labelClass} mt-4 block`}>
            {t('site.calculators.plan.step2')} <span className="text-oc-ink">{t('site.calculators.plan.step2Top')}</span> {t('site.calculators.plan.step2Rest')}
            <select value={topKey} onChange={(event) => { setTopKey(event.target.value); setAnalysed(false) }} className={selectClass}>
              <option value="">{t('site.calculators.vastu.selectDirection')}</option>
              {VASTU_DIRECTIONS.map((direction) => (
                <option key={direction.key} value={direction.key}>{t(`site.calculators.vastu.direction.${direction.key}`)}</option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] font-medium leading-4 text-oc-faint">
              {t('site.calculators.plan.step2Hint')}
            </span>
          </label>

          {/* --------------------------------------- 3 + 4. centre and rooms */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <span className={labelClass}>{t('site.calculators.plan.step3')}</span>
              <button
                type="button"
                onClick={() => setPlacing('centre')}
                className={`mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition ${
                  placing === 'centre'
                    ? 'border-oc-green bg-oc-mint text-oc-deep'
                    : 'border-[rgba(8,62,43,.15)] bg-white text-oc-ink hover:bg-oc-sunken'
                }`}
              >
                <Crosshair className="h-4 w-4" />
                {placing === 'centre'
                  ? t('site.calculators.plan.centreClick')
                  : centre ? t('site.calculators.plan.centreMove') : t('site.calculators.plan.centreSet')}
              </button>
              <span className="mt-1 block text-[11px] font-medium leading-4 text-oc-faint">
                {t('site.calculators.plan.step3Hint')}
              </span>
            </div>
            <label className={labelClass}>
              {t('site.calculators.plan.step4')}
              <span className={`ms-1 font-bold ${markedRequired === REQUIRED_COMPONENTS.length ? 'text-oc-green' : 'text-oc-faint'}`}>
                {t('site.calculators.plan.markedCount', { marked: markedRequired, total: REQUIRED_COMPONENTS.length })}
              </span>
              <select
                value={placing && placing !== 'centre' ? placing : ''}
                onChange={(event) => setPlacing(event.target.value || null)}
                className={selectClass}
                disabled={!centre || !topKey}
              >
                <option value="">{!centre || !topKey ? t('site.calculators.plan.roomFirst') : t('site.calculators.plan.roomChoose')}</option>
                {VASTU_COMPONENTS.map((component) => (
                  <option key={component.key} value={component.key}>
                    {t(`site.calculators.vastu.component.${component.key}`)}{marks[component.key] ? t('site.calculators.plan.marked') : ''}{component.required ? '' : t('site.calculators.plan.optional')}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* ------------------------------------------------- the plan itself */}
          <div className="mt-4 overflow-x-auto">
            <div className="relative inline-block max-w-full">
              <img
                ref={imageRef}
                src={plan.url}
                alt={plan.name}
                onLoad={measure}
                onClick={clickPlan}
                className={`block max-h-[520px] w-auto max-w-full rounded-xl border border-[rgba(8,62,43,.15)] bg-oc-sunken ${placing ? 'cursor-crosshair' : ''}`}
              />
              {guides && (
                <svg
                  className="pointer-events-none absolute left-0 top-0"
                  width={plan.dims.w}
                  height={plan.dims.h}
                  aria-hidden="true"
                >
                  {guides.lines.map((end, index) => (
                    <line key={index} x1={guides.cx} y1={guides.cy} x2={end.x} y2={end.y} stroke="rgba(8,62,43,.35)" strokeDasharray="4 4" strokeWidth="1" />
                  ))}
                  {guides.labels.map((label) => (
                    <text key={label.key} x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" className="fill-oc-deep" style={{ fontSize: 11, fontWeight: 800 }}>
                      {label.key.toUpperCase()}
                    </text>
                  ))}
                  <circle cx={guides.cx} cy={guides.cy} r="5" fill="#126b45" />
                </svg>
              )}
              {placements.map((item) => (
                <span
                  key={item.component.key}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-oc-deep px-2 py-0.5 text-[10px] font-extrabold text-white shadow"
                  style={{ left: `${item.point.x * 100}%`, top: `${item.point.y * 100}%` }}
                >
                  {t(`site.calculators.vastu.component.${item.component.key}`)}
                </span>
              ))}
            </div>
          </div>

          {/* --------------------------------------------- marked rooms list */}
          {placements.length > 0 && (
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              {placements.map((item) => (
                <li key={item.component.key} className="flex items-center gap-3 py-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-oc-green" />
                  <span className="font-bold text-oc-ink">{t(`site.calculators.vastu.component.${item.component.key}`)}</span>
                  <span className="text-oc-muted">{t(`site.calculators.vastu.direction.${item.direction}`)}</span>
                  <button
                    type="button"
                    onClick={() => clearMark(item.component.key)}
                    className="ms-auto inline-flex items-center gap-1 rounded-lg border border-[rgba(8,62,43,.15)] px-2 py-1 text-[11px] font-bold text-oc-muted transition hover:bg-oc-sunken"
                  >
                    <X className="h-3 w-3" /> {t('site.calculators.plan.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* --------------------------------------------------- 5. analyse */}
          {/* The reason a disabled button is disabled belongs above it, where it
              is read before the button rather than after it. */}
          {blockers.length > 0 && (
            <ErrorNote>
              {t('site.calculators.plan.blockerIntro', { steps: blockers.join(t('site.calculators.plan.blockerJoin')) })}
            </ErrorNote>
          )}
          <button
            type="button"
            disabled={!ready}
            onClick={() => setAnalysed(true)}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('site.calculators.plan.analyse')}
          </button>
        </>
      )}

      {/* ------------------------------------------------------- the report */}
      {analysed && ready && (
        <div className="mt-4 space-y-4">
          <Headline
            label={t('site.calculators.plan.headline')}
            value={`${result.percent}% · ${t(`site.calculators.vastu.overall.${result.band.key}`)}`}
            sub={t(
              result.placements.length === 1
                ? 'site.calculators.plan.headlineSub'
                : 'site.calculators.plan.headlineSubPlural',
              { count: result.placements.length, name: plan.name },
            )}
          />

          <div>
            <h3 className="font-display text-base font-extrabold text-oc-ink">{t('site.calculators.plan.roomByRoom')}</h3>
            <ul className="mt-2 divide-y divide-[rgba(8,62,43,.08)]">
              {result.placements.map((item) => (
                <li key={item.component.key} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-bold text-oc-ink">{t(`site.calculators.vastu.component.${item.component.key}`)}</span>
                    <span className="text-sm text-oc-muted">{t(`site.calculators.vastu.direction.${item.direction}`)}</span>
                    <span className={`ms-auto rounded-full px-2.5 py-1 text-[11px] font-extrabold ${TONE_CLASS[item.band.tone]}`}>
                      {t(`site.calculators.vastu.band.${item.band.key}`)}
                    </span>
                    <span className="w-10 text-end text-xs font-bold text-oc-faint">{item.score}/10</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-oc-muted">{placementAdvice(item, t)}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* Remedies only where something actually needs attention. A plan with
              nothing wrong is not given a list of defects to fix. */}
          {result.attention.length > 0 && (
            <div>
              <h3 className="font-display text-base font-extrabold text-oc-ink">
                {t('site.calculators.plan.recommendations', { count: result.attention.length })}
              </h3>
              <ul className="mt-2 space-y-2">
                {result.attention.map((item) => (
                  <li key={item.component.key} className="rounded-xl border border-[rgba(8,62,43,.1)] bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">
                    <span className="font-bold text-oc-ink">{t(`site.calculators.vastu.component.${item.component.key}`)} — {t(`site.calculators.vastu.direction.${item.direction}`)}. </span>
                    {placementAdvice(item, t)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <MethodNote>{t('site.calculators.plan.method')}</MethodNote>

          <p className="rounded-xl border border-[rgba(8,62,43,.1)] bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">
            <span className="font-bold text-oc-ink">{t('site.calculators.vastu.noteLabel')}</span>{' '}
            {t('site.calculators.plan.note')}
          </p>
        </div>
      )}
    </div>
  )
}
