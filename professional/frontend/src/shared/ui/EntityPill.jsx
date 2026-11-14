import { avatarSrc, userAvatarSrc } from './avatars.js'
/**
 * The chip used inside EntityCard.
 *
 * Same tones and shape as the landing page's Pill, so a status chip reads the
 * same on a dashboard as it does on the marketing site. Amber marks a state,
 * never an action.
 */
const tones = {
  neutral: 'bg-oc-sunken text-oc-muted border-oc-line',
  brand: 'bg-ocbrand-50 text-ocbrand-700 border-ocbrand-100',
  accent: 'bg-ocaccent-50 text-ocaccent-600 border-ocaccent-100',
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  warning: 'bg-rose-50 text-rose-600 border-rose-100',
  info: 'bg-blue-50 text-slate-700 border-blue-100',
}

const dotTones = {
  neutral: 'bg-oc-faint',
  brand: 'bg-ocbrand-400',
  accent: 'bg-ocaccent-400 animate-pulse-dot',
  positive: 'bg-emerald-500',
  warning: 'bg-rose-500',
  info: 'bg-blue-500',
}

export function EntityPill({ tone = 'neutral', dot = false, icon: Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-normal ${tones[tone] || tones.neutral}`}>
      {dot && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotTones[tone] || dotTones.neutral}`} />}
      {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />}
      {children}
    </span>
  )
}

/** Round avatar frame at card scale — the landing card's treatment. */
/**
 * The avatar belongs to the person named on the card, so it is resolved from
 * that person's own record rather than from whoever is logged in.
 *
 * Give it `user` (the object the name came from) and it resolves the picture
 * itself: their uploaded image, else their role's default. `role` alone is
 * enough for a list that is already one role; `src` still works for a caller
 * holding a URL it resolved elsewhere. With none of the three it falls back to
 * `fallback`, exactly as it always did.
 */
export function EntityAvatar({ src, alt, fallback, className = '', role = null, user = null }) {
  const resolved = user
    ? userAvatarSrc(user, role)
    : (String(src || '').trim() || (role ? avatarSrc('', role) : ''))
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-oc-line bg-oc-mint text-xs font-extrabold text-oc-green ${className}`}>
      {resolved ? <img src={resolved} alt={alt || ''} className="h-full w-full object-cover" /> : (fallback || '')}
    </span>
  )
}
