import { motion } from 'framer-motion'
import { useState } from 'react'

/* Scroll-reveal wrapper — calm, slow entrance used across the site */
export function Reveal({ children, delay = 0, y = 26, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function Container({ children, className = '' }) {
  return <div className={`container-x ${className}`}>{children}</div>
}

export function Eyebrow({ children, dark = false, className = '' }) {
  return <span className={`${dark ? 'eyebrow-dark' : 'eyebrow'} ${className}`}>{children}</span>
}

/* Section heading block — Manrope display heading + sub line */
export function SectionHeading({ eyebrow, title, highlight, sub, align = 'center', dark = false }) {
  const alignCls = align === 'center' ? 'text-center mx-auto' : 'text-left'
  const titleCls = dark ? 'text-white' : 'text-graphite'
  const subCls = dark ? 'text-slate-300' : 'text-slate-500'
  return (
    <div className={`max-w-3xl ${alignCls}`}>
      {eyebrow && (
        <Reveal>
          <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
        </Reveal>
      )}
      <Reveal delay={0.06}>
        <h2 className={`h-display mt-4 text-[clamp(1.6rem,3.2vw,2.5rem)] leading-[1.12] text-balance ${titleCls}`}>
          {title}{' '}
          {highlight && <span className="text-brand-500">{highlight}</span>}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.12}>
          <p className={`mt-4 text-sm leading-relaxed sm:text-base ${subCls}`}>{sub}</p>
        </Reveal>
      )}
    </div>
  )
}

/* Image with graceful gradient fallback if the remote photo fails to load */
export function SmartImage({ src, alt, className = '', fallback = 'from-brand-200 to-brand-400' }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <div className={`bg-gradient-to-br ${fallback} ${className}`} aria-label={alt} role="img" />
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={className} />
}

/* Star rating row */
export function Stars({ rating = 5, className = 'h-4 w-4' }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} star rating`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 20 20"
          className={`${className} ${i < rating ? 'fill-brand-500 text-brand-500' : 'fill-slate-200 text-slate-200'}`}
        >
          <path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.28 3.95a1 1 0 0 0 .95.69h4.15c.97 0 1.37 1.24.59 1.81l-3.36 2.44a1 1 0 0 0-.36 1.12l1.28 3.95c.3.92-.75 1.69-1.54 1.12l-3.36-2.44a1 1 0 0 0-1.18 0l-3.36 2.44c-.79.57-1.84-.2-1.54-1.12l1.28-3.95a1 1 0 0 0-.36-1.12L2.08 9.38c-.78-.57-.38-1.81.59-1.81h4.15a1 1 0 0 0 .95-.69l1.28-3.95Z" />
        </svg>
      ))}
    </div>
  )
}
