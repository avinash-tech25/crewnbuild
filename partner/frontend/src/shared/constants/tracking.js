// Every environment-specific and tunable value live tracking uses, in one place.
// Nothing here is read anywhere but the tracking hooks, services and map.

/**
 * Map tiles. Swapping this object changes the provider; nothing else in the app
 * knows which tile server is in use, so any {z}/{x}/{y} raster provider drops in.
 * The attribution is required by the OpenStreetMap licence -- keep it visible.
 */
export const MAP_TILES = {
  url: import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution:
    import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}

/**
 * An optional opening view for a map that has nothing real to show yet, as
 * "lat,lng" in VITE_MAP_DEFAULT_CENTER. Null unless it is configured.
 *
 * There is deliberately no built-in city here. A map centred on somewhere nobody
 * asked for reads as "this is where you are", and a booking whose PIN code is in
 * Karimnagar opening over Hyderabad is worse than no map at all. With nothing
 * known, the screens say they are waiting for a location instead of drawing one.
 */
export const MAP_DEFAULT_CENTER = (() => {
  const configured = String(import.meta.env.VITE_MAP_DEFAULT_CENTER || '')
    .split(',')
    .map((part) => Number(part.trim()))
  return configured.length === 2 && configured.every(Number.isFinite) ? configured : null
})()
export const MAP_DEFAULT_ZOOM = 12

/**
 * A fix less precise than this is not a position.
 *
 * `navigator.geolocation` does not fail when a device has no satellite or Wi-Fi
 * fix: it looks up the IP address and returns the middle of whichever city the
 * connection appears to come from, with an accuracy of tens of kilometres. It
 * looks exactly like a real fix, and accepting one is what put a Karimnagar
 * booking in Hyderabad and left the technician standing on top of the customer.
 * Must match MAX_LOCATION_ACCURACY_METERS on the backend, which refuses these too.
 */
export const MAX_USABLE_ACCURACY_METERS = 1000

/** True when a browser position is precise enough to be treated as a place. */
export function isUsableFix(position) {
  const { latitude, longitude, accuracy } = position?.coords ?? {}
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false
  if (latitude === 0 && longitude === 0) return false
  // A device that states an accuracy has to mean it.
  return !Number.isFinite(accuracy) || accuracy <= MAX_USABLE_ACCURACY_METERS
}

// The technician marker glides across most of the gap until the next fix is due,
// clamped to this range, so it keeps moving instead of hopping between points.
export const MARKER_ANIMATION_MIN_MS = 600
export const MARKER_ANIMATION_MAX_MS = 3000
// A jump further than this is a new journey, not movement: snap instead of gliding.
export const MARKER_SNAP_DISTANCE_METERS = 2000
// Below this a "move" is GPS noise from a stationary device, so the marker stays
// put. Travel is never this small between fixes.
export const MARKER_MIN_MOVE_METERS = 4

// ----- technician: sending real GPS -----
// The browser reports a fix far more often than anyone needs to see one. A fix is
// sent at most this often...
export const GPS_SEND_INTERVAL_MS = 3000
// ...and only when it moved further than GPS noise: max(this, accuracy / 2), capped.
export const GPS_MIN_MOVE_METERS = 5
export const GPS_MAX_NOISE_METERS = 50
// A technician standing still still re-sends, so the requester sees a live position.
export const GPS_HEARTBEAT_MS = 15000
// A fix older than this is never re-sent as a heartbeat.
export const GPS_FIX_MAX_AGE_MS = 60000
// Accuracy worse than this is flagged on the technician's screen (Wi-Fi/IP location).
export const GPS_POOR_ACCURACY_METERS = 100
// How often queued fixes are re-examined, so a device that goes quiet while the
// technician stands still does not stall the heartbeat.
export const GPS_PUMP_MS = 1000

/** Continuous tracking: precise and near-fresh. A watch keeps running after a
 *  TIMEOUT, so a slow first lock is a warning, never a dead stream. */
export const GPS_WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
/** One quick network-assisted fix, so the requester sees the technician at once
 *  instead of waiting several seconds for a cold satellite lock. */
export const GPS_QUICK_FIX_OPTIONS = { enableHighAccuracy: false, maximumAge: 10000, timeout: 10000 }

// ----- requester: watching -----
export const WS_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]
export const WS_PING_INTERVAL_MS = 25000
// Without a position for this long the map says "Location updating..." instead of
// showing the last one as live. The server sends its own value with every snapshot
// (LOCATION_STALE_THRESHOLD_SECONDS); this is only the default until it arrives.
export const LOCATION_STALE_MS = 15000
// "Your technician is nearly there" once the remaining distance drops below this.
export const NEAR_DESTINATION_METERS = 150
// Below this the technician counts as having arrived, and the backend says so on
// its own from the real remaining distance. Mirrors ARRIVAL_THRESHOLD_METERS.
export const ARRIVAL_THRESHOLD_METERS = 40

// The subprotocol the tracking websocket is opened with; the Partner session token
// travels as the second value rather than in the URL. Must match the backend's
// TRACKING_SUBPROTOCOL (app/routers/tracking_router.py).
export const TRACKING_SUBPROTOCOL = 'partner.tracking.v1'

// Booking statuses tracking is open for. The backend decides the same thing again;
// this only avoids drawing a map that is going to come back empty.
export const TRACKABLE_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']
// Statuses where the technician may share their position.
export const SHARING_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED']

export const GPS_MESSAGES = {
  unsupported: 'This browser cannot share a location. Open Partner in Chrome or Safari on your phone.',
  insecure:
    'Sharing your live location needs a secure page (https:// or localhost). Open the https:// address of Partner on this phone and try again.',
  denied:
    'Location permission is off for this site. Allow location in your browser settings, then tap Start journey again.',
  unavailable: 'No GPS position yet (weak signal, or location services are off). Still trying…',
  imprecise:
    'Your device has not fixed a precise location yet — what it reported is an estimate from your internet connection, not where you are. Turn on precise location (GPS), or move near a window or outdoors.',
  timeout: 'Still waiting for a GPS fix. Move near a window or step outside — sharing resumes on its own.',
}

/** Metres between two {latitude, longitude} points. */
export function metersBetween(a, b) {
  const rad = Math.PI / 180
  const deltaLat = (b.latitude - a.latitude) * rad
  const deltaLng = (b.longitude - a.longitude) * rad
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(deltaLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Kilometres, to two decimals: 0.43 km, 1.85 km, 7.25 km.
 *
 * One unit throughout, so "430 m" and "1.9 km" never sit next to each other and
 * have to be compared in the reader's head. Two decimals because the last stretch
 * of a journey is where the number matters most.
 */
export function formatDistance(meters) {
  if (meters === null || meters === undefined) return '—'
  return `${(meters / 1000).toFixed(2)} km`
}

export function formatEta(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * Epoch milliseconds for a time the API sent, or one this browser recorded.
 * The API's timestamps are UTC without a zone suffix, which a browser would
 * otherwise read as local time and report as hours old.
 */
export function parseTimestamp(time) {
  if (!time) return null
  if (typeof time === 'number') return time
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(time) ? time : `${time}Z`).getTime()
}

/** Accepts an ISO string (with or without a zone) or epoch milliseconds. */
export function formatSince(time) {
  const value = parseTimestamp(time)
  if (value === null) return '—'
  const elapsed = (Date.now() - value) / 1000
  if (elapsed < 2) return 'just now'
  if (elapsed < 60) return `${Math.round(elapsed)}s ago`
  if (elapsed < 3600) return `${Math.round(elapsed / 60)} min ago`
  return new Date(value).toLocaleTimeString()
}

/** True while a position is recent enough to still call the technician live. */
export function isFresh(time, now = Date.now(), staleAfterMs = LOCATION_STALE_MS) {
  const value = parseTimestamp(time)
  return value !== null && now - value <= staleAfterMs
}

// ----- technician: the one location stream -----
// Defaults until the server's answer says otherwise (update_interval_seconds).
export const LOCATION_UPDATE_INTERVAL_MS = 3000
// A phone standing still stops firing; re-send the last fix this often so the
// server does not consider the technician gone (always below the stale threshold).
export const LOCATION_HEARTBEAT_MS = 6000
