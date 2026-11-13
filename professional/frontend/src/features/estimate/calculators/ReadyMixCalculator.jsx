/**
 * Ready Mix Calculator.
 *
 * Ready-mix concrete is ordered by volume, so this is geometry:
 * length × width × depth × number of pours, plus a wastage allowance.
 *
 * Every dimension carries its own unit and is converted to metres before
 * anything is multiplied. A single shared unit let "6" typed for a 6-inch slab
 * be read as 6 feet — twelve times the concrete — so depth also offers inches
 * and centimetres, and defaults to inches.
 *
 * No mix ratio or grade recipe is asserted anywhere — the mix design belongs to
 * the supplier, and claiming one here would be inventing engineering data.
 */
import { useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { CUBIC_FEET_PER_CUBIC_METRE, DEFAULT_WASTAGE, WASTAGE_CHOICES } from './constants.js'
import { ErrorNote, Headline, MethodNote, NumberField, QuantityRow, cardClass, labelClass, range, selectClass } from './ui.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// Exact definitions of each unit in metres (1 in = 25.4 mm, 1 ft = 12 in).
const METRES_PER_UNIT = { ft: 0.3048, in: 0.0254, cm: 0.01, m: 1 }
const PLAN_UNITS = ['ft', 'm']
const DEPTH_UNITS = ['in', 'cm', 'ft', 'm']
const DEPTH_PLACEHOLDER_KEYS = {
  in: 'site.calculators.readyMix.depthPlaceholderIn',
  cm: 'site.calculators.readyMix.depthPlaceholderCm',
  ft: 'site.calculators.readyMix.depthPlaceholderFt',
  m: 'site.calculators.readyMix.depthPlaceholderM',
}

// The same 1,000 ft ceiling as before, held in metres now that every
// dimension is converted to metres first.
const MAX_DIMENSION_M = 1000 * METRES_PER_UNIT.ft
const MAX_ELEMENTS = 500

/** A number field with its own unit picker beside it. */
function DimensionField({ label, value, onChange, placeholder, unit, units, onUnitChange, t }) {
  return (
    <div className="flex items-end gap-2">
      <NumberField className="min-w-0 flex-1" label={label} value={value} onChange={onChange} placeholder={placeholder} />
      <div className="w-20 shrink-0">
        <select
          value={unit}
          onChange={(event) => onUnitChange(event.target.value)}
          aria-label={t('site.calculators.readyMix.unitLabel', { field: label })}
          className={selectClass}
        >
          {units.map((option) => (
            <option key={option} value={option}>{t(`site.calculators.unit.${option}`)}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export default function ReadyMixCalculator() {
  const { t } = useLanguage()
  const [length, setLength] = useState('')
  const [lengthUnit, setLengthUnit] = useState('ft')
  const [width, setWidth] = useState('')
  const [widthUnit, setWidthUnit] = useState('ft')
  const [depth, setDepth] = useState('')
  const [depthUnit, setDepthUnit] = useState('in')
  const [count, setCount] = useState('1')
  const [wastage, setWastage] = useState(String(DEFAULT_WASTAGE))

  const { error, result } = useMemo(() => {
    if (!length.trim() || !width.trim() || !depth.trim()) return { error: '', result: null }
    // Each value times its own unit's length in metres. An unknown unit gives
    // NaN, which the finite check below rejects like any other bad entry.
    const metres = [[length, lengthUnit], [width, widthUnit], [depth, depthUnit]]
      .map(([value, unitKey]) => Number(value) * (METRES_PER_UNIT[unitKey] ?? NaN))
    if (metres.some((value) => !Number.isFinite(value) || value <= 0)) {
      return { error: t('site.calculators.readyMix.errDimensions'), result: null }
    }
    if (metres.some((value) => value > MAX_DIMENSION_M)) {
      return { error: t('site.calculators.readyMix.errTooLarge'), result: null }
    }
    const elements = Number(count)
    if (!Number.isFinite(elements) || elements < 1 || elements > MAX_ELEMENTS || !Number.isInteger(elements)) {
      return { error: t('site.calculators.readyMix.errPours', { max: MAX_ELEMENTS }), result: null }
    }

    const [lengthM, widthM, depthM] = metres
    const cubicMetres = lengthM * widthM * depthM * elements
    const cubicFeet = cubicMetres * CUBIC_FEET_PER_CUBIC_METRE
    const allowance = Number(wastage) / 100
    return {
      error: '',
      result: {
        cubicFeet, cubicMetres, elements,
        withWastage: cubicMetres * (1 + allowance),
        allowancePercent: Number(wastage),
      },
    }
    // `t` is a dependency only because the validation messages are worded in the
    // selected language; the arithmetic above is unchanged by it.
  }, [length, lengthUnit, width, widthUnit, depth, depthUnit, count, wastage, t])

  const unitText = (unitKey) => t(`site.calculators.unit.${unitKey}`)

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-oc-green" />
          <h1 className="font-display text-lg font-extrabold text-oc-ink">{t('site.calculators.readyMix.title')}</h1>
        </div>
        <p className="mt-1 text-sm leading-6 text-oc-muted">
          {t('site.calculators.readyMix.intro')}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <DimensionField
            t={t} label={t('site.calculators.readyMix.length', { unit: unitText(lengthUnit) })}
            value={length} onChange={setLength} placeholder={t('site.calculators.readyMix.lengthPlaceholder')}
            unit={lengthUnit} units={PLAN_UNITS} onUnitChange={setLengthUnit}
          />
          <DimensionField
            t={t} label={t('site.calculators.readyMix.width', { unit: unitText(widthUnit) })}
            value={width} onChange={setWidth} placeholder={t('site.calculators.readyMix.widthPlaceholder')}
            unit={widthUnit} units={PLAN_UNITS} onUnitChange={setWidthUnit}
          />
          <DimensionField
            t={t} label={t('site.calculators.readyMix.depth', { unit: unitText(depthUnit) })}
            value={depth} onChange={setDepth} placeholder={t(DEPTH_PLACEHOLDER_KEYS[depthUnit])}
            unit={depthUnit} units={DEPTH_UNITS} onUnitChange={setDepthUnit}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('site.calculators.readyMix.pours')} value={count} onChange={setCount}
            placeholder="1" min={1} step={1}
            hint={t('site.calculators.readyMix.poursHint')}
          />
          <label className={labelClass}>
            {t('site.calculators.readyMix.wastage')}
            <select value={wastage} onChange={(event) => setWastage(event.target.value)} className={selectClass}>
              {WASTAGE_CHOICES.map((choice) => (
                <option key={choice} value={String(choice)}>{choice}%</option>
              ))}
            </select>
          </label>
        </div>

        <ErrorNote>{error}</ErrorNote>
      </div>

      {result && (
        <>
          <Headline
            label={t('site.calculators.readyMix.headline')}
            value={`${range(result.withWastage, result.withWastage, 2)} ${t('site.calculators.unit.cubicMetre')}`}
            sub={t('site.calculators.readyMix.headlineSub', { percent: result.allowancePercent })}
          />
          <div className={cardClass}>
            <h2 className="font-display text-base font-extrabold text-oc-ink">{t('site.calculators.readyMix.worked')}</h2>
            <ul className="mt-3 divide-y divide-[rgba(8,62,43,.08)]">
              <QuantityRow
                label={result.elements > 1
                  ? t('site.calculators.readyMix.rowVolumeMultiple', { count: result.elements })
                  : t('site.calculators.readyMix.rowVolume')}
                value={range(result.cubicMetres, result.cubicMetres, 2)}
                unit={t('site.calculators.unit.cubicMetre')}
              />
              <QuantityRow label={t('site.calculators.readyMix.rowCubicFeet')} value={range(result.cubicFeet, result.cubicFeet, 1)} unit={t('site.calculators.unit.cft')} />
              <QuantityRow label={t('site.calculators.readyMix.rowWastage', { percent: result.allowancePercent })} value={range(result.withWastage - result.cubicMetres, result.withWastage - result.cubicMetres, 2)} unit={t('site.calculators.unit.cubicMetre')} />
              <QuantityRow label={t('site.calculators.readyMix.rowTotal')} value={range(result.withWastage, result.withWastage, 2)} unit={t('site.calculators.unit.cubicMetre')} />
            </ul>
            <MethodNote>{t('site.calculators.readyMix.method')}</MethodNote>
          </div>
        </>
      )}
    </div>
  )
}
