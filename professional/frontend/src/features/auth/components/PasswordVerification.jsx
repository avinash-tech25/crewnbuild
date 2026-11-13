import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { OtpInput, emptyCode } from './OtpInput.jsx'
import { sendEmailCode, verifyEmailCode } from '../emailCodeApi.js'
import { actionButton, BackLink, PasswordField, StatusLine, swap } from './PasswordFields.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const MATCH_PAUSE = 700
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Each stage steps back to the one before it, so a mistake is always correctable.
const previousStage = { confirm: 'create', sendCode: 'confirm', code: 'sendCode' }

export function passwordIsStrong(password) {
  return password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^\w\s]/.test(password)
}

// Statuses whose `detail` the OTP endpoints write for people to read: already
// registered (409), wait before resending (429), wrong code (400), expired (410),
// no code requested yet (404 with the service's own sentence).
const READABLE_STATUSES = new Set([400, 404, 409, 410, 429])

function apiMessage(error, fallback, invalidEmailMessage = fallback) {
  const response = error?.response
  // No reply at all (backend down, wrong address, CORS): never a raw network text.
  if (!response) return fallback
  const detail = response.data?.detail
  // FastAPI's own validation error for a malformed address arrives as a list.
  if (response.status === 422) return invalidEmailMessage
  // "Not Found" is FastAPI's answer for a route that does not exist -- the request
  // reached the wrong server -- not something to show on the signup screen.
  if (response.status === 404 && detail === 'Not Found') return fallback
  // Delivery failures and other server errors get the friendly fallback.
  if (response.status >= 500) return fallback
  if (READABLE_STATUSES.has(response.status)) {
    if (typeof detail === 'string' && detail.trim()) return detail
    if (detail?.message) return detail.message
  }
  return fallback
}

/**
 * Password creation and e-mail check, shown as one slot that steps forward.
 *
 * create -> confirm -> sendCode -> code -> done. The code is generated and
 * checked by the API, so reaching "done" means the address really did receive
 * the six digits.
 */
export function PasswordVerification({ email, password, onPasswordChange, onVerifiedChange }) {
  const { t } = useLanguage()
  const [stage, setStage] = useState('create')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState(emptyCode)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [delivered, setDelivered] = useState(true)
  const confirmationRef = useRef(null)

  const strong = passwordIsStrong(password)
  const matched = password.length > 0 && password === confirmation
  const codeComplete = code.every((digit) => digit !== '')
  const emailUsable = EMAIL_PATTERN.test((email || '').trim())

  useEffect(() => { onVerifiedChange(stage === 'done') }, [stage, onVerifiedChange])

  // A changed address invalidates anything already confirmed for the old one.
  useEffect(() => {
    setStage((current) => (current === 'done' ? 'sendCode' : current))
  }, [email])

  // Let the visitor see the match confirmed before the slot moves on.
  useEffect(() => {
    if (stage !== 'confirm' || !matched) return undefined
    const timer = setTimeout(() => setStage('sendCode'), MATCH_PAUSE)
    return () => clearTimeout(timer)
  }, [stage, matched])

  useEffect(() => {
    if (secondsLeft <= 0) return undefined
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const openConfirmation = () => {
    if (!strong) {
      setProblem(t('validation.password'))
      return
    }
    setProblem('')
    setStage('confirm')
    setTimeout(() => confirmationRef.current?.focus(), 80)
  }

  const goBack = () => {
    const target = previousStage[stage]
    if (!target) return
    if (target === 'create') setConfirmation('')
    if (target === 'confirm') setCode(emptyCode())
    setProblem('')
    setStage(target)
  }

  const requestCode = async () => {
    if (!emailUsable) {
      setProblem(t('signup.flow.needEmail'))
      return
    }
    setBusy(true)
    setProblem('')
    try {
      const result = await sendEmailCode(email.trim().toLowerCase())
      setCode(emptyCode())
      setSecondsLeft(result?.resend_after_seconds || 30)
      // Only ever false on a development machine whose mailbox is refusing us:
      // in production an undeliverable code is a refusal, not a reply. Saying so
      // beats telling somebody to watch an inbox nothing is coming to.
      setDelivered(result?.delivered !== false)
      setStage('code')
    } catch (error) {
      setProblem(apiMessage(error, t('signup.flow.sendFailed'), t('signup.flow.needEmail')))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    setBusy(true)
    setProblem('')
    try {
      await verifyEmailCode(email.trim().toLowerCase(), code)
      setStage('done')
    } catch (error) {
      setProblem(apiMessage(error, t('signup.flow.otpInvalid')))
    } finally {
      setBusy(false)
    }
  }

  const panels = {
    create: (
      <PasswordField
        label={t('signup.password')}
        required
        revealLabel={t('shared.showPassword')}
        placeholder={t('signup.passwordPlaceholder')}
        value={password}
        onChange={(value) => { onPasswordChange(value); setProblem('') }}
        tone={problem ? 'warning' : 'idle'}
        hint={problem
          ? <StatusLine tone="warning">{problem}</StatusLine>
          : <span className="mt-1 block text-[11px] font-medium text-oc-muted">{t('signup.passwordHint')}</span>}
        trailing={
          <button
            type="button"
            onClick={openConfirmation}
            disabled={!password}
            aria-label={t('signup.flow.continueLabel')}
            className="absolute end-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg bg-oc-green text-white
                       transition-[background,transform] duration-200 hover:bg-oc-deep disabled:opacity-35 disabled:hover:bg-oc-green"
          >
            <ArrowRight size={16} className="rtl:-scale-x-100" />
          </button>
        }
      />
    ),

    confirm: (
      <>
        <PasswordField
          inputRef={confirmationRef}
          label={t('signup.flow.verifyLabel')}
          required
          revealLabel={t('shared.showPassword')}
          placeholder={t('signup.flow.verifyPlaceholder')}
          value={confirmation}
          onChange={setConfirmation}
          tone={matched ? 'success' : confirmation ? 'warning' : 'idle'}
          trailing={matched ? <Check size={18} className="absolute end-4 top-1/2 -translate-y-1/2 text-oc-green" /> : null}
        />
        {confirmation !== '' ? (
          <StatusLine tone={matched ? 'success' : 'warning'}>{matched ? t('signup.flow.match') : t('signup.flow.mismatch')}</StatusLine>
        ) : (
          <BackLink label={t('signup.flow.back')} onClick={goBack} />
        )}
      </>
    ),

    sendCode: (
      <>
        <StatusLine tone="success">{t('signup.flow.match')}</StatusLine>
        <button type="button" onClick={requestCode} disabled={busy} className={`${actionButton} mt-2`}>
          {busy ? t('signup.flow.sending') : t('signup.flow.sendOtp')}
        </button>
        {problem && <StatusLine tone="warning">{problem}</StatusLine>}
        <BackLink label={t('signup.flow.back')} onClick={goBack} />
      </>
    ),

    code: (
      <>
        <OtpInput
          code={code}
          onChange={(next) => { setCode(next); setProblem('') }}
          invalid={Boolean(problem)}
          label={t('signup.flow.otpLabel')}
          note={email}
        />
        {!delivered && (
          <StatusLine tone="warning">
            Email delivery is not working on this machine, so the code was
            written to the backend console instead of being sent.
          </StatusLine>
        )}
        {problem && <StatusLine tone="warning">{problem}</StatusLine>}

        {/* Back, verify and resend share one row so the tallest stage stays the
            same height as the others and the form never grows into a scroll. */}
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            aria-label={t('signup.flow.back')}
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
              00:{String(secondsLeft).padStart(2, '0')}
            </span>
          ) : (
            <button type="button" onClick={requestCode} className="shrink-0 text-[11px] font-extrabold text-oc-green hover:text-oc-deep">
              {t('signup.flow.resend')}
            </button>
          )}
        </div>
      </>
    ),

    done: (
      <p className="flex items-center gap-2 rounded-xl border border-oc-green/40 bg-oc-mint/60 px-3 py-3 text-xs font-extrabold text-oc-green">
        <ShieldCheck size={16} />
        {t('signup.flow.emailVerified')}
      </p>
    ),
  }

  // One child, keyed by stage: AnimatePresence in wait mode expects exactly one.
  return (
    <div className="min-h-[112px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={stage} {...swap}>
          {panels[stage]}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
