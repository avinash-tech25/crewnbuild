import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { loginUser, loginWithPhoneCode, signupUser, verifySession } from '../../features/auth/authApi.js'
import { refreshSession } from '../api/apiClient.js'
import { SIGNED_IN_ROLES } from './roles.js'

/**
 * Who is signed in, as the server last confirmed it (technical-architecture.md 8.1).
 *
 * The session is two HttpOnly cookies this code cannot read, and nothing about it is kept
 * in the browser's storage: every page load asks GET /auth/session before any protected
 * route renders. `sessionStatus` says how far that has got:
 *
 *   verifying    the check is in flight; protected routes show a loader, nothing else
 *   verified     `user` is the account the server returned
 *   anonymous    there is no session
 *   unreachable  the server did not answer at all; the page says so instead of signing out
 */

function apiErrorMessage(error, fallbackMessage) {
  const detail = error.response?.data?.detail
  if (Array.isArray(detail)) return detail[0]?.msg || fallbackMessage
  if (detail && typeof detail === 'object') return detail.message || fallbackMessage
  return detail || fallbackMessage
}

// GET /auth/session; with an expired access cookie, one refresh and a second look. The
// check makes its own refresh (skipRefresh), so a visitor with no session at all is simply
// anonymous: no sign-out round trip.
async function confirmSessionOnLoad() {
  try {
    return await verifySession({ skipRefresh: true })
  } catch (error) {
    if (error.response?.status !== 401) throw error
    await refreshSession()
    return verifySession()
  }
}

// One confirmation per page load: React's StrictMode runs mount effects twice in
// development, and a re-mounted router must not start a second round trip.
let verificationStarted = false

export function resetSessionCheckForTests() {
  verificationStarted = false
}

export const verifyStoredSession = createAsyncThunk(
  'auth/verifyStoredSession',
  async (_, { getState, rejectWithValue }) => {
    try {
      const confirmed = await confirmSessionOnLoad()
      // Signed out (for example by going to Home) while the check was in flight.
      if (getState().auth.sessionStatus !== 'verifying') return rejectWithValue('superseded')
      return confirmed
    } catch (error) {
      // A session the server refused and a server that never answered are different
      // outcomes: the first ends the session, the second must not.
      return rejectWithValue(error.response ? 'refused' : 'unreachable')
    }
  },
  {
    condition: (_, { getState }) => {
      if (verificationStarted || getState().auth.sessionStatus !== 'verifying') return false
      verificationStarted = true
      return true
    },
  },
)

function signInThunk(type, request, refusedMessage) {
  return createAsyncThunk(type, async (details, { rejectWithValue }) => {
    try {
      return await request(details)
    } catch (error) {
      // Only a 4xx is about the details sent. No answer, or a 5xx, is a server fault and
      // must not tell the user their password is wrong.
      if (!error.response) return rejectWithValue('Cannot reach the server. Check your connection and try again.')
      if (error.response.status >= 500) {
        return rejectWithValue(apiErrorMessage(error, 'Sign-in is temporarily unavailable. Please try again shortly.'))
      }
      return rejectWithValue(apiErrorMessage(error, refusedMessage))
    }
  })
}

export const loginWithCredentials = signInThunk(
  'auth/loginWithCredentials',
  loginUser,
  'Unable to login. Please check your credentials.',
)

export const loginWithWhatsApp = signInThunk(
  'auth/loginWithWhatsApp',
  loginWithPhoneCode,
  'That code is not right or has expired. Ask for a new one.',
)

export const signupWithProfile = createAsyncThunk('auth/signupWithProfile', async (profileDetails, { rejectWithValue }) => {
  try {
    return await signupUser(profileDetails)
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'Unable to create account. Please check the form.'))
  }
})

function signedIn(state, user) {
  // An account for a role this application does not serve belongs to another one.
  if (!SIGNED_IN_ROLES.includes(user?.role)) {
    state.user = null
    state.sessionStatus = 'anonymous'
    return
  }
  state.user = user
  state.sessionStatus = 'verified'
  state.errorMessage = ''
}

export const initialAuthState = {
  user: null,
  status: 'idle',
  sessionStatus: 'verifying',
  errorMessage: '',
}

const authSlice = createSlice({
  name: 'auth',
  initialState: initialAuthState,
  reducers: {
    // Every dispatch carries an account the server just returned (OAuth callback,
    // background refresh, profile saves), so it is confirmed.
    setAuthenticatedUser(state, action) {
      signedIn(state, action.payload.user)
    },
    // Drops the last sign-in error (the Login screen switching tabs).
    clearAuthError(state) {
      state.status = 'idle'
      state.errorMessage = ''
    },
    // Ends the session in the store; the store's middleware also ends it on the server and
    // forgets every cached server answer.
    logoutUser(state) {
      state.user = null
      state.sessionStatus = 'anonymous'
      state.errorMessage = ''
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(verifyStoredSession.fulfilled, (state, action) => {
        signedIn(state, action.payload.user)
      })
      .addCase(verifyStoredSession.rejected, (state, action) => {
        if (action.payload === 'superseded') return
        if (action.payload === 'unreachable') {
          state.sessionStatus = 'unreachable'
          return
        }
        state.user = null
        state.sessionStatus = 'anonymous'
      })
    for (const thunk of [loginWithCredentials, loginWithWhatsApp, signupWithProfile]) {
      builder
        .addCase(thunk.pending, (state) => {
          state.status = 'loading'
          state.errorMessage = ''
        })
        .addCase(thunk.fulfilled, (state, action) => {
          state.status = 'succeeded'
          signedIn(state, action.payload.user)
        })
        .addCase(thunk.rejected, (state, action) => {
          state.status = 'failed'
          state.errorMessage = action.payload || action.error.message
        })
    }
  },
})

export const { clearAuthError, logoutUser, setAuthenticatedUser } = authSlice.actions
export default authSlice.reducer
