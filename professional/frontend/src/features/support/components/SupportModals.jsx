import { useState } from 'react'
import {
  CheckCircle2, ChevronDown, LifeBuoy, Loader2, MessageSquarePlus, Send, Star, X,
} from 'lucide-react'

import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { FEEDBACK_STORAGE_KEY } from '../feedbackStorage.js'

function ModalOverlay({ onClose, children, maxWidth = 'max-w-2xl' }) {
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-slate-900/45 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full ${maxWidth} overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_90px_-40px_rgba(15,23,42,0.85)]`}
      >
        {children}
      </div>
    </div>
  )
}

function ModalHeader({ icon: Icon, title, subtitle, onClose }) {
  const { t } = useLanguage()
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-lg font-extrabold text-slate-950">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-medium leading-5 text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        aria-label={t('ce.close')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// The Help Center's questions and answers, as translation keys. Exported so the
// Contact & Support page searches the same help content instead of a copy.
export const HELP_FAQ_KEYS = [
  { id: 'updateProfile', question: 'help.q.updateProfile', answer: 'ui.contractor.helpAnswerUpdateProfile' },
  { id: 'findClients', question: 'help.q.findClients', answer: 'ui.contractor.helpAnswerFindClients' },
  { id: 'requests', question: 'help.q.requests', answer: 'ui.contractor.helpAnswerRequests' },
  { id: 'trackSites', question: 'help.q.trackSites', answer: 'ui.contractor.helpAnswerTrackSites' },
  { id: 'escrow', question: 'help.q.escrow', answer: 'ui.contractor.helpAnswerEscrow' },
  { id: 'verifyDocuments', question: 'help.q.verifyDocuments', answer: 'ui.contractor.helpAnswerVerifyDocuments' },
]

export function HelpCenterModal({ onClose }) {
  const { t } = useLanguage()
  const [openIndex, setOpenIndex] = useState(0)
  const HELP_FAQS = [
    ...HELP_FAQ_KEYS.map((faq) => ({ question: t(faq.question), answer: t(faq.answer) })),
    {
      question: t('help.stillNeedHelp'),
      answer: t('help.supportContact'),
    },
  ]
  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader icon={LifeBuoy} title={t('ui.helpCenter')} subtitle={t('help.subtitle')} onClose={onClose} />
      <div className="max-h-[62vh] space-y-2 overflow-y-auto px-5 py-4">
        {HELP_FAQS.map((faq, index) => {
          const open = openIndex === index
          return (
            <div key={faq.question} className="overflow-hidden rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setOpenIndex(open ? -1 : index)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm font-bold text-slate-900">{faq.question}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && <p className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-[13px] leading-6 text-slate-600">{faq.answer}</p>}
            </div>
          )
        })}
      </div>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
        <p className="text-xs font-semibold text-slate-500">
          {t('ui.contractor.helpFooterBefore')} <span className="font-extrabold text-brand-700">support@octabuild.com</span> {t('ui.contractor.helpFooterAfter')}
        </p>
      </div>
    </ModalOverlay>
  )
}

export function FeedbackModal({ onClose }) {
  const { t } = useLanguage()
  const FEEDBACK_CATEGORIES = [t('feedback.type.general'), t('feedback.type.bug'), t('feedback.type.feature'), t('feedback.type.suggestions'), t('dash.common.other')]
  const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0])
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submitFeedback = () => {
    if (!message.trim()) {
      setError(t('feedback.err.empty'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const entry = {
        category,
        rating,
        message: message.trim(),
        contact: contact.trim(),
        createdAt: new Date().toISOString(),
        role: 'BUILDER',
      }
      const existingEntries = JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY) || '[]')
      localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify([entry, ...existingEntries].slice(0, 100)))
      setSubmitted(true)
    } catch {
      setError(t('feedback.err.save'))
    } finally {
      setBusy(false)
    }
  }

  if (submitted) {
    return (
      <ModalOverlay onClose={onClose} maxWidth="max-w-md">
        <div className="px-6 py-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-xl font-extrabold text-slate-950">{t('dash.contractor.feedbackThanks')}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{t('dash.contractor.feedbackThanksSub')}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-brand-600 px-6 text-sm font-extrabold text-white transition hover:bg-brand-700"
          >
            {t('dash.common.close')}
          </button>
        </div>
      </ModalOverlay>
    )
  }

  return (
    <ModalOverlay onClose={onClose} maxWidth="max-w-lg">
      <ModalHeader icon={MessageSquarePlus} title={t('ui.feedback')} subtitle={t('dash.contractor.feedbackSubtitle')} onClose={onClose} />
      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.feedbackCategory')}</p>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white"
          >
            {FEEDBACK_CATEGORIES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.feedbackRate')}</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                className="transition hover:scale-110"
                aria-label={t(star === 1 ? 'ui.contractor.starOne' : 'ui.contractor.starMany', { count: star })}
              >
                <Star
                  className={`h-6 w-6 transition ${
                    (hoverRating || rating) >= star
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-slate-100 text-slate-200'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.feedbackLabel')} <span className="text-red-500">*</span></p>
          <textarea
            value={message}
            onChange={(event) => { setMessage(event.target.value); setError('') }}
            rows={4}
            placeholder={t('feedback.ph.message')}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white"
          />
          {error && <p className="mt-1 text-[11px] font-bold text-red-600">{error}</p>}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.feedbackContact')}</p>
          <input
            type="text"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder={t('feedback.ph.contact')}
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3.5">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50"
        >
          {t('dash.common.cancel')}
        </button>
        <button
          type="button"
          onClick={submitFeedback}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-extrabold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('dash.contractor.submitFeedback')}
        </button>
      </div>
    </ModalOverlay>
  )
}
