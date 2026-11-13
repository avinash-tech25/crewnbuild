/**
 * Paint Calculator.
 *
 * Paintable area = wall area (+ ceiling, optionally) − openings.
 * Paint required = paintable area × coats ÷ spreading rate.
 *
 * Spreading rates and their source live in `constants.js`. No supplier product
 * is named or quoted: CREWNBUILD's product records carry no coverage figure, so
 * the result is labelled a general estimate rather than a product claim.
 */
import { useMemo, useState } from 'react'
import { Paintbrush } from 'lucide-react'
import { FEET_PER_METRE, PAINT_TYPES, UNIT_FT, UNIT_M } from './constants.js'
import { ErrorNote, Headline, MethodNote, NumberField, QuantityRow, UnitToggle, cardClass, labelClass, range, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const MAX_DIMENSION_FT = 500

export default function PaintCalculator() {
  const { t } = useLanguage()
  const [unit, setUnit] = useState(UNIT_FT)
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [openings, setOpenings] = useState('')
  const [coats, setCoats] = useState('2')
  const [type, setType] = useState(PAINT_TYPES[0].key)
  const [includeCeiling, setIncludeCeiling] = useState(false)

  const { error, result } = useMemo(() => {
    if (!length.trim() || !width.trim() || !height.trim()) return { error: '', result: null }
    const values = [length, width, height].map(Number)
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
      return { error: t('site.calculators.paint.errDimensions'), result: null }
    }
    const toFeet = unit === UNIT_M ? FEET_PER_METRE : 1
    const [lengthFt, widthFt, heightFt] = values.map((value) => value * toFeet)
    if ([lengthFt, widthFt, heightFt].some((value) => value > MAX_DIMENSION_FT)) {
      return { error: t('site.calculators.paint.errTooLarge'), result: null }
    }

    const coatCount = Number(coats)
    if (!Number.isFinite(coatCount) || coatCount < 1 || coatCount > 5) {
      return { error: t('site.calculators.paint.errCoats'), result: null }
    }

    // Openings are entered in the chosen unit's square measure.
    const openingsEntered = openings.trim() ? Number(openings) : 0
    if (!Number.isFinite(openingsEntered) || openingsEntered < 0) {
      return { error: t('site.calculators.paint.errOpeningsNegative'), result: null }
    }
    const openingsSqFt = openingsEntered * (unit === UNIT_M ? FEET_PER_METRE ** 2 : 1)

    const wallArea = 2 * (lengthFt + widthFt) * heightFt
    const ceilingArea = includeCeiling ? lengthFt * widthFt : 0
    const paintable = wallArea + ceilingArea - openingsSqFt
    if (paintable <= 0) {
      return { error: t('site.calculators.paint.errOpeningsTooBig'), result: null }
    }

    const paint = PAINT_TYPES.find((item) => item.key === type) || PAINT_TYPES[0]
    return {
      error: '',
      result: {
        wallArea, ceilingArea, openingsSqFt, paintable, coatCount, paint,
        // A higher spreading rate needs less paint, so the low/high swap.
        litresLow: (paintable * coatCount) / paint.high,
        litresHigh: (paintable * coatCount) / paint.low,
      },
    }
    // `t` is a dependency only because the validation messages are worded in the
    // selected language; the arithmetic above is unchanged by it.
  }, [unit, length, width, height, openings, coats, type, includeCeiling, t])

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Paintbrush className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t('site.calculators.paint.title')}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">
          {t('site.calculators.paint.intro')}
        </p>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className={labelClass}>{t('site.calculators.paint.measurementsIn')}</span>
          <UnitToggle
            value={unit}
            onChange={setUnit}
            labels={{ [UNIT_FT]: t('site.calculators.unit.feet'), [UNIT_M]: t('site.calculators.unit.metres') }}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <NumberField label={t('site.calculators.paint.roomLength')} value={length} onChange={setLength} placeholder={t('site.calculators.paint.lengthPlaceholder')} />
          <NumberField label={t('site.calculators.paint.roomWidth')} value={width} onChange={setWidth} placeholder={t('site.calculators.paint.widthPlaceholder')} />
          <NumberField label={t('site.calculators.paint.wallHeight')} value={height} onChange={setHeight} placeholder={t('site.calculators.paint.heightPlaceholder')} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <NumberField
            label={t('site.calculators.paint.openings')}
            value={openings}
            onChange={setOpenings}
            placeholder={t('site.calculators.paint.openingsPlaceholder')}
            hint={t('site.calculators.paint.openingsHint', {
              unit: unit === UNIT_M ? t('site.calculators.unit.m') : t('site.calculators.unit.ft'),
            })}
          />
          <label className={labelClass}>
            {t('site.calculators.paint.coats')}
            <select value={coats} onChange={(event) => setCoats(event.target.value)} className={selectClass}>
              {[1, 2, 3, 4, 5].map((count) => <option key={count} value={String(count)}>{count}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            {t('site.calculators.paint.paintType')}
            <select value={type} onChange={(event) => setType(event.target.value)} className={selectClass}>
              {PAINT_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{t(`site.calculators.paintType.${item.key}`)}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs font-bold text-oc-muted">
          <input
            type="checkbox"
            checked={includeCeiling}
            onChange={(event) => setIncludeCeiling(event.target.checked)}
            className="h-4 w-4 rounded border-[rgba(8,62,43,.3)] text-oc-green focus:ring-oc-green"
          />
          {t('site.calculators.paint.includeCeiling')}
        </label>

        <ErrorNote>{error}</ErrorNote>
      </div>

      {result && (
        <>
          <Headline
            label={t('site.calculators.paint.headline')}
            value={`${range(result.litresLow, result.litresHigh, 1)} ${t('site.calculators.unit.litres')}`}
            sub={t('site.calculators.paint.headlineSub', {
              coats: result.coatCount,
              type: t(`site.calculators.paintType.${result.paint.key}`),
              area: Math.round(result.paintable).toLocaleString('en-IN'),
            })}
          />
          <div className={cardClass}>
            <h2 className="font-display text-base font-extrabold text-oc-ink">{t('site.calculators.paint.worked')}</h2>
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              <QuantityRow label={t('site.calculators.paint.rowWall')} value={Math.round(result.wallArea).toLocaleString('en-IN')} unit={t('site.calculators.unit.sqftShort')} />
              {result.ceilingArea > 0 && (
                <QuantityRow label={t('site.calculators.paint.rowCeiling')} value={Math.round(result.ceilingArea).toLocaleString('en-IN')} unit={t('site.calculators.unit.sqftShort')} />
              )}
              {result.openingsSqFt > 0 && (
                <QuantityRow label={t('site.calculators.paint.rowLess')} value={`− ${Math.round(result.openingsSqFt).toLocaleString('en-IN')}`} unit={t('site.calculators.unit.sqftShort')} />
              )}
              <QuantityRow label={t('site.calculators.paint.rowPaintable')} value={Math.round(result.paintable).toLocaleString('en-IN')} unit={t('site.calculators.unit.sqftShort')} />
              <QuantityRow
                label={t('site.calculators.paint.rowSpreading', { type: t(`site.calculators.paintType.${result.paint.key}`) })}
                value={range(result.paint.low, result.paint.high, 0)}
                unit={t('site.calculators.unit.sqftPerLitre')}
              />
            </ul>
            <MethodNote>{t('site.calculators.paint.method')}</MethodNote>
          </div>
        </>
      )}
    </div>
  )
}
