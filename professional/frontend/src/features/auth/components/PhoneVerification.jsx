import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { AuthField, controlClass, labelClass } from './AuthShell.jsx'
import { OtpInput, emptyCode } from './OtpInput.jsx'
import { DevOtpNotice } from './DevOtpNotice.jsx'
import { requestGate } from '../requestGate.js'
import { actionButton, StatusLine, swap } from './PasswordFields.jsx'
import { RESIDENCE_COUNTRIES } from '../../onboarding/components/CountryField.jsx'
import { phoneMaxLengthForCountry } from '../../../shared/auth/accountPaths.js'
import { sendPhoneCode, verifyPhoneCode } from '../phoneCodeApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { WhatsAppGlyph } from './WhatsAppGlyph.jsx'

const INDIA_MOBILE = /^[6-9]\d{9}$/

// The countries an account can live in (the same list Complete Profile offers),
// with the dialling code shown in front of the number.
const DIAL_CODES = { India: '+91' }
const COUNTRY_KEYS = { India: 'country.india' }

// Statuses whose `detail` the phone endpoints write for people to read:
// invalid number (422), number in use (409), wait / too many (429), wrong code
// (400), expired or used (410), no code requested yet (404).
const READABLE_STATUSES = new Set([400, 404, 409, 410, 422, 429])

function apiMessage(error, fallback) {
  const response = error?.response
  if (!response || response.status >= 500) return fallback
  const detail = response.data?.detail
  if (response.status === 404 && detail === 'Not Found') return fallback
  if (READABLE_STATUSES.has(response.status) && typeof detail === 'string' && detail.trim()) return detail
  return fallback
}

// The country's dialling code, drawn in the field's icon slot so the field keeps
// the exact shape and spacing of the other sign-up fields. Made once per country,
// so the icon is not a new component on every render. The four-character code is
// set smaller to fit the same slot.
function dialCodeIcon(dialCode) {
  const size = dialCode.length > 3 ? 'text-xs' : 'text-sm'
  return function DialCode({ className }) {
    return <span className={`${className} ${size} font-extrabold`} dir="ltr">{dialCode}</span>
  }
}

const DIAL_CODE_ICONS = Object.fromEntries(
  Object.entries(DIAL_CODES).map(([name, dialCode]) => [name, dialCodeIcon(dialCode)]),
)

/**
 * The sign-up phone number, with its country.
 *
 * Where the API turns the WhatsApp check on (`verificationRequired`), the
 * number is an Indian mobile and goes enter -> code -> done: the API sends and
 * checks the code, and a correct code returns a one-time token that sign-up
 * must present with the same number. Editing the number drops the token, so a
 * number can only be submitted as verified if it is the one that received the
 * code. Everywhere else it is an optional number for the chosen country, with
 * no code to request.
 */
export function PhoneVerification({
  phone, onPhoneChange, onVerifiedChange, country = 'India', onCountryChange, verificationRequired = true,
  // The phone-first sign-up shows only the number: the check fixes the country
  // to India, so the +91 in the field says it and the locked select is dropped.
  showCountry = true, label,
}) {
  const { t } = useLanguage()
  const [stage, setStage] = useState('enter')
  const [code, setCode] = useState(emptyCode)
  const [busy, setBusy] = useState(false)
  const sendGate = useRef(requestGate()).current
  const [problem, setProblem] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  // Development preview reply ({ code }), else null. See DevOtpNotice.
  const [devPreview, setDevPreview] = useState(null)

  // The WhatsApp check only knows Indian numbers, so it fixes the country.
  const effectiveCountry = verificationRequired ? 'India' : country
  const maxDigits = phoneMaxLengthForCountry(effectiveCountry)
  const phoneUsable = INDIA_MOBILE.test(phone)
  const codeComplete = code.every((digit) => digit !== '')

  useEffect(() => {
    if (secondsLeft <= 0) return undefined
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const changePhone = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, maxDigits)
    onPhoneChange(digits)
    // A changed number invalidates anything already confirmed for the old one.
    if (digits !== phone) {
      onVerifiedChange(null)
      setCode(emptyCode())
      setStage('enter')
      setDevPreview(null)
    }
    setProblem('')
  }

  const requestCode = async () => {
    if (busy) return
    if (!phoneUsable) {
      setProblem(t('signup.phone.invalid'))
      return
    }
    if (!sendGate.enter()) return
    setBusy(true)
    setProblem('')
    try {
      const result = await sendPhoneCode(phone)
      setCode(emptyCode())
      setDevPreview(result?.dev_preview ? { code: result.dev_otp || '' } : null)
      setSecondsLeft(result?.resend_after_seconds || 60)
      setStage('code')
    } catch (error) {
      setProblem(apiMessage(error, t('signup.phone.sendFailed')))
    } finally {
      sendGate.leave()
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (busy) return
    setBusy(true)
    setProblem('')
    try {
      const result = await verifyPhoneCode(phone, code)
      if (!result?.verification_token) throw new Error('missing token')
      onVerifiedChange(result.verification_token)
      setStage('done')
    } catch (error) {
      setProblem(apiMessage(error, t('signup.flow.otpInvalid')))
    } finally {
      setBusy(false)
    }
  }

  const panels = {
    enter: (
      <>
        <button type="button" onClick={requestCode} disabled={busy || !phoneUsable} className={actionButton}>
          <span className="inline-flex items-center justify-center gap-2">
            <WhatsAppGlyph />
            {busy ? t('signup.flow.sending') : t('signup.phone.send')}
          </span>
        </button>
        {problem && <StatusLine tone="warning">{problem}</StatusLine>}
      </>
    ),

    code: (
      <>
        <OtpInput
          code={code}
          onChange={(next) => { setCode(next); setProblem('') }}
          invalid={Boolean(problem)}
          label={t('signup.phone.otpLabel')}
          note={`+91 ${phone}`}
        />
        {/* Sent, not delivered: the provider accepting a message is all we know. */}
        <span className="mt-1 block text-[11px] font-medium text-oc-muted">{t('signup.phone.sent')}</span>
        {devPreview && <DevOtpNotice code={devPreview.code} />}
        {problem && <StatusLine tone="warning">{problem}</StatusLine>}
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setStage('enter'); setProblem('') }}
            aria-label={t('signup.phone.change')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-oc-line text-oc-muted
                       transition-colors duration-200 hover:border-oc-green hover:text-oc-green"
          >
            <ArrowLeft size={15} className="rtl:-scale-x-100" />
          </button>
          <button type="button" onClick={submitCode} disabled={!codeComplete || busy} className={`${actionButton} min-h-[40px] flex-1`}>
            {busy ? t('signup.flow.checking') : t('signup.flow.verifyOtp')}
          </button>
          {secondsLeft > 0 ? (
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-oc-muted">
              {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
            </span>
          ) : (
            <button type="button" onClick={requestCode} disabled={busy} className="shrink-0 text-[11px] font-extrabold text-oc-green hover:text-oc-deep">
              {t('signup.flow.resend')}
            </button>
          )}
        </div>
      </>
    ),

    done: (
      <p className="flex items-center gap-2 rounded-xl border border-oc-green/40 bg-oc-mint/60 px-3 py-3 text-xs font-extrabold text-oc-green">
        <ShieldCheck size={16} />
        {t('signup.phone.verified')}
      </p>
    ),
  }

  const changeCountry = (value) => {
    onCountryChange?.(value)
    // A number typed for one country is not a number for the other.
    onPhoneChange('')
    setProblem('')
  }

  return (
    <div className="flex flex-col gap-[9px]">
      {showCountry && (
      <label className="block">
        <span className={labelClass}>{t('signup.countryOfResidence')}</span>
        <select
          value={effectiveCountry}
          onChange={(event) => changeCountry(event.target.value)}
          disabled={verificationRequired}
          className={`${controlClass} px-4 font-semibold disabled:bg-oc-mint/40 disabled:text-oc-muted`}
        >
          {RESIDENCE_COUNTRIES.map((name) => (
            <option key={name} value={name}>{t(COUNTRY_KEYS[name] || name)} ({DIAL_CODES[name]})</option>
          ))}
        </select>
      </label>
      )}
      <AuthField
        label={label || (verificationRequired ? t('signup.phone.label') : t('signup.phone'))}
        icon={DIAL_CODE_ICONS[effectiveCountry] || DIAL_CODE_ICONS.India}
        type="tel"
        placeholder={verificationRequired || effectiveCountry === 'India' ? t('signup.phone.placeholder') : ''}
        value={phone}
        onChange={changePhone}
        autoComplete="tel-national"
        inputMode="numeric"
        maxLength={maxDigits}
        required={verificationRequired}
      />
      {verificationRequired && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={stage} {...swap}>
            {panels[stage]}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  )
}
