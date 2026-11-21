import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import LegalDocument from './LegalDocument.jsx'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The full text of a legal document over the current page, so reading it never leaves the
 * page or resets a form. Closes on Escape, the × button or a click outside the panel, and
 * hands focus back to whatever opened it. It only shows the text: it never records consent.
 */
export default function LegalDialog({ doc, onClose }) {
  const panel = useRef(null)
  const closeButton = useRef(null)
  const body = useRef(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  const titleId = `legal-dialog-${doc.id}-title`

  useEffect(() => {
    const opener = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Always from the top, whichever document and however far the last one was read.
    if (body.current) body.current.scrollTop = 0
    closeButton.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
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
      document.body.style.overflow = overflow
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-dialog flex items-center justify-center bg-oc-deep/60 p-2 sm:p-6"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return
        // Keep the press from moving focus to the page, so focus lands back on the opener.
        event.preventDefault()
        onClose()
      }}
      data-testid="legal-dialog-backdrop"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-end border-b border-oc-line px-4 py-2">
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-oc-muted hover:bg-oc-sunken hover:text-oc-deep"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={body} data-testid="legal-dialog-body" className="flex-1 overflow-y-auto px-5 py-6 sm:px-10">
          <LegalDocument doc={doc} idPrefix="dialog-" headingId={titleId} />
        </div>
      </div>
    </div>
  )
}
