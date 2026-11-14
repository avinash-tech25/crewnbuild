import { configureStore } from '@reduxjs/toolkit'
import cartReducer from '../features/shop/cartSlice.js'
import catalogReducer from '../features/catalog/catalogSlice.js'
import supplierCatalogReducer from '../features/catalog/supplierCatalogSlice.js'
import { forgetSavedFeedback } from '../features/support/feedbackStorage.js'
import { baseApi } from '../shared/api/baseApi.js'
import { endServerSession } from '../shared/api/apiClient.js'
import { bindApiDispatch } from '../shared/api/callEndpoint.js'
import authReducer, { logoutUser } from '../shared/auth/authSlice.js'
import { noteSignedIn } from '../shared/auth/signedInAccount.js'

// Every way of signing out (Logout buttons, Home, the Login screen, an expired session)
// dispatches logoutUser. The session lives in HttpOnly cookies, so it also ends on the
// server (which revokes it and clears them), and every cached server answer is forgotten
// so nothing of this account is shown to the next one (section 8.1, step 5). Feedback
// contact details kept in the browser are forgotten too.
const endSessionEverywhere = (store) => (next) => (action) => {
  const result = next(action)
  if (logoutUser.match(action)) {
    endServerSession()
    forgetSavedFeedback()
    store.dispatch(baseApi.util.resetApiState())
  }
  return result
}

export function createAppStore(preloadedState) {
  const store = configureStore({
    reducer: {
      auth: authReducer,
      cart: cartReducer,
      catalog: catalogReducer,
      supplierCatalog: supplierCatalogReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // Uploads (FormData) travel as endpoint arguments; RTK Query keeps them only for
        // the request's lifetime.
        serializableCheck: { ignoredActionPaths: ['meta.arg', 'meta.baseQueryMeta'], ignoredPaths: [baseApi.reducerPath] },
      }).concat(baseApi.middleware, endSessionEverywhere),
  })
  bindApiDispatch(store.dispatch)
  // For the live sockets, which run outside React.
  noteSignedIn(store.getState().auth.user)
  store.subscribe(() => noteSignedIn(store.getState().auth.user))
  return store
}

export const store = createAppStore()
