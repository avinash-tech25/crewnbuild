import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { LocateFixed, Loader2, Search, X } from 'lucide-react'
import { MAP_TILES } from '../../../shared/constants/tracking.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { searchPlaces } from '../../technician/dispatchApi.js'

/**
 * Where the work is, chosen on a map.
 *
 * The map opens on the booking's service location, already decided by the page
 * above it — a precise device fix if there is one, otherwise the address the
 * account registered. Nothing has to be pressed for the common case. The search
 * box is for the case that could never serve: a House Owner in one city booking
 * for a property in another, or a Site Engineer booking for whichever site needs
 * the work rather than wherever they are standing.
 *
 * There is no country-wide view and no stand-in city. Until a real location
 * exists the map is not drawn at all, because a map centred on somewhere nobody
 * chose reads as "this is where it is".
 */

const PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="
      width:38px;height:38px;border-radius:999px;display:grid;place-items:center;
      background:#126b45;border:3px solid #fff;font-size:18px;line-height:1;
      box-shadow:0 6px 16px -6px rgba(8,62,43,.8),0 0 0 3px rgba(18,107,69,.22);
    ">📍</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
})

const SEARCH_DEBOUNCE_MS = 450

/**
 * How close to zoom, from how well the device knows where it is — always a
 * street or a locality, never a view of the country.
 *
 * A location can also carry its own `zoom`, and then it wins: a registered
 * address resolved to a village is not a sensor reading, and has no accuracy in
 * metres to be read off. How specific the lookup was is what sets its zoom.
 */
function zoomFor(location) {
  if (location?.zoom) return location.zoom
  const accuracy = location?.accuracy
  if (accuracy === null || accuracy === undefined) return 16 // chosen by hand: exact
  if (accuracy <= 50) return 17
  if (accuracy <= 200) return 16
  return 15
}

/** Moves the view when the chosen location changes. */
function Recentre({ latitude, longitude, zoom }) {
  const map = useMap()
  const lastRef = useRef(null)
  useEffect(() => {
    const key = `${latitude.toFixed(6)},${longitude.toFixed(6)},${zoom}`
    if (lastRef.current === key) return
    lastRef.current = key
    map.setView([latitude, longitude], zoom)
  }, [map, latitude, longitude, zoom])
  return null
}

/** Tapping the map moves the pin, so the exact building can be picked. */
function TapToPlace({ onPlace }) {
  useMapEvents({ click: (event) => onPlace([event.latlng.lat, event.latlng.lng]) })
  return null
}

export default function ServiceLocationPicker({
  location,
  placeName = '',
  locating = false,
  // Still working out where to open: the page is reading the device and the
  // registered address. Kept apart from `locating`, which is only the device,
  // so the empty map does not offer "try again" before the first try is done.
  resolving = false,
  // A quiet line under the map — why the pin is where it is. Never an alert:
  // the pin being on the registered address is the screen working, not a fault.
  note = '',
  onChoose,
  onRecentre,
  className = 'h-[300px] sm:h-[360px]',
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  // The broader text the results are for, when the exact one found nothing.
  const [matched, setMatched] = useState(null)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const requestRef = useRef(0)

  // Search as the requester types, but only after they pause: a request per
  // keystroke would be both useless and against the geocoder's usage policy.
  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setResults([])
      setMatched(null)
      setSearching(false)
      return undefined
    }
    setSearching(true)
    const attempt = ++requestRef.current
    const timer = window.setTimeout(async () => {
      try {
        const { results: found, matched: broader } = await searchPlaces(text)
        if (requestRef.current !== attempt) return
        setResults(found)
        setMatched(found.length ? broader : null)
        setMessage(
          found.length
            ? ''
            : 'No places matched that search. Try a landmark, an area, or a PIN code — or place the pin on the map.',
        )
      } catch (error) {
        if (requestRef.current !== attempt) return
        setResults([])
        setMatched(null)
        setMessage(apiErrorMessage(error, 'Location search is unavailable. Tap the map instead.'))
      } finally {
        if (requestRef.current === attempt) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const choose = useCallback(
    (place) => {
      onChoose([place.latitude, place.longitude], place.name)
      setQuery(place.name)
      setResults([])
      setMatched(null)
      setMessage('')
    },
    [onChoose],
  )

  const zoom = zoomFor(location)

  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-oc-muted">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </span>
        <input
          type="search"
          className="field-input pl-9 pr-9"
          placeholder="Search another location…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search for the address, area or landmark where the work is needed"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResults([]); setMatched(null); setMessage('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-oc-muted hover:bg-oc-sunken"
            aria-label="Clear the search"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {results.length > 0 && (
          <ul className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-oc-line bg-white shadow-ocsoft">
            {matched && (
              <li className="border-b border-oc-line bg-oc-sunken px-3.5 py-2 text-xs text-oc-muted">
                No exact match. Showing places for “{matched}” — pick the area, then drag the pin to the building.
              </li>
            )}
            {results.map((result) => (
              <li key={`${result.latitude},${result.longitude},${result.name}`}>
                <button
                  type="button"
                  onClick={() => choose(result)}
                  className="block w-full px-3.5 py-2.5 text-left text-sm text-oc-ink hover:bg-oc-sunken"
                >
                  {result.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {location ? (
        <div className={`relative overflow-hidden rounded-2xl border border-oc-line ${className}`}>
          <MapContainer
            center={[location.latitude, location.longitude]}
            zoom={zoom}
            scrollWheelZoom
            className="h-full w-full"
          >
            <TileLayer url={MAP_TILES.url} attribution={MAP_TILES.attribution} maxZoom={MAP_TILES.maxZoom} />
            <Marker
              position={[location.latitude, location.longitude]}
              icon={PIN_ICON}
              draggable
              eventHandlers={{
                dragend: (event) => {
                  const { lat, lng } = event.target.getLatLng()
                  onChoose([lat, lng], null)
                },
              }}
            />
            <Recentre latitude={location.latitude} longitude={location.longitude} zoom={zoom} />
            <TapToPlace onPlace={(point) => onChoose(point, null)} />
          </MapContainer>

          {/* Small, like a map control, so the ride-hailing look holds. It is the
              way back to this device's own position after searching elsewhere. */}
          <button
            type="button"
            onClick={onRecentre}
            disabled={locating}
            title="Use my current location"
            aria-label="Use my current location"
            className="absolute bottom-3 right-3 z-[1000] grid h-10 w-10 place-items-center rounded-full border border-oc-line bg-white text-oc-green shadow-ocsoft transition hover:bg-oc-mint disabled:opacity-60"
          >
            {locating ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
          </button>
        </div>
      ) : (
        // No location yet. Neutral, never a country or a stand-in city.
        <div className={`grid place-items-center rounded-2xl border border-dashed border-oc-line bg-oc-sunken ${className}`}>
          <div className="px-6 text-center">
            {locating || resolving ? (
              <p className="flex items-center justify-center gap-2 text-sm font-semibold text-oc-muted">
                <Loader2 className="h-4 w-4 animate-spin text-oc-green" /> Finding your location…
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-oc-muted">Search for the place the technician should come to.</p>
                <button type="button" onClick={onRecentre} className="btn-ghost mt-3">
                  <LocateFixed className="h-4 w-4" /> Try my location again
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {placeName && (
        <p className="truncate text-xs font-semibold text-oc-ink" title={placeName}>
          {placeName}
        </p>
      )}
      <p className="text-xs text-oc-muted">
        {note && <span className="font-semibold text-oc-ink">{note} </span>}
        {location
          ? 'Drag the pin, or tap the map, to place it exactly on the building.'
          : 'Allow location, or search above, to set where the technician should come.'}
      </p>
      {message && <p className="text-xs font-semibold text-amber-700">{message}</p>}
    </div>
  )
}
