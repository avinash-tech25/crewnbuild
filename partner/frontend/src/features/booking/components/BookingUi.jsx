import { statusTone } from '../../../shared/ui/ListCard.jsx'

/**
 * Small presentation pieces for the requester's booking pages only. The
 * technician screens and the landing page keep their own StatusPill and
 * CategoryCard; nothing here changes what a booking is or does.
 */

// The same colour scheme as every card (shared/ui/ListCard.jsx): waiting amber, under way
// blue, done green, refused or failed red, ended grey. Labels come from the API.
const BADGE_TONES = {
  amber: ['bg-amber-50 text-amber-800 ring-amber-200', 'bg-amber-500'],
  green: ['bg-emerald-50 text-emerald-800 ring-emerald-200', 'bg-emerald-500'],
  blue: ['bg-sky-50 text-sky-800 ring-sky-200', 'bg-sky-500'],
  red: ['bg-rose-50 text-rose-700 ring-rose-200', 'bg-rose-500'],
  grey: ['bg-slate-100 text-slate-700 ring-slate-200', 'bg-slate-400'],
  violet: ['bg-violet-50 text-violet-800 ring-violet-200', 'bg-violet-500'],
}
const badgeTone = (status) => BADGE_TONES[statusTone(status)] || BADGE_TONES.grey
const dotFor = (status) => badgeTone(status)[1]

function sentence(text) {
  const value = String(text || '').replaceAll('_', ' ').toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** A compact status badge: a coloured dot and the API's own label. */
export function BookingStatusBadge({ status, label }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${badgeTone(status)[0]}`}>
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
