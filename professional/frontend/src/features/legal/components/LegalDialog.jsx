/**
 * A legal document in a large scrollable window over the current page, so a visitor
 * can read the Terms or the Privacy Policy without leaving a half-filled form.
 *
 * The same frame size as every details window (DETAIL_DIALOG_SIZE). Focus moves into
 * the window when it opens, stays inside it while Tab is pressed, and goes back to
 * the button that opened it on close (×, Escape or a click outside). Reading the
 * document accepts nothing: only the form's own checkbox does that.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DETAIL_DIALOG_SIZE } from '../../../shared/ui/DetailDialog.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { LegalDocument } from './LegalDocument.jsx'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function LegalDialog({ doc, onClose }) {
  const { t } = useLanguage()
  const frame = useRef(null)
  const body = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement
    // Always from the top, whichever document and however far the last one was read.
    if (body.current) body.current.scrollTop = 0
    frame.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !frame.current) return
      const items = [...frame.current.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === frame.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[140] grid place-items-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" data-testid="legal-dialog-backdrop" />
      <section
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-label={doc.title}
        tabIndex={-1}
        className={`relative flex ${DETAIL_DIALOG_SIZE} flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl focus:outline-none`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <p className="truncate font-display text-base font-extrabold text-slate-950">{doc.title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('legal.close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div ref={body} data-testid="legal-dialog-body" className="dash-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
          <LegalDocument doc={doc} inDialog />
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default LegalDialog
