import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { formatMoney } from '../../messaging/messageHelpers.jsx'

// The owner's "Negotiate" on a builder quotation that is not assigned yet. It
// sends one request -- the assignment and the owner's opening counter-offer
// together (/project-requests/assign with offer_amount) -- so a refused offer
// never leaves the builder assigned. Same dialog markup as AwardPanel's.

function errorText(error, fallback) {
  const detail = error?.response?.data?.detail
  if (detail?.message) return detail.message
  if (typeof detail === 'string') return detail
  return fallback
}

export default function NegotiateQuotationModal({ quotation, builderName, budget, country = 'India', onSubmit, onClose }) {
  const { t, td } = useLanguage()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const money = (value) => formatMoney(value, country)

  const submit = async (event) => {
    event.preventDefault()
    const value = Number(amount)
    if (amount === '' || !Number.isFinite(value) || value <= 0) {
      setMessage(t('award.form.invalidAmount'))
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await onSubmit(value, note.trim())
      onClose()
    } catch (error) {
      setMessage(errorText(error, t('award.error')))
    } finally {
      setBusy(false)
    }
  }

  const primary = 'inline-flex min-h-10 items-center justify-center rounded-xl bg-oc-green px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50'
  const secondary = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-oc-line bg-white px-4 py-2 text-sm font-extrabold text-oc-ink transition hover:bg-oc-sunken disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="negotiate-quotation-title">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-5 text-oc-ink shadow-xl">
        <p id="negotiate-quotation-title" className="font-display text-lg font-extrabold">{t('award.form.title')}</p>
        {builderName && <p className="mt-0.5 truncate text-sm font-semibold text-oc-muted">{td(builderName)}</p>}
        <dl className="mt-3 grid gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-oc-muted">{t('request.flow.builderQuotation')}</dt>
            <dd className="text-right font-extrabold">{money(quotation)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-oc-muted">{t('award.negotiateModal.yourBudget')}</dt>
            <dd className="text-right font-bold">{Number(budget) > 0 ? money(budget) : t('dash.common.notSet')}</dd>
          </div>
        </dl>
        <label className="mt-3 block text-xs font-bold text-oc-muted">
          {t('award.negotiateModal.yourCounter')}
          <input
            type="number"
            inputMode="decimal"
            min="1"
            step="any"
            required
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1 w-full min-w-0 rounded-xl border border-oc-line bg-white px-3 py-2 text-sm text-oc-ink outline-none focus:border-ocbrand-400"
          />
        </label>
        {Number(amount) > 0 && <p className="mt-1 text-xs font-bold text-oc-ink">{money(amount)}</p>}
        <BudgetInWords value={amount} country={country} />
        <label className="mt-3 block text-xs font-bold text-oc-muted">
          {t('award.form.reason')}
          <textarea maxLength={1000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full min-w-0 rounded-xl border border-oc-line bg-white px-3 py-2 text-sm text-oc-ink outline-none focus:border-ocbrand-400" />
        </label>
        <p className="mt-3 text-xs text-oc-muted">{t('award.negotiateModal.body')}</p>
        {message && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{message}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} className={secondary} onClick={onClose}>{t('dash.common.cancel')}</button>
          <button type="submit" disabled={busy} className={primary}>{t('award.form.submit')}</button>
        </div>
      </form>
    </div>
  )
}
