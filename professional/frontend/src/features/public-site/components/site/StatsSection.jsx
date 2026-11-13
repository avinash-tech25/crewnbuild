import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'
import { Container, Reveal } from './ui.jsx'
import { STATS } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const STAT_LABEL_KEYS = {
  'Years of experience': 'site.stats.years',
  'Projects delivered': 'site.stats.projects',
  'Engineers & architects': 'site.stats.engineers',
  'On-time delivery': 'site.stats.ontime',
}

function Counter({ value, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const [display, setDisplay] = useState(0)
  const numeric = parseInt(value.replace(/\D/g, ''), 10) || 0
  const isPercent = value.includes('%')

  useEffect(() => {
    if (!inView) return
    const duration = 1400
    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(eased * numeric))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [inView, numeric])

  return (
    <span ref={ref}>
      {display}
      {isPercent ? '%' : suffix}
    </span>
  )
}

export default function StatsSection() {
  const { t } = useLanguage()
  return (
    <section className="relative overflow-hidden bg-[#e2ece4] py-20">
      <div className="pointer-events-none absolute -right-32 top-0 h-80 w-80 rounded-full bg-brand-400/25 blur-[100px]" />
      <div className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-brand-500/20 blur-[100px]" />
      <Container className="relative">
        <Reveal>
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-brand-600">
            {t('site.stats.eyebrow')}
          </p>
        </Reveal>
        <div className="mt-10 grid grid-cols-2 gap-6 lg:grid-cols-4">
          {STATS.map((s, i) => {
            const labelKey = STAT_LABEL_KEYS[s.label] || s.label
            return (
              <Reveal key={s.label} delay={i * 0.08}>
                <div className="group relative text-center">
                  <p className="font-display text-[clamp(1.9rem,3.8vw,2.9rem)] font-extrabold tracking-tighter text-graphite">
                    <span className="bg-gradient-to-br from-brand-700 to-brand-500 bg-clip-text text-transparent transition group-hover:from-brand-600 group-hover:to-brand-400">
                      <Counter value={s.value} />
                    </span>
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{t(labelKey)}</p>
                  <span className="mx-auto mt-4 block h-1 w-8 rounded-full bg-brand-500 opacity-70 transition-all duration-300 group-hover:w-14 group-hover:opacity-100" />
                </div>
              </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
