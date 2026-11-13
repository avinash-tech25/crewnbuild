import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { OtpInput, emptyCode } from './OtpInput.jsx'
import { sendResetCode, verifyResetCode } from '../passwordResetApi.js'
import { actionButton, BackLink, PasswordField, StatusLine, swap } from './PasswordFields.jsx'
import { passwordIsStrong } from './PasswordVerification.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const MATCH_PAUSE = 700
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The code is proven before a new password is asked for, so these are the only steps
// worth returning to. Once the code is accepted there is nothing above it to correct.
const previousStage = { code: 'sendCode', confirm: 'password' }

const stagesAfterCode = ['password', 'confirm', 'ready']

function apiMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  return fallback
}

/**
 * Password recovery, shown as one slot that steps forward.
 *
 * sendCode -> code -> password -> confirm -> ready. The code is issued and
 * checked by the API, so the new password can only be saved by someone who
 * actually received the e-mail.
 */
export function PasswordReset({ email, onCodeVerified, onPasswordReady, onPasswordChange }) {
  const { t } = useLanguage()
  const [stage, setStage] = useState('sendCode')
  const [code, setCode] = useState(emptyCode)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const passwordRef = useRef(null)
  const confirmationRef = useRef(null)

  const matched = password.length > 0 && password === confirmation
  const codeComplete = code.every((digit) => digit !== '')
  const emailUsable = EMAIL_PATTERN.test((email || '').trim())

  useEffect(() => { onCodeVerified(stagesAfterCode.includes(stage)) }, [stage, onCodeVerified])
  useEffect(() => { onPasswordReady(stage === 'ready') }, [stage, onPasswordReady])
  useEffect(() => { onPasswordChange(password) }, [password, onPasswordChange])

  // Let the visitor see the match confirmed before the slot moves on.
  useEffect(() => {
    if (stage !== 'confirm' || !matched) return undefined
    const timer = setTimeout(() => setStage('ready'), MATCH_PAUSE)
    return () => clearTimeout(timer)
  }, [stage, matched])

  useEffect(() => {
    if (secondsLeft <= 0) return undefined
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const goBack = () => {
    const target = previousStage[stage]
    if (!target) return
    if (target === 'sendCode') setCode(emptyCode())
    if (target === 'password') setConfirmation('')
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
      const result = await sendResetCode(email.trim().toLowerCase())
      setCode(emptyCode())
      setSecondsLeft(result?.resend_after_seconds || 30)
      setStage('code')
    } catch (error) {
      setProblem(apiMessage(error, t('signup.flow.sendFailed')))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    setBusy(true)
    setProblem('')
    try {
      await verifyResetCode(email.trim().toLowerCase(), code)
      setStage('password')
      setTimeout(() => passwordRef.current?.focus(), 80)
    } catch (error) {
      setProblem(apiMessage(error, t('signup.flow.otpInvalid')))
    } finally {
      setBusy(false)
    }
  }

  const openConfirmation = () => {
    if (!passwordIsStrong(password)) {
      setProblem(t('validation.password'))
      return
    }
    setProblem('')
    setStage('confirm')
    setTimeout(() => confirmationRef.current?.focus(), 80)
  }

  const panels = {
    sendCode: (
      <>
        <button type="button" onClick={requestCode} disabled={!email || busy} className={actionButton}>
          {busy ? t('signup.flow.sending') : t('reset.sendCode')}
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
          label={t('signup.flow.otpLabel')}
          note={email}
        />
        {problem && <StatusLine tone="warning">{problem}</StatusLine>}

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

    password: (
      <PasswordField
        inputRef={passwordRef}
        label={t('reset.newPasswordLabel')}
        revealLabel={t('shared.showPassword')}
        placeholder={t('reset.newPasswordPlaceholder')}
        value={password}
        onChange={(value) => { setPassword(value); setProblem('') }}
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
          label={t('reset.confirmLabel')}
          revealLabel={t('shared.showPassword')}
          placeholder={t('reset.confirmPlaceholder')}
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

    ready: (
      <p className="flex items-center gap-2 rounded-xl border border-oc-green/40 bg-oc-mint/60 px-3 py-3 text-xs font-extrabold text-oc-green">
        <ShieldCheck size={16} />
        {t('reset.readyToSave')}
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
