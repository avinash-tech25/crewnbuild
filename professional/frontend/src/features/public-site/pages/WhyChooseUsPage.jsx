import { Check, Minus } from 'lucide-react'
import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import WhyUsSection from '../components/site/WhyUsSection.jsx'
import StatsSection from '../components/site/StatsSection.jsx'
import TestimonialsSection from '../components/site/TestimonialsSection.jsx'
import CTASection from '../components/site/CTASection.jsx'
import { Container, Reveal, SectionHeading } from '../components/site/ui.jsx'
import { IMG } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const COMPARISON = [
  { labelKey: 'site.why.cmp1', us: true, them: false },
  { labelKey: 'site.why.cmp2', us: true, them: false },
  { labelKey: 'site.why.cmp3', us: true, them: true },
  { labelKey: 'site.why.cmp4', us: true, them: false },
  { labelKey: 'site.why.cmp5', us: true, them: true },
  { labelKey: 'site.why.cmp6', us: true, them: false },
  { labelKey: 'site.why.cmp7', us: true, them: false },
]

export default function WhyChooseUs() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.why.hero.eyebrow')}
        title={t('site.why.hero.title')}
        highlight={t('site.why.hero.highlight')}
        sub={t('site.why.hero.sub')}
        image={IMG.teamWork}
      />

      <WhyUsSection />

      {/* Comparison */}
      <section className="bg-slate-50 py-24 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow={t('site.why.compare.eyebrow')}
            title={t('site.why.compare.title')}
            highlight={t('site.why.compare.highlight')}
          />
          <Reveal className="mx-auto mt-14 max-w-3xl">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_80px_-50px_rgba(15,23,42,0.5)]">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_90px] border-b border-slate-100 bg-slate-50 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:px-7">
                <span />
                <span className="text-center font-display text-sm font-extrabold text-graphite">
                  {t('site.why.compare.us')}
                </span>
                <span className="text-center font-display text-sm font-extrabold text-slate-400">
                  {t('site.why.compare.them')}
                </span>
              </div>
              {COMPARISON.map((row, i) => (
                <div
                  key={row.labelKey}
                  className={`grid grid-cols-[minmax(0,1fr)_90px_90px] items-center px-5 py-4 sm:grid-cols-[minmax(0,1fr)_120px_120px] sm:px-7 ${
                    i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-600">{t(row.labelKey)}</p>
                  <span className="flex justify-center">
                    {row.us ? (
                      <Check className="h-5 w-5 text-brand-500" strokeWidth={2.6} />
                    ) : (
                      <Minus className="h-5 w-5 text-slate-300" />
                    )}
                  </span>
                  <span className="flex justify-center">
                    {row.them ? (
                      <Check className="h-5 w-5 text-slate-300" strokeWidth={2.6} />
                    ) : (
                      <Minus className="h-5 w-5 text-slate-300" />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>

      <StatsSection />
      <TestimonialsSection limit={3} />
      <CTASection />
    </SiteLayout>
  )
}
