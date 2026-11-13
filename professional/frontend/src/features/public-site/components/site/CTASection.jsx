import { ArrowRight, PhoneCall } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Container, Reveal } from './ui.jsx'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

export default function CTASection() {
  const { t } = useLanguage()
  return (
    <section className="bg-[#fcfaf3] pb-24 pt-4 sm:pb-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 px-8 py-16 shadow-[0_50px_120px_-50px_rgba(19,65,39,0.7)] sm:px-16">
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-brand-900/30 blur-3xl" />
            <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.12]" />

            <div className="relative flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-center">
              <div className="max-w-2xl">
                <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-white backdrop-blur">
                  <PhoneCall className="h-4 w-4" /> {t('site.cta.badge')}
                </p>
                <h2 className="mt-5 font-display text-[clamp(1.7rem,3.4vw,2.7rem)] font-extrabold leading-[1.1] tracking-tighter text-white text-balance">
                  {t('site.cta.title')}
                </h2>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                  {t('site.cta.sub')}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                <Link
                  to="/estimate"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-[15px] font-bold text-graphite shadow-soft transition hover:-translate-y-0.5 hover:shadow-float"
                >
                  {t('site.hero.cta.estimate')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="tel:+914012345678"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-8 py-4 text-[15px] font-bold text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/20"
                >
                  <PhoneCall className="h-4 w-4" /> +91 40 1234 5678
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
