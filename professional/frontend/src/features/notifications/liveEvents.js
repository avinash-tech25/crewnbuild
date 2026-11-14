/**
 * The one live "something changed" connection for the signed-in user
 * (/events/ws). Separate from the chat socket, which is untouched.
 *
 * The server sends only {"event": "requests_changed"} -- no request data -- and
 * whoever listens reloads through its existing REST loader, so the REST API
 * stays the only source of truth. Polling, focus and visibility refreshes stay
 * in place: if this socket is down, everything works exactly as before.
 *
 * One socket for the whole app, however many dashboards and panels listen:
 *   retain() / release()   the dashboard shell keeps it open while mounted
 *                          (released with a short grace, so a remount does not
 *                          open a second socket)
 *   subscribe(listener)    called on every hint; returns the unsubscribe
 * Reconnects after an unexpected drop with backoff (1 s doubling to 30 s), and
 * after a reconnect tells listeners once, to catch up on anything missed.
 */
import { websocketUrl } from '../../shared/api/apiClient.js'
import { hasSignedInUser, onSignedOut } from '../../shared/auth/signedInAccount.js'

const PING_MS = 25000
const MAX_BACKOFF_MS = 30000
const RELEASE_GRACE_MS = 1500

const listeners = new Set()
let holders = 0
let socket = null
let pingTimer = null
let retryTimer = null
let releaseTimer = null
let backoff = 1000
let everOpened = false

function emit(eventName) {
  listeners.forEach((listener) => {
    try {
      listener(eventName)
    } catch {
      // one listener failing must not stop the others
    }
  })
}

function clearTimers() {
  window.clearInterval(pingTimer)
  window.clearTimeout(retryTimer)
  pingTimer = null
  retryTimer = null
}

function close() {
  clearTimers()
  const current = socket
  socket = null
  everOpened = false
  backoff = 1000
  if (current) {
    current.onclose = null
    current.onerror = null
    current.onmessage = null
    try { current.close() } catch { /* already closed */ }
  }
}

function scheduleReconnect() {
  if (holders <= 0 || retryTimer) return
  const delay = backoff
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    open()
  }, delay)
}

function open() {
  if (holders <= 0 || socket) return
  // Signed out: nothing to connect as. A later sign-in remounts the shell.
  if (!hasSignedInUser()) return
  let next
  try {
    next = new WebSocket(websocketUrl('/events/ws'))
  } catch {
    scheduleReconnect()
    return
  }
  socket = next
  next.onopen = () => {
    const reconnected = everOpened
    everOpened = true
    backoff = 1000
    window.clearInterval(pingTimer)
    pingTimer = window.setInterval(() => {
      if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify({ event: 'ping' }))
    }, PING_MS)
    // Hints sent while we were disconnected are gone; reload once instead.
    if (reconnected) emit('requests_changed')
  }
  next.onmessage = (message) => {
    let payload
    try {
      payload = JSON.parse(message.data)
    } catch {
      return
    }
    if (payload?.event === 'requests_changed') emit('requests_changed')
  }
  next.onclose = () => {
    if (socket !== next) return
    socket = null
    window.clearInterval(pingTimer)
    pingTimer = null
    scheduleReconnect()
  }
  next.onerror = () => {
    // onclose follows and schedules the retry.
  }
}

export function retainLiveEvents() {
  window.clearTimeout(releaseTimer)
  releaseTimer = null
  holders += 1
  open()
}

export function releaseLiveEvents() {
  holders = Math.max(0, holders - 1)
  if (holders > 0) return
  window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null
    if (holders === 0) close()
  }, RELEASE_GRACE_MS)
}

export function subscribeLiveEvents(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Signed out (by the user, or the session ended): stop at once rather than reconnecting
// with a session that no longer works.
onSignedOut(() => close())
