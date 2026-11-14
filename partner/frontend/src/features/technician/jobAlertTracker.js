/**
 * Which job requests should make the technician's dashboard ring, and which are
 * new this session. No imports and no browser objects: unit-tested under Node.
 *
 * Two separate answers, on purpose:
 *
 *   ring        whether ANY valid request is still waiting. The alert is one
 *               repeating chime for "something is waiting", not one chime per
 *               request, so two requests never ring twice as hard and a request
 *               seen twice (first in the API load, then on the live socket, or
 *               again after a reconnect) cannot start a second alarm.
 *   newlyAlerted the requests that have not alerted before in this session.
 *               Each booking id appears here at most once, however many times
 *               it is loaded, pushed or recovered. A hidden-tab system
 *               notification is raised only for these.
 *
 * Requests that were already waiting when the dashboard opened, or that a
 * reconnection recovers, count: they are still waiting on an answer. Accepted,
 * rejected, taken, cancelled and expired requests are not in the list the
 * caller passes, and an expired one still in it is ignored here.
 */

/** True while an offer can still be answered. An offer with no readable deadline is treated as open. */
export function isOfferOpen(offer, now = Date.now()) {
  if (!offer || !offer.booking_id) return false
  const raw = offer.expires_at
  if (raw === null || raw === undefined || raw === '') return true
  const text = String(raw)
  const expiry = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`)
  return !Number.isFinite(expiry) || expiry > now
}

export function createJobAlertTracker() {
  const alerted = new Set()
  return {
    /** offers: the requests currently on screen. */
    update(offers = [], now = Date.now()) {
      const open = offers.filter((offer) => isOfferOpen(offer, now))
      const newlyAlerted = []
      for (const offer of open) {
        if (alerted.has(offer.booking_id)) continue
        alerted.add(offer.booking_id)
        newlyAlerted.push(offer)
      }
      return { ring: open.length > 0, newlyAlerted }
    },
    /** Whether this booking has already alerted in this session. */
    hasAlerted(bookingId) {
      return alerted.has(bookingId)
    },
  }
}
