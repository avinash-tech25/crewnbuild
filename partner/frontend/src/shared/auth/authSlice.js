import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { technicianSession } from '../api/apiClient.js'
import { fetchCurrentTechnician } from '../../features/technician/technicianApi.js'

/**
 * The technician session in this tab. The session itself is HttpOnly cookies this code
 * cannot read; the store holds who is signed in and what the session may do, and nothing
 * of it is written to browser storage. On load the server is asked (checkTechnicianSession).
 *
 *   status   'checking' (asking the server), 'signed-in' or 'signed-out'
 *   kind     'partner' (email + password: the dashboard) or 'onboarding' (registration)
 */
export const initialAuthState = { user: null, signedIn: false, kind: null, status: 'checking' }

const signedInWith = (state, { user, kind }) => {
  state.user = user
  state.signedIn = true
  state.kind = kind
  state.status = 'signed-in'
}

/**
 * On load: GET /auth/me. An expired access cookie is renewed once (POST /auth/refresh)
 * and asked again; anything else means no technician session in this tab.
 */
export const checkTechnicianSession = createAsyncThunk('auth/checkTechnicianSession', async () => {
  try {
    return await fetchCurrentTechnician({ skipRefresh: true })
  } catch (error) {
    if (error?.response?.status !== 401) throw error
  }
  technicianSession.setActive(true)
  try {
    await technicianSession.refresh()
    return await fetchCurrentTechnician({ skipRefresh: true })
  } catch {
    technicianSession.setActive(false)
    return null
  }
})

const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    // A verified sign-up code (registration session), an email + password sign-in or a
    // finished registration starts a session: the account, its kind and its CSRF token.
    setSession(state, action) {
      const { user, session_type: kind, csrf_token: csrfToken } = action.payload
      technicianSession.setCsrf(csrfToken)
      technicianSession.setActive(true)
      signedInWith(state, { user, kind })
    },
    // Onboarding steps, profile edits and availability changes return the updated account.
    // An answer that arrives after sign-out never brings the session back.
    setUser(state, action) {
      if (!state.signedIn) return
      state.user = action.payload
    },
    // Logout discards this tab's session; app/store.js also ends it on the server.
    logout(state) {
      state.user = null
      state.signedIn = false
      state.kind = null
      state.status = 'signed-out'
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkTechnicianSession.fulfilled, (state, action) => {
        const current = action.payload
        if (!current) {
          Object.assign(state, { ...initialAuthState, status: 'signed-out' })
          return
        }
        technicianSession.setActive(true)
        const { session_type: kind, csrf_token: _csrf, ...user } = current
        signedInWith(state, { user, kind })
      })
      .addCase(checkTechnicianSession.rejected, (state) => {
        // The server could not be asked (down, timed out): no session shown, none ended.
        Object.assign(state, { ...initialAuthState, status: 'signed-out' })
      })
  },
})

export const { setSession, setUser, logout } = authSlice.actions
export default authSlice.reducer
