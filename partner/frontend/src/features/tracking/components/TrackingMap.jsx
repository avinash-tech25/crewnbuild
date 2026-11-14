import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import {
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  MAP_TILES,
  MARKER_ANIMATION_MAX_MS,
  MARKER_ANIMATION_MIN_MS,
  MARKER_MIN_MOVE_METERS,
  MARKER_SNAP_DISTANCE_METERS,
} from '../../../shared/constants/tracking.js'

/**
 * The Leaflet + OpenStreetMap view the requester watches their technician on.
 *
 * Coordinate rule for this file: every prop and every Leaflet call is
 * [latitude, longitude]. The backend sends GeoJSON ([longitude, latitude]) and
 * it is flipped exactly once, in `toLatLngPath` (routePath.js), and nowhere else.
 *
 * The markers are divIcons with their styles inline: Leaflet's default marker
 * images do not survive a bundler, and this keeps the map self-contained rather
 * than adding classes to the shared stylesheet.
 */

function pinIcon({ glyph, background, ring }) {
  return L.divIcon({
    className: '',
    html: `<div style="
        width:38px;height:38px;border-radius:999px;display:grid;place-items:center;
        background:${background};border:3px solid #fff;font-size:18px;line-height:1;
        box-shadow:0 6px 16px -6px rgba(8,62,43,.8),0 0 0 3px ${ring};
      ">${glyph}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  })
}

const DESTINATION_ICON = pinIcon({ glyph: '📍', background: '#126b45', ring: 'rgba(18,107,69,.22)' })

/**
 * The technician, as a bike travelling to the job.
 *
 * `heading` is the direction the device reports it is moving in, in degrees
 * clockwise from north, and the icon is turned to match so the bike faces the
 * way it is going. Browsers report no heading at all while stationary, and
 * that is exactly when a rotation would be meaningless, so it is left upright.
 * Rotation is decoration: the position is always the real fix.
 */
function technicianIcon(heading) {
  const facing = Number.isFinite(heading) ? `transform:rotate(${heading}deg);` : ''
  return L.divIcon({
    className: '',
    html: `<div style="
        width:40px;height:40px;border-radius:999px;display:grid;place-items:center;
        background:#f4b740;border:3px solid #fff;font-size:20px;line-height:1;
        box-shadow:0 6px 16px -6px rgba(8,62,43,.8),0 0 0 3px rgba(244,183,64,.3);
      "><span style="display:block;${facing}">🏍️</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

/**
 * The technician's marker, which glides to each new position instead of
 * teleporting -- and is added to the map imperatively, so a position update
 * moves one marker rather than re-rendering the map around it.
 */
function MovingMarker({ position, heading }) {
  const map = useMap()
  const markerRef = useRef(null)
  const frameRef = useRef(0)
  const lastMoveRef = useRef(performance.now())

  useEffect(() => {
    const marker = L.marker(position, { icon: technicianIcon(heading), zIndexOffset: 1000 }).addTo(map)
    markerRef.current = marker
    return () => {
      cancelAnimationFrame(frameRef.current)
      marker.remove()
      markerRef.current = null
    }
    // Created once for this map; later positions are animated by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return undefined

    const from = marker.getLatLng()
    const to = L.latLng(position)
    // A device standing still still reports a position, and it wanders a metre or
    // two each time. The bike moves when the technician moves, not otherwise.
    if (from.distanceTo(to) < MARKER_MIN_MOVE_METERS) return undefined

    const startedAt = performance.now()
    const gap = startedAt - lastMoveRef.current
    lastMoveRef.current = startedAt

    // A jump this large is a new journey, not movement.
    if (from.distanceTo(to) > MARKER_SNAP_DISTANCE_METERS) {
      cancelAnimationFrame(frameRef.current)
      marker.setLatLng(to)
      return undefined
    }

    // Glide across most of the gap until the next fix is expected, starting from
    // wherever the marker is right now, so it keeps moving instead of hopping.
    const duration = Math.min(MARKER_ANIMATION_MAX_MS, Math.max(MARKER_ANIMATION_MIN_MS, gap * 0.9))
    const step = (now) => {
      const ratio = Math.min(1, (now - startedAt) / duration)
      marker.setLatLng([from.lat + (to.lat - from.lat) * ratio, from.lng + (to.lng - from.lng) * ratio])
      if (ratio < 1) frameRef.current = requestAnimationFrame(step)
    }

    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [position[0], position[1]])

  // Only the icon changes; the marker, the map and the animation are untouched.
  useEffect(() => {
    markerRef.current?.setIcon(technicianIcon(heading))
  }, [heading])

  return null
}

/**
 * Frames the route, the technician and the destination once per `fitKey` (first
 * load, a replanned route), then leaves the view alone so the technician visibly
 * moves across a still map. Only when they leave the visible map is the whole
 * journey framed again -- panning on every fix would slide the map under the
 * marker and push the destination off screen.
 */
function ViewController({ points, fitKey, follow, followMode }) {
  const map = useMap()
  const fittedRef = useRef(null)

  // Navigation mode: the map stays under the technician, the way a sat-nav does.
  // Driven by the position changing, never by a timer, so a parked bike does not
  // make the map drift.
  useEffect(() => {
    if (!followMode || !follow) return
    map.panTo(follow, { animate: true, duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, followMode, follow?.[0], follow?.[1]])

  // Framing is instant. An animated zoom finishes on a timer, and a card that
  // leaves the screen mid-animation (a job cancelled live) would have Leaflet
  // finish it on a map that no longer exists.
  const frame = (framePoints) => {
    if (framePoints.length === 1) map.setView(framePoints[0], 15, { animate: false })
    else map.fitBounds(L.latLngBounds(framePoints), { padding: [45, 45], maxZoom: 16, animate: false })
  }

  useEffect(() => {
    if (followMode) return
    if (points.length === 0) return
    if (fittedRef.current === fitKey) return
    fittedRef.current = fitKey
    frame(points)
    // `frame` is recreated each render but closes over nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, points])

  useEffect(() => {
    if (followMode || !follow || points.length === 0) return
    if (!map.getBounds().contains(L.latLng(follow))) frame([...points, follow])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, follow?.[0], follow?.[1]])

  return null
}

/** Only mounted while the requester is placing their pin. */
function PinPlacer({ onPlace }) {
  useMapEvents({
    click: (event) => onPlace([event.latlng.lat, event.latlng.lng]),
  })
  return null
}

export default function TrackingMap({
  destination,
  technician,
  technicianHeading,
  routePath = [],
  routeSource = 'osrm',
  onPlaceDestination,
  // Navigation-follow (the technician's own screen) rather than the tracking
  // overview the requester watches.
  followMode = false,
  fitKey = 'default',
  className = 'h-[320px] sm:h-[420px]',
}) {
  // A route is always planned from the technician's position, so it already
  // frames them. Adding the marker separately would let a new route be framed
  // around their PREVIOUS position when route_updated arrives just ahead of the
  // position that caused it.
  const framePoints = useMemo(() => {
    const points = []
    if (routePath.length) points.push(...routePath)
    if (destination) points.push(destination)
    if (technician && !routePath.length) points.push(technician)
    return points
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePath, destination?.[0], destination?.[1], technician?.[0], technician?.[1]])

  // With no real point to show, say so. A map centred on a city nobody chose reads
  // as "this is where it is", and that is exactly how a Karimnagar booking came to
  // be displayed over Hyderabad.
  const opening = destination ?? technician ?? MAP_DEFAULT_CENTER
  if (!opening) {
    return (
      <div className={`grid place-items-center rounded-2xl border border-dashed border-oc-line bg-oc-sunken ${className}`}>
        <p className="px-6 text-center text-sm font-semibold text-oc-muted">Waiting for location…</p>
      </div>
    )
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-oc-line ${className}`}>
      <MapContainer
        center={opening}
        zoom={followMode ? 16 : MAP_DEFAULT_ZOOM}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer url={MAP_TILES.url} attribution={MAP_TILES.attribution} maxZoom={MAP_TILES.maxZoom} />

        {routePath.length > 1 && (
          <>
            <Polyline positions={routePath} pathOptions={{ color: '#083e2b', weight: 8, opacity: 0.12 }} />
            <Polyline
              positions={routePath}
              pathOptions={{
                color: '#126b45',
                weight: 5,
                opacity: 0.95,
                // A straight-line estimate is dashed, so it never reads as a road.
                dashArray: routeSource === 'fallback' ? '10 10' : undefined,
              }}
            />
          </>
        )}

        {destination && <Marker position={destination} icon={DESTINATION_ICON} />}
        {technician && <MovingMarker position={technician} heading={technicianHeading} />}

        <ViewController points={framePoints} fitKey={fitKey} follow={technician} followMode={followMode} />
        {onPlaceDestination && <PinPlacer onPlace={onPlaceDestination} />}
      </MapContainer>
    </div>
  )
}
