import axios from 'axios'

/**
 * The one HTTP client of the app (technical-architecture.md 4.4, 6.2, 8.1).
 *
 * Every request goes through here, most of them through RTK Query's base query
 * (baseApi.js). The rules:
 *
 *   - base URL VITE_API_BASE_URL (http://localhost:8000/api/v1 in development);
 *   - the session is two HttpOnly cookies the page can neither read nor store, so
 *     every request is sent with credentials and no token is kept anywhere;
 *   - every write carries X-CSRF-Token, the token the server returned with the last
 *     sign-in, refresh or GET /auth/session, held in memory only;
 *   - a 401 triggers one shared refresh (many requests failing together wait for the
 *     same POST /auth/refresh), then each is retried once; if the refresh is refused
 *     the session has ended and the app signs out (onSessionEnded).
 */

export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').replace(/\/+$/, '')

export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true })

// ---- the CSRF token: memory only ----

let csrfToken = ''

export function setCsrfToken(token) {
  csrfToken = token || ''
}

export function currentCsrfToken() {
  return csrfToken
}

// Headers for a request made outside this client (fetch with keepalive).
export function csrfHeaders() {
  return csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
}

// ---- what the app is told about the session ----

const sessionListeners = { ended: new Set(), refreshed: new Set() }

/** Subscribe to `ended` (the refresh was refused) or `refreshed` (new cookies, with the account). */
export function onSessionEvent(name, listener) {
  sessionListeners[name].add(listener)
  return () => sessionListeners[name].delete(listener)
}

function emit(name, detail) {
  sessionListeners[name].forEach((listener) => listener(detail))
}

const SAFE_METHODS = ['get', 'head', 'options']

apiClient.interceptors.request.use((config) => {
  if (csrfToken && !SAFE_METHODS.includes(String(config.method || 'get').toLowerCase())) {
    config.headers['X-CSRF-Token'] = csrfToken
  }
  return config
})

// Requests that must never trigger a refresh of their own. A request can also opt out with
// `skipRefresh` (the start-up session check refreshes by itself: authSlice).
const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login', '/auth/signup', '/auth/logout', '/auth/phone/login/verify-code']

// One refresh at a time: ten requests failing together produce one POST /auth/refresh.
let refreshInFlight = null

export function refreshSession() {
  if (refreshInFlight) return refreshInFlight
  // A bare axios call, so a failing refresh never passes back through the
  // interceptor below and tries to refresh itself.
  refreshInFlight = axios
    .post(`${API_BASE_URL}/auth/refresh`, null, { withCredentials: true })
    .then((response) => {
      setCsrfToken(response.data?.csrf_token)
      emit('refreshed', response.data)
      return response.data
    })
    .catch((error) => {
      // Another tab rotated the same refresh cookie a moment ago; the browser already
      // holds the newer cookies, so the original request can simply be retried.
      if (error.response?.data?.detail === 'REFRESH_SUPERSEDED') return { superseded: true }
      throw error
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

// After a page reload the CSRF token is gone from memory: fetched again once.
let csrfRecovery = null

function recoverCsrfToken() {
  if (!csrfRecovery) {
    csrfRecovery = axios
      .get(`${API_BASE_URL}/auth/session`, { withCredentials: true })
      .then((response) => setCsrfToken(response.data?.csrf_token))
      .finally(() => {
        csrfRecovery = null
      })
  }
  return csrfRecovery
}

apiClient.interceptors.response.use(
  (response) => {
    // Every sign-in, sign-up, refresh and session answer names this session's CSRF token.
    if (typeof response.data?.csrf_token === 'string') setCsrfToken(response.data.csrf_token)
    return response
  },
  async (error) => {
    const request = error.config
    const status = error.response?.status
    const path = String(request?.url || '')

    // A write refused for a missing CSRF token (the page was reloaded): recover it once, replay.
    if (status === 403 && error.response?.data?.detail?.code === 'CSRF_FAILED' && request && !request.retriedForCsrf) {
      request.retriedForCsrf = true
      try {
        await recoverCsrfToken()
        request.headers = { ...request.headers, ...csrfHeaders() }
        return apiClient(request)
      } catch {
        return Promise.reject(error)
      }
    }

    // A 401: the access cookie is no longer accepted. Refresh once (shared) and retry once;
    // the session ends only when the refresh itself is refused.
    const mayRefresh = !request?.skipRefresh && !NO_REFRESH_PATHS.some((p) => path.includes(p))
    if (status === 401 && request && !request.retriedAfterRefresh && mayRefresh) {
      request.retriedAfterRefresh = true
      try {
        await refreshSession()
      } catch {
        setCsrfToken('')
        emit('ended')
        return Promise.reject(error)
      }
      request.headers = { ...request.headers, ...csrfHeaders() }
      return apiClient(request)
    }
    return Promise.reject(error)
  },
)

/** Ends the session on the server, which revokes it and clears its cookies. Safe without one. */
export function endServerSession() {
  const headers = csrfHeaders()
  setCsrfToken('')
  return fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers,
  }).catch(() => undefined)
}

/**
 * The address of a stored file (/files/<uuid>) or an image already absolute. Files are
 * served to the signed-in account: the browser sends the session cookie with the image
 * request itself, so no token ever goes in a URL.
 */
export function imageUrl(path) {
  if (!path) return ''
  if (path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:')) return path
  return `${API_BASE_URL}${path}`
}

export function websocketUrl(path) {
  return `${API_BASE_URL.replace(/^http/, 'ws')}${path}`
}
