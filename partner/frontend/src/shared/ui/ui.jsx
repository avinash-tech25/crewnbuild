import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

const ALERT_TONES = {
  error: { icon: AlertCircle, className: 'border-red-200 bg-red-50 text-red-800' },
  success: { icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  info: { icon: Info, className: 'border-oc-line bg-oc-sunken text-oc-deep' },
}

export function Alert({ tone = 'info', children }) {
  if (!children) return null
  const { icon: Icon, className } = ALERT_TONES[tone] || ALERT_TONES.info
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-medium ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".2" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** The circular search animation shown while technicians are being found. */
export function SearchLoader({ image, message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16 text-center" role="status" aria-live="polite">
      <div className="relative grid h-40 w-40 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-oc-green/10 [animation-duration:1.8s]" />
        <svg className="absolute inset-0 h-full w-full animate-spin [animation-duration:1.4s]" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" stroke="#d9e6de" strokeWidth="4" fill="none" />
          <path d="M50 4a46 46 0 0 1 46 46" stroke="#126b45" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M96 50a46 46 0 0 1-9 27" stroke="#f4b740" strokeWidth="4" strokeLinecap="round" fill="none" />
        </svg>
        <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-gradient-to-b from-white to-oc-mint shadow-inner">
          {image && <img src={image} alt="" className="mt-4 h-28 w-28 object-contain" />}
        </div>
      </div>
      <p className="font-display text-lg font-extrabold text-oc-deep">{message}</p>
      <p className="max-w-xs text-sm text-oc-muted">Asking the closest available technicians first.</p>
    </div>
  )
}

export function EmptyState({ icon: Icon = Info, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-oc-line bg-white/60 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-oc-mint text-oc-green">
        <Icon className="h-5 w-5" />
      </span>
      <p className="font-display text-base font-extrabold text-oc-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-oc-muted">{children}</div>}
    </div>
  )
}

// Every service request status (partner.service_requests.status).
const STATUS_STYLES = {
  SEARCHING: 'bg-amber-50 text-amber-800 border-amber-200',
  OFFERED: 'bg-orange-50 text-orange-800 border-orange-200',
  ACCEPTED: 'bg-sky-50 text-sky-800 border-sky-200',
  EN_ROUTE: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  ARRIVED: 'bg-teal-50 text-teal-800 border-teal-200',
  IN_PROGRESS: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  COMPLETED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  NO_TECHNICIAN_FOUND: 'bg-red-50 text-red-700 border-red-200',
  EXPIRED: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function StatusPill({ status, label }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${STATUS_STYLES[status] || STATUS_STYLES.CANCELLED}`}>
      {label || String(status || '').replaceAll('_', ' ').toLowerCase()}
    </span>
  )
}

export function formatDate(value) {
  if (!value) return ''
  // The API sends UTC timestamps without a zone suffix.
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
