import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock, Mail, MapPin, Phone } from 'lucide-react'
import Logo from '../../../../shared/ui/Logo.jsx'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const COLUMNS = [
  {
    titleKey: 'site.footer.col.company',
    links: [
      { labelKey: 'site.footer.link.about', to: '/about' },
      { labelKey: 'site.footer.link.projects', to: '/projects' },
      { labelKey: 'site.footer.link.why', to: '/why-us' },
      { labelKey: 'site.footer.link.testimonials', to: '/testimonials' },
      { labelKey: 'site.footer.link.contact', to: '/contact' },
    ],
  },
  {
    titleKey: 'site.footer.col.services',
    links: [
      { labelKey: 'site.footer.link.design', to: '/services' },
      { labelKey: 'site.footer.link.residential', to: '/services' },
      { labelKey: 'site.footer.link.commercial', to: '/services' },
      { labelKey: 'site.footer.link.renovation', to: '/services' },
      { labelKey: 'site.footer.link.pm', to: '/services' },
    ],
  },
  {
    titleKey: 'site.footer.col.platform',
    links: [
      { labelKey: 'site.footer.link.homeowners', to: '/signup?role=OWNER' },
      { labelKey: 'site.footer.link.builders', to: '/signup?role=CONTRACTOR' },
      { labelKey: 'site.footer.link.suppliers', to: '/signup?role=SUPPLIER' },
      { labelKey: 'site.footer.link.login', to: '/login' },
    ],
  },
  {
    titleKey: 'site.footer.col.legal',
    links: [
      { labelKey: 'site.footer.link.privacy', to: '/' },
      { labelKey: 'site.footer.link.terms', to: '/' },
      { labelKey: 'site.footer.link.rera', to: '/' },
      { labelKey: 'site.footer.link.security', to: '/' },
    ],
  },
]

export default function Footer() {
  const { t } = useLanguage()
  return (
    <footer className="bg-[#0a2b1d] text-white">
      <div className="container-x py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-12">
          <div className="col-span-2 md:col-span-4">
            <Logo light />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-brand-100/70">
              {t('site.footer.tagline')}
            </p>
            <div className="mt-6 space-y-2.5 text-sm text-brand-100/70">
              <p className="flex items-center gap-2.5">
                <Mail className="h-4 w-4 text-brand-300" /> hello@octabuild.in
              </p>
              <p className="flex items-center gap-2.5">
                <Phone className="h-4 w-4 text-brand-300" /> +91 40 1234 5678
              </p>
              <p className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 text-brand-300" /> HITEC City, Hyderabad, India
              </p>
              <p className="flex items-center gap-2.5">
                <Clock className="h-4 w-4 text-brand-300" /> Mon–Sat · 9:00 AM – 7:00 PM
              </p>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.titleKey} className="md:col-span-2">
              <h4 className="font-display text-sm font-bold tracking-wide text-white">{t(col.titleKey)}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.labelKey}>
                    <Link
                      to={l.to}
                      className="group relative inline-flex max-w-full items-center gap-1 text-sm text-brand-100/70 transition-colors hover:text-brand-200"
                    >
                      {/* The hover arrow sits just past the label instead of
                          taking width in the row: the link columns are ~84px at
                          768px, and the invisible arrow pushed labels out of them. */}
                      <span className="min-w-0">{t(l.labelKey)}</span>
                      <ArrowUpRight className="absolute -end-[18px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-brand-100/50 sm:flex-row">
          <p>{t('site.footer.copyright')}</p>
          <p className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-brand-400" />
            {t('site.footer.built')}
          </p>
        </div>
      </div>
    </footer>
  )
}
