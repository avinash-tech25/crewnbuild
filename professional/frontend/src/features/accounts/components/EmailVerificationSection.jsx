import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { CheckCircle2, Mail } from 'lucide-react'
import { OtpInput, emptyCode } from '../../auth/components/OtpInput.jsx'
import { actionButton, StatusLine } from '../../auth/components/PasswordFields.jsx'
import { sendProfileEmailCode, verifyProfileEmailCode } from '../../auth/emailCodeApi.js'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Statuses whose `detail` the e-mail endpoints write for people to read: wrong
// code (400), no code asked for (404), address on another account or already
// verified (409), expired (410), wait / too many tries (429).
const READABLE_STATUSES = new Set([400, 404, 409, 410, 429])

function apiMessage(error, td, fallback, invalidEmail) {
  const response = error?.response
  if (!response || response.status >= 500) return fallback
  // FastAPI's own validation error for a malformed address arrives as a list.
  if (response.status === 422) return invalidEmail
  const detail = response.data?.detail
  if (response.status === 404 && detail === 'Not Found') return fallback
  if (READABLE_STATUSES.has(response.status) && typeof detail === 'string' && detail.trim()) return td(detail)
  return fallback
}

const badgeTones = {
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sent: 'border-amber-200 bg-amber-50 text-amber-700',
  notVerified: 'border-rose-200 bg-rose-50 text-rose-700',
  none: 'border-slate-200 bg-slate-50 text-slate-600',
}

/**
 * Email address and its check, in Profile Settings.
 *
 * One component for all four roles, like Delete Account: the server works on
 * whichever account the session belongs to, so nothing here names an account.
 * An account signs up with its mobile number only; the address is added here.
 * The server saves it on the account, verified, only once the e-mailed code is
 * confirmed. The account the server returns then replaces the one in the store,
 * so every screen shows the same address and status.
 */
export default function EmailVerificationSection({ className = '' }) {
  const { t, td } = useLanguage()
  const dispatch = useDispatch()
  const user = useSelector((state) => state.auth.user)
  const savedEmail = user?.email || ''
  const verified = Boolean(savedEmail && user?.email_verified)

  const [email, setEmail] = useState(savedEmail)
  const [stage, setStage] = useState('enter')
  const [code, setCode] = useState(emptyCode)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [notice, setNotice] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => { setEmail(savedEmail) }, [savedEmail])

  useEffect(() => {
    if (secondsLeft <= 0) return undefined
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const typed = email.trim().toLowerCase()
  const emailUsable = EMAIL_PATTERN.test(typed)
  const codeComplete = code.every((digit) => digit !== '')
  // A verified address needs nothing until a different one is typed.
  const nothingToVerify = verified && typed === savedEmail.toLowerCase()
  const status = stage === 'code' ? 'sent' : verified ? 'verified' : savedEmail ? 'notVerified' : 'none'

  const requestCode = async () => {
    if (busy) return
    if (!emailUsable) {
      setProblem(t('emailVerify.invalid'))
      return
    }
    setBusy(true)
    setProblem('')
    setNotice('')
    try {
      const result = await sendProfileEmailCode(typed)
      setCode(emptyCode())
      setSecondsLeft(result?.resend_after_seconds || 30)
      setStage('code')
    } catch (error) {
      setProblem(apiMessage(error, td, t('emailVerify.sendFailed'), t('emailVerify.invalid')))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (busy || !codeComplete) return
    setBusy(true)
    setProblem('')
    try {
      const result = await verifyProfileEmailCode(typed, code)
      if (!result?.user) throw new Error('missing account')
      dispatch(setAuthenticatedUser({ user: result.user }))
      setStage('enter')
      setCode(emptyCode())
      setNotice(t('emailVerify.success'))
    } catch (error) {
      setProblem(apiMessage(error, td, t('emailVerify.codeFailed'), t('emailVerify.invalid')))
    } finally {
      setBusy(false)
    }
  }

  const changeEmail = (value) => {
    setEmail(value)
    setProblem('')
    setNotice('')
    // A code belongs to the address it was sent to.
    if (stage === 'code') {
      setStage('enter')
      setCode(emptyCode())
    }
  }

  return (
    <section className={`rounded-2xl border border-oc-line bg-white p-4 ${className}`} aria-labelledby="email-verification-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="email-verification-title" className="flex items-center gap-2 text-sm font-extrabold text-oc-ink">
            <Mail className="h-4 w-4 text-oc-green" /> {t('emailVerify.title')}
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-graphite/55">{t('emailVerify.subtitle')}</p>
        </div>
        <span
          role="status"
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${badgeTones[status]}`}
        >
          {status === 'verified' && <CheckCircle2 className="h-3.5 w-3.5" />}
          {t(`emailVerify.status.${status}`)}
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-oc-muted rtl:tracking-normal">{t('emailVerify.label')}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => changeEmail(event.target.value)}
            placeholder={t('emailVerify.placeholder')}
            autoComplete="email"
            disabled={busy}
            className="h-11 w-full rounded-xl border border-oc-line bg-white px-3 text-sm font-semibold text-oc-ink outline-none transition
                       focus:border-oc-green focus:ring-4 focus:ring-oc-green/10 disabled:bg-oc-sunken"
          />
        </label>
        {stage === 'enter' && (
          <button
            type="button"
            onClick={requestCode}
            disabled={busy || !emailUsable || nothingToVerify}
            className={`${actionButton} min-h-[44px] sm:w-auto sm:px-5`}
          >
            {busy ? t('emailVerify.sending') : t('emailVerify.send')}
          </button>
        )}
      </div>

      {stage === 'code' && (
        <div className="mt-3 max-w-sm">
          <OtpInput
            code={code}
            onChange={(next) => { setCode(next); setProblem('') }}
            invalid={Boolean(problem)}
            disabled={busy}
            label={t('emailVerify.codeLabel')}
          />
          <span className="mt-1 block text-[11px] font-medium text-oc-muted">{t('emailVerify.sentTo', { email: typed })}</span>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={submitCode} disabled={!codeComplete || busy} className={`${actionButton} min-h-[40px] flex-1`}>
              {busy ? t('emailVerify.checking') : t('emailVerify.verify')}
            </button>
            {secondsLeft > 0 ? (
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-oc-muted">
                00:{String(secondsLeft).padStart(2, '0')}
              </span>
            ) : (
              <button type="button" onClick={requestCode} disabled={busy} className="shrink-0 text-[11px] font-extrabold text-oc-green hover:text-oc-deep">
                {t('emailVerify.resend')}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => changeEmail(savedEmail)}
            disabled={busy}
            className="mt-2 text-[11px] font-extrabold text-oc-muted underline-offset-2 hover:text-oc-green hover:underline"
          >
            {t('emailVerify.change')}
          </button>
        </div>
      )}

      {problem && <div className="mt-2"><StatusLine tone="warning">{problem}</StatusLine></div>}
      {notice && <div className="mt-2"><StatusLine tone="success">{notice}</StatusLine></div>}
    </section>
  )
}
