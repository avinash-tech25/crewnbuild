import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, MapPin, Route, Timer } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import TrackingMap from '../../tracking/components/LazyTrackingMap.jsx'
import { routeKey, toLatLngPath } from '../../tracking/routePath.js'
import { formatDistance, formatEta, formatSince } from '../../../shared/constants/tracking.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchSharingStatus } from '../../tracking/trackingApi.js'

/**
 * Where this job is, and how to get there.
 *
 * Only ever rendered for a job the technician already holds, and the endpoint
 * behind it is scoped to that technician, so a job they have merely been offered
 * has no map -- before accepting there is nothing here to show.
 *
 * Two sources, one picture: the first view comes from the backend when the card
 * opens (drawn from the technician's current position, which their app is already
 * sending), and every position the app sends returns an updated one (`live`), so
 * the distance and the route stay current without this screen polling or asking
 * the device for a position of its own.
 */

/**
 * Google Maps' cross-platform directions link: it opens the Maps app on a phone
 * and maps.google.com in a desktop browser, with the route from wherever the
 * device is. Only a job the technician holds has a destination to link to.
 */
export function externalMapsUrl(point) {
  if (!point) return null
  const [latitude, longitude] = point.map(Number)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`
}

export default function JobNavigation({ job, live, following, onRouteDistance }) {
  const [loaded, setLoaded] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setLoaded(await fetchSharingStatus(job.id))
      setError('')
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'The route to this job could not be loaded.'))
    }
  }, [job.id])

  useEffect(() => {
    load()
  }, [load])

  // What the phone last published wins: it is newer than the view this card
  // opened with, and it is the technician's own position.
  const view = live ?? loaded

  const destination = useMemo(
    () => (view?.destination ? [view.destination.latitude, view.destination.longitude] : null),
    [view?.destination?.latitude, view?.destination?.longitude],
  )
  // Turn-by-turn in the phone's or computer's own maps, to the same point this
  // map routes to: the requester's confirmed pin, else the booking's point.
  const mapsUrl = externalMapsUrl(destination ?? (
    job.service_latitude !== null && job.service_latitude !== undefined && job.service_longitude !== null && job.service_longitude !== undefined
      ? [job.service_latitude, job.service_longitude]
      : null
  ))
  const technician = useMemo(
    () => (view?.position ? [view.position.latitude, view.position.longitude] : null),
    [view?.position?.latitude, view?.position?.longitude],
  )
  const routePath = useMemo(() => toLatLngPath(view?.route?.geometry), [view?.route])

  // The card above shows how the job was matched — a straight line measured when
  // it was offered. Once a road route exists, that is the number to show there
  // too, so the card and this map cannot disagree.
  const routeDistance = view?.distance_remaining_meters
  useEffect(() => {
    if (onRouteDistance) onRouteDistance(routeDistance ?? null)
  }, [onRouteDistance, routeDistance])

  if (!view && !error) {
    return (
      <div className="flex justify-center py-8 text-oc-green">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {destination ? (
        <TrackingMap
          destination={destination}
          technician={technician}
          technicianHeading={view?.position?.heading}
          routePath={routePath}
          routeSource={view?.route?.source}
          // The technician's own screen follows them, the way a sat-nav does.
          // The requester's screen keeps the whole journey in view instead.
          followMode={Boolean(following && technician)}
          fitKey={`job-${job.id}-${routeKey(routePath)}`}
          className="h-[260px] sm:h-[320px]"
        />
      ) : (
        <div className="grid h-[180px] place-items-center rounded-2xl border border-dashed border-oc-line bg-oc-sunken">
          <p className="px-6 text-center text-sm font-semibold text-oc-muted">Waiting for location…</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat icon={Route} label="Distance" value={formatDistance(view?.distance_remaining_meters)} />
        <Stat icon={Timer} label="Time" value={formatEta(view?.eta_seconds)} />
        <Stat
          icon={MapPin}
          label="Updated"
          // A preview carries the time its position was read, so this says how
          // old the route is instead of "Not started" — which was never about
          // the route at all, only about the journey.
          value={view?.updated_at ? formatSince(view.updated_at) : '—'}
        />
      </div>

      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost w-full" data-testid="open-in-maps">
          <ExternalLink className="h-4 w-4" /> Open in Maps
        </a>
      )}

      {!technician && (
        <p className="text-xs text-oc-muted">
          The distance and the time are measured from where you actually are to the customer's address, as soon as
          your location arrives.
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {view?.message && <Alert tone="info">{view.message}</Alert>}
    </div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-oc-line bg-white px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-oc-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <p className="mt-0.5 font-display text-base font-extrabold text-oc-ink">{value}</p>
    </div>
  )
}
