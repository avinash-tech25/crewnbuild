import { Suspense, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { onSessionEvent } from '../../shared/api/apiClient.js'
import { logoutUser, recheckSession, setAuthenticatedUser, verifyStoredSession } from '../../shared/auth/authSlice.js'
import FullPageLoader from '../../shared/ui/FullPageLoader.jsx'
import RequireAccess from './guards/RequireAccess.jsx'
import RouteErrorBoundary from './RouteErrorBoundary.jsx'
import { PROTECTED_PATH_PREFIXES, routes } from './routes.jsx'
import { useScrollMemory } from '../../shared/navigation/scrollMemory.js'

/** The session's life in this tab (section 8.1). */
// A tab coming back into view asks the server again at most this often.
const RECHECK_INTERVAL_MS = 30_000

export function useSessionLifecycle() {
  const dispatch = useDispatch()
  const signedIn = useSelector((state) => Boolean(state.auth.user))
  const lastRecheck = useRef(0)

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
    // The server ends a session after SESSION_IDLE_HOURS without activity or
    // SESSION_MAX_HOURS in total. A tab left open past that must not keep showing the
    // account (avatar, Dashboard, a dashboard page): when it comes back into view, ask the
    // server again, and sign the page out if the session is over.
    const recheck = () => {
      if (!signedIn) return
      dispatch(recheckSession())
        .unwrap()
        .catch((reason) => {
          if (reason === 'refused') dispatch(logoutUser())
        })
    }
    const recheckWhenVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRecheck.current < RECHECK_INTERVAL_MS) return
      lastRecheck.current = Date.now()
      recheck()
    }
    // A page restored from the back/forward cache skips React entirely, so a dashboard left
    // before signing out could reappear on Back. Reloading it lets the guard decide again;
    // any other page re-checks its session.
    const reloadRestoredProtectedPage = (event) => {
      if (!event.persisted) return
      if (PROTECTED_PATH_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix))) {
        window.location.reload()
        return
      }
      recheck()
    }
    window.addEventListener('pageshow', reloadRestoredProtectedPage)
    document.addEventListener('visibilitychange', recheckWhenVisible)
    return () => {
      stopEnded()
      stopRefreshed()
      window.removeEventListener('pageshow', reloadRestoredProtectedPage)
      document.removeEventListener('visibilitychange', recheckWhenVisible)
    }
  }, [dispatch, signedIn])
}

export function AppRoutes() {
  // Each page's scroll position, for the Back buttons that return to it (legal pages).
  useScrollMemory()
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        {routes.map(({ path, Component, access }) => {
          const screen = <Component />
          return (
            <Route
              key={path}
              path={path}
              element={
                <RouteErrorBoundary>
                  <RequireAccess access={access}>{screen}</RequireAccess>
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
