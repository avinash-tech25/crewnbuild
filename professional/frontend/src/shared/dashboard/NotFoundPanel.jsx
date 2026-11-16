import { ArrowLeft } from 'lucide-react'
import { connectionLostUrl } from '../../features/public-site/components/landing/shared.jsx'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/**
 * The not-found page's content (the same picture and texts as /404), inside a dashboard,
 * for an address naming something this account cannot open: another account's project,
 * an id that does not exist, a deleted record. The server refuses that data anyway;
 * nothing about it is fetched. `onBack` returns to the list the item belongs to.
 */
export default function NotFoundPanel({ backLabel, onBack }) {
  const { t } = useLanguage()
  return (
    <section role="alert" data-testid="not-found-panel" className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
      <img src={connectionLostUrl} alt="" aria-hidden="true" className="max-h-40 w-auto object-contain" />
      <span className="mt-5 text-[11px] font-extrabold uppercase tracking-[.22em] text-slate-500">{t('notFound.code')}</span>
      <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-oc-ink">
        {t('notFound.headline')} <span className="text-oc-green">{t('notFound.highlight')}</span>
      </h2>
      <p className="mt-2 text-sm text-slate-600">{t('notFound.body')}</p>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-oc-ink transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
        </button>
      )}
    </section>
  )
}
