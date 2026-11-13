/**
 * Raw Material Calculator.
 *
 * Built-up area × published per-sq.ft consumption = material quantities.
 * The rates and their sources are in `constants.js`; this file only does the
 * arithmetic and the rendering, and quotes no price or product.
 */
import { useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import { MATERIAL_RATES, SQ_FT_PER_SQ_METRE } from './constants.js'
import { ErrorNote, Headline, MethodNote, NumberField, QuantityRow, cardClass, labelClass, range, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { floorCountFor, floorOptionsForCountry, floorTypeLabel } from '../../../shared/utils/floorOptions.js'

const UNIT_SQFT = 'SQFT'
const UNIT_SQM = 'SQM'
const MAX_AREA_SQFT = 1_000_000
const MAX_FLOORS = 20

export default function RawMaterialCalculator() {
  const { t, country } = useLanguage()
  // India wording: the entry is built-up area per floor (it is multiplied by
  // the floor count below), and the result needs its limits stated. India is
  // the only country served. The arithmetic is unchanged.
  const isIndia = true
  const [area, setArea] = useState('')
  const [unit, setUnit] = useState(UNIT_SQFT)
  // The CODE the user picked ('G', 'G+1', ...). The arithmetic below still
  // works on the number, taken from the canonical option, so every result is
  // exactly what the same floor count produced before.
  const [floorType, setFloorType] = useState('G')

  const { error, result } = useMemo(() => {
    const entered = Number(area)
    const floorCount = floorCountFor(country, floorType, 1)
    if (!area.trim()) return { error: '', result: null }
    if (!Number.isFinite(entered) || entered <= 0) {
      return { error: t(isIndia ? 'site.calculators.raw.errBuiltUpArea' : 'site.calculators.raw.errArea'), result: null }
    }
    if (!Number.isFinite(floorCount) || floorCount < 1 || floorCount > MAX_FLOORS) {
      return { error: t('site.calculators.raw.errFloors', { max: MAX_FLOORS }), result: null }
    }
    const plotSqFt = unit === UNIT_SQM ? entered * SQ_FT_PER_SQ_METRE : entered
    if (plotSqFt > MAX_AREA_SQFT) return { error: t('site.calculators.raw.errTooLarge'), result: null }

    const builtUp = plotSqFt * floorCount
    return {
      error: '',
      result: {
        plotSqFt,
        builtUp,
        rows: MATERIAL_RATES.map((rate) => ({
          ...rate,
          low: builtUp * rate.low,
          high: builtUp * rate.high,
        })),
      },
    }
    // `t` is a dependency only because the validation messages are worded in the
    // selected language; the arithmetic above is unchanged by it.
  }, [area, unit, floorType, country, isIndia, t])

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t('site.calculators.raw.title')}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">
          {t('site.calculators.raw.intro')}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <span className={labelClass}>{t(isIndia ? 'site.calculators.raw.builtUpPerFloor' : 'site.calculators.raw.plotArea')}</span>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="number" inputMode="decimal" min="0" step="any"
                value={area} onChange={(event) => setArea(event.target.value)}
                placeholder={t('site.calculators.raw.plotPlaceholder')}
                className="h-11 w-full flex-1 rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)]"
              />
              <div className="inline-flex shrink-0 rounded-xl border border-[rgba(8,62,43,.15)] bg-oc-sunken p-1">
                {[[UNIT_SQFT, t('site.calculators.unit.sqft')], [UNIT_SQM, t('site.calculators.unit.sqm')]].map(([value, text]) => (
                  <button
                    key={value} type="button" onClick={() => setUnit(value)} aria-pressed={unit === value}
                    className={`h-9 rounded-lg px-4 text-xs font-extrabold transition ${
                      unit === value ? 'bg-oc-green text-white shadow-[0_8px_18px_-10px_rgba(18,107,69,.8)]' : 'text-oc-muted hover:text-oc-deep'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className={labelClass}>
            {t('site.calculators.raw.floors')}
            <select value={floorType} onChange={(event) => setFloorType(event.target.value)} className={selectClass}>
              {floorOptionsForCountry(country).map((option) => (
                <option key={option.value} value={option.value}>{floorTypeLabel(option.value)}</option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <p className="text-xs font-medium leading-5 text-oc-faint">
              {t(isIndia ? 'site.calculators.raw.builtUpNoteIndia' : 'site.calculators.raw.builtUpNote')}
            </p>
          </div>
        </div>

        <ErrorNote>{error}</ErrorNote>
      </div>

      {result && (
        <>
          <Headline
            label={t('site.calculators.raw.builtUpLabel')}
            value={`${Math.round(result.builtUp).toLocaleString('en-IN')} ${t('site.calculators.unit.sqftShort')}`}
            sub={t('site.calculators.raw.builtUpSub', {
              plot: Math.round(result.plotSqFt).toLocaleString('en-IN'),
              floors: floorCountFor(country, floorType, 1),
            })}
          />
          <div className={cardClass}>
            <h2 className="font-display text-base font-extrabold text-oc-ink">{t('site.calculators.raw.resultTitle')}</h2>
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              {result.rows.map((row) => (
                <QuantityRow
                  key={row.key}
                  // India names the unit in full beside the material, e.g.
                  // "Sand (cubic feet)"; the short unit column is unchanged.
                  label={isIndia
                    ? t('site.calculators.raw.materialWithUnit', {
                      material: t(`site.calculators.material.${row.key}`),
                      unit: t(`site.calculators.raw.unitLong.${row.unit}`),
                    })
                    : t(`site.calculators.material.${row.key}`)}
                  value={range(row.low, row.high, row.unit === 'cft' || row.unit === 'bags' ? 0 : 0)}
                  unit={t(`site.calculators.unit.${row.unit}`)}
                />
              ))}
            </ul>
            {isIndia && (
              <>
                <MethodNote>{t('site.calculators.raw.thumbRuleDisclaimer')}</MethodNote>
                <MethodNote>{t('site.calculators.raw.rmcNote')}</MethodNote>
              </>
            )}
            <MethodNote>
              {t('site.calculators.raw.method', {
                low: MATERIAL_RATES[0].low,
                high: MATERIAL_RATES[0].high,
              })}
            </MethodNote>
          </div>
        </>
      )}
    </div>
  )
}
