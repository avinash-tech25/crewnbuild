import { Suspense, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { onSessionEvent } from '../../shared/api/apiClient.js'
import { logoutUser, setAuthenticatedUser, verifyStoredSession } from '../../shared/auth/authSlice.js'
import FullPageLoader from '../../shared/ui/FullPageLoader.jsx'
import RequireAccess from './guards/RequireAccess.jsx'
import RouteErrorBoundary from './RouteErrorBoundary.jsx'
import { PROTECTED_PATH_PREFIXES, routes } from './routes.jsx'

/**
 * Going to Home ends the session, as it did in the old app, through the same logoutUser
 * the Logout button uses; protected routes then send anyone without a session to /login,
 * so Back cannot reopen a dashboard.
 */
function SignOutOnArrival({ children }) {
  const dispatch = useDispatch()
  const signedIn = useSelector((state) => Boolean(state.auth.user))
  useEffect(() => {
    if (signedIn) dispatch(logoutUser())
  }, [dispatch, signedIn])
  return children
}

/** The session's life in this tab (section 8.1). */
export function useSessionLifecycle() {
  const dispatch = useDispatch()
  const signedIn = useSelector((state) => Boolean(state.auth.user))

  useEffect(() => {
    // Confirm the session with the server before any protected route acts on it.
    dispatch(verifyStoredSession())
  }, [dispatch])

  useEffect(() => {
    // The refresh was refused: the session has ended (revoked, expired, signed out elsewhere).
    const stopEnded = onSessionEvent('ended', () => {
      if (signedIn) dispatch(logoutUser())
    })
    // A background refresh answered with the account: adopt it.
    const stopRefreshed = onSessionEvent('refreshed', (data) => {
      if (data?.user) dispatch(setAuthenticatedUser(data))
    })
    // A page restored from the back/forward cache skips React entirely, so a dashboard left
    // before signing out could reappear on Back. Reloading it lets the guard decide again.
    const reloadRestoredProtectedPage = (event) => {
      if (event.persisted && PROTECTED_PATH_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix))) {
        window.location.reload()
      }
    }
    window.addEventListener('pageshow', reloadRestoredProtectedPage)
    return () => {
      stopEnded()
      stopRefreshed()
      window.removeEventListener('pageshow', reloadRestoredProtectedPage)
    }
  }, [dispatch, signedIn])
}

export function AppRoutes() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        {routes.map(({ path, Component, access, signsOut }) => {
          const screen = <Component />
          return (
            <Route
              key={path}
              path={path}
              element={
                <RouteErrorBoundary>
                  <RequireAccess access={access}>{signsOut ? <SignOutOnArrival>{screen}</SignOutOnArrival> : screen}</RequireAccess>
                </RouteErrorBoundary>
              }
            />
          )
        })}
      </Routes>
    </Suspense>
  )
}

export default function AppRouter() {
  useSessionLifecycle()
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
