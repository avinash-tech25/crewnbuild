import { configureStore } from '@reduxjs/toolkit'
import { endTechnicianSession } from '../shared/api/apiClient.js'
import { baseApi } from '../shared/api/baseApi.js'
import { bindApiDispatch } from '../shared/api/callEndpoint.js'
import authReducer, { logout } from '../shared/auth/authSlice.js'

// Every way a technician signs out dispatches logout. The session lives in HttpOnly
// cookies, so it also ends on the server (which revokes it and clears them), and every
// cached server answer is forgotten so nothing of this account is shown to the next one.
const endSessionEverywhere = (store) => (next) => (action) => {
  const result = next(action)
  if (logout.match(action)) {
    endTechnicianSession()
    store.dispatch(baseApi.util.resetApiState())
  }
  return result
}

export function createAppStore(preloadedState) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // Uploads (FormData, a progress callback) travel as endpoint arguments; RTK Query
        // keeps them only for the request's lifetime.
        serializableCheck: { ignoredActionPaths: ['meta.arg', 'meta.baseQueryMeta'], ignoredPaths: [baseApi.reducerPath] },
      }).concat(baseApi.middleware, endSessionEverywhere),
  })
  bindApiDispatch(store.dispatch)
  return store
}

export const store = createAppStore()
