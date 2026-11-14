import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { ArrowRight, Menu, X } from 'lucide-react'
import Logo from '../../../shared/ui/Logo.jsx'
import { PARTNER_SESSION } from '../../../shared/api/apiClient.js'
import PublicWeatherIndicator from '../../weather/components/PublicWeatherIndicator.jsx'

// The same white surface the Professional app's landing bar uses, copied by value rather than imported
// so Partner keeps depending on nothing in the Professional app. Kept in both scroll states: the bar is
// opaque, so only its shadow changes as the visitor scrolls.
const BAR = 'bg-white'
const BAR_EDGE = 'border-[rgba(8,62,43,.12)]'

const NAV_LINKS = [
  { href: '#services', label: 'Services' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#join', label: 'For technicians' },
]

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // Only a session signed in with email + password; the dashboard route confirms it with the backend.
  const signedIn = useSelector((state) => state.auth.signedIn && state.auth.kind === PARTNER_SESSION)

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <header
      className={`sticky top-0 z-30 w-full border-b transition duration-300 ease-soft ${BAR} ${BAR_EDGE} ${
        scrolled ? 'shadow-ocsoft' : ''
      }`}
    >
      <div className="mx-auto flex h-[58px] max-md:h-[52px] w-full items-center gap-6 px-5 sm:px-8">
        <Logo wordmark />
        <nav className="ml-6 hidden items-center gap-7 text-xs font-bold text-oc-muted md:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition hover:text-oc-deep">{link.label}</a>
          ))}
        </nav>
        {/* The weather where the visitor is (or chooses); its detail opens in a popover. */}
        <PublicWeatherIndicator className="ml-auto" />
        <div className="hidden items-center gap-3 md:flex">
          {signedIn ? (
            <Link to="/dashboard" className="btn-primary text-xs">My dashboard <ArrowRight className="h-4 w-4" /></Link>
          ) : (
            <>
              <Link to="/login" className="text-xs font-extrabold text-oc-deep hover:text-oc-green">Technician login</Link>
              <Link to="/register" className="btn-primary text-xs">Join as technician <ArrowRight className="h-4 w-4" /></Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="rounded-lg p-2 text-oc-ink md:hidden"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {menuOpen && (
        <div className={`border-t ${BAR_EDGE} ${BAR} md:hidden`}>
          <div className="container-x flex flex-col gap-1 py-3">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)} className="rounded-lg px-2 py-2.5 text-sm font-bold text-oc-ink">
                {link.label}
              </a>
            ))}
            {signedIn ? (
              <Link to="/dashboard" className="btn-primary mt-2">My dashboard</Link>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link to="/login" className="btn-ghost">Login</Link>
                <Link to="/register" className="btn-primary">Join</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
