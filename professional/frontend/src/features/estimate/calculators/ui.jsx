/**
 * Shared form and result pieces for the three material calculators.
 *
 * The class strings match the ones the existing estimate screen already uses,
 * so these calculators look like the rest of CREWNBUILD. They are declared here
 * rather than imported from `EstimateCalculator.jsx`, which is left untouched.
 */
import { UNIT_FT, UNIT_M } from './constants.js'

export const selectClass = 'mt-2 h-11 w-full rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)]'
export const inputClass = 'mt-2 h-11 w-full rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-oc-faint focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)]'
export const labelClass = 'block text-xs font-bold text-oc-muted'
export const cardClass = 'rounded-2xl border border-[rgba(8,62,43,.1)] bg-white p-5 shadow-[0_8px_30px_-8px_rgba(15,23,42,.06)] sm:p-7'

/** A number the user types. Kept as a string so the field can be emptied. */
export function NumberField({ label, value, onChange, placeholder, hint, min = 0, step = 'any', className = '' }) {
  return (
    <label className={`${labelClass} ${className}`}>
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
      {hint && <span className="mt-1 block text-[11px] font-medium leading-4 text-oc-faint">{hint}</span>}
    </label>
  )
}

/** Feet / metres toggle, styled like the existing area unit switch. */
export function UnitToggle({ value, onChange, labels = { [UNIT_FT]: 'Feet', [UNIT_M]: 'Metres' } }) {
  return (
    <div className="inline-flex shrink-0 rounded-xl border border-[rgba(8,62,43,.15)] bg-oc-sunken p-1">
      {[UNIT_FT, UNIT_M].map((unit) => (
        <button
          key={unit}
          type="button"
          onClick={() => onChange(unit)}
          aria-pressed={value === unit}
          className={`h-9 rounded-lg px-4 text-xs font-extrabold transition ${
            value === unit ? 'bg-oc-green text-white shadow-[0_8px_18px_-10px_rgba(18,107,69,.8)]' : 'text-oc-muted hover:text-oc-deep'
          }`}
        >
          {labels[unit]}
        </button>
      ))}
    </div>
  )
}

export function ErrorNote({ children }) {
  if (!children) return null
  return <p className="mt-4 rounded-xl bg-[#fef3cd] px-4 py-3 text-sm font-bold text-[#856404]">{children}</p>
}

/** The headline figure of a result. */
export function Headline({ label, value, sub }) {
  return (
    <section className="rounded-2xl border border-[rgba(8,62,43,.1)] bg-oc-deep p-5 text-white sm:p-7">
      <p className="text-xs font-bold uppercase tracking-wide text-[#b9d8c5]">{label}</p>
      <p className="mt-2 font-display text-3xl font-extrabold leading-none text-white sm:text-4xl">{value}</p>
      {sub && <p className="mt-2 text-xs font-semibold text-[#b9d8c5]">{sub}</p>}
    </section>
  )
}

/** One row of a breakdown: name on the left, quantity and unit on the right. */
export function QuantityRow({ label, value, unit }) {
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="text-oc-muted">{label}</span>
      <span className="ms-auto font-extrabold text-oc-ink">{value}</span>
      <span className="w-14 text-end text-xs font-bold text-oc-faint">{unit}</span>
    </li>
  )
}

/** How the number was reached, and where the figures came from. */
export function MethodNote({ children }) {
  return <p className="mt-4 rounded-xl bg-oc-sunken p-3 text-xs leading-5 text-oc-muted">{children}</p>
}

/**
 * The advice the Vastu rules engine words in English, in the selected language.
 *
 * It reads the placement the engine produced — its band, its direction and its
 * best directions — so the words and the score still cannot disagree. Shared by
 * both Vastu screens, and kept here rather than in either of them because they
 * import each other.
 */
export function placementAdvice(item, t) {
  if (item.band.key === 'favourable') {
    return t('site.calculators.vastu.adviceFavourable', {
      direction: t(`site.calculators.vastu.direction.${item.direction}`),
    })
  }
  const best = (item.bestKeys || []).map((key) => t(`site.calculators.vastu.direction.${key}`))
  return t('site.calculators.vastu.advicePreferred', {
    best: best.join(t('site.calculators.vastu.or')),
    principle: t(`site.calculators.vastu.principle.${item.component.key}`),
  })
}

/** Formats a range as "low – high", or a single number when they coincide. */
export function range(low, high, digits = 0) {
  const format = (value) => Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })
  return format(low) === format(high) ? format(low) : `${format(low)} – ${format(high)}`
}
