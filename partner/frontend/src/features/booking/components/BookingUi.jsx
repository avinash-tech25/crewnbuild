import { TONE_CLASSES, statusTone } from '../../../shared/ui/ListCard.jsx'

/**
 * Small presentation pieces for the requester's booking pages only. Nothing here
 * changes what a booking is or does.
 */

// The badge's dot, in the card colours (TONE_CLASSES in shared/ui/ListCard.jsx):
// waiting amber, under way blue, done green, refused or failed red, ended grey.
const DOT_TONES = {
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  red: 'bg-rose-500',
  grey: 'bg-slate-400',
  violet: 'bg-violet-500',
}

/** A status code or the API's label, in sentence case ("En route"). */
export function statusSentence(text) {
  const value = String(text || '').replaceAll('_', ' ').toLowerCase()
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** A compact status badge: a coloured dot and the API's own label. */
export function BookingStatusBadge({ status, label }) {
  const tone = statusTone(status)
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px text-[11px] font-bold ${TONE_CLASSES[tone] || TONE_CLASSES.grey}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONES[tone] || DOT_TONES.grey}`} aria-hidden="true" />
      {statusSentence(label || status)}
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
