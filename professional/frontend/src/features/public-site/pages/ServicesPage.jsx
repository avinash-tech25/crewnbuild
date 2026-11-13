import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import ProcessSection from '../components/site/ProcessSection.jsx'
import CTASection from '../components/site/CTASection.jsx'
import { Container, Eyebrow, Reveal, SmartImage } from '../components/site/ui.jsx'
import { IMG, SERVICES } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

// Each service maps to 4 point keys: p1–p4, p5–p8, … (in SERVICES order)
const POINT_BASE = {
  design: 1,
  residential: 5,
  commercial: 9,
  renovation: 13,
  pm: 17,
  mep: 21,
}

const TITLE_KEYS = {
  design: 'site.services.card.design',
  residential: 'site.services.card.residential',
  commercial: 'site.services.card.commercial',
  renovation: 'site.services.card.renovation',
  pm: 'site.services.card.pm',
  mep: 'site.services.card.mep',
}

const BLURB_KEYS = {
  design: 'site.services.card.designBlurb',
  residential: 'site.services.card.residentialBlurb',
  commercial: 'site.services.card.commercialBlurb',
  renovation: 'site.services.card.renovationBlurb',
  pm: 'site.services.card.pmBlurb',
  mep: 'site.services.card.mepBlurb',
}

export default function Services() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.services.hero.eyebrow')}
        title={t('site.services.hero.title')}
        highlight={t('site.services.hero.highlight')}
        sub={t('site.services.hero.sub')}
        image={IMG.blueprint}
      />

      <section className="bg-white py-24 sm:py-28">
        <Container>
          <div className="space-y-20">
            {SERVICES.map((s, i) => {
              const title = t(TITLE_KEYS[s.id] || '') || s.title
              const blurb = t(BLURB_KEYS[s.id] || '') || s.blurb
              const pointStart = POINT_BASE[s.id]
              return (
                <div
                  key={s.id}
                  id={s.id}
                  className="grid scroll-mt-28 items-center gap-10 lg:grid-cols-2"
                >
                  <Reveal className={i % 2 === 1 ? 'lg:order-2' : ''}>
                    <div className="group relative overflow-hidden rounded-[2rem] shadow-[0_36px_90px_-48px_rgba(15,23,42,0.6)]">
                      <SmartImage
                        src={s.image}
                        alt={title}
                        className="aspect-[4/3] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" />
                    </div>
                  </Reveal>
                  <div className={i % 2 === 1 ? 'lg:order-1' : ''}>
                    <Reveal>
                      <Eyebrow>0{i + 1}</Eyebrow>
                    </Reveal>
                    <Reveal delay={0.06}>
                      <h2 className="h-display mt-4 text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.1]">
                        {title}
                      </h2>
                    </Reveal>
                    <Reveal delay={0.12}>
                      <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-500">{blurb}</p>
                    </Reveal>
                    <Reveal delay={0.18}>
                      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                        {s.points.map((p, pIndex) => (
                          <li
                            key={p}
                            className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-graphite ring-1 ring-slate-100 transition hover:bg-brand-50 hover:ring-brand-200"
                          >
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-500" />
                            {pointStart ? t(`site.services.p${pointStart + pIndex}`) : p}
                          </li>
                        ))}
                      </ul>
                    </Reveal>
                    <Reveal delay={0.24}>
                      <Link to="/contact" className="btn-ghost mt-7">
                        {t('site.services.cta')}
                      </Link>
                    </Reveal>
                  </div>
                </div>
              )
            })}
          </div>
        </Container>
      </section>

      <ProcessSection compact />
      <CTASection />
    </SiteLayout>
  )
}
