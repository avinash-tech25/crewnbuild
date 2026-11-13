import { CheckCircle2, Compass, Handshake, Leaf, Target } from 'lucide-react'
import SiteLayout from '../components/SiteLayout.jsx'
import PageHero from '../components/site/PageHero.jsx'
import StatsSection from '../components/site/StatsSection.jsx'
import TeamSection from '../components/site/TeamSection.jsx'
import CTASection from '../components/site/CTASection.jsx'
import { Container, Eyebrow, Reveal, SectionHeading, SmartImage } from '../components/site/ui.jsx'
import { IMG } from '../components/site/data.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const VALUES = [
  { icon: Compass, titleKey: 'site.about.h1', blurbKey: 'site.about.h1b' },
  { icon: Target, titleKey: 'site.about.h2', blurbKey: 'site.about.h2b' },
  { icon: Handshake, titleKey: 'site.about.h3', blurbKey: 'site.about.h3b' },
  { icon: Leaf, titleKey: 'site.about.h4', blurbKey: 'site.about.h4b' },
]

const HIGHLIGHTS = [
  'site.about.hl1',
  'site.about.hl2',
  'site.about.hl3',
  'site.about.hl4',
]

export default function About() {
  const { t } = useLanguage()
  return (
    <SiteLayout>
      <PageHero
        eyebrow={t('site.about.hero.eyebrow')}
        title={t('site.about.hero.title')}
        highlight={t('site.about.hero.highlight')}
        sub={t('site.about.hero.sub')}
        image={IMG.heroConstruction}
      />

      {/* Story */}
      <section className="bg-white py-24 sm:py-28">
        <Container>
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div className="order-2 lg:order-1">
              <Reveal>
                <Eyebrow>{t('site.about.story.eyebrow')}</Eyebrow>
              </Reveal>
              <Reveal delay={0.06}>
                <h2 className="h-display mt-4 text-[clamp(1.9rem,4vw,3rem)] leading-[1.08]">
                  {t('site.about.story.title')}{' '}
                  <span className="text-brand-500">{t('site.about.story.highlight')}</span>
                </h2>
              </Reveal>
              <Reveal delay={0.12}>
                <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-500">
                  <p>{t('site.about.story.p1')}</p>
                  <p>{t('site.about.story.p2')}</p>
                </div>
              </Reveal>
              <Reveal delay={0.18}>
                <ul className="mt-7 space-y-3">
                  {HIGHLIGHTS.map((key) => (
                    <li key={key} className="flex items-start gap-3 text-sm font-semibold text-graphite">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
                      {t(key)}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
            <Reveal className="order-1 lg:order-2">
              <div className="relative overflow-hidden rounded-[2rem] shadow-[0_40px_100px_-50px_rgba(15,23,42,0.6)]">
                <SmartImage
                  src={IMG.cranes}
                  alt="CREWNBUILD site crew at work"
                  className="aspect-[4/3] w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 to-transparent" />
                <div className="absolute bottom-6 left-6 rounded-2xl bg-white/90 px-5 py-3 backdrop-blur">
                  <p className="font-display text-2xl font-extrabold text-graphite">{t('site.about.story.est')}</p>
                  <p className="text-xs font-semibold text-slate-500">{t('site.about.story.city')}</p>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* Values */}
      <section className="bg-slate-50 py-24 sm:py-28">
        <Container>
          <SectionHeading
            eyebrow={t('site.about.values.eyebrow')}
            title={t('site.about.values.title')}
            highlight={t('site.about.values.highlight')}
          />
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((v, i) => (
              <Reveal key={v.titleKey} delay={i * 0.06}>
                <div className="group h-full rounded-3xl border border-slate-200 bg-white p-7 transition-all duration-300 hover:-translate-y-1.5 hover:border-brand-300 hover:shadow-[0_30px_70px_-40px_rgba(35,102,69,0.4)]">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition group-hover:bg-brand-500 group-hover:text-white">
                    <v.icon className="h-6 w-6" strokeWidth={1.9} />
                  </span>
                  <h3 className="mt-5 font-display text-lg font-extrabold tracking-tight text-graphite">
                    {t(v.titleKey)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">{t(v.blurbKey)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <StatsSection />
      <TeamSection />
      <CTASection />
    </SiteLayout>
  )
}
