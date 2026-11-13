import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Smartphone } from 'lucide-react'
import { PhoneVerification } from '../../auth/components/PhoneVerification.jsx'
import { StatusLine } from '../../auth/components/PasswordFields.jsx'
import { changeAccountPhone, readPhoneVerificationConfig } from '../../auth/phoneCodeApi.js'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

function apiMessage(error, td, fallback) {
  const response = error?.response
  if (!response || response.status >= 500) return fallback
  const detail = response.data?.detail
  if (typeof detail === 'string' && detail.trim() && detail !== 'Not Found') return td(detail)
  if (typeof detail?.message === 'string') return td(detail.message)
  return fallback
}

/**
 * Mobile number, in Profile Settings (and Complete Profile while it is missing).
 *
 * Where the API turns the WhatsApp check on, the number is how the account signs
 * in, so it changes only to a number that has just passed that check: the new
 * number is sent a code, the code returns a one-time token for exactly that
 * number, and the API swaps the number with it. The account id, role and every
 * related record stay as they are. Elsewhere the section is not shown and the
 * profile forms keep editing the number as before.
 */
// `currentPhone` and `onSaved` let a screen whose number is not users.phone use
// the same verified change: the admin console passes the administrator's own
// admin-profile number (GET /admin/me) and reloads it once the API has saved it.
export default function PhoneChangeSection({ className = '', currentPhone: phoneOverride, onSaved }) {
  const { t, td } = useLanguage()
  const dispatch = useDispatch()
  const user = useSelector((state) => state.auth.user)
  const currentPhone = (phoneOverride ?? user?.phone) || ''
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const [notice, setNotice] = useState('')
  // Remounts the WhatsApp check, so a finished or cancelled change starts clean.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('crewnbuild_recovery_phone_prompt')) {
        window.sessionStorage.removeItem('crewnbuild_recovery_phone_prompt')
        setOpen(true)
      }
    } catch {
      /* starts closed */
    }
  }, [])

  useEffect(() => {
    let active = true
    readPhoneVerificationConfig()
      .then((config) => { if (active) setEnabled(config?.enabled === true) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // The check only reaches Indian numbers; another country keeps its own form.
  const india = !user?.country_of_residence || user.country_of_residence === 'India'
  if (!enabled || !india) return null

  const close = () => {
    setOpen(false)
    setPhone('')
    setProblem('')
    setAttempt((value) => value + 1)
  }

  const applyVerifiedNumber = async (token) => {
    if (!token || saving) return
    setSaving(true)
    setProblem('')
    try {
      const updated = await changeAccountPhone(phone, token)
      dispatch(setAuthenticatedUser({ user: updated }))
      // The persisted number, read back from the API, not the typed one.
      await onSaved?.()
      setNotice(t('phoneChange.success'))
      close()
    } catch (error) {
      setProblem(apiMessage(error, td, t('phoneChange.failed')))
      // The token may be spent or refused: ask for a fresh check.
      setAttempt((value) => value + 1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`rounded-2xl border border-oc-line bg-white p-4 ${className}`} aria-labelledby="phone-change-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="phone-change-title" className="flex items-center gap-2 text-sm font-extrabold text-oc-ink">
            <Smartphone className="h-4 w-4 text-oc-green" /> {t('phoneChange.title')}
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-graphite/55">{t('phoneChange.subtitle')}</p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => { setNotice(''); setOpen(true) }}
            className="inline-flex h-9 shrink-0 items-center rounded-lg border border-oc-green/40 bg-oc-mint/50 px-4 text-xs font-extrabold text-oc-green transition hover:bg-oc-mint"
          >
            {currentPhone ? t('phoneChange.change') : t('phoneChange.add')}
          </button>
        )}
      </div>

      <p className="mt-3 text-xs font-bold text-oc-muted">
        {t('phoneChange.current')}:{' '}
        <span className="font-extrabold text-oc-ink" dir="ltr">{currentPhone ? `+91 ${currentPhone}` : t('phoneChange.none')}</span>
      </p>

      {open && (
        <div className="mt-3 max-w-md">
          <PhoneVerification
            key={attempt}
            phone={phone}
            onPhoneChange={(value) => { setPhone(value); setProblem('') }}
            onVerifiedChange={applyVerifiedNumber}
            verificationRequired
            showCountry={false}
            label={t('phoneChange.newLabel')}
          />
          {saving && <StatusLine tone="success">{t('phoneChange.saving')}</StatusLine>}
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="mt-2 text-[11px] font-extrabold text-oc-muted underline-offset-2 hover:text-oc-green hover:underline"
          >
            {t('phoneChange.cancel')}
          </button>
        </div>
      )}

      {problem && <div className="mt-2"><StatusLine tone="warning">{problem}</StatusLine></div>}
      {notice && <div className="mt-2"><StatusLine tone="success">{notice}</StatusLine></div>}
    </section>
  )
}
