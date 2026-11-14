import { useId, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { formatRupees } from '../../../shared/utils/money.js'
import {
  DESCRIPTION_MAX_LENGTH, KIND_LABOUR, NAME_MAX_LENGTH, UNIT_MAX_LENGTH, UNIT_SUGGESTIONS,
  itemProblems, lineAmountPaise, paiseToAmount,
} from '../workBillRules.js'

const LABELS = {
  MATERIAL: { name: 'Material name', quantity: 'Quantity', price: 'Unit price (₹)', description: 'Notes', namePlaceholder: 'e.g. PVC pipe 1 inch' },
  LABOUR: { name: 'Service type', quantity: 'Hours / quantity', price: 'Rate (₹)', description: 'Description', namePlaceholder: 'e.g. Extra drain cleaning' },
}

/**
 * Add or edit one bill line. The amount shown is a preview worked out the way
 * the server does it; the server computes and stores the real one.
 */
export default function BillItemForm({ kind, initial, today, saving, onSave, onCancel }) {
  const [form, setForm] = useState(initial)
  const [touched, setTouched] = useState(false)
  const labels = LABELS[kind]
  const uid = useId()
  const problems = itemProblems(form, kind, { today })
  const shown = touched ? problems : {}
  const preview = lineAmountPaise(form.quantity, form.unit_price)

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const submit = (event) => {
    event.preventDefault()
    setTouched(true)
    if (Object.keys(problems).length === 0) onSave(form)
  }

  const field = (name, label, input, wide = false) => (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-bold text-oc-muted">{label}</span>
      {input}
      {shown[name] && <span className="mt-0.5 block text-xs font-bold text-red-700" role="alert">{shown[name]}</span>}
    </label>
  )

  return (
    <form className="space-y-3 rounded-lg border border-oc-green/40 bg-oc-mint/30 p-3" onSubmit={submit} data-testid={`bill-form-${kind}`} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('name', labels.name, (
          <input className="field-input mt-1" value={form.name} onChange={set('name')} maxLength={NAME_MAX_LENGTH * 2}
            placeholder={labels.namePlaceholder} aria-invalid={Boolean(shown.name)} data-testid="bill-item-name" />
        ), true)}
        {field('quantity', labels.quantity, (
          <input className="field-input mt-1" inputMode="decimal" value={form.quantity} onChange={set('quantity')}
            aria-invalid={Boolean(shown.quantity)} data-testid="bill-item-quantity" />
        ))}
        {field('unit', 'Unit', (
          <>
            <input className="field-input mt-1" value={form.unit} onChange={set('unit')} list={`${uid}-units`} maxLength={UNIT_MAX_LENGTH * 2}
              aria-invalid={Boolean(shown.unit)} data-testid="bill-item-unit" />
            <datalist id={`${uid}-units`}>{UNIT_SUGGESTIONS[kind].map((unit) => <option key={unit} value={unit} />)}</datalist>
          </>
        ))}
        {field('unit_price', labels.price, (
          <input className="field-input mt-1" inputMode="decimal" value={form.unit_price} onChange={set('unit_price')}
            placeholder="0" aria-invalid={Boolean(shown.unit_price)} data-testid="bill-item-price" />
        ))}
        {kind === KIND_LABOUR && field('work_date', 'Date', (
          <input type="date" className="field-input mt-1" value={form.work_date} max={today} onChange={set('work_date')}
            aria-invalid={Boolean(shown.work_date)} data-testid="bill-item-date" />
        ))}
        {field('description', labels.description, (
          <textarea className="field-input mt-1 min-h-[64px] resize-y" value={form.description} onChange={set('description')}
            maxLength={DESCRIPTION_MAX_LENGTH * 2} aria-invalid={Boolean(shown.description)} data-testid="bill-item-description" />
        ), true)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-oc-muted">
          Amount <span className="font-extrabold text-oc-ink" data-testid="bill-item-preview">{preview === null ? '—' : formatRupees(paiseToAmount(preview))}</span>
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost px-3 py-2" onClick={onCancel} disabled={saving}><X className="h-4 w-4" /> Cancel</button>
          <button type="submit" className="btn-primary px-4 py-2" disabled={saving} data-testid="bill-item-save">
            {saving ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Save line
          </button>
        </div>
      </div>
    </form>
  )
}
