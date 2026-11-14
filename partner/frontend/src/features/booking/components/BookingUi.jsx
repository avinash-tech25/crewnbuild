/**
 * Small presentation pieces for the requester's booking pages only. The
 * technician screens and the landing page keep their own StatusPill and
 * CategoryCard; nothing here changes what a booking is or does.
 */

// Each stored status, grouped by what it means to the person who booked:
// still waiting (amber), confirmed and under way (green), done (emerald),
// cancelled (red), or not matched (orange). Labels come from the API.
const STATUS_TONES = {
  SEARCHING: 'bg-amber-50 text-amber-800 ring-amber-200',
  OFFERED: 'bg-amber-50 text-amber-800 ring-amber-200',
  ACCEPTED: 'bg-green-50 text-green-800 ring-green-200',
  EN_ROUTE: 'bg-green-50 text-green-800 ring-green-200',
  ARRIVED: 'bg-green-50 text-green-800 ring-green-200',
  IN_PROGRESS: 'bg-green-50 text-green-800 ring-green-200',
  COMPLETED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
  NO_TECHNICIAN_FOUND: 'bg-orange-50 text-orange-800 ring-orange-200',
  EXPIRED: 'bg-orange-50 text-orange-800 ring-orange-200',
}
const DOT_TONES = {
  amber: 'bg-amber-500', green: 'bg-green-500', emerald: 'bg-emerald-500', red: 'bg-red-500', orange: 'bg-orange-500',
}

function dotFor(status) {
  const tone = STATUS_TONES[status] || ''
  return DOT_TONES[Object.keys(DOT_TONES).find((name) => tone.includes(`${name}-50`))] || 'bg-slate-400'
}

function sentence(text) {
  const value = String(text || '').replaceAll('_', ' ').toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** A compact status badge: a coloured dot and the API's own label. */
export function BookingStatusBadge({ status, label }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${STATUS_TONES[status] || 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotFor(status)}`} aria-hidden="true" />
      {sentence(label || status)}
    </span>
  )
}

/** The trade's figure as a small tile: head and shoulders, never stretched. */
export function TradeThumb({ type, size = 'h-11 w-11' }) {
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-xl bg-gradient-to-b ring-1 ring-oc-line ${type?.tint || 'from-oc-mint to-white'} ${size}`}>
      {type?.heroImage && (
        <img src={type.heroImage} alt="" loading="lazy" className="absolute left-1/2 top-[6%] h-[190%] w-auto max-w-none -translate-x-1/2 object-contain" />
      )}
    </span>
  )
}
