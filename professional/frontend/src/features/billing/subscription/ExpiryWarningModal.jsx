import { useEffect, useState } from 'react'
import { Clock, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { onSignedOut } from '../../../shared/auth/signedInAccount.js'
import { forgetSeenWarnings } from './expiryNotice.js'
import { expiryWarning, expiryWarningContent, expiryWarningDate, expiryWarningSeenKey } from './subscriptionFormat.js'

function readSeen(key) {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markSeen(key) {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    /* noop */
  }
}

// Each login shows the popup again: the "shown" marks are forgotten at sign-out.
onSignedOut(() => forgetSeenWarnings(window.localStorage))

// The builder's "plan ends in 3/2/1 days" popup, from the server's status
// (GET /subscriptions/me, fetched when the dashboard opens). Shown once per login,
// account, plan end and day count: it is marked seen as soon as it opens, so
// closing it, going to the plans, reloading or leaving the page keep it closed
// until the count drops or the builder signs out and in again.
// Display only -- the server still enforces every limit and feature itself.
export default function ExpiryWarningModal({ status, userId, onViewPlans }) {
  const { t } = useLanguage()
  const warning = expiryWarning(status)
  const seenKey = warning && userId ? expiryWarningSeenKey(userId, warning) : null
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(Boolean(seenKey) && !readSeen(seenKey))
  }, [seenKey])
  // Marked once it is actually on screen (a separate effect, so a re-run of the one
  // above, as StrictMode does, cannot hide it before it was shown).
  useEffect(() => {
    if (open && seenKey) markSeen(seenKey)
  }, [open, seenKey])

  if (!open || !warning) return null

  const dismiss = () => setOpen(false)
  const viewPlans = () => {
    dismiss()
    onViewPlans()
  }
  // Free and Pro: one "going to expire" message with Upgrade; Premium: its renewal text.
  const content = expiryWarningContent(warning)

  return (
    <div className="fixed inset-0 z-[130] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="expiry-warning-title">
      <div className="relative w-full max-w-md rounded-2xl border border-oc-line bg-white p-5 shadow-2xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('subscription.expiryWarning.later')}
          className="absolute end-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-oc-muted transition hover:bg-oc-sunken hover:text-oc-ink"
        >
          <X className="h-4 w-4" />
        </button>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
          <Clock className="h-5 w-5" />
        </span>
        {content.messageKey ? (
          <h2 id="expiry-warning-title" className="mt-3 pe-8 font-display text-lg font-extrabold leading-snug text-oc-ink">
            {t(content.messageKey, content.values)}
          </h2>
        ) : (
          <>
            <h2 id="expiry-warning-title" className="mt-3 pe-8 font-display text-lg font-extrabold leading-snug text-oc-ink">
              {t(content.titleKey)}
            </h2>
            <p className="mt-1 text-sm font-extrabold text-amber-700">{t('subscription.expiryWarning.daysLeft', content.values)}</p>
            <p className="mt-2 text-sm font-medium text-oc-muted">
              {t(content.bodyKey, { date: expiryWarningDate(warning, activeLocale()) })}
            </p>
          </>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-oc-line bg-white px-4 text-sm font-extrabold text-oc-muted transition hover:bg-oc-sunken"
          >
            {t('subscription.expiryWarning.later')}
          </button>
          <button
            type="button"
            onClick={viewPlans}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-extrabold text-white transition hover:bg-emerald-700"
          >
            {t(content.ctaKey)}
          </button>
        </div>
      </div>
    </div>
  )
}
