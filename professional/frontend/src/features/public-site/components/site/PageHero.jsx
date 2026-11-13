import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLanguage } from '../../../../i18n/LanguageContext.jsx'

export default function PageHero({ eyebrow, title, highlight, sub, image }) {
  const { t } = useLanguage()
  return (
    <section className="relative overflow-hidden bg-[#eef2ec] pt-36 pb-20 sm:pt-44 sm:pb-24">
      {image && (
        <img src={image} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-15" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[#eef2ec]/80 via-[#eef2ec]/85 to-[#eef2ec]" />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-brand-400/25 blur-[100px]" />
      <div className="pointer-events-none absolute -right-20 bottom-8 h-64 w-64 rounded-full bg-brand-500/20 blur-[100px]" />

      <div className="container-x relative">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-600"
        >
          <Link to="/" className="transition hover:text-brand-600">
            {t('site.nav.home')}
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-brand-700">{eyebrow}</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.1 }}
          className="mt-5 max-w-3xl font-display text-[clamp(1.9rem,3.8vw,3rem)] font-extrabold leading-[1.08] tracking-[-0.025em] text-graphite text-balance"
        >
          {title} {highlight && <span className="text-brand-700">{highlight}</span>}
        </motion.h1>

        {sub && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.2 }}
            className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg"
          >
            {sub}
          </motion.p>
        )}
      </div>
    </section>
  )
}
