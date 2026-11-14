/**
 * The pincode step: Create Account -> Pincode -> Dashboard.
 *
 * Every marketplace account in India without a pincode lands here straight
 * after signup or login (postAuthPath). It is the existing LocationLeadsPrompt,
 * unchanged — six digits, checked against India Post, one post office branch
 * chosen — shown on its own page instead of over a dashboard.
 *
 * Saving stores users.pincode / users.location (PATCH /auth/location) and opens
 * the dashboard -- or, for a paid builder sign-up, the plan checkout, which has no
 * "Later": the server refuses to take payment before the PIN code is verified. "Later" opens the dashboard too (the same prompt asks again in
 * a later session), so an India Post outage can never lock a new account out. Complete
 * Profile is not asked for here: it opens when an action first needs it.
 */
import { useDispatch, useSelector } from 'react-redux'
import { Navigate, useNavigate } from 'react-router-dom'
import LocationLeadsPrompt, { DISMISSED_KEY } from '../../../shared/ui/LocationLeadsPrompt.jsx'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { dashboardPath, needsLocationPincode, postAuthPath, subscriptionCheckoutPending } from '../../../shared/auth/accountPaths.js'

export default function PincodeSetupPage() {
  const { user } = useSelector((state) => state.auth)
  const dispatch = useDispatch()
  const navigate = useNavigate()

  // Nothing to set (already saved, or an account outside India): straight on.
  if (!needsLocationPincode(user)) return <Navigate to={postAuthPath(user)} replace />

  const goToDashboard = (account = user) => navigate(postAuthPath(account), { replace: true })

  const saved = (updatedUser) => {
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    goToDashboard(updatedUser)
  }

  // "Later" here means the same as "Later" on the dashboard prompt: not again
  // this browser session. Straight to the dashboard: postAuthPath would answer
  // this page again, since the account still has no pincode. A paid builder
  // sign-up has no "Later", so this never skips the checkout.
  const later = () => {
    try {
      window.sessionStorage.setItem(`${DISMISSED_KEY}:${user.id}`, '1')
    } catch {
      /* noop */
    }
    navigate(dashboardPath(user), { replace: true })
  }

  return (
    <main className="min-h-screen bg-oc-sunken">
      <LocationLeadsPrompt open currentPincode="" onDismiss={subscriptionCheckoutPending(user) ? undefined : later} onSaved={saved} />
    </main>
  )
}
