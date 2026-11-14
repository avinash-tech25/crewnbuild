import axios from 'axios'

/**
 * The HTTP clients of the Partner web app. There are two principals, and they never mix:
 *
 *   technician  a Partner technician (email + password, or the registration session)
 *   requester   a Professional House Owner or Site Engineer, signed in by the hand-off
 *               from the Professional app (postMessage, exchanged once)
 *
 * Each has its own client. Both sessions live in HttpOnly cookies the Partner backend sets;
 * this code can neither read nor store a token. The rules, for each client:
 *
 *   - base URL VITE_API_BASE_URL (in development a local backend is reached through the
 *     dev server's same-origin proxy, /partner-api);
 *   - every request carries the cookies; every write carries X-CSRF-Token, the token the
 *     server returned with the last sign-in, refresh or session check, held in memory only;
 *   - a 401 triggers one shared refresh for that principal, then each request is retried
 *     once; if the refresh is refused the session has ended (onSessionEnded).
 *
 * Nothing about either session is kept in browser storage: after a reload the server is
 * asked (GET /auth/me, GET /requester/session).
 */

const DEV_API_PROXY_PATH = '/partner-api'
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

function isLoopbackUrl(url) {
  try {
    return LOOPBACK_HOSTS.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

function resolveApiBaseUrl() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8200/api/v1').replace(/\/+$/, '')
  // In development a local backend is always reached through the dev server's proxy:
  // same origin, no CORS, and never an https page calling plain http.
  return import.meta.env.DEV && !import.meta.env.VITEST && isLoopbackUrl(configured) ? `${DEV_API_PROXY_PATH}/api/v1` : configured
}

export const API_BASE_URL = resolveApiBaseUrl()

// Checking or renewing a session must end one way or the other.
export const SESSION_CHECK_TIMEOUT_MS = 15000

// What a technician session may do, as the backend issued it: 'partner' after email +
// password sign-in (the dashboard), 'onboarding' for the registration session.
export const PARTNER_SESSION = 'partner'
export const ONBOARDING_SESSION = 'onboarding'

const SAFE_METHODS = ['get', 'head', 'options']

function isCsrfRefusal(error) {
  return error?.response?.status === 403 && error.response.data?.detail?.code === 'CSRF_FAILED'
}

/**
 * One principal's client: its CSRF token, its session flag (memory only), its shared
 * refresh and its retry rules.
 */
function createSessionClient({ refreshPath, sessionPath, noRefreshPaths }) {
  const client = axios.create({ baseURL: API_BASE_URL, withCredentials: true })
  let csrfToken = ''
  // Whether this tab holds this principal's session, as the server last said. A refresh is
  // only attempted for a session that exists, and an answer that arrives after sign-out
  // never brings it back.
  let active = false
  const endedListeners = new Set()
  let refreshInFlight = null
  let csrfRecovery = null

  const setCsrf = (token) => {
    csrfToken = token || ''
  }

  function refresh() {
    if (refreshInFlight) return refreshInFlight
    // A bare axios call: a failing refresh never passes back through the interceptor.
    refreshInFlight = axios
      .post(`${API_BASE_URL}${refreshPath}`, null, { withCredentials: true, timeout: SESSION_CHECK_TIMEOUT_MS })
      .then((response) => {
        if (!active) throw Object.assign(new Error('signed out'), { signedOut: true })
        setCsrf(response.data?.csrf_token)
        return response.data
      })
      .catch((error) => {
        // Another tab rotated the same refresh cookie a moment ago; the browser already
        // holds the newer cookies, so the original request can simply be retried.
        if (error?.response?.data?.detail === 'REFRESH_SUPERSEDED') return { superseded: true }
        throw error
      })
      .finally(() => {
        refreshInFlight = null
      })
    return refreshInFlight
  }

  function recoverCsrf() {
    if (!csrfRecovery) {
      csrfRecovery = axios
        .get(`${API_BASE_URL}${sessionPath}`, { withCredentials: true, timeout: SESSION_CHECK_TIMEOUT_MS })
        .then((response) => setCsrf(response.data?.csrf_token))
        .finally(() => {
          csrfRecovery = null
        })
    }
    return csrfRecovery
  }

  function end() {
    active = false
    setCsrf('')
    endedListeners.forEach((listener) => listener())
  }

  client.interceptors.request.use((config) => {
    if (csrfToken && !SAFE_METHODS.includes(String(config.method || 'get').toLowerCase())) {
      config.headers['X-CSRF-Token'] = csrfToken
    }
    return config
  })

  client.interceptors.response.use(
    (response) => {
      if (typeof response.data?.csrf_token === 'string' && response.data.csrf_token) setCsrf(response.data.csrf_token)
      return response
    },
    async (error) => {
      const request = error.config
      const status = error.response?.status
      const path = String(request?.url || '')

      if (isCsrfRefusal(error) && request && !request.retriedForCsrf) {
        request.retriedForCsrf = true
        try {
          await recoverCsrf()
          request.headers = { ...request.headers, 'X-CSRF-Token': csrfToken }
          return client(request)
        } catch {
          return Promise.reject(error)
        }
      }

      const mayRefresh = active && !request?.skipRefresh && !noRefreshPaths.some((prefix) => path.startsWith(prefix))
      if (status === 401 && request && !request.retriedAfterRefresh && mayRefresh) {
        request.retriedAfterRefresh = true
        try {
          await refresh()
        } catch (refreshError) {
          // Only a refused refresh ends the session. A backend that is down or slow is a
          // failure the page can retry, not a reason to sign out.
          if (refreshError?.signedOut || [401, 403].includes(refreshError?.response?.status)) end()
          return Promise.reject(error)
        }
        request.headers = { ...request.headers, 'X-CSRF-Token': csrfToken }
        return client(request)
      }
      return Promise.reject(error)
    },
  )

  return {
    client,
    setCsrf,
    currentCsrf: () => csrfToken,
    csrfHeaders: () => (csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    refresh,
    /** The server has confirmed (true) or ended (false) this principal's session. */
    setActive(value) {
      active = Boolean(value)
      if (!active) setCsrf('')
    },
    isActive: () => active,
    /** Called when a refused refresh ends the session. */
    onSessionEnded(listener) {
      endedListeners.add(listener)
      return () => endedListeners.delete(listener)
    },
  }
}

// ------------------------------------------------------------ technician

export const technicianSession = createSessionClient({
  refreshPath: '/auth/refresh',
  sessionPath: '/auth/me',
  // Sign-in, sign-up, reset and refresh answer with a 401 themselves.
  noRefreshPaths: ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout', '/auth/password-reset'],
})
export const apiClient = technicianSession.client

/** Ends the technician session on the server, which revokes it and clears its cookies. */
export function endTechnicianSession() {
  const headers = technicianSession.csrfHeaders()
  technicianSession.setActive(false)
  return fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include', keepalive: true, headers }).catch(() => undefined)
}

// ------------------------------------------------------------ requester (Professional House Owner / Site Engineer)

export const requesterSession = createSessionClient({
  refreshPath: '/requester/refresh',
  sessionPath: '/requester/session',
  noRefreshPaths: ['/requester/session', '/requester/refresh', '/requester/logout'],
})
export const bookingClient = requesterSession.client

// The booking session in this tab, as the server last described it: { requester, expiresAt }.
// Memory only; a reload asks the server (GET /requester/session).
let requesterState = null

export function storeRequesterSession(response) {
  requesterSession.setCsrf(response.csrf_token)
  requesterSession.setActive(true)
  requesterState = {
    // A minute early, so a request never leaves with a session about to lapse.
    expiresAt: Date.now() + Math.max((response.expires_in_seconds || 0) - 60, 30) * 1000,
    requester: response.requester,
  }
  return requesterState
}

export function readRequesterSession() {
  if (!requesterState || Date.now() >= requesterState.expiresAt) return null
  return requesterState
}

export function clearRequesterSession() {
  requesterState = null
  requesterSession.setActive(false)
}

requesterSession.onSessionEnded(() => {
  requesterState = null
})

// ------------------------------------------------------------ errors and addresses

// Dispatch and location refusals carry a stable code beside their message
// ({"detail": {"code", "message"}}). The server's message is already written for people and
// is shown as it is; these cover codes that arrive without one and the ones raised in the
// browser itself (no location permission).
export const ERROR_MESSAGES = {
  NO_TECHNICIAN_AVAILABLE: 'No technician is available nearby right now. Please try again in a few minutes.',
  LOCATION_PERMISSION_REQUIRED: 'Allow location access for this site to receive nearby jobs.',
  LOCATION_STALE: 'Your location is out of date. Keep the app open with location turned on.',
  REQUEST_ALREADY_ASSIGNED: 'This job has already been accepted by another technician.',
  REQUEST_CANCELLED: 'The customer cancelled this request.',
  OFFER_EXPIRED: 'This job request expired before you answered.',
  INVALID_SERVICE: 'That service is not available. Please choose another.',
}

/** The stable code of a refused request, or null. */
export function apiErrorCode(error) {
  const detail = error?.response?.data?.detail
  return detail && typeof detail === 'object' && !Array.isArray(detail) ? detail.code ?? null : null
}

export function apiErrorMessage(error, fallbackMessage) {
  const detail = error?.response?.data?.detail
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && !detail.message && ERROR_MESSAGES[detail.code]) {
    return ERROR_MESSAGES[detail.code]
  }
  if (Array.isArray(detail)) return detail[0]?.msg || fallbackMessage
  if (typeof detail === 'string') return detail
  if (detail && typeof detail.message === 'string') return detail.message
  // No answer at all: the backend is down, the address is wrong, or CORS refused it.
  if (!error?.response) return `Partner could not be reached at ${API_BASE_URL}. Check that the Partner backend is running and try again.`
  return fallbackMessage
}

export function assetUrl(path) {
  if (!path) return ''
  if (/^(https?:|blob:|data:)/.test(path)) return path
  return `${API_BASE_URL}${path}`
}

/** A websocket address on the same origin as the API (ws:// from http, wss:// from https). */
export function websocketUrl(path) {
  const base = /^https?:/i.test(API_BASE_URL) ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`
  return `${base.replace(/^http/i, 'ws')}${path}`
}
