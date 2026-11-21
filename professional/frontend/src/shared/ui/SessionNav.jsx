import { useEffect, useId, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown, LayoutGrid, LogOut, UserRound } from 'lucide-react'
import { logoutUser } from '../auth/authSlice.js'
import { useAccountLinks } from '../auth/sessionLinks.js'
import { userAvatarSrc } from './avatars.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/**
 * A public page's header controls for a visitor who is signed in: the avatar's account
 * menu (Dashboard, Profile, Sign out) where Sign in sits, and a Dashboard button (the
 * role's home, or the step it has not finished) where Get started sits. Renders nothing
 * when signed out, so the header keeps its Sign in / Get started buttons. Sign out here is the explicit action; nothing else on
 * a public page ends a session.
 *
 * `goClassName` styles the Dashboard button to match the header it sits in;
 * `stacked` lays both out full width (a phone menu).
 */
export default function SessionNav({ goClassName = '', stacked = false, onNavigate }) {
  const { user, links } = useAccountLinks()
  const { t, td } = useLanguage()
  const dispatch = useDispatch()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!wrapRef.current?.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!user || !links) return null
  const name = td(user.name || '')
  const go = () => { setOpen(false); onNavigate?.() }
  const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm font-bold text-oc-ink transition hover:bg-oc-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green'

  return (
    <div ref={wrapRef} data-testid="session-nav" className={`relative flex items-center gap-2 ${stacked ? 'w-full flex-col items-stretch' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('session.accountMenu')}
        title={name}
        className={`inline-flex items-center gap-1 rounded-full border border-[rgba(8,62,43,.3)] bg-white/70 p-0.5 pe-1.5 text-oc-deep transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green ${stacked ? 'self-center' : ''}`}
      >
        <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-oc-mint text-xs font-extrabold text-oc-green">
          <img src={userAvatarSrc(user)} alt="" className="h-full w-full object-cover" />
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('session.accountMenu')}
          className={`absolute end-0 top-full z-dropdown mt-2 w-56 rounded-xl border border-oc-line bg-white p-1.5 shadow-ocsoft ${stacked ? 'start-1/2 -translate-x-1/2' : ''}`}
        >
          {name && <p className="truncate px-3 pb-1.5 pt-1 text-xs font-semibold text-oc-muted" title={name}>{name}</p>}
          <Link role="menuitem" to={links.dashboard} onClick={go} className={itemClass}>
            <LayoutGrid size={16} aria-hidden="true" /> {t('ui.dashboard')}
          </Link>
          {links.profile && (
            <Link role="menuitem" to={links.profile} onClick={go} className={itemClass}>
              <UserRound size={16} aria-hidden="true" /> {t('ui.profile')}
            </Link>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); dispatch(logoutUser()) }}
            className={`${itemClass} text-rose-700`}
          >
            <LogOut size={16} aria-hidden="true" /> {t('session.signOut')}
          </button>
        </div>
      )}
      <Link to={links.home} onClick={go} className={goClassName}>
        {t('ui.dashboard')} <ArrowRight size={15} className="rtl:-scale-x-100" aria-hidden="true" />
      </Link>
    </div>
  )
}
