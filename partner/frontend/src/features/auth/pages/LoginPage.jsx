import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { setSession } from '../../../shared/auth/authSlice.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { loginWithPassword } from '../../technician/technicianApi.js'

const INVALID_CREDENTIALS = 'Invalid email or password.'

/**
 * Technician sign-in: email + password, checked by the Partner backend. It is the only way
 * to a dashboard session; the email one-time code belongs to registration.
 */
export default function LoginPage() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  // e.g. filled in after registration, which ends with "your account is ready".
  const [email, setEmail] = useState(location.state?.email || '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ tone: 'info', text: location.state?.notice || '' })

  const signIn = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage({ tone: 'info', text: '' })
    try {
      const session = await loginWithPassword({ email: email.trim(), password })
      dispatch(setSession(session))
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setPassword('')
      setMessage({
        tone: 'error',
        text: error?.response?.status === 401 ? INVALID_CREDENTIALS : apiErrorMessage(error, 'Unable to sign in right now. Please try again.'),
      })
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      dense
      title="Technician login"
      subtitle="Sign in with your email and password."
      footer={<>New to Partner, or registration not finished? <Link to="/register" className="font-extrabold text-oc-green hover:underline">Register as a technician</Link></>}
    >
      <Alert tone={message.tone}>{message.text}</Alert>
      <form onSubmit={signIn} className="mt-4 space-y-3.5">
        <label className="block">
          <span className="field-label">Email</span>
          <input className="field-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block">
          <span className="field-label">Password</span>
          <input className="field-input" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <p className="-mt-1 text-right text-sm">
          <Link to="/forgot-password" className="font-bold text-oc-green hover:underline" data-testid="forgot-password-link">Forgot password?</Link>
        </p>
        <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} Sign in
        </button>
      </form>
    </AuthLayout>
  )
}
