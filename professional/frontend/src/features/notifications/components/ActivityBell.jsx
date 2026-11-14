import { useState } from 'react'
import { Clock3 } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale, formatNumber } from '../../../shared/utils/formatters.js'

/**
 * Which of two written forms a count takes.
 *
 * `count === 1 ? one : many` is the English rule, and only the English rule.
 * `Intl.PluralRules` knows each language's own, so the engine decides which form
 * applies. The key table holds two forms; Arabic distinguishes six, which two
 * keys cannot express — the hand-off notes what a full treatment would need.
 */
function plural(count, one, many) {
  try {
    return new Intl.PluralRules(activeLocale()).select(Number(count)) === 'one' ? one : many
  } catch {
    return Number(count) === 1 ? one : many
  }
}

export default function ActivityBell({ items = [] }) {
  const { t } = useLanguage()
  const [isOpen, setIsOpen] = useState(false)

  const toggle = () => {
    setIsOpen((currentValue) => !currentValue)
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="group relative flex h-11 shrink-0 items-center gap-2 rounded-full bg-white pl-3 pr-3.5 text-slate-600 shadow-sm ring-1 ring-black/5 transition hover:text-brand-700 hover:ring-brand-200"
        aria-label={t('dash.common.recentActivity')}
        aria-expanded={isOpen}
      >
        <Clock3 className="h-5 w-5" />
        <span className="hidden text-xs font-extrabold text-slate-700 group-hover:text-brand-800 md:block">
          {t('dash.common.activity')}
        </span>
        {items.length > 0 && (
          <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={toggle} />
          <div className="absolute right-0 top-12 z-50 max-lg:fixed max-lg:right-4 max-lg:top-[60px] max-sm:left-4 max-sm:w-auto w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)]">
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                <Clock3 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-slate-950">{t('dash.common.recentActivity')}</p>
                <p className="truncate text-[11px] font-medium text-slate-500">{t('dash.common.recentActivitySub')}</p>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800 ring-1 ring-brand-100">
                {formatNumber(items.length)} {plural(items.length, t('dash.common.updateOne'), t('dash.common.updateMany'))}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length ? (
                items.map((item) => (
                  <div key={item} className="flex items-start gap-2.5 border-b border-slate-50 px-4 py-3 last:border-b-0">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-400" />
                    <p className="text-sm font-medium leading-5 text-slate-600">{item}</p>
                  </div>
                ))
              ) : (
                <div className="px-4 py-10 text-center">
                  <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-50 text-slate-300 ring-1 ring-slate-100">
                    <Clock3 className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-extrabold text-slate-900">{t('dash.common.noRecentActivity')}</p>
                  <p className="mt-1 text-xs font-medium text-slate-500">{t('dash.common.noRecentActivitySub')}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
