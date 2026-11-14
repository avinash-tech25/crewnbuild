import { useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { apiErrorMessage } from '../../../shared/auth/accountPaths.js'
import { formatQty } from '../../site-work/components/EngineerAnalyticsSection.jsx'

export const inputClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100'
export const labelClass = 'block text-[11px] font-extrabold uppercase tracking-wide text-slate-600 rtl:tracking-normal'
export const primaryButton = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-700 px-3 text-xs font-extrabold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50'
export const secondaryButton = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-graphite/70 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

// className is a presentation-only extra (the dashboard uses it); left out, a
// Panel looks exactly as before.
export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] sm:p-5${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-base font-extrabold text-graphite">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, tone = 'text-graphite', onClick }) {
  return (
    <button type="button" onClick={onClick} className="rounded-2xl border border-slate-200 bg-white p-4 text-start transition hover:-translate-y-0.5 hover:border-brand-200">
      <span className="block text-[11px] font-extrabold uppercase tracking-wide text-graphite/55 rtl:tracking-normal">{label}</span>
      <span className={`mt-1 block font-display text-2xl font-extrabold ${tone}`}>{value}</span>
    </button>
  )
}

export function Notice({ message, onClose }) {
  if (!message) return null
  const { text, error } = message
  return (
    <div role={error ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
      <span>{text}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="×" className="shrink-0 text-base leading-none">×</button>}
    </div>
  )
}

// Status chips with a count each, as on the Builder's request board.
// filters: [{ id, label }]; counts: { [id]: number }.
// A table's Action column, pinned at the end while a wide table scrolls sideways
// (on a phone too), so View details and Issue materials stay in reach. The cell
// sets its own background (bg-white, or bg-slate-50 in the header).
export const pinnedEnd = 'sticky end-0 z-[1] shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.18)]'

// A Request ID or Purchase ID (a UUID), whole and selectable, never cut short.
export function RequestId({ value, className = '' }) {
  return <span dir="ltr" className={`select-all break-all font-mono text-[11px] font-bold ${className}`}>{value}</span>
}

// The Request ID search above a list of store requests.
export function RequestSearch({ value, onChange }) {
  const { t } = useLanguage()
  return (
    <div className="relative sm:w-80">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input type="search" className={`${inputClass} ps-9`} aria-label={t('store.requests.searchId')} placeholder={t('store.requests.searchId')} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

export function FilterChips({ filters, counts, active, onChange }) {
  return (
    <div className="dash-scroll flex min-w-0 items-center gap-1.5 overflow-x-auto p-0.5">
      {filters.map((filter) => {
        const on = filter.id === active
        return (
          <button
            key={filter.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(filter.id)}
            className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-extrabold transition ${on ? 'bg-brand-800 text-white' : 'border border-slate-200 bg-white text-graphite/65 hover:text-graphite'}`}
          >
            {filter.label}
            <span className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ${on ? 'bg-white/20 text-white' : 'bg-slate-100 text-graphite/60'}`}>{counts[filter.id] || 0}</span>
          </button>
        )
      })}
    </div>
  )
}

export const thClass = 'whitespace-nowrap px-2.5 py-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 rtl:tracking-normal'
export const tdClass = 'px-2.5 py-2 align-top text-xs font-semibold text-graphite/80'

// A table that scrolls sideways inside its own frame on a narrow screen, never the page.
export function DataTable({ head, minWidth = 'min-w-[860px]', children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="dash-scroll overflow-x-auto">
        <table className={`w-full ${minWidth} border-collapse text-start`}>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/90 text-start">{head}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">{children}</tbody>
        </table>
      </div>
    </div>
  )
}

// A window over the page, closed by ×, Escape or a click outside: centred, or
// (placement="right") a panel along the right edge that keeps the page in view.
export function DetailModal({ title, subtitle, onClose, children, width = 'max-w-6xl', placement = 'center', badge = null }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const right = placement === 'right'
  return (
    <div className={`fixed inset-0 z-[130] ${right ? 'flex justify-end' : 'grid place-items-center p-3 sm:p-6'}`}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={right
          ? `relative flex h-full w-full ${width} flex-col overflow-hidden border-s border-slate-200 bg-white shadow-2xl`
          : `relative flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {badge && <span className="mb-1 inline-block rounded-md bg-brand-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-800 ring-1 ring-brand-100">{badge}</span>}
            <h3 className="truncate font-display text-base font-extrabold text-graphite">{title}</h3>
            {subtitle && <div className="mt-0.5 text-xs font-semibold text-graphite/55">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label={t('store.close')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="dash-scroll overflow-y-auto px-4 py-3 sm:px-5">{children}</div>
      </section>
    </div>
  )
}

// The server's refusal when it wrote one, in the reader's language.
export function refusalText(error, td, fallback) {
  const message = apiErrorMessage(error, fallback)
  return typeof message === 'string' ? td(message) : fallback
}

// Where a request stands, line by line: what was asked, approved, handed over and
// is still to come, and what the store bought from a supplier to cover it.
// showStock: also what the store holds and is short of (the Store Manager's view).
export function RequestLines({ request, showStock = false }) {
  const { t, td } = useLanguage()
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-lg bg-slate-50/70 px-3">
      {request.lines.map((line) => (
        <li key={line.id} className="py-1.5 text-xs">
          <p className="font-extrabold text-graphite">{td(line.item_name)}{line.variant ? ` · ${td(line.variant)}` : ''}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-semibold text-graphite/70">
            <span>{t('store.line.requested', { quantity: `${formatQty(line.quantity)} ${td(line.unit)}` })}</span>
            <span>{t('store.line.approved', { quantity: formatQty(line.approved_quantity) })}</span>
            <span className="text-emerald-700">{t('store.line.issued', { quantity: formatQty(line.issued) })}</span>
            {line.remaining > 0 && <span className="text-amber-700">{t('store.line.remaining', { quantity: formatQty(line.remaining) })}</span>}
            {line.ordered > 0 && <span>{t('store.line.ordered', { quantity: formatQty(line.ordered) })} · {t('store.line.received', { quantity: formatQty(line.received) })}</span>}
            {showStock && line.remaining > 0 && (
              <span className={`font-extrabold ${line.shortage > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                {t('store.requests.available', { quantity: formatQty(line.available) })}
                {line.shortage > 0 && ` · ${t('store.requests.short', { quantity: formatQty(line.shortage) })}`}
              </span>
            )}
          </p>
        </li>
      ))}
    </ul>
  )
}
