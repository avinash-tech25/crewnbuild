/**
 * Stock status, as text plus an icon -- never colour alone.
 *
 *   quantity  > threshold   In stock
 *   quantity <= threshold   Low stock (only N left)
 *   quantity  = 0           Out of stock
 */
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

export function stockState(quantity, threshold) {
  const qty = Number(quantity || 0)
  if (qty <= 0) return 'out'
  if (qty <= Number(threshold || 0)) return 'low'
  return 'in'
}

const STYLES = {
  in: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'In stock' },
  low: { icon: AlertTriangle, className: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'Low stock' },
  out: { icon: XCircle, className: 'bg-rose-50 text-rose-700 ring-rose-200', label: 'Out of stock' },
}

const amount = (value) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export function StockBadge({ quantity, threshold, unit = '', className = '' }) {
  const state = stockState(quantity, threshold)
  const style = STYLES[state]
  const Icon = style.icon
  const detail = state === 'low' ? ` · only ${amount(quantity)}${unit ? ` ${unit}` : ''} left` : ''
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold ring-1 ${style.className} ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {style.label}
      {detail}
    </span>
  )
}
