import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, Mail, Smartphone } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import OnboardingStepper, { TITLES } from '../../onboarding/components/OnboardingStepper.jsx'
import CodeInput from '../components/CodeInput.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { technicianTypeBySlug } from '../../../shared/constants/technicianTypes.js'
import { logout, setSession } from '../../../shared/auth/authSlice.js'
import { PARTNER_SESSION, apiErrorMessage } from '../../../shared/api/apiClient.js'
import { sendSignupCode, verifySignupCode } from '../../technician/technicianApi.js'
import LegalDialog from '../../legal/components/LegalDialog.jsx'
import terms from '../../legal/content/terms.js'
import privacy from '../../legal/content/privacy.js'

// Contact number only (the code goes to email): exactly 10 digits, the same rule as the backend.
const MOBILE_PATTERN = /^\d{10}$/
const MOBILE_ERROR = 'Enter a valid 10 digit mobile number.'
const CONSENT_ERROR = 'Please agree to the Terms of Service and Privacy Policy to create your account.'
const LEGAL = { terms, privacy }

/**
 * New Partner registration, steps 1-3: email -> mobile -> email code.
 *
 * /register always starts a NEW registration at the Email step. It never resumes
 * progress kept in this browser: a session left by a previous (possibly different)
 * technician is discarded when the page opens, unless it belongs to a finished
 * account, which goes to its dashboard instead. Once the code is verified, the
 * server-issued session continues on /onboarding, which resumes at the step the
 * server reports (and survives a refresh).
 */
export default function RegisterPage() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const typeSlug = technicianTypeBySlug(searchParams.get('type'))?.slug || ''
  const { signedIn, kind } = useSelector((state) => state.auth)
  // Decided once, from what was stored when the page opened: a technician signed in with
  // email + password goes to their dashboard; a registration session left in this tab is discarded.
  const [openedWith] = useState(() => (signedIn ? (kind === PARTNER_SESSION ? 'complete' : 'unfinished') : 'none'))
  const [stage, setStage] = useState('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: '' })
  const [resendIn, setResendIn] = useState(0)
  // Ticked only by the technician; reading the documents never ticks it.
  const [accepted, setAccepted] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [reading, setReading] = useState(null)

  // Signup-specific cleanup only: the stored technician session of an unfinished
  // registration. The account itself is untouched on the server; its owner can
  // continue it any time by signing in with an email code.
  useEffect(() => {
    if (openedWith === 'unfinished') dispatch(logout())
  }, [openedWith, dispatch])

  useEffect(() => {
    if (resendIn <= 0) return undefined
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendIn])

  if (openedWith === 'complete') return <Navigate to="/dashboard" replace />

  const sendCode = async () => {
    setBusy(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const result = await sendSignupCode(email.trim())
      setStage('code')
      setCode('')
      setResendIn(result.resend_after_seconds || 30)
      setMessage(result.delivered === false
        ? { tone: 'info', text: 'Email delivery is not set up on this development machine; the code was written to the Partner backend console.' }
        : { tone: 'info', text: `We sent a 6-digit code to ${email.trim()}.` })
    } catch (error) {
      const status = error?.response?.status
      // Send-code never answers 404 itself: a 404 (or a 500) means the request reached the
      // wrong server or failed there, and FastAPI's bare "Not Found" means nothing to a technician.
      setMessage({
        tone: 'error',
        text: status === 404 || status === 500
          ? 'Unable to send verification code. Please try again.'
          : apiErrorMessage(error, 'Unable to send verification code. Please try again.'),
      })
      if (status === 409) setStage('email')
    } finally {
      setBusy(false)
    }
  }

  const verify = async (event) => {
    event.preventDefault()
    if (!accepted) {
      setConsentError(CONSENT_ERROR)
      return
    }
    setBusy(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const session = await verifySignupCode({
        email: email.trim(),
        phone,
        code,
        acceptTerms: true,
        termsVersion: terms.version,
        privacyVersion: privacy.version,
      })
      dispatch(setSession(session))
      navigate(typeSlug ? `/onboarding?type=${typeSlug}` : '/onboarding', { replace: true })
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'That code did not work. Try again.') })
      setBusy(false)
    }
  }

  // Spaces are removed; a change with letters, symbols or more than 10 digits is refused.
  const changePhone = (event) => {
    const next = event.target.value.replace(/\s/g, '')
    if (!/^\d{0,10}$/.test(next)) {
      setMessage({ tone: 'error', text: MOBILE_ERROR })
      return
    }
    setPhone(next)
    setMessage((current) => (current.text === MOBILE_ERROR ? { tone: 'info', text: '' } : current))
  }

  const submitMobile = (event) => {
    event.preventDefault()
    if (!MOBILE_PATTERN.test(phone)) {
      setMessage({ tone: 'error', text: MOBILE_ERROR })
      return
    }
    sendCode()
  }

  const [title, subtitle] = TITLES[stage]

  return (
    <AuthLayout
      dense
      title={title}
      subtitle={subtitle}
      footer={<>Already registered? <Link to="/login" className="font-extrabold text-oc-green hover:underline">Login with an email code</Link></>}
    >
      <OnboardingStepper current={stage} />
      <Alert tone={message.tone}>{message.text}</Alert>

      {stage === 'email' && (
        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); setMessage({ tone: 'info', text: '' }); setStage('mobile') }}>
          <label className="block">
            <span className="field-label">Email</span>
            <input className="field-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button type="submit" className="btn-primary w-full py-3"><Mail className="h-4 w-4" /> Continue</button>
        </form>
      )}

      {stage === 'mobile' && (
        <form className="mt-4 space-y-4" onSubmit={submitMobile}>
          <label className="block">
            <span className="field-label">Mobile number</span>
            <input className="field-input" inputMode="tel" autoComplete="tel" required placeholder="10 digit mobile"
              value={phone} onChange={changePhone} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStage('email')}><ArrowLeft className="h-4 w-4" /> Back</button>
            <button type="submit" className="btn-primary flex-1 py-3" disabled={busy || !MOBILE_PATTERN.test(phone)}>
              {busy ? <Spinner className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />} Send email code
            </button>
          </div>
        </form>
      )}

      {stage === 'code' && (
        <form className="mt-4 space-y-4" onSubmit={verify}>
          <div className="flex items-center gap-2 rounded-xl bg-oc-sunken px-3 py-2 text-xs text-oc-muted">
            <Mail className="h-3.5 w-3.5" /> {email} <Smartphone className="ml-2 h-3.5 w-3.5" /> {phone}
          </div>
          <CodeInput value={code} onChange={setCode} disabled={busy} />
          {/* Verifying the code creates the account, so the agreement is asked for here. */}
          <div>
            <label className="flex items-start gap-2 text-sm text-oc-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-oc-green"
                checked={accepted}
                aria-required="true"
                aria-invalid={consentError ? 'true' : undefined}
                aria-describedby={consentError ? 'accept-terms-error' : undefined}
                onChange={(event) => {
                  setAccepted(event.target.checked)
                  if (event.target.checked) setConsentError('')
                }}
              />
              <span>
                I agree to the{' '}
                <button type="button" className="font-extrabold text-oc-green underline-offset-2 hover:underline"
                  onClick={(event) => { event.preventDefault(); setReading('terms') }}>Terms of Service</button>
                {' '}and{' '}
                <button type="button" className="font-extrabold text-oc-green underline-offset-2 hover:underline"
                  onClick={(event) => { event.preventDefault(); setReading('privacy') }}>Privacy Policy</button>
              </span>
            </label>
            {consentError && <p id="accept-terms-error" role="alert" className="mt-1 text-sm font-bold text-red-700">{consentError}</p>}
          </div>
          <button type="submit" className="btn-primary w-full py-3" disabled={busy || code.length !== 6}>
            {busy ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Verify email
          </button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="inline-flex items-center gap-1 font-bold text-oc-muted hover:text-oc-deep" onClick={() => setStage('mobile')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button type="button" className="font-extrabold text-oc-green disabled:text-oc-muted" disabled={busy || resendIn > 0} onClick={sendCode}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}
      {reading && <LegalDialog doc={LEGAL[reading]} onClose={() => setReading(null)} />}
    </AuthLayout>
  )
}
