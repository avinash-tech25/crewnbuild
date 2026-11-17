import { Link, useLocation } from 'react-router-dom'
import Logo from '../../../shared/ui/Logo.jsx'
import { TECHNICIAN_TYPES } from '../../../shared/constants/technicianTypes.js'
import { SUPPORT_PHONE, phoneHref } from '../../../shared/constants/support.js'

export default function SiteFooter() {
  // The section links point into the landing page; from another page (/terms) they go back to it.
  const home = useLocation().pathname === '/' ? '' : '/'
  return (
    <footer className="bg-oc-deep text-[#b9d8c5]">
      <div className="container-x grid gap-10 py-14 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo tone="light" />
          <p className="max-w-sm text-sm leading-relaxed">
            CREWNBUILD connects House Owners and Site Engineers with verified local painters, plumbers, electricians and carpenters,
            matched by PIN code and locality.
          </p>
          <p className="text-sm">
            Call us:{' '}
            <a href={phoneHref(SUPPORT_PHONE)} className="font-semibold text-white hover:underline" dir="ltr">{SUPPORT_PHONE}</a>
          </p>
        </div>
        <div>
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-white">Services</p>
          <ul className="space-y-2 text-sm">
            {TECHNICIAN_TYPES.map((type) => (
              <li key={type.code}><a href={`${home}#services`} className="hover:text-white">{type.label}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-white">Technicians</p>
          <ul className="space-y-2 text-sm">
            <li><Link to="/register" className="hover:text-white">Register</Link></li>
            <li><Link to="/login" className="hover:text-white">Login</Link></li>
            <li><a href={`${home}#how-it-works`} className="hover:text-white">How it works</a></li>
          </ul>
        </div>
        <nav aria-label="Legal">
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-white">Legal</p>
          <ul className="space-y-2 text-sm">
            <li><Link to="/terms" className="hover:text-white">Terms of service</Link></li>
            <li><Link to="/privacy" className="hover:text-white">Privacy policy</Link></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <div className="container-x flex flex-col gap-2 py-5 text-xs sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} CREWNBUILD. All rights reserved.</span>
          <span>House Owners and Site Engineers book through their CREWNBUILD dashboard.</span>
        </div>
      </div>
    </footer>
  )
}
