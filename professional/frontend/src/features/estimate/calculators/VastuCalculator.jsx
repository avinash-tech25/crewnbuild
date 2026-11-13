/**
 * Vastu Calculator.
 *
 * The user names the direction each part of the house faces; the screen reports
 * a compliance percentage and a per-placement verdict.
 *
 * Every rule, score and band lives in `vastuRules.js`, and every number on this
 * screen is derived from the user's own selections through `evaluateVastu`.
 * Nothing is stored, nothing is fetched and no API is called — the calculation
 * needs no server-side data, so it does not have a backend.
 *
 * The form pieces are the shared ones the other three calculators already use,
 * so this reads as part of the same hub rather than a new style.
 */
import { useMemo, useState } from 'react'
import { Compass } from 'lucide-react'
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
import VastuPlanUpload from './VastuPlanUpload.jsx'
import VastuAutoAnalysis from './VastuAutoAnalysis.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// The three verdict tones, using colours already present on these screens.
const TONE_CLASS = {
  good: 'bg-oc-mint text-oc-deep',
  warn: 'bg-[#fef3cd] text-[#856404]',
  bad: 'bg-[#fdecea] text-[#a12622]',
}

/** One placement, its verdict and the reason behind it. */
function PlacementRow({ item, t }) {
  return (
    <li className="py-3">
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
  )
}

export default function VastuCalculator() {
  const { t } = useLanguage()
  // `{ componentKey: directionKey }`. Empty string means "not answered".
  const [selections, setSelections] = useState({})

  const result = useMemo(() => evaluateVastu(selections), [selections])

  const choose = (key, value) => {
    setSelections((current) => {
      const next = { ...current }
      if (value) next[key] = value
      else delete next[key]
      return next
    })
  }

  const missingNote = result.missing.length
    ? t('site.calculators.vastu.missing', {
      list: result.missing.map((item) => t(`site.calculators.vastu.component.${item.key}`)).join(', '),
    })
    : ''

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t('site.calculators.vastu.title')}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">
          {t('site.calculators.vastu.intro')}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {VASTU_COMPONENTS.map((component) => (
            <label key={component.key} className={labelClass}>
              {t(`site.calculators.vastu.component.${component.key}`)}
              {!component.required && (
                <span className="ms-1 font-semibold text-oc-faint">{t('site.calculators.vastu.optional')}</span>
              )}
              <select
                value={selections[component.key] || ''}
                onChange={(event) => choose(component.key, event.target.value)}
                className={selectClass}
              >
                <option value="">
                  {component.required ? t('site.calculators.vastu.selectDirection') : t('site.calculators.vastu.notApplicable')}
                </option>
                {VASTU_DIRECTIONS.map((direction) => (
                  <option key={direction.key} value={direction.key}>{t(`site.calculators.vastu.direction.${direction.key}`)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <ErrorNote>{missingNote}</ErrorNote>
      </div>

      {result.ready && (
        <>
          <Headline
            label={t('site.calculators.vastu.headline')}
            value={`${result.percent}% · ${t(`site.calculators.vastu.overall.${result.band.key}`)}`}
            sub={t(
              result.placements.length === 1
                ? 'site.calculators.vastu.headlineSub'
                : 'site.calculators.vastu.headlineSubPlural',
              { count: result.placements.length },
            )}
          />

          <div className={cardClass}>
            <h2 className="font-display text-base font-extrabold text-oc-ink">{t('site.calculators.vastu.analysis')}</h2>

            {result.favourable.length > 0 && (
              <>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide text-oc-faint">
                  {t('site.calculators.vastu.favourableCount', { count: result.favourable.length })}
                </p>
                <ul className="divide-y divide-[rgba(8,62,43,.08)]">
                  {result.favourable.map((item) => <PlacementRow key={item.component.key} item={item} t={t} />)}
                </ul>
              </>
            )}

            {result.attention.length > 0 && (
              <>
                <p className="mt-4 text-xs font-bold uppercase tracking-wide text-oc-faint">
                  {t('site.calculators.vastu.attentionCount', { count: result.attention.length })}
                </p>
                <ul className="divide-y divide-[rgba(8,62,43,.08)]">
                  {result.attention.map((item) => <PlacementRow key={item.component.key} item={item} t={t} />)}
                </ul>
              </>
            )}

            <MethodNote>{t('site.calculators.vastu.method')}</MethodNote>

            <p className="mt-3 rounded-xl border border-[rgba(8,62,43,.1)] bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">
              <span className="font-bold text-oc-ink">{t('site.calculators.vastu.noteLabel')}</span>{' '}
              {t('site.calculators.vastu.note')}
            </p>
          </div>
        </>
      )}

      {/* Second, independent block. The calculator above keeps its own
          fields, logic and result; this adds the plan-based route beneath
          it and shares the same rules engine. */}
      <VastuPlanUpload />

      {/* Development builds only: a test panel for the automatic analysis
          endpoint. Never rendered in production; the manual routes above are
          unchanged. */}
      {import.meta.env.DEV && <VastuAutoAnalysis />}
    </div>
  )
}
