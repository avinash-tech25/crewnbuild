import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound, Mail, RotateCw, ShieldCheck } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { passwordApi } from '../passwordApi.js'
import { PASSWORD_RULE, cleanCode, newPasswordProblems } from '../passwordRules.js'

/**
 * Forgot password: email -> emailed code -> new password -> back to sign in.
 *
 * The server answers the email step the same way whether or not the address has an
 * account, so this page never says either. The code is exchanged for a short-lived
 * reset token that only the server can check; the code, the token and the new
 * password live in this component's memory only (never in storage or the URL) and
 * are dropped as soon as they are no longer needed.
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState('email') // email | code | password
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [passwords, setPasswords] = useState({ newPassword: '', confirmPassword: '' })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: '' })
  const [cooldown, setCooldown] = useState(0)
  const timer = useRef(null)

  // Nothing sensitive outlives the page.
  useEffect(() => () => window.clearInterval(timer.current), [])

  const startCooldown = (seconds) => {
    window.clearInterval(timer.current)
    setCooldown(seconds)
    timer.current = window.setInterval(() => {
      setCooldown((left) => {
        if (left <= 1) window.clearInterval(timer.current)
        return Math.max(0, left - 1)
      })
    }, 1000)
  }

  const startAgain = (notice) => {
    setStep('email')
    setCode('')
    setResetToken('')
    setPasswords({ newPassword: '', confirmPassword: '' })
    setTouched(false)
    setMessage(notice ? { tone: 'error', text: notice } : { tone: 'info', text: '' })
  }

  const sendCode = async (event) => {
    event?.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setMessage({ tone: 'error', text: 'Enter a valid email address.' })
      return
    }
    setBusy(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const answer = await passwordApi.sendResetCode(email.trim())
      setCode('')
      setStep('code')
      setMessage({ tone: 'success', text: answer.message })
      startCooldown(answer.resend_after_seconds || 30)
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'The code could not be sent. Please try again.') })
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (event) => {
    event.preventDefault()
    if (code.length !== 6) {
      setMessage({ tone: 'error', text: 'Enter the 6-digit code from the email.' })
      return
    }
    setBusy(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const answer = await passwordApi.verifyResetCode(email.trim(), code)
      setResetToken(answer.reset_token)
      setCode('') // spent: the server has deleted it
      setStep('password')
    } catch (error) {
      setCode('')
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'That code is not right or has expired. Ask for a new one.') })
    } finally {
      setBusy(false)
    }
  }

  const problems = newPasswordProblems(passwords)
  const shown = touched ? problems : {}

  const resetPassword = async (event) => {
    event.preventDefault()
    setTouched(true)
    if (Object.keys(problems).length) return
    setBusy(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const answer = await passwordApi.resetPassword({ resetToken, ...passwords })
      setResetToken('')
      setPasswords({ newPassword: '', confirmPassword: '' })
      // Sign-in shows this notice; no password travels with it.
      navigate('/login', { replace: true, state: { email: email.trim(), notice: answer.message } })
    } catch (error) {
      if (error?.response?.status === 400) {
        // The reset token is spent or expired: the only way on is a new code.
        startAgain(apiErrorMessage(error, 'This password reset has expired. Please start again.'))
      } else {
        setPasswords({ newPassword: '', confirmPassword: '' })
        setTouched(false)
        setMessage({ tone: 'error', text: apiErrorMessage(error, 'Your password could not be reset.') })
      }
    } finally {
      setBusy(false)
    }
  }

  const titles = {
    email: ['Forgot password', 'Enter the email you registered with. We will email you a code to reset your password.'],
    code: ['Enter the code', `If an account exists for ${email.trim()}, a 6-digit code has been sent to it.`],
    password: ['Choose a new password', PASSWORD_RULE],
  }

  return (
    <AuthLayout
      dense
      title={titles[step][0]}
      subtitle={titles[step][1]}
      footer={<>Remembered it? <Link to="/login" className="font-extrabold text-oc-green hover:underline">Back to sign in</Link></>}
    >
      <Alert tone={message.tone}>{message.text}</Alert>

      {step === 'email' && (
        <form onSubmit={sendCode} className="mt-4 space-y-3.5" noValidate data-testid="reset-email-form">
          <label className="block">
            <span className="field-label">Email</span>
            <input className="field-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} data-testid="reset-email" />
          </label>
          <button type="submit" className="btn-primary w-full py-3" disabled={busy} data-testid="reset-send">
            {busy ? <Spinner className="h-4 w-4" /> : <Mail className="h-4 w-4" />} Send reset code
          </button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verifyCode} className="mt-4 space-y-3.5" noValidate data-testid="reset-code-form">
          <label className="block">
            <span className="field-label">6-digit code</span>
            <input
              className="field-input text-center font-display text-xl tracking-[0.5em]"
              // No maxLength: the browser would cut a pasted "482 913" before cleanCode
              // (which keeps six digits) could see it.
              inputMode="numeric" autoComplete="one-time-code"
              value={code} onChange={(event) => setCode(cleanCode(event.target.value))} data-testid="reset-code"
            />
          </label>
          <button type="submit" className="btn-primary w-full py-3" disabled={busy} data-testid="reset-verify">
            {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} Verify code
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" className="font-bold text-oc-green hover:underline disabled:text-oc-muted disabled:no-underline"
              disabled={busy || cooldown > 0} onClick={() => sendCode()} data-testid="reset-resend">
              <RotateCw className="mr-1 inline h-3.5 w-3.5" />
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="font-bold text-oc-muted hover:underline" onClick={() => startAgain()}>Use a different email</button>
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={resetPassword} className="mt-4 space-y-3.5" noValidate data-testid="reset-password-form">
          {['newPassword', 'confirmPassword'].map((name) => {
            const key = name === 'newPassword' ? 'new' : 'confirm'
            return (
              <label key={name} className="block">
                <span className="field-label">{name === 'newPassword' ? 'New password' : 'Confirm new password'}</span>
                <input
                  className="field-input" type="password" autoComplete="new-password"
                  value={passwords[name]} onChange={(event) => setPasswords((current) => ({ ...current, [name]: event.target.value }))}
                  aria-invalid={Boolean(shown[key])} data-testid={`reset-${name}`}
                />
                {shown[key] && <span className="mt-1 block text-xs font-bold text-red-700" role="alert">{shown[key]}</span>}
              </label>
            )
          })}
          <button type="submit" className="btn-primary w-full py-3" disabled={busy} data-testid="reset-submit">
            {busy ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />} Reset password
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
