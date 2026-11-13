import { Quote } from 'lucide-react'
import { Container, Reveal, SectionHeading, SmartImage, Stars } from './ui.jsx'
import { TESTIMONIALS } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const TESTIMONIAL_KEYS = [
  { quoteKey: 'site.testi.q1', roleKey: 'site.testi.r1' },
  { quoteKey: 'site.testi.q2', roleKey: 'site.testi.r2' },
  { quoteKey: 'site.testi.q3', roleKey: 'site.testi.r3' },
]

export default function TestimonialsSection({ limit }) {
  const { t } = useLanguage()
  const items = limit ? TESTIMONIALS.slice(0, limit) : TESTIMONIALS
  return (
    <section className="relative overflow-hidden bg-[#e9efe9] py-24 sm:py-28">
      <div className="pointer-events-none absolute -left-24 top-1/3 h-80 w-80 rounded-full bg-brand-100/70 blur-[110px]" />
      <Container className="relative">
        <SectionHeading
          eyebrow={t('site.testi.eyebrow')}
          title={t('site.testi.title')}
          highlight={t('site.testi.highlight')}
          sub={t('site.testi.sub')}
        />

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => {
            const keys = TESTIMONIAL_KEYS[i] || {}
            return (
              <Reveal key={item.name} delay={(i % 3) * 0.07}>
                <figure className="group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_-40px_rgba(15,23,42,0.6)] transition-all duration-300 hover:-translate-y-1.5 hover:border-brand-300 hover:shadow-[0_26px_60px_-38px_rgba(35,102,69,0.4)]">
                  <Quote className="h-6 w-6 fill-brand-100 text-brand-300 transition-colors group-hover:fill-brand-500 group-hover:text-brand-500" />
                  <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">
                    “{keys.quoteKey ? t(keys.quoteKey) : item.quote}”
                  </blockquote>
                  <figcaption className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
                    <SmartImage
                      src={item.image}
                      alt={item.name}
                      className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-100"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-display text-[13px] font-extrabold text-graphite">{item.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{keys.roleKey ? t(keys.roleKey) : item.role}</p>
                    </div>
                    <div className="ml-auto">
                      <Stars rating={item.rating} className="h-3 w-3" />
                    </div>
                  </figcaption>
                </figure>
              </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
