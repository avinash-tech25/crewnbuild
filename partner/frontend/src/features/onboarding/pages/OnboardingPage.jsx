import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react'
import AuthLayout from '../../auth/components/AuthLayout.jsx'
import AadhaarStep from '../components/AadhaarStep.jsx'
import FaceStep from '../components/FaceStep.jsx'
import OnboardingStepper, { TITLES } from '../components/OnboardingStepper.jsx'
import ProfileStep from '../components/ProfileStep.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { technicianTypeBySlug } from '../../../shared/constants/technicianTypes.js'
import { logout, setSession, setUser } from '../../../shared/auth/authSlice.js'
import { PARTNER_SESSION, apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchCurrentTechnician } from '../../technician/technicianApi.js'

const ONBOARDING_STEPS = ['FACE', 'AADHAAR', 'PROFILE']
const ACCOUNT_LOAD_FAILED = 'Unable to load your Partner account. Please try again.'
const SESSION_ENDED = 'Your session has ended. Sign in with your email and password, or register again with the same email to finish your registration.'
const ACCOUNT_READY = 'Your Partner account is ready. Sign in with your email and the password you created.'

/**
 * Registration steps 4-7 for a signed-in account whose email is verified:
 * face -> Aadhaar -> details -> account created.
 *
 * The step shown is always the one the Partner backend reports for THIS session's
 * account (GET /auth/me), never a step remembered by the browser, and the backend
 * refuses any step submitted out of order. A refresh therefore resumes the same
 * registration; a new registration starts on /register instead.
 */
export default function OnboardingPage() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preferredType = technicianTypeBySlug(searchParams.get('type'))?.code || ''
  const { user, signedIn, kind } = useSelector((state) => state.auth)
  const [step, setStep] = useState(null) // null until the server has answered
  const [justCompleted, setJustCompleted] = useState(false)
  const [loadError, setLoadError] = useState('')
  // Whether this page opened with a stored session, so losing it here means "sign in again".
  const [openedSignedIn] = useState(() => signedIn)

  // Every outcome ends the spinner: a step, a redirect, or an error with a retry -- never a
  // step guessed from what the browser remembers.
  const load = useCallback(async () => {
    setLoadError('')
    try {
      const current = await fetchCurrentTechnician()
      if (!current?.onboarding?.step) throw new Error('No onboarding step in the account response')
      dispatch(setUser(current))
      setStep(current.onboarding.step)
    } catch (error) {
      const status = error?.response?.status
      if (status === 401) {
        // Still refused after the API client tried to renew it: this session is over.
        dispatch(logout())
      } else {
        // A 403 carries the account's own reason (e.g. suspended); anything else can be retried.
        setLoadError(status === 403 ? apiErrorMessage(error, ACCOUNT_LOAD_FAILED) : ACCOUNT_LOAD_FAILED)
      }
    }
  }, [dispatch])

  useEffect(() => {
    if (signedIn) load()
  }, [signedIn, load])

  // An email that was never verified (first-release accounts) must sign in with a code first.
  useEffect(() => {
    if (step === 'EMAIL') dispatch(logout())
  }, [step, dispatch])

  // A registration session never opens the dashboard. Once the account exists the session
  // ends here, and the technician signs in with the email and password just created.
  const accountReadyFor = useRef(null)
  const endRegistrationSession = useCallback(() => {
    if (accountReadyFor.current === null) accountReadyFor.current = user?.email || ''
    dispatch(logout())
  }, [dispatch, user])

  useEffect(() => {
    if (signedIn && step === 'COMPLETE' && !justCompleted && kind !== PARTNER_SESSION) endRegistrationSession()
  }, [signedIn, step, justCompleted, kind, endRegistrationSession])

  if (!signedIn) {
    if (accountReadyFor.current !== null) return <Navigate to="/login" replace state={{ email: accountReadyFor.current, notice: ACCOUNT_READY }} />
    if (step === 'EMAIL') return <Navigate to="/login" replace state={{ notice: 'Sign in with a code sent to your email to continue your registration.' }} />
    // The session this page opened with expired or was refused: sign in again.
    if (openedSignedIn) return <Navigate to="/login" replace state={{ notice: SESSION_ENDED }} />
    return <Navigate to="/register" replace />
  }
  if (step === 'COMPLETE' && !justCompleted) return kind === PARTNER_SESSION ? <Navigate to="/dashboard" replace /> : null

  /**
   * A finished step. The last one also creates the account, and the backend
   * returns the dashboard session with it (the same session /auth/login issues),
   * so the technician goes straight to their own dashboard instead of being asked
   * to type the password they set a moment ago. The session arrives as cookies; the
   * answer carries its kind and CSRF token. Without them nothing changes: the
   * registration session stays onboarding-scoped.
   */
  const advance = (response) => {
    const { session_type: sessionType, csrf_token: csrfToken, ...account } = response
    if (csrfToken && sessionType === PARTNER_SESSION) {
      dispatch(setSession({ user: account, session_type: sessionType, csrf_token: csrfToken }))
      navigate('/dashboard', { replace: true })
      return
    }
    dispatch(setUser(account))
    if (account.onboarding.step === 'COMPLETE') setJustCompleted(true)
    setStep(account.onboarding.step)
  }

  const signOut = () => {
    dispatch(logout())
    navigate('/register', { replace: true })
  }

  const shown = ONBOARDING_STEPS.includes(step) || step === 'COMPLETE' ? step : 'FACE'
  const [title, subtitle] = TITLES[shown]

  return (
    <AuthLayout
      title={step ? title : 'Continue your registration'}
      subtitle={step ? subtitle : ''}
      footer={step !== 'COMPLETE' && (
        <>{user?.email ? `Registering as ${user.email}. ` : ''}Not you? <button type="button" onClick={signOut} className="font-extrabold text-oc-green hover:underline">Sign out</button></>
      )}
    >
      {!step && !loadError && <div className="flex justify-center py-16 text-oc-green"><Spinner className="h-8 w-8" /></div>}
      {!step && loadError && (
        <div className="space-y-4 text-center">
          <Alert tone="error">{loadError}</Alert>
          <button type="button" className="btn-ghost" onClick={load}><RefreshCw className="h-4 w-4" /> Try again</button>
        </div>
      )}

      {step && <OnboardingStepper current={shown} />}
      {step === 'FACE' && <FaceStep onDone={advance} />}
      {step === 'AADHAAR' && <AadhaarStep onDone={advance} />}
      {step === 'PROFILE' && <ProfileStep user={user} preferredType={preferredType} onDone={advance} />}

      {step === 'COMPLETE' && (
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-14 w-14 text-oc-green" />
          <p className="text-sm text-oc-muted">
            Face verification: <strong className="text-oc-ink">{user?.onboarding?.face_status === 'VERIFIED' ? 'Verified' : 'Submitted, pending review'}</strong>
            <br />
            Aadhaar: <strong className="text-oc-ink">{user?.onboarding?.aadhaar_masked}</strong> ({user?.onboarding?.aadhaar_status === 'VERIFIED' ? 'verified' : 'pending verification'})
          </p>
          <button type="button" className="btn-primary w-full py-3" onClick={() => (kind === PARTNER_SESSION ? navigate('/dashboard', { replace: true }) : endRegistrationSession())}>
            {kind === PARTNER_SESSION ? 'Go to my dashboard' : 'Sign in to my dashboard'} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </AuthLayout>
  )
}
