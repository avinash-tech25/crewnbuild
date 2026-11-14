import { useCallback, useEffect, useRef, useState } from 'react'
import { TRACKING_SUBPROTOCOL, WS_PING_INTERVAL_MS, WS_RECONNECT_DELAYS_MS } from '../../shared/constants/tracking.js'
import { apiErrorMessage } from '../../shared/api/apiClient.js'
import { fetchTracking, hasRequesterSession, trackingSocketUrl } from './trackingApi.js'

/**
 * Live tracking for the House Owner / Site Engineer watching one booking.
 *
 *   REST snapshot  ->  first paint, and everything back after a page refresh:
 *                      the technician's last position, the route, the distance
 *                      and the ETA are all there before any new fix arrives.
 *   websocket      ->  every position and route change after that, pushed.
 *
 * So the page never polls for a position and never needs reloading. A dropped
 * socket is retried on a backoff that tops out, never in a tight loop, and the
 * connection state is returned for the badge.
 *
 * `enabled` is false until the booking is one tracking is open for, so nothing
 * connects while a booking is still searching or already finished.
 */
export default function useBookingTracking(bookingId, { enabled = true } = {}) {
  const [tracking, setTracking] = useState(null)
  const [connection, setConnection] = useState('idle')
  const [error, setError] = useState('')
  // Bumped to ask for a fresh snapshot and a fresh socket (used after the
  // requester places their pin, and by the page's Try again).
  const [attempt, setAttempt] = useState(0)

  const trackingRef = useRef(null)
  trackingRef.current = tracking

  const refresh = useCallback(() => setAttempt((value) => value + 1), [])

  /** Merge one websocket frame into what the page is showing. */
  const applyMessage = useCallback((message) => {
    switch (message.type) {
      case 'tracking_snapshot':
        setTracking(message.tracking)
        setError('')
        break

      case 'technician_location':
        // Position frames deliberately leave the route out to stay small, so they
        // are merged into what is already on screen rather than replacing it.
        setTracking((current) =>
          current === null
            ? current
            : {
                ...current,
                status: message.status ?? current.status,
                status_label: message.status_label ?? current.status_label,
                distance_remaining_meters: message.distance_remaining_meters,
                eta_seconds: message.eta_seconds,
                position: {
                  latitude: message.latitude,
                  longitude: message.longitude,
                  accuracy: message.accuracy,
                  heading: message.heading,
                  speed: message.speed,
                  updated_at: message.updated_at,
                  // When this browser received it: how fresh the position looks
                  // must not depend on the server's clock agreeing with this one.
                  received_at: Date.now(),
                },
              },
        )
        break

      case 'route_updated':
        setTracking((current) => (current === null ? current : { ...current, route: message.route }))
        break

      case 'tracking_stopped':
        setTracking((current) =>
          current === null ? current : { ...current, status: message.status ?? current.status, is_live: false },
        )
        break

      case 'booking_status':
        setTracking((current) =>
          current === null
            ? current
            : { ...current, status: message.status ?? current.status, status_label: message.status_label ?? current.status_label },
        )
        break

      case 'resync':
        // A message too large to relay between server processes (a long road
        // route) arrives as this; the full snapshot is fetched instead.
        setAttempt((value) => value + 1)
        break

      case 'error':
        setError(message.message || 'Live tracking is unavailable right now.')
        break

      default:
        break
    }
  }, [])

  useEffect(() => {
    if (!bookingId || !enabled) {
      setConnection('idle')
      return undefined
    }

    // Scoped to this effect run: React's double mount in development can never
    // leave an orphaned socket reconnecting in the background.
    let cancelled = false
    let socket = null
    let retry = 0
    let reconnectTimer = null
    let pingTimer = null

    setConnection('connecting')

    // The snapshot first, so the map is already drawn when the socket opens.
    fetchTracking(bookingId)
      .then((snapshot) => {
        if (!cancelled) {
          setTracking(snapshot)
          setError('')
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(apiErrorMessage(requestError, 'Live tracking could not be loaded.'))
      })

    const connect = () => {
      if (cancelled) return
      if (!hasRequesterSession()) {
        // The booking session lapsed. The page's own 401 handling reconnects it;
        // retrying a socket without one would only fail on a loop.
        setConnection('offline')
        return
      }

      setConnection((current) => (current === 'live' ? current : 'connecting'))
      // The booking session cookie goes with the handshake; nothing secret is in the
      // URL or the subprotocol, which only names the protocol.
      socket = new WebSocket(trackingSocketUrl(bookingId), [TRACKING_SUBPROTOCOL])

      socket.onopen = () => {
        retry = 0
        setConnection('live')
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }))
        }, WS_PING_INTERVAL_MS)
      }

      socket.onmessage = (event) => {
        try {
          applyMessage(JSON.parse(event.data))
        } catch {
          // A malformed frame is ignored rather than breaking the stream.
        }
      }

      socket.onclose = () => {
        window.clearInterval(pingTimer)
        pingTimer = null
        if (cancelled) return
        setConnection('reconnecting')
        const delay = WS_RECONNECT_DELAYS_MS[Math.min(retry, WS_RECONNECT_DELAYS_MS.length - 1)]
        retry += 1
        reconnectTimer = window.setTimeout(connect, delay)
      }

      // An error is always followed by a close; closing here keeps one path.
      socket.onerror = () => socket?.close()
    }

    connect()

    return () => {
      cancelled = true
      window.clearTimeout(reconnectTimer)
      window.clearInterval(pingTimer)
      // Detached first, so the teardown close cannot schedule a reconnect.
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.close()
      }
    }
  }, [bookingId, enabled, attempt, applyMessage])

  return { tracking, setTracking, connection, error, refresh }
}
