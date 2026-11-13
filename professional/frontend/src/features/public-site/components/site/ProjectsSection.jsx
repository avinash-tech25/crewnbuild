import { useState } from 'react'
import { MapPin, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Container, Reveal, SectionHeading, SmartImage } from './ui.jsx'
import { PROJECTS } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const CATEGORY_KEYS = {
  All: 'site.projects.cat.all',
  Residential: 'site.projects.cat.residential',
  Commercial: 'site.projects.cat.commercial',
  Infrastructure: 'site.projects.cat.infrastructure',
  Industrial: 'site.projects.cat.industrial',
  Renovation: 'site.projects.cat.renovation',
}
const CATEGORIES = Object.keys(CATEGORY_KEYS)

export default function ProjectsSection({ limit, showFilter = true }) {
  const { t } = useLanguage()
  const [active, setActive] = useState('All')
  const filtered = active === 'All' ? PROJECTS : PROJECTS.filter((p) => p.category === active)
  const visible = limit ? filtered.slice(0, limit) : filtered

  return (
    <section className="bg-[#e9efe9] py-24 sm:py-28">
      <Container>
        <SectionHeading
          eyebrow={t('site.projects.eyebrow')}
          title={t('site.projects.title')}
          highlight={t('site.projects.highlight')}
          sub={t('site.projects.sub')}
        />

        {showFilter && (
          <Reveal className="mt-10 flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setActive(c)}
                className={`rounded-full px-5 py-2.5 text-sm font-bold transition-all duration-300 ${
                  active === c
                    ? 'bg-brand-500 text-brand-950 shadow-orange'
                    : 'border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                {t(CATEGORY_KEYS[c])}
              </button>
            ))}
          </Reveal>
        )}

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((p, i) => (
            <Reveal key={p.id} delay={(i % 4) * 0.05}>
              <article className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_28px_-32px_rgba(15,23,42,0.6)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_-38px_rgba(15,23,42,0.5)]">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <SmartImage
                    src={p.image}
                    alt={p.title}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/15 to-transparent" />
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-graphite backdrop-blur">
                    {t(CATEGORY_KEYS[p.category] || p.category)}
                  </span>
                  <span className="absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-brand-500 text-brand-950 opacity-0 shadow-orange transition-all duration-300 group-hover:opacity-100">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <h3 className="font-display text-[15px] font-extrabold leading-snug tracking-tight text-white">
                      {p.title}
                    </h3>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-300">
                      <MapPin className="h-3 w-3 text-brand-400" />
                      {p.location}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs font-semibold text-slate-500">{t('site.projects.completed', { year: p.year })}</span>
                  <span className="text-xs font-bold text-brand-600">{p.area}</span>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        {limit && (
          <Reveal className="mt-12 text-center">
            <Link to="/projects" className="btn-secondary group">
              {t('site.projects.exploreAll')} <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Reveal>
        )}
      </Container>
    </section>
  )
}
