import { CheckCircle2, Eye, FileCheck2, Landmark, ShieldCheck, Wallet } from 'lucide-react'
import { Container, Eyebrow, Reveal, SmartImage } from './ui.jsx'
import { IMG } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const REASONS = [
  { icon: Landmark, titleKey: 'site.why.r1t', blurbKey: 'site.why.r1b' },
  { icon: Wallet, titleKey: 'site.why.r2t', blurbKey: 'site.why.r2b' },
  { icon: Eye, titleKey: 'site.why.r3t', blurbKey: 'site.why.r3b' },
  { icon: FileCheck2, titleKey: 'site.why.r4t', blurbKey: 'site.why.r4b' },
  { icon: ShieldCheck, titleKey: 'site.why.r5t', blurbKey: 'site.why.r5b' },
  { icon: CheckCircle2, titleKey: 'site.why.r6t', blurbKey: 'site.why.r6b' },
]

export default function WhyUsSection() {
  const { t } = useLanguage()
  return (
    <section className="relative overflow-hidden bg-[#e9efe9] py-24 sm:py-28">
      <div className="pointer-events-none absolute right-0 top-24 h-80 w-80 rounded-full bg-brand-100/60 blur-[120px]" />
      <Container className="relative">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div className="relative">
            <Reveal>
              <div className="relative overflow-hidden rounded-[2rem] shadow-[0_40px_100px_-50px_rgba(15,23,42,0.6)]">
                <SmartImage
                  src={IMG.teamWork}
                  alt="CREWNBUILD engineers reviewing plans on site"
                  className="aspect-[4/5] w-full object-cover sm:aspect-[5/5]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" />
              </div>
            </Reveal>
            <Reveal delay={0.2} className="absolute -bottom-8 -right-4 sm:right-8">
              <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 pr-6 shadow-[0_26px_60px_-32px_rgba(15,23,42,0.5)]">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-orange">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display text-xl font-extrabold tracking-tight text-graphite">{t('site.why.years')}</p>
                  <p className="text-[13px] font-semibold text-slate-500">{t('site.why.yearsSub')}</p>
                </div>
              </div>
            </Reveal>
          </div>

          <div>
            <Reveal>
              <Eyebrow>{t('site.why.eyebrow')}</Eyebrow>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="h-display mt-4 text-[clamp(1.6rem,3.2vw,2.5rem)] leading-[1.12]">
                {t('site.why.titlePre')}<span className="text-brand-500">{t('site.why.titleHighlight')}</span>
              </h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-500 sm:text-lg">
                {t('site.why.sub')}
              </p>
            </Reveal>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {REASONS.map((r, i) => (
                <Reveal key={r.titleKey} delay={0.1 + i * 0.05}>
                  <div className="group flex gap-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-brand-100 transition-all duration-300 group-hover:bg-brand-500 group-hover:text-white group-hover:shadow-orange">
                      <r.icon className="h-4.5 w-4.5" strokeWidth={1.9} />
                    </span>
                    <div>
                      <h3 className="font-display text-sm font-extrabold tracking-tight text-graphite">
                        {t(r.titleKey)}
                      </h3>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{t(r.blurbKey)}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
