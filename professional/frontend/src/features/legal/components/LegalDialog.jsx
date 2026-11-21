/**
 * A legal document in a large window over the current page, so a visitor can read the
 * Terms or the Privacy Policy without leaving a half-filled form: the same section list and
 * one-section view as /terms and /privacy, starting at the first section, at the top.
 * Choosing a section changes only the window, never the page's address.
 *
 * The same frame size as every details window (DETAIL_DIALOG_SIZE). Focus moves into the
 * window when it opens, stays inside it while Tab is pressed, and goes back to the button
 * that opened it on close (×, Escape or a click outside). Reading the document accepts
 * nothing: only the form's own checkbox does that.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DETAIL_DIALOG_SIZE } from '../../../shared/ui/DetailDialog.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { LEGAL_TITLE_KEYS } from '../legalDocuments.js'
import { LegalDocument } from './LegalDocument.jsx'

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function LegalDialog({ doc, onClose }) {
  const { t } = useLanguage()
  const title = t(LEGAL_TITLE_KEYS[doc.id])
  const [activeId, setActiveId] = useState(doc.sections[0].id)
  const frame = useRef(null)
  const body = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement
    if (body.current) body.current.scrollTop = 0
    frame.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !frame.current) return
      // Only what is on screen: the section list on wide screens, the dropdown on narrow ones.
      const all = [...frame.current.querySelectorAll(FOCUSABLE)]
      const shown = all.filter((item) => item.getClientRects().length > 0)
      const items = shown.length ? shown : all
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
    <div className="fixed inset-0 z-dialog-nested grid place-items-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" data-testid="legal-dialog-backdrop" />
      <section
        ref={frame}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex ${DETAIL_DIALOG_SIZE} flex-col overflow-hidden rounded-3xl border border-white/10 bg-oc-deep font-display text-white shadow-2xl focus:outline-none`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 px-4 py-3 sm:px-7">
          <p className="truncate text-lg font-extrabold text-white">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('legal.close')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-amber"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div ref={body} data-testid="legal-dialog-body" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-7">
          <LegalDocument doc={doc} activeId={activeId} onSelect={setActiveId} idPrefix="dialog-" />
        </div>
      </section>
    </div>,
    document.body,
  )
}

export default LegalDialog
