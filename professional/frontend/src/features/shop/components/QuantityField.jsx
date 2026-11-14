import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { quantityProblem, stepQuantity } from '../../../shared/utils/quantityUnits.js'

/**
 * A quantity typed straight in (500 bags, 100 rods, 25 buckets), with the - and +
 * buttons kept for small changes and the unit beside it. Controlled: `value` is
 * the text shown, `onChange` gets every edit, and `onCommit` (optional) the text
 * once it is settled -- on blur, Enter or a +/- step -- for a caller that saves it.
 * A quantity the unit cannot take is named under the field.
 */
export default function QuantityField({ value, unit, onChange, onCommit, disabled = false, label, large = false }) {
  const { t, td } = useLanguage()
  const text = value == null ? '' : String(value)
  const problem = text.trim() ? quantityProblem(text, unit) : ''
  const step = (delta) => {
    const next = stepQuantity(text, delta)
    onChange(next)
    onCommit?.(next, { stepped: true })
  }
  const box = large ? 'h-11 rounded-xl' : 'h-9 rounded-lg'
  const button = large ? 'w-11' : 'w-8'
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1.5">
        <div className={`flex items-center overflow-hidden border ${box} ${problem ? 'border-rose-300' : 'border-slate-200'}`}>
          <button type="button" disabled={disabled || !text} onClick={() => step(-1)} aria-label={t('shop.decrease')} className={`grid h-full ${button} place-items-center text-graphite/60 transition hover:bg-slate-50 disabled:opacity-40`}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={text}
            placeholder="0"
            aria-label={label}
            aria-invalid={Boolean(problem)}
            onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => onCommit?.(text)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onCommit?.(text) } }}
            className={`h-full ${large ? 'w-20 text-base' : 'w-16 text-sm'} border-x border-slate-100 bg-white text-center font-extrabold text-graphite outline-none focus:bg-brand-50/40`}
          />
          <button type="button" disabled={disabled} onClick={() => step(1)} aria-label={t('shop.increase')} className={`grid h-full ${button} place-items-center bg-brand-50 text-brand-800 transition hover:bg-brand-100 disabled:opacity-40`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {unit && <span className="text-xs font-bold text-graphite/60">{td(unit)}</span>}
      </div>
      {problem && (
        <p role="alert" className="mt-1 max-w-[12rem] text-[11px] font-bold text-rose-700">
          {problem === 'whole' ? t('store.quantityWhole', { unit: td(unit) }) : t('store.quantityInvalid')}
        </p>
      )}
    </div>
  )
}

// A saved quantity, such as a cart line's: typed or stepped, and saved once it is
// settled and valid. Stepping below one saves 0 (the caller removes the line, as
// the - button always did); a cleared or invalid entry is never saved.
export function SavedQuantityField({ quantity, unit, onSave, ...rest }) {
  const [draft, setDraft] = useState(String(quantity ?? ''))
  useEffect(() => { setDraft(String(quantity ?? '')) }, [quantity])
  const commit = (text, { stepped = false } = {}) => {
    if (!String(text).trim()) {
      if (stepped) onSave(0)
      else setDraft(String(quantity ?? ''))
      return
    }
    if (quantityProblem(text, unit) || Number(text) === Number(quantity)) return
    onSave(Number(text))
  }
  return <QuantityField value={draft} unit={unit} onChange={setDraft} onCommit={commit} {...rest} />
}
