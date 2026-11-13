import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Container, Reveal, SectionHeading } from './ui.jsx'
import { PROCESS } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const STEP_KEYS = [
  { titleKey: 'site.process.s1t', blurbKey: 'site.process.s1b' },
  { titleKey: 'site.process.s2t', blurbKey: 'site.process.s2b' },
  { titleKey: 'site.process.s3t', blurbKey: 'site.process.s3b' },
  { titleKey: 'site.process.s4t', blurbKey: 'site.process.s4b' },
  { titleKey: 'site.process.s5t', blurbKey: 'site.process.s5b' },
  { titleKey: 'site.process.s6t', blurbKey: 'site.process.s6b' },
]

export default function ProcessSection({ compact = false }) {
  const { t } = useLanguage()
  const steps = compact ? PROCESS.slice(0, 4) : PROCESS
  return (
    <section className="relative bg-[#fcfaf3] py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/60 to-transparent" />
      <Container>
        <SectionHeading
          eyebrow={t('site.process.eyebrow')}
          title={t('site.process.title')}
          highlight={t('site.process.highlight')}
          sub={t('site.process.sub')}
        />

        <div className="relative mt-16">
          {/* connector line */}
          <div className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-brand-500/10 via-brand-500/50 to-brand-500/10 lg:block" />
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((p, i) => {
              const keys = STEP_KEYS[i] || {}
              return (
                <Reveal key={p.step} delay={i * 0.08}>
                  <div className="group relative">
                    <div className="flex items-center gap-3.5">
                      <span className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-brand-300 bg-white font-display text-base font-extrabold text-brand-700 shadow-[0_0_0_5px_rgba(240,246,242,1)] transition-all duration-300 group-hover:border-brand-500 group-hover:bg-brand-500 group-hover:text-brand-950">
                        {p.step}
                      </span>
                      <span className="h-px flex-1 bg-brand-200" />
                    </div>
                    <h3 className="mt-4 font-display text-lg font-extrabold tracking-tight text-graphite">
                      {t(keys.titleKey || p.title)}
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{t(keys.blurbKey || p.blurb)}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>

        {compact && (
          <Reveal className="mt-14 text-center">
            <Link to="/process" className="btn-white group">
              {t('site.process.seeAll')} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Reveal>
        )}
      </Container>
    </section>
  )
}
