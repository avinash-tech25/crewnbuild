import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { TIMELINE, mountBrandArtwork } from '../../../public/crewnbuild-motion.js'
import '../../../public/crewnbuild-intro.css'
import './BrandLoader.css'

// After one full logo animation the wait is long enough to say so, as the start-up screen does.
export const STILL_LOADING_DELAY = TIMELINE.hold

/**
 * The Crew&Build loader: the logo (with its tagline) builds itself up, then
 * "Loading…" becomes "Still loading the application…" if the wait goes on.
 * Variants: 'page' (whole screen), 'panel', 'inline'. With reduced motion the finished
 * logo shows at once (BrandLoader.css).
 */
export default function BrandLoader({ variant = 'panel', label, className = '', animated = true }) {
  const id = `crew-loader-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const visual = useRef(null)
  const [waiting, setWaiting] = useState(false)
  const { t } = useLanguage()

  // Drawn once per loader, so a re-render (language, provider update) never restarts it.
  useLayoutEffect(() => {
    const svg = mountBrandArtwork(visual.current, id)
    return () => svg.remove()
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => setWaiting(true), STILL_LOADING_DELAY)
    return () => clearTimeout(timer)
  }, [])

  const message = waiting ? t('loader.stillLoading') : (label ?? t('loader.loading'))
  return (
    <div
      className={`brand-loader brand-loader--${variant}${animated ? '' : ' brand-loader--still'} ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={t('loader.label')}
    >
      <div ref={visual} className="brand-loader__visual" aria-hidden="true" />
      <span className={`brand-loader__label${waiting ? ' brand-loader__label--waiting' : ''}`}>{message}</span>
    </div>
  )
}
