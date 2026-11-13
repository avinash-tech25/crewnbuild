import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { AuthField } from './AuthShell.jsx'
import { buttonClass } from '../../public-site/components/landing/shared.jsx'
import { OtpInput, emptyCode } from './OtpInput.jsx'
import { DevOtpNotice } from './DevOtpNotice.jsx'
import { requestGate } from '../requestGate.js'
import { actionButton, StatusLine } from './PasswordFields.jsx'
import { sendPhoneLoginCode } from '../phoneCodeApi.js'
import { loginWithWhatsApp } from '../../../shared/auth/authSlice.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { WhatsAppGlyph } from './WhatsAppGlyph.jsx'


const INDIA_MOBILE = /^[6-9]\d{9}$/

// Statuses whose `detail` the send endpoint writes for people to read. The API
// decides who may sign in before any code exists: not registered (404), not
// allowed to sign in, e.g. suspended (403), number held by two accounts (409),
// invalid number (422), wait / too many (429).
const READABLE_STATUSES = new Set([403, 404, 409, 422, 429])
// Refusals about the number or its account: the code screen and its timer must
// not stay up for them, even on a resend.
const NUMBER_REFUSALS = new Set([403, 404, 409, 422])

function sendRefusal(error, fallback) {
  const response = error?.response
  if (!response || response.status >= 500) return { message: fallback, status: response?.status || 0 }
  const detail = response.data?.detail
  const readable = READABLE_STATUSES.has(response.status) && typeof detail === 'string' && detail.trim()
  return { message: readable ? detail : fallback, status: response.status }
}

function DialCode({ className }) {
  return <span className={`${className} text-sm font-extrabold`} dir="ltr">+91</span>
}

/**
 * Sign in with a WhatsApp code to the account's registered +91 number.
 *
 * number -> code -> signed in. The API sends a LOGIN code (a sign-up code is
 * never accepted here) and, for a correct one, answers exactly like a password
 * sign-in: the same session cookies, the same account checks. `onSignedIn`
 * receives the account and takes the same landing decision as password login.
 */
export function PhoneLogin({ onSignedIn }) {
  const { t, translateMessage } = useLanguage()
  const dispatch = useDispatch()
  const { status, errorMessage } = useSelector((state) => state.auth)
  const [phone, setPhone] = useState('')
  const [stage, setStage] = useState('enter')
  const [code, setCode] = useState(emptyCode)
  const [sending, setSending] = useState(false)
  const sendGate = useRef(requestGate()).current
  const [problem, setProblem] = useState('')
  // True when the API answered "not registered": the Sign Up link is offered.
  const [notRegistered, setNotRegistered] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)
  // Development preview reply ({ code }), else null. See DevOtpNotice.
  const [devPreview, setDevPreview] = useState(null)

  const phoneUsable = INDIA_MOBILE.test(phone)
  const codeComplete = code.every((digit) => digit !== '')
  const signingIn = status === 'loading'

  useEffect(() => {
    if (secondsLeft <= 0) return undefined
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const changePhone = (value) => {
    setPhone(value.replace(/\D/g, '').slice(0, 10))
    setProblem('')
    setNotRegistered(false)
    // A code belongs to the number it was sent to.
    if (stage === 'code') {
      setStage('enter')
      setCode(emptyCode())
      setDevPreview(null)
    }
  }

  const requestCode = async () => {
    if (!phoneUsable) {
      setProblem(t('signup.phone.invalid'))
      return
    }
    if (!sendGate.enter()) return
    setSending(true)
    setProblem('')
    setNotRegistered(false)
    try {
      // The code screen and its timer appear only once the API has accepted
      // the request; nothing changes on screen before then.
      const result = await sendPhoneLoginCode(phone)
      setCode(emptyCode())
      setDevPreview(result?.dev_preview ? { code: result.dev_otp || '' } : null)
      setSecondsLeft(result?.resend_after_seconds || 60)
      setStage('code')
    } catch (error) {
      const refusal = sendRefusal(error, t('signup.phone.sendFailed'))
      setProblem(refusal.message)
      setNotRegistered(refusal.status === 404)
      if (NUMBER_REFUSALS.has(refusal.status)) {
        // Back to the number, with no code boxes or countdown left over.
        setStage('enter')
        setCode(emptyCode())
        setSecondsLeft(0)
        setDevPreview(null)
      }
    } finally {
      sendGate.leave()
      setSending(false)
    }
  }

  const submitCode = async (event) => {
    event.preventDefault()
    if (signingIn || !codeComplete) return
    setProblem('')
    const result = await dispatch(loginWithWhatsApp({ phone, code }))
    if (result.payload?.user) {
      onSignedIn(result.payload.user)
      return
    }
    setCode(emptyCode())
  }

  return (
    <form className="mt-5 flex flex-col gap-[9px]" onSubmit={submitCode} noValidate>
      <AuthField
        label={t('signup.mobileNumber')}
        icon={DialCode}
        type="tel"
        placeholder={t('signup.phone.placeholder')}
        value={phone}
        onChange={changePhone}
        autoComplete="tel-national"
        inputMode="numeric"
        maxLength={10}
        required
      />

      {stage === 'enter' ? (
        <button type="button" onClick={requestCode} disabled={sending || !phoneUsable} className={actionButton}>
          <span className="inline-flex items-center justify-center gap-2">
            <WhatsAppGlyph />
            {sending ? t('signup.flow.sending') : t('login.phone.send')}
          </span>
        </button>
      ) : (
        <>
          <OtpInput
            code={code}
            onChange={(next) => { setCode(next); setProblem('') }}
            invalid={Boolean(problem || (status === 'failed' && errorMessage))}
            disabled={signingIn}
            label={t('signup.phone.otpLabel')}
            note={`+91 ${phone}`}
          />
          {/* Sent, not delivered: the provider accepting a message is all we know. */}
          <span className="block text-[11px] font-medium text-oc-muted">{t('signup.phone.sent')}</span>
          {devPreview && <DevOtpNotice code={devPreview.code} />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setStage('enter'); setProblem('') }}
              aria-label={t('signup.phone.change')}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-oc-line text-oc-muted
                         transition-colors duration-200 hover:border-oc-green hover:text-oc-green"
            >
              <ArrowLeft size={15} className="rtl:-scale-x-100" />
            </button>
            {secondsLeft > 0 ? (
              <span className="text-[11px] font-semibold tabular-nums text-oc-muted">
                {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
              </span>
            ) : (
              <button type="button" onClick={requestCode} disabled={sending} className="text-[11px] font-extrabold text-oc-green hover:text-oc-deep">
                {sending ? t('signup.flow.sending') : t('signup.flow.resend')}
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={signingIn || !codeComplete}
            className={`${buttonClass} mt-1 w-full disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:bg-oc-green`}
          >
            {signingIn ? t('login.phone.verifying') : t('login.phone.verify')}
            {signingIn ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} className="rtl:-scale-x-100" />}
          </button>
        </>
      )}

      {problem && (
        <div role="alert">
          <StatusLine tone="warning">{problem}</StatusLine>
          {notRegistered && (
            <Link to="/signup" className={`${actionButton} mt-2 grid place-items-center`}>
              {t('login.phone.signUp')}
            </Link>
          )}
        </div>
      )}
      {!problem && status === 'failed' && errorMessage && stage === 'code' && (
        <p role="alert" className="rounded-xl border border-warm/30 bg-warm/10 px-3 py-2 text-[11px] font-bold text-warm">
          {translateMessage(errorMessage)}
        </p>
      )}
    </form>
  )
}
