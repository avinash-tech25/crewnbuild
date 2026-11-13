import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { Container, Reveal, SectionHeading } from './ui.jsx'
import { FAQS } from './data.js'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

const FAQ_KEYS = [
  { qKey: 'site.faq.q1', aKey: 'site.faq.a1' },
  { qKey: 'site.faq.q2', aKey: 'site.faq.a2' },
  { qKey: 'site.faq.q3', aKey: 'site.faq.a3' },
  { qKey: 'site.faq.q4', aKey: 'site.faq.a4' },
  { qKey: 'site.faq.q5', aKey: 'site.faq.a5' },
  { qKey: 'site.faq.q6', aKey: 'site.faq.a6' },
]

export default function FaqSection() {
  const [openIdx, setOpenIdx] = useState(0)
  const { t } = useLanguage()

  return (
    <section className="bg-[#e9efe9] py-24 sm:py-28">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <SectionHeading
              align="left"
              eyebrow={t('site.faq.eyebrow')}
              title={t('site.faq.title')}
              highlight={t('site.faq.highlight')}
              sub={t('site.faq.sub')}
            />
          </div>

          <div className="space-y-3">
            {FAQS.map((f, i) => {
              const open = openIdx === i
              const keys = FAQ_KEYS[i] || {}
              return (
                <Reveal key={f.q} delay={i * 0.04}>
                  <div
                    className={`overflow-hidden rounded-2xl border transition-all duration-300 ${
                      open
                        ? 'border-brand-300 bg-brand-50/50 shadow-[0_20px_50px_-35px_rgba(35,102,69,0.5)]'
                        : 'border-slate-200 bg-white hover:border-brand-200'
                    }`}
                  >
                    <button
                      onClick={() => setOpenIdx(open ? -1 : i)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <span className="font-display text-sm font-extrabold tracking-tight text-graphite">
                        {keys.qKey ? t(keys.qKey) : f.q}
                      </span>
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all duration-300 ${
                          open ? 'rotate-45 bg-brand-500 text-brand-950' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <p className="px-5 pb-4 text-[13px] leading-relaxed text-slate-500">{keys.aKey ? t(keys.aKey) : f.a}</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </Container>
    </section>
  )
}
