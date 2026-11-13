import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { verifySession } from '../authApi.js'
import { postAuthPath } from '../../../shared/auth/accountPaths.js'

export default function OAuthCallback() {
  const dispatch = useDispatch()
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    // The provider callback set the session cookies on the API and redirected
    // here with nothing in the URL; ask the API which account that session is.
    verifySession()
      .then(({ user }) => {
        if (cancelled) return
        dispatch(setAuthenticatedUser({ user }))
        // The same landing decision as login and signup (postAuthPath): the
        // pincode step while the account has none, else the dashboard.
        navigate(postAuthPath(user), { replace: true })
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [dispatch, navigate])

  return (
    <main className="grid min-h-screen place-items-center bg-cream text-center">
      <div className="rounded-2xl border border-forest-100 bg-white p-6 shadow-card">
        <p className="font-display text-lg font-extrabold text-forest-800">Signing you in...</p>
        <p className="mt-1 text-sm text-graphite/60">Please wait while we complete authentication.</p>
      </div>
    </main>
  )
}
