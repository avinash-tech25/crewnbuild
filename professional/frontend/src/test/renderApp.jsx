import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AppProviders from '../app/AppProviders.jsx'
import { AppRoutes, useSessionLifecycle } from '../app/router/AppRouter.jsx'
import { createAppStore } from '../app/store.js'
import { initialAuthState } from '../shared/auth/authSlice.js'

export const location = { current: null }

function LocationProbe() {
  location.current = useLocation()
  return null
}

function AppWithSession() {
  useSessionLifecycle()
  return <AppRoutes />
}

/**
 * The whole route table at `path`. `session`: 'live' runs the real start-up check against
 * the fake server; otherwise the store starts with this auth state ({ user } signed in,
 * {} signed out).
 */
export function renderApp(path, { auth, session } = {}) {
  const preloaded = session === 'live' ? undefined : { auth: { ...initialAuthState, ...auth } }
  const store = createAppStore(preloaded)
  const view = render(
    <AppProviders store={store}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        {session === 'live' ? <AppWithSession /> : <AppRoutes />}
      </MemoryRouter>
    </AppProviders>,
  )
  return { store, ...view }
}

export const signedInAs = (user) => ({ user, sessionStatus: 'verified' })
export const signedOut = { user: null, sessionStatus: 'anonymous' }
