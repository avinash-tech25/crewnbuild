/**
 * The one "View details" window of the application: every request / record popup
 * (House Owner, Builder, Supplier, Store Manager, labour and equipment, partners,
 * admin) opens in this frame, so they are all the same size and read the same way.
 *
 *   frame    90vw wide up to 1280px, at most 85vh tall (at least 60vh, so a short
 *            record fills the same frame rather than a small box)
 *   header   a small label, the title, then the status line
 *   body     grey, its sections as white cards (<DetailSection>); it scrolls inside
 *            the window when long
 *
 * Closed by its ×, by Escape (not while typing in a field), or by a click outside. Only the frame lives here: what a
 * window shows and does stays with the screen that opens it.
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

/** The frame's size, one class string for every details window. */
export const DETAIL_DIALOG_SIZE = 'w-[90vw] max-w-[1280px] max-h-[85vh] min-h-[min(60vh,85vh)]'

export function DetailDialog({ label = null, title, status = null, onClose, closeLabel, actions = null, testId, children }) {
  const { t } = useLanguage()
  useEffect(() => {
    // Escape closes the window, except while typing in a field: a half-written reply
    // or note is not thrown away by a key meant for the text.
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : label || undefined}
        data-detail-dialog=""
        data-testid={testId}
        className={`detail-dialog relative flex ${DETAIL_DIALOG_SIZE} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            {label && <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>}
            <h3 className="truncate font-display text-base font-extrabold text-slate-950">{title}</h3>
            {status && <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">{status}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel || t('dash.contractor.closeDetails')}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div data-detail-dialog-body="" className="dash-scroll min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/50 p-3 sm:p-5">
          {children}
        </div>
      </section>
    </div>
  )
}

/** One section card inside a details window; `title` is optional. */
export function DetailSection({ title = null, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-oc-line bg-white p-3 sm:p-4 ${className}`}>
      {title && <h4 className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{title}</h4>}
      {children}
    </section>
  )
}
