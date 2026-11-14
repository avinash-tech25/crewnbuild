import { render } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes, useTechnicianSessionLifecycle } from '../app/router/AppRouter.jsx'
import { createAppStore } from '../app/store.js'
import { technicianSession } from '../shared/api/apiClient.js'
import { initialAuthState } from '../shared/auth/authSlice.js'

export const location = { current: null }

function LocationProbe() {
  location.current = useLocation()
  return null
}

function AppWithSession() {
  useTechnicianSessionLifecycle()
  return <AppRoutes />
}

/**
 * The whole route table at `path`. `session: 'live'` runs the real start-up check against
 * the fake server; otherwise the store starts with this technician auth state.
 */
export function renderApp(path, { auth, session } = {}) {
  const preloaded = session === 'live' ? undefined : { auth: { ...initialAuthState, status: 'signed-out', ...auth } }
  if (preloaded?.auth.signedIn) technicianSession.setActive(true)
  const store = createAppStore(preloaded)
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        {session === 'live' ? <AppWithSession /> : <AppRoutes />}
      </MemoryRouter>
    </Provider>,
  )
  return { store, ...view }
}

export const technicianSignedIn = (user, kind = 'partner') => ({ user, signedIn: true, kind, status: 'signed-in' })
export const signedOut = { user: null, signedIn: false, kind: null, status: 'signed-out' }
