import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crosshair, MapPin, Navigation, RefreshCw, Route, Timer } from 'lucide-react'
import {
  NEAR_DESTINATION_METERS,
  TRACKABLE_STATUSES,
  formatDistance,
  formatEta,
  formatSince,
  isFresh,
} from '../../../shared/constants/tracking.js'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import useBookingTracking from '../useBookingTracking.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { saveDestination } from '../trackingApi.js'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import TrackingMap from './LazyTrackingMap.jsx'
import { routeKey, toLatLngPath } from '../routePath.js'

/**
 * Live tracking for the House Owner or the Site Engineer -- one component for
 * both, because it is one feature. Which of them is watching is already settled
 * by the booking session; nothing here needs to know.
 *
 * It appears only once the technician has accepted, and closes itself when the
 * booking does.
 */

const CONNECTION_LABEL = {
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  idle: '',
}

const HEADLINE = {
  ACCEPTED: 'Your technician has accepted and will set off shortly',
  EN_ROUTE: 'Your technician is on the way',
  ARRIVED: 'Your technician has arrived',
  IN_PROGRESS: 'Work is in progress',
}

export function isTrackable(status) {
  return TRACKABLE_STATUSES.includes(status)
}

/** The requester places the pin for their address before a route can be drawn. */
function DestinationPicker({ bookingId, initialCenter, onSaved }) {
  const [pin, setPin] = useState(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState({ tone: 'info', text: '' })

  const useMyLocation = () => {
    if (!window.isSecureContext || !('geolocation' in navigator)) {
      setMessage({
        tone: 'error',
        text: 'This browser cannot read your location here. Tap your home or site on the map instead.',
      })
      return
    }
    setBusy('locate')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin([position.coords.latitude, position.coords.longitude])
        setMessage({ tone: 'info', text: 'Check the pin is on your building, then confirm it.' })
        setBusy('')
      },
      () => {
        setMessage({
          tone: 'error',
          text: 'Your location could not be read. Allow location for this site, or tap the spot on the map.',
        })
        setBusy('')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  const confirm = async () => {
    if (!pin) return
    setBusy('save')
    try {
      onSaved(await saveDestination(bookingId, { latitude: pin[0], longitude: pin[1] }))
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'That location could not be saved.') })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-oc-line bg-oc-sunken p-4">
        <p className="font-display text-base font-extrabold text-oc-ink">Where exactly should they come?</p>
        <p className="mt-1 text-sm text-oc-muted">
          Your address and PIN code got a technician near you. Place the pin on the building itself so the map
          can show how far away they are and when they will arrive.
        </p>
      </div>

      <TrackingMap
        destination={pin}
        fitKey={pin ? `pin-${pin[0].toFixed(4)}` : `pick-${initialCenter?.join(',') ?? 'default'}`}
        onPlaceDestination={setPin}
        className="h-[300px] sm:h-[380px]"
      />

      <Alert tone={message.tone}>{message.text}</Alert>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" onClick={useMyLocation} disabled={Boolean(busy)}>
          {busy === 'locate' ? <Spinner className="h-4 w-4" /> : <Crosshair className="h-4 w-4" />} Use my current
          location
        </button>
        <button type="button" className="btn-primary" onClick={confirm} disabled={!pin || Boolean(busy)}>
          {busy === 'save' ? <Spinner className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} Confirm this location
        </button>
      </div>
      <p className="text-xs text-oc-muted">You can also tap anywhere on the map to move the pin.</p>
    </div>
  )
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-oc-line bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-oc-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-0.5 font-display text-lg font-extrabold text-oc-ink">{value}</p>
    </div>
  )
}

export default function LiveTrackingPanel({ booking, onRemainingDistance }) {
  const bookingId = booking.id
  const enabled = isTrackable(booking.status)
  const { tracking, setTracking, connection, error, refresh } = useBookingTracking(bookingId, { enabled })

  /*
   * The remaining road distance, passed up to the page around this panel.
   *
   * The page shows the technician on a card of their own, and that card used to
   * carry the distance recorded when the job was offered -- a straight line,
   * measured once, never updated. Beside a live route distance it read as a
   * contradiction: 17.54 km at the top, 10.5 km below it.
   *
   * So there is one number, and this is where it comes from. Offered rather than
   * lifted: the socket, the route and the arithmetic all stay exactly where they
   * were, and the page renders what this panel already knows.
   */
  useEffect(() => {
    if (!onRemainingDistance) return
    onRemainingDistance(enabled ? (tracking?.distance_remaining_meters ?? null) : null)
  }, [onRemainingDistance, enabled, tracking?.distance_remaining_meters])

  // Re-render "updated 4s ago" and the LIVE badge between messages.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])

  const onDestinationSaved = useCallback(
    (snapshot) => {
      setTracking(snapshot)
      // A pin means a route: reconnect so the socket's own snapshot agrees.
      refresh()
    },
    [setTracking, refresh],
  )

  const destination = useMemo(
    () => (tracking?.destination ? [tracking.destination.latitude, tracking.destination.longitude] : null),
    [tracking?.destination?.latitude, tracking?.destination?.longitude],
  )
  const technician = useMemo(
    () => (tracking?.position ? [tracking.position.latitude, tracking.position.longitude] : null),
    [tracking?.position?.latitude, tracking?.position?.longitude],
  )
  const routePath = useMemo(() => toLatLngPath(tracking?.route?.geometry), [tracking?.route])

  if (!enabled) return null

  if (!tracking) {
    return (
      <section className="card space-y-3 p-6">
        <h2 className="font-display text-lg font-extrabold text-oc-deep">Live tracking</h2>
        {error ? (
          <>
            <Alert tone="error">{error}</Alert>
            <button type="button" className="btn-ghost" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          </>
        ) : (
          <div className="flex justify-center py-10 text-oc-green">
            <Spinner className="h-7 w-7" />
          </div>
        )}
      </section>
    )
  }

  const type = technicianTypeByCode(tracking.technician?.technician_type || booking.technician_type)

  if (!tracking.destination) {
    return (
      <section className="card space-y-4 p-6">
        <h2 className="font-display text-lg font-extrabold text-oc-deep">Live tracking</h2>
        <DestinationPicker bookingId={bookingId} initialCenter={technician} onSaved={onDestinationSaved} />
      </section>
    )
  }

  // `received_at` is when this browser saw the fix; it is preferred over the
  // server's own stamp so freshness never depends on two clocks agreeing.
  const lastUpdate = tracking.position ? (tracking.position.received_at ?? tracking.position.updated_at) : null
  // The server says how old a position may be before it stops being live
  // (LOCATION_STALE_THRESHOLD_SECONDS). Past that it is not shown as current.
  const staleAfterMs = (tracking.stale_after_seconds ?? 15) * 1000
  const positionFresh = isFresh(lastUpdate, now, staleAfterMs)
  const live = tracking.is_live && positionFresh && connection === 'live'
  const approximate = tracking.eta_basis === 'straight_line'
  const near =
    tracking.is_live &&
    tracking.distance_remaining_meters !== null &&
    tracking.distance_remaining_meters !== undefined &&
    tracking.distance_remaining_meters <= NEAR_DESTINATION_METERS

  return (
    <section className="card space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-oc-deep">Live tracking</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${
            live
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : connection === 'reconnecting' || connection === 'connecting'
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-oc-line bg-oc-sunken text-oc-muted'
          }`}
        >
          <i className={`h-1.5 w-1.5 rounded-full bg-current ${live ? 'animate-pulse' : ''}`} />
          {live ? 'Live' : (CONNECTION_LABEL[connection] || 'Waiting')}
        </span>
      </header>

      <p className="font-display text-base font-extrabold text-oc-ink">
        {near ? 'Your technician is nearly there' : (HEADLINE[tracking.status] ?? tracking.status_label)}
      </p>

      <TrackingMap
        destination={destination}
        technician={technician}
        technicianHeading={tracking.position?.heading}
        routePath={routePath}
        routeSource={tracking.route?.source}
        fitKey={`booking-${bookingId}-${routeKey(routePath)}`}
      />

      {tracking.position ? (
        // What the person waiting actually wants to know: how far, how long, how
        // fresh. The raw coordinates and the fix's accuracy are not shown -- they
        // are the map's working, not an answer to the question being asked. Both
        // still arrive on `tracking.position` and still drive the map, the route,
        // the distance and the ETA above.
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Metric icon={Route} label="Distance" value={`${approximate ? '≈ ' : ''}${formatDistance(tracking.distance_remaining_meters)}`} />
            <Metric icon={Timer} label={approximate ? 'Arrives in (approx.)' : 'Arrives in'} value={formatEta(tracking.eta_seconds)} />
            <Metric icon={Navigation} label="Updated" value={positionFresh ? formatSince(lastUpdate) : 'Location updating…'} />
          </div>
          {!positionFresh && tracking.is_live && (
            // An old position is not presented as live: it may be minutes behind.
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" data-testid="location-updating">
              Location updating… The last known position was {formatSince(lastUpdate)}.
            </p>
          )}
        </div>
      ) : (
        // No position means no position. A distance of 0 km and "under a minute"
        // would both be inventions, and would read as the technician being outside.
        <div className="rounded-xl border border-dashed border-oc-line bg-oc-sunken px-3.5 py-4 text-center text-sm font-semibold text-oc-muted">
          Waiting for technician location…
        </div>
      )}

      <div className="flex items-center gap-3 rounded-2xl border border-oc-line bg-oc-sunken p-3">
        {type?.heroImage && <img src={type.heroImage} alt="" className="h-10 w-auto" />}
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-extrabold text-oc-ink">
            {tracking.technician?.name ?? 'Your technician'}
          </p>
          <p className="text-xs text-oc-muted">{type?.label ?? tracking.technician?.technician_type}</p>
        </div>
      </div>

      {!tracking.position && tracking.is_live && (
        <Alert tone="info">
          Waiting for your technician's location. The map updates on its own as soon as it arrives.
        </Alert>
      )}
      {tracking.message && <Alert tone="info">{tracking.message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </section>
  )
}
