import { useCallback, useEffect, useRef, useState } from 'react'
import { WS_PING_INTERVAL_MS, WS_RECONNECT_DELAYS_MS } from '../../shared/constants/tracking.js'
import { apiErrorMessage } from '../../shared/api/apiClient.js'
import {
  DISPATCH_SUBPROTOCOL,
  acceptOffer,
  declineOffer,
  dispatchSocketUrl,
  fetchOffers,
  hasTechnicianSession,
} from './dispatchApi.js'
import { startNewJobAlert, stopNewJobAlert } from './notificationSound.js'
import { createJobAlertTracker, isOfferOpen } from './jobAlertTracker.js'
import { showJobNotification } from './jobNotifications.js'

/**
 * Job requests as they arrive, for a technician who is waiting for work.
 *
 *   REST      -> what is already waiting when the dashboard opens, and the
 *                recovery after a reload
 *   websocket -> every new request, pushed, so nothing has to be refreshed
 *
 * The alert rings for as long as any request is still waiting on an answer,
 * and falls silent the moment none is: accepting it, rejecting it and letting
 * it lapse all take the card out of `offers`, and the alert follows the list
 * rather than keeping a clock of its own. So it cannot outlive the request,
 * and it needs no separate stop for each of the ways one can end.
 *
 * A request that was already waiting when the dashboard opened, or that a
 * reconnection recovers, rings too: it is still waiting on an answer, and
 * silencing it was why a technician who opened the dashboard after a booking
 * heard nothing. The alert is a single chime for "something is waiting"
 * (jobAlertTracker), so one request seen in both the API load and the live
 * socket, or again after a reconnect, never rings twice; each request raises at
 * most one hidden-tab notification per session.
 */

// Ignore an offer whose deadline has already passed: the backend will lapse it,
// and showing a card that cannot be accepted only wastes the technician's tap.
const stillOpen = (offer) => isOfferOpen(offer)

export default function useJobOffers({ enabled = true, onAccepted, onJobCancelled } = {}) {
  const [offers, setOffers] = useState([])
  const [connection, setConnection] = useState('idle')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  // Which requests have already alerted in this dashboard session; lives as
  // long as the dashboard does.
  const trackerRef = useRef(null)
  if (!trackerRef.current) trackerRef.current = createJobAlertTracker()
  const onAcceptedRef = useRef(onAccepted)
  useEffect(() => {
    onAcceptedRef.current = onAccepted
  }, [onAccepted])
  const onJobCancelledRef = useRef(onJobCancelled)
  useEffect(() => {
    onJobCancelledRef.current = onJobCancelled
  }, [onJobCancelled])

  const remove = useCallback((bookingId) => {
    setOffers((current) => current.filter((offer) => offer.booking_id !== bookingId))
  }, [])

  /** Add a request. A genuinely new one starts the alert through `alerting`. */
  const receive = useCallback((offer) => {
    if (!stillOpen(offer)) return
    setOffers((current) => {
      if (current.some((existing) => existing.booking_id === offer.booking_id)) return current
      return [...current, offer]
    })
  }, [])

  const reload = useCallback(async () => {
    try {
      const waiting = (await fetchOffers()).filter(stillOpen)
      setOffers(waiting)
      setError('')
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'Job requests could not be loaded.'))
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setConnection('idle')
      setOffers([])
      return undefined
    }

    let cancelled = false
    let socket = null
    let retry = 0
    let reconnectTimer = null
    let pingTimer = null

    reload()

    const connect = () => {
      if (cancelled) return
      if (!hasTechnicianSession()) {
        setConnection('offline')
        return
      }
      setConnection((current) => (current === 'live' ? current : 'connecting'))
      // The session cookie goes with the handshake; nothing secret is in the URL or
      // the subprotocol, which only names the protocol.
      socket = new WebSocket(dispatchSocketUrl(), [DISPATCH_SUBPROTOCOL])

      socket.onopen = () => {
        retry = 0
        setConnection('live')
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }))
        }, WS_PING_INTERVAL_MS)
      }

      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return // a malformed frame is ignored rather than breaking the stream
        }
        if (message.type === 'booking_offer') receive(message)
        // Somebody else took it, it lapsed, or the customer cancelled: the card
        // goes immediately, so nobody sets off to a job that is not theirs.
        else if (message.type === 'booking_taken' || message.type === 'booking_offer_expired') {
          remove(message.booking_id)
        }
        // A job this technician had ACCEPTED was cancelled. Only its id arrives; the
        // dashboard reloads its lists from the API.
        else if (message.type === 'job_cancelled') onJobCancelledRef.current?.(message.booking_id)
      }

      socket.onclose = () => {
        window.clearInterval(pingTimer)
        pingTimer = null
        if (cancelled) return
        setConnection('reconnecting')
        const delay = WS_RECONNECT_DELAYS_MS[Math.min(retry, WS_RECONNECT_DELAYS_MS.length - 1)]
        retry += 1
        // Anything missed while disconnected is picked up by the reload the
        // reconnection triggers, so no request is lost to a dropped socket.
        reconnectTimer = window.setTimeout(() => {
          reload()
          connect()
        }, delay)
      }

      socket.onerror = () => socket?.close()
    }

    connect()

    return () => {
      cancelled = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(pingTimer)
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.close()
      }
    }
  }, [enabled, reload, receive, remove])

  // Expired cards clear themselves, so none lingers after its deadline. This is
  // also what silences the alert on a request nobody answered: the card goes,
  // `alerting` turns false, and the sound stops with it.
  useEffect(() => {
    if (!offers.length) return undefined
    const timer = window.setInterval(() => setOffers((current) => current.filter(stillOpen)), 1000)
    return () => window.clearInterval(timer)
  }, [offers.length])

  // Ring while at least one request is still unanswered. Accept, Reject,
  // taken, cancelled and expiry all remove the card, so all of them stop the
  // sound without any of them having to say so. A request that has not alerted
  // before also raises one system notification if the tab is hidden.
  // Render stays pure (no bookkeeping here); the tracker is updated in the effect.
  const alerting = offers.some((offer) => isOfferOpen(offer))
  useEffect(() => {
    if (alerting) startNewJobAlert()
    else stopNewJobAlert()
  }, [alerting])
  useEffect(() => {
    trackerRef.current.update(offers).newlyAlerted.forEach(showJobNotification)
  }, [offers])

  // Leaving the dashboard, signing out or losing the tab must not leave a sound
  // running with nothing on screen to explain it.
  useEffect(() => stopNewJobAlert, [])

  const answer = useCallback(
    async (bookingId, accept) => {
      setBusyId(bookingId)
      setError('')
      try {
        const outcome = accept ? await acceptOffer(bookingId) : await declineOffer(bookingId)
        remove(bookingId)
        if (accept) await onAcceptedRef.current?.(outcome)
        return outcome
      } catch (requestError) {
        // 409 is the ordinary outcome of losing the race; say so and drop the card.
        if (requestError?.response?.status === 409) remove(bookingId)
        setError(apiErrorMessage(requestError, 'That job request could not be answered.'))
        return null
      } finally {
        setBusyId('')
      }
    },
    [remove],
  )

  return { offers, connection, error, busyId, answer, reload }
}
