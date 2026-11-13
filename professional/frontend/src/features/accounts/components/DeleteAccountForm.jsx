import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Trash2 } from 'lucide-react'
import { deleteOwnAccount, fetchDeletionForm } from '../accountDeletionApi.js'
import { FALLBACK_ROLES } from './deletionPolicy.js'
import DeletionPolicy from './DeletionPolicy.jsx'
import EmailVerificationSection from './EmailVerificationSection.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY_FORM = { email: '', phone: '', role: '', reasonCode: '', reasonDetails: '', agree: false, confirmText: '' }
const REASON_OTHER = 'OTHER'
// Typed exactly, capitals and all; the server checks it too.
const CONFIRMATION_WORD = 'DELETE'

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

function samePhone(entered, registered) {
  const a = digits(entered)
  const b = digits(registered)
  return Boolean(a && b) && (a === b || (Math.min(a.length, b.length) >= 10 && a.slice(-10) === b.slice(-10)))
}

/**
 * The Delete Account form, shown on the /delete-account page (reached from
 * Profile Settings > Delete Account, the app stores and the mobile app) once the
 * visitor is signed in. The mobile app shows the same fields and calls the same
 * two endpoints.
 *
 * Filled in from the signed-in account (GET /account/deletion-form). Confirming
 * deletes the account at once (POST /account/delete): the server checks the
 * details against the account, records the deletion, deletes the account and
 * ends every session. Deleting needs the registered email address verified (the
 * server's status, from the form data; the existing email verification section
 * is shown until it is), the checkbox ticked and DELETE typed exactly; the
 * server checks all three again. `onDeleted` is told afterwards; signing the browser out
 * and what to show next is the caller's. `onCancel`, if given, adds a Cancel button.
 */
export default function DeleteAccountForm({ onDeleted, onCancel }) {
  const { t, td } = useLanguage()
  const [formData, setFormData] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // Verifying the address below updates the signed-in account in the store; the
  // form is then fetched again, so the status shown is the server's.
  const sessionEmail = useSelector((state) => state.auth.user?.email || '')
  const sessionVerified = useSelector((state) => Boolean(state.auth.user?.email_verified))

  useEffect(() => {
    fetchDeletionForm()
      .then((data) => {
        setFormData(data)
        // First load: fill from the account. Later loads keep what was typed.
        setForm((current) => (current === EMPTY_FORM
          ? { ...EMPTY_FORM, email: data.account.email || '', phone: data.account.phone || '', role: data.account.role || '' }
          : { ...current, email: data.account.email || '' }))
      })
      .catch(() => setLoadFailed(true))
  }, [sessionEmail, sessionVerified])

  const account = formData?.account || {}
  const roles = formData?.roles?.length ? formData.roles : FALLBACK_ROLES
  const reasons = formData?.reasons || []
  const update = (field) => (event) => setForm((current) => ({
    ...current,
    [field]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  }))

  const emailError = account.email
    ? (!EMAIL_PATTERN.test(form.email.trim()) ? t('account.deleteContactInvalid')
      : form.email.trim().toLowerCase() !== account.email.toLowerCase() ? t('account.deleteEmailMismatch') : '')
    : ''
  const phoneError = samePhone(form.phone, account.phone) ? '' : t('account.deletePhoneMismatch')
  const roleError = form.role && form.role !== account.role ? t('account.deleteRoleMismatch') : ''
  const detailsMissing = form.reasonCode === REASON_OTHER && !form.reasonDetails.trim()
  const emailVerified = Boolean(account.email && account.email_verified)
  const confirmTyped = form.confirmText === CONFIRMATION_WORD
  const canDelete = Boolean(formData) && emailVerified && !emailError && !phoneError && Boolean(form.role) && !roleError
    && Boolean(form.reasonCode) && !detailsMissing && form.agree && confirmTyped && !deleting

  const submit = async (event) => {
    event.preventDefault()
    if (!canDelete) return
    setDeleting(true)
    setErrorMessage('')
    try {
      const result = await deleteOwnAccount({
        full_name: account.name,
        role: form.role,
        email: account.email ? form.email.trim() : null,
        phone: form.phone.trim(),
        reason_code: form.reasonCode,
        reason_details: form.reasonDetails.trim() || null,
        confirm_deletion: form.agree,
        confirmation_text: form.confirmText,
      })
      onDeleted(result)
    } catch (error) {
      // The server rolls back on failure: the account and the session are as they were.
      // The server writes its `detail` in English; `td` renders it in the reader's language.
      const detail = error?.response?.data?.detail
      const message = Array.isArray(detail) ? null : (detail && typeof detail === 'object' ? detail.message : detail)
      setErrorMessage(td(message) || t('account.deleteFailed'))
      setDeleting(false)
    }
  }

  if (!formData) {
    return <p className="p-4 text-sm font-semibold text-oc-muted">{loadFailed ? t('account.deleteFailed') : '…'}</p>
  }

  const input = 'mt-1.5 h-10 w-full rounded-lg border border-oc-line bg-white px-3 text-sm font-semibold text-oc-ink outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 read-only:bg-slate-50 read-only:text-oc-muted'
  const label = 'block text-xs font-bold text-oc-ink'
  const fieldError = 'mt-1 block font-semibold text-rose-600'

  return (
    <form onSubmit={submit} noValidate>
      <div className="space-y-4">
        {!emailVerified && (
          <div className="space-y-3">
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">{t('account.deleteVerifyEmail')}</p>
            <EmailVerificationSection />
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="text-xs font-extrabold uppercase tracking-wide text-oc-muted">{t('account.deleteAccountInfo')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>{t('account.deleteFullName')}
              <input className={input} readOnly value={account.name || ''} />
            </label>
            <label className={label}>{t('account.deleteRole')}
              <select className={input} required value={form.role} onChange={update('role')}>
                <option value="">{t('account.deleteRoleChoose')}</option>
                {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
              {roleError && <span className={fieldError}>{roleError}</span>}
            </label>
            <label className={label}>{t('account.deleteEmail')}
              {account.email
                ? <input className={input} type="email" required autoComplete="email" maxLength={255} value={form.email} onChange={update('email')} />
                : <input className={input} readOnly value={t('account.deleteNoEmail')} />}
              {emailError && form.email && <span className={fieldError}>{emailError}</span>}
            </label>
            <label className={label}>{t('account.deleteMobile')}
              <input className={input} type="tel" inputMode="tel" required autoComplete="tel" maxLength={30} value={form.phone} onChange={update('phone')} />
              {phoneError && form.phone && <span className={fieldError}>{phoneError}</span>}
            </label>
          </div>
        </fieldset>

        <div className="space-y-3">
          <label className={label}>{t('account.deleteReason')}
            <select className={input} required value={form.reasonCode} onChange={update('reasonCode')}>
              <option value="">{t('account.deleteReasonChoose')}</option>
              {reasons.map((reason) => {
                // A reason the server adds before it has a translation shows its own label.
                const key = `account.reason.${reason.value}`
                const translated = t(key)
                return <option key={reason.value} value={reason.value}>{translated === key ? reason.label : translated}</option>
              })}
            </select>
          </label>
          <label className={label}>{t('account.deleteReasonDetails')}
            <textarea className={`${input} h-20 py-2`} maxLength={1000} value={form.reasonDetails} onChange={update('reasonDetails')} />
            {detailsMissing && <span className={fieldError}>{t('account.deleteReasonDetailsRequired')}</span>}
          </label>
        </div>

        <DeletionPolicy />

        <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600" checked={form.agree} onChange={update('agree')} />
          <span>{t('account.deleteAgree')}</span>
        </label>

        <label className={label}>{t('account.deleteConfirmLabel')}
          <input
            className={input}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={50}
            value={form.confirmText}
            onChange={update('confirmText')}
          />
          {form.confirmText && !confirmTyped && <span className={fieldError}>{t('account.deleteConfirmMismatch')}</span>}
        </label>

        {errorMessage && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{errorMessage}</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className="h-9 rounded-lg border border-oc-line bg-white px-4 text-xs font-extrabold text-oc-ink transition hover:bg-ocbrand-50 disabled:opacity-50"
          >
            {t('dash.common.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={!canDelete}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-extrabold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />{deleting ? t('account.deleting') : t('account.delete')}
        </button>
      </div>
    </form>
  )
}
