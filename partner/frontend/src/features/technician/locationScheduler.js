/**
 * When a technician's position may be sent. Pure: no timers, no network, no React,
 * so every rule here is unit-tested (locationScheduler.test.js).
 *
 *   watchPosition fires   ->  offer(fix)     keeps only the newest fix
 *   the pump ticks (1 s)  ->  next()         returns a fix to send now, or null
 *   request leaves        ->  sending(fix)   at most ONE request in flight
 *   request answers       ->  settled(ok)
 *
 * The rules, so the server sees ~one fix per interval and never a burst:
 *   - nothing is sent while a request is in flight;
 *   - at most one send per `intervalMs` (LOCATION_UPDATE_INTERVAL_SECONDS, from the server);
 *   - a fix is sent once. The same device timestamp is only re-sent as a
 *     HEARTBEAT, after `heartbeatMs` of no newer fix (a phone standing still
 *     stops reporting), so the server keeps the position fresh. A heartbeat is
 *     never sent for a fix older than `maxFixAgeMs`: an old position is not
 *     re-announced as current;
 *   - a fix that is older than one already offered is ignored (a late quick fix
 *     must not replace a newer watch fix).
 */

export function createLocationScheduler({ intervalMs, heartbeatMs, maxFixAgeMs, now = () => Date.now() }) {
  let latest = null // newest fix offered
  let sentTimestamp = null // device timestamp of the last fix that went out
  let lastSentAt = 0 // when (local clock) the last request left
  let inFlight = false
  let interval = intervalMs

  return {
    offer(fix) {
      if (!fix || !Number.isFinite(fix.timestamp)) return false
      if (latest && fix.timestamp < latest.timestamp) return false
      latest = { ...fix, receivedAt: now() }
      return true
    },

    next() {
      if (inFlight || !latest) return null
      const current = now()
      if (current - lastSentAt < interval) return null
      const isNew = sentTimestamp === null || latest.timestamp > sentTimestamp
      if (isNew) return latest
      const heartbeatDue = current - lastSentAt >= heartbeatMs
      const fresh = current - latest.receivedAt <= maxFixAgeMs
      return heartbeatDue && fresh ? latest : null
    },

    sending(fix) {
      inFlight = true
      lastSentAt = now()
      sentTimestamp = fix.timestamp
    },

    settled() {
      inFlight = false
    },

    /** The server's cadence wins over the built-in default. */
    setInterval(ms) {
      if (Number.isFinite(ms) && ms >= 1000) interval = ms
    },

    /** Allow an immediate send (the page became visible again). */
    nudge() {
      lastSentAt = 0
    },

    reset() {
      latest = null
      sentTimestamp = null
      lastSentAt = 0
      inFlight = false
    },

    get inFlight() {
      return inFlight
    },
  }
}
