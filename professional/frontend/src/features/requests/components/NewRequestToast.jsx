import { createPortal } from 'react-dom'
import { BellRing, Volume2, X } from 'lucide-react'
import { newRequestsLabel } from '../../../shared/utils/requestInbox.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

/**
 * The compact "2 New Requests Received" popup. One popup per burst, carrying the
 * exact count; clicking it opens the dashboard's existing Requests section.
 * While the browser is still holding sound back it also offers Enable sound.
 */
export default function NewRequestToast({ inbox, onOpen }) {
  const { t } = useLanguage()
  const { toast, dismissToast, soundStatus, enableSound } = inbox
  if (!toast.open || !toast.count || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed bottom-4 end-4 z-[140] w-[calc(100vw-2rem)] max-w-sm" role="status" aria-live="polite">
      <div className="flex items-start gap-3 rounded-2xl border border-brand-200 bg-white p-3 shadow-[0_18px_40px_-18px_rgba(15,23,42,0.45)]">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><BellRing className="h-5 w-5" /></span>
        <button
          type="button"
          onClick={() => { dismissToast(); onOpen?.() }}
          className="min-w-0 flex-1 text-start"
        >
          <span className="block text-sm font-extrabold text-slate-900">{newRequestsLabel(toast.count, t)}</span>
          <span className="block text-xs font-semibold text-brand-700">{t('ui.requestInbox.viewRequests')}</span>
        </button>
        {soundStatus === 'blocked' && (
          <button
            type="button"
            onPointerDown={enableSound}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); enableSound() } }}
            className="inline-flex shrink-0 items-center gap-1 self-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-extrabold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-200"
          >
            <Volume2 className="h-3.5 w-3.5" /> {t('ui.requestInbox.enableSound')}
          </button>
        )}
        <button type="button" onClick={dismissToast} aria-label={t('ui.requestInbox.dismiss')} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
