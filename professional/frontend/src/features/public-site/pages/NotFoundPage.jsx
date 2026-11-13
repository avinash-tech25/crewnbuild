/**
 * Not-found screen.
 *
 * Presentation is the landing design (oc-* palette, landing wordmark and
 * language control). Previously the router sent every unmatched path straight to `/`
 * with no page at all; this renders the address instead so a mistyped or stale link is
 * visible rather than silently swallowed.
 */
import { ArrowLeft, RotateCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand, buttonClass, connectionLostUrl } from '../components/landing/shared.jsx'
import LanguageSelector from '../../../shared/ui/LanguageSelector.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export default function NotFound() {
  const { t } = useLanguage()

  return (
    <div className="flex min-h-svh flex-col bg-oc-paper px-[8%] py-5 text-oc-ink max-wide:px-6">
      {/* Wraps on the smallest phones (language under the logo) instead of the
          language pill overlapping the wordmark at 320px. */}
      <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <Brand />
        <span className="ms-auto">
          <LanguageSelector compact variant="light" />
        </span>
      </div>

      <div className="mx-auto my-auto flex w-full max-w-[520px] flex-col items-center py-8 text-center">
        <img
          src={connectionLostUrl}
          alt=""
          aria-hidden="true"
          className="max-h-[38svh] w-auto object-contain drop-shadow-[0_26px_34px_rgba(8,62,43,.18)]"
        />

        <span className="mt-6 text-[11px] font-extrabold uppercase tracking-[.22em] text-oc-muted rtl:tracking-normal">
          {t('notFound.code')}
        </span>

        <h1 className="mt-2.5 text-[clamp(1.9rem,3.2vw,2.6rem)] font-extrabold leading-[1.05] [overflow-wrap:anywhere] tracking-[-.05em] rtl:leading-[1.3] rtl:tracking-normal">
          {t('notFound.headline')}
          <br />
          <span className="text-oc-green">{t('notFound.highlight')}</span>
        </h1>

        <p className="mt-3.5 text-sm leading-[1.75] text-oc-muted">{t('notFound.body')}</p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className={buttonClass}>
            <RotateCw size={15} />
            {t('notFound.retry')}
          </button>
          <Link
            to="/"
            className="inline-flex min-h-[50px] items-center gap-2 rounded-full border border-oc-line bg-white px-6 text-xs font-extrabold text-oc-ink transition-colors duration-200 hover:bg-oc-mint"
          >
            <ArrowLeft size={15} className="rtl:-scale-x-100" />
            {t('shared.backHome')}
          </Link>
        </div>
      </div>
    </div>
  )
}
