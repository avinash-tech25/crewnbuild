import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu, Phone, X } from 'lucide-react'
import Logo from '../../../../shared/ui/Logo.jsx'
import LanguageSelector from '../../../../shared/ui/LanguageSelector.jsx'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const LINKS = [
  { labelKey: 'site.nav.home', to: '/' },
  { labelKey: 'site.nav.about', to: '/about' },
  { labelKey: 'site.nav.services', to: '/services' },
  { labelKey: 'site.nav.projects', to: '/projects' },
  { labelKey: 'site.nav.whyUs', to: '/why-us' },
  { labelKey: 'site.nav.process', to: '/process' },
  { labelKey: 'site.nav.testimonials', to: '/testimonials' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { t } = useLanguage()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b border-slate-200/70 bg-[#fcfaf3]/90 backdrop-blur-xl transition-all duration-300 ${
        scrolled ? 'shadow-[0_10px_40px_-24px_rgba(15,23,42,0.35)]' : ''
      }`}
    >
      {/* The full row of links, language, Login and Sign Up needs more than
          1024px (Sign Up Now was cut off the right edge there), so the menu
          button serves tablets too and the row appears from 1280px. */}
      <nav className="container-x flex h-[76px] items-center justify-between gap-2.5 lg:px-6">
        <Logo taglineClassName="hidden xl:block" />

        <ul className="hidden items-center gap-0.5 xl:flex xl:gap-1">
          {/* Desktop nav links — nowrap so labels never stack */}
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `relative rounded-full whitespace-nowrap px-2 py-2 text-sm font-semibold transition-colors xl:px-3 ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-graphite'
                  }`
                }
              >
                {t(l.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-1.5 xl:flex">
          <a
            href="tel:+914012345678"
            className="hidden whitespace-nowrap items-center gap-2 text-sm font-bold transition-colors text-slate-600 hover:text-brand-600 3xl:inline-flex"
          >
            <Phone className="h-4 w-4" /> +91 40 1234 5678
          </a>
          <LanguageSelector compact variant="light" />
          <NavLink
            to="/login"
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border border-brand-300 bg-white px-3 text-[13px] font-bold text-brand-800 transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-brand-50"
          >
            {t('site.nav.login')}
          </NavLink>
          <NavLink
            to="/signup"
            className="inline-flex h-9 whitespace-nowrap items-center gap-2 rounded-full bg-brand-800 px-3.5 text-[13px] font-bold text-white shadow-orange transition hover:-translate-y-0.5 hover:bg-brand-700"
          >
            {t('site.nav.signup')}
          </NavLink>
        </div>

        <button
          className="grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-graphite transition xl:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-slate-100 bg-white/95 backdrop-blur-xl xl:hidden">
          <div className="container-x flex flex-col gap-1 py-4">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `rounded-xl px-4 py-3 text-sm font-bold transition ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {t(l.labelKey)}
              </NavLink>
            ))}
            <div className="mt-3 flex items-center justify-center">
              <LanguageSelector compact variant="light" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <NavLink to="/login" className="btn-ghost">
                {t('site.nav.login')}
              </NavLink>
              <NavLink to="/signup" className="btn-primary col-span-2">
                {t('site.nav.signup')}
              </NavLink>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
