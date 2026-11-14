import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Alert, Spinner } from '../../shared/ui/ui.jsx'
import { PARTNER_SESSION, apiErrorMessage, technicianSession } from '../../shared/api/apiClient.js'
import { checkTechnicianSession, logout, setUser } from '../../shared/auth/authSlice.js'
import { fetchCurrentTechnician } from '../../features/technician/technicianApi.js'

/**
 * The route table. Two principals use this app and never mix:
 *
 *   technician  /dashboard, /weather (and /onboarding for a registration session): the
 *               technician session only, confirmed by the server before anything renders
 *   requester   /book-technician/...: the booking session only, started by the
 *               Professional hand-off (features/booking/useRequesterSession.js)
 *
 * A booking session never opens a technician page and a technician session never books.
 * Pages are lazy-loaded, so a requester never downloads the technician's screens.
 */
const LandingPage = lazy(() => import('../../features/site/pages/LandingPage.jsx'))
const NotFoundPage = lazy(() => import('../../features/site/pages/NotFoundPage.jsx'))
const LoginPage = lazy(() => import('../../features/auth/pages/LoginPage.jsx'))
const ForgotPasswordPage = lazy(() => import('../../features/auth/pages/ForgotPasswordPage.jsx'))
const RegisterPage = lazy(() => import('../../features/auth/pages/RegisterPage.jsx'))
const OnboardingPage = lazy(() => import('../../features/onboarding/pages/OnboardingPage.jsx'))
const TechnicianDashboardPage = lazy(() => import('../../features/technician/pages/TechnicianDashboardPage.jsx'))
const WeatherPage = lazy(() => import('../../features/weather/pages/WeatherPage.jsx'))
const BookTechnicianPage = lazy(() => import('../../features/booking/pages/BookTechnicianPage.jsx'))
const ServiceListPage = lazy(() => import('../../features/booking/pages/ServiceListPage.jsx'))
const BookServicePage = lazy(() => import('../../features/booking/pages/BookServicePage.jsx'))
const BookingTrackerPage = lazy(() => import('../../features/booking/pages/BookingTrackerPage.jsx'))

const ACCOUNT_LOAD_FAILED = 'Unable to load your Partner account. Please try again.'

function PageLoader() {
  return (
    <div role="status" aria-label="Loading" className="grid min-h-screen place-items-center bg-oc-paper text-oc-green">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

/**
 * Dashboard routes: a technician session signed in with email + password, confirmed by
 * the backend before anything renders. No session goes to /login (and back here after), a
 * registration session to /onboarding, and a session the backend refuses is ended.
 */
export function RequireTechnician({ children }) {
  const dispatch = useDispatch()
  const location = useLocation()
  const { signedIn, kind, status } = useSelector((state) => state.auth)
  const [check, setCheck] = useState({ status: 'checking', error: '' })
  const partner = signedIn && kind === PARTNER_SESSION

  const verify = useCallback(async () => {
    setCheck({ status: 'checking', error: '' })
    try {
      const current = await fetchCurrentTechnician()
      if (current?.session_type !== PARTNER_SESSION) {
        dispatch(logout())
        return
      }
      const { session_type: _kind, csrf_token: _csrf, ...user } = current
      dispatch(setUser(user))
      setCheck({ status: current.onboarding?.step === 'COMPLETE' ? 'confirmed' : 'onboarding', error: '' })
    } catch (error) {
      const code = error?.response?.status
      if (code === 401) {
        // Refused even after the client tried to renew it: the session is over.
        dispatch(logout())
        return
      }
      setCheck({ status: 'failed', error: code === 403 ? apiErrorMessage(error, ACCOUNT_LOAD_FAILED) : ACCOUNT_LOAD_FAILED })
    }
  }, [dispatch])

  useEffect(() => {
    if (partner) verify()
  }, [partner, verify])

  if (status === 'checking') return <PageLoader />
  if (!signedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (kind !== PARTNER_SESSION || check.status === 'onboarding') return <Navigate to="/onboarding" replace />
  if (check.status === 'failed') {
    return (
      <div className="grid min-h-screen place-items-center bg-oc-paper px-4">
        <div className="w-full max-w-md space-y-4 text-center">
          <Alert tone="error">{check.error}</Alert>
          <button type="button" className="btn-ghost" onClick={verify}><RefreshCw className="h-4 w-4" /> Try again</button>
        </div>
      </div>
    )
  }
  if (check.status !== 'confirmed') return <PageLoader />
  return children
}

/** Sign-in and password reset: a signed-in technician goes to the dashboard instead. */
function GuestOnly({ children }) {
  const { signedIn, kind, status } = useSelector((state) => state.auth)
  if (status === 'checking') return <PageLoader />
  return signedIn && kind === PARTNER_SESSION ? <Navigate to="/dashboard" replace /> : children
}

/** Asks the server for the technician session once on load, and signs out when it ends. */
export function useTechnicianSessionLifecycle() {
  const dispatch = useDispatch()
  const status = useSelector((state) => state.auth.status)

  useEffect(() => {
    if (status === 'checking') dispatch(checkTechnicianSession())
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => technicianSession.onSessionEnded(() => dispatch(logout())),
    [dispatch],
  )
}

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
        {/* A new registration always starts here at the Email step. */}
        <Route path="/register" element={<RegisterPage />} />
        {/* Face, Aadhaar and details for a signed-in account, at the step the server reports. */}
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/onboarding/*" element={<Navigate to="/onboarding" replace />} />
        <Route path="/dashboard" element={<RequireTechnician><TechnicianDashboardPage /></RequireTechnician>} />
        {/* Weather for the current job, a chosen place, or the device's position. */}
        <Route path="/weather" element={<RequireTechnician><WeatherPage /></RequireTechnician>} />
        {/* Booking for Professional House Owners and Site Engineers, opened from their dashboard. */}
        <Route path="/book-technician" element={<BookTechnicianPage />} />
        <Route path="/book-technician/bookings/:bookingId" element={<BookingTrackerPage />} />
        {/* A trade opens its catalog; the booking form sits one level deeper, on the chosen
            service. The form still renders without a service, so an older link works. */}
        <Route path="/book-technician/:typeSlug" element={<ServiceListPage />} />
        <Route path="/book-technician/:typeSlug/:serviceSlug" element={<BookServicePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

export default function AppRouter() {
  useTechnicianSessionLifecycle()
  return <AppRoutes />
}
