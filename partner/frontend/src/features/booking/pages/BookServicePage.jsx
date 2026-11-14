import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarCheck } from 'lucide-react'
import { Alert, SearchLoader, Spinner } from '../../../shared/ui/ui.jsx'
import ServiceLocationPicker from '../components/LazyServiceLocationPicker.jsx'
import { SERVICE_AREAS } from '../../../shared/constants/serviceAreas.js'
import { technicianTypeBySlug } from '../../../shared/constants/technicianTypes.js'
import useRequesterSession from '../useRequesterSession.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import ServiceSummary from '../components/ServiceSummary.jsx'
import { createBooking, fetchRegisteredLocation, fetchService } from '../bookingApi.js'
import BookingShell from '../components/BookingShell.jsx'

// Long enough that the search animation reads as a step rather than a flicker.
const MINIMUM_SEARCH_MS = 1200

// High accuracy, and long enough for a satellite fix rather than the instant
// answer a browser gives from the network. `maximumAge` is deliberately short:
// a cached fix from an hour ago is not where the phone is now.
const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 14000, maximumAge: 30000 }

/**
 * The line between a position and a guess.
 *
 * `navigator.geolocation` does not fail when a device has no satellite fix. It
 * looks the IP address up instead and hands back the middle of whatever city the
 * connection appears to come from -- the same shape of answer, with an accuracy
 * of kilometres. That is what put a House Owner registered in Badanapalli,
 * 505405 on a map of Nampally, Hyderabad, 120 km away.
 *
 * So a fix is only the *device's location* if the device says it is sure of it.
 * Anything coarser is discarded outright rather than shown as a pin: their
 * registered address is a real place, and a guess from an ISP is not.
 */
const PRECISE_ACCURACY_METERS = 150

const NO_LOCATION_MESSAGE =
  'We could not work out where you are, or place your registered address. Search for the location the technician should come to.'
const REGISTERED_NOTE = 'Using your registered location.'
const IMPRECISE_NOTE = 'Precise device location is unavailable.'

/**
 * Book a trade: where the work is, which part of the property, and go.
 *
 * Three locations, kept apart on purpose:
 *
 *   deviceLocation    where this device says it is -- and only when it is sure,
 *                     within PRECISE_ACCURACY_METERS. A coarse fix is dropped.
 *   registeredLocation  the account's own address in CREWNBUILD, resolved to a
 *                     point by the backend. Always fetched, so it is ready the
 *                     moment the device turns out to have nothing precise.
 *   manualLocation    a place the requester deliberately chose, by searching or by
 *                     moving the pin. Set only by them.
 *
 *   serviceLocation = manualLocation ?? deviceLocation ?? registeredLocation
 *
 * That order is the whole fix. A phone outdoors books where it is standing; a
 * desktop, whose browser can only guess a city from the ISP, books the address
 * the account registered -- never the guess. A deliberate choice outranks both,
 * and keeps outranking them until the requester presses the recentre control.
 */
export default function BookServicePage() {
  const { typeSlug, serviceSlug } = useParams()
  const type = technicianTypeBySlug(typeSlug)
  const navigate = useNavigate()
  // The catalog entry being booked, when the page was reached through the
  // service list. Loaded from the server rather than passed through router
  // state, so a refresh or a shared link shows the same service and price.
  //
  // A service in the URL makes it mandatory: the booking is placed with that
  // service or not at all, never quietly without one. Without a service in the
  // URL a booking is still accepted, exactly as before the catalog existed.
  //
  //   idle      no service in the URL -- nothing to load
  //   loading   waiting for the booking session, or for the service itself
  //   ready     the service is loaded and matches this trade and slug
  //   error     it could not be loaded; booking stays blocked until a retry works
  const serviceRequired = Boolean(serviceSlug)
  const [serviceLoad, setServiceLoad] = useState({ status: serviceRequired ? 'loading' : 'idle', service: null, message: '' })
  const [serviceAttempt, setServiceAttempt] = useState(0)
  const service = serviceLoad.status === 'ready' ? serviceLoad.service : null
  const serviceReady = !serviceRequired || Boolean(service)
  const session = useRequesterSession()

  const [deviceLocation, setDeviceLocation] = useState(null)
  const [registeredLocation, setRegisteredLocation] = useState(null)
  const [manualLocation, setManualLocation] = useState(null)
  const [locating, setLocating] = useState(true)
  const [resolvingRegistered, setResolvingRegistered] = useState(true)
  const [locationNote, setLocationNote] = useState('')
  const [serviceArea, setServiceArea] = useState('')
  const [state, setState] = useState({ status: 'form', message: '', existingId: null })

  // What is actually booked. A deliberate choice wins, then a device that knows
  // precisely where it is, then the address this account registered.
  const serviceLocation = manualLocation ?? deviceLocation ?? registeredLocation
  // Both answers are still outstanding, so there is nothing honest to draw yet.
  const stillLooking = locating || resolvingRegistered

  /**
   * Read where this device is, and accept it only if the device is sure.
   *
   * Resolves to a precise fix, or null -- for a refusal, a timeout, an insecure
   * page, *and* for a fix too coarse to be a location rather than a city. The
   * caller cannot tell those apart because it must treat them the same: none of
   * them is where the requester is.
   */
  const readPreciseDeviceLocation = useCallback(
    (maximumAge = GEOLOCATION_OPTIONS.maximumAge) =>
      new Promise((resolve) => {
        if (!window.isSecureContext || !('geolocation' in navigator)) {
          resolve(null)
          return
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const accuracy = position.coords.accuracy ?? null
            if (accuracy !== null && accuracy > PRECISE_ACCURACY_METERS) {
              // The IP-address guess. Dropped here, so it can never reach the
              // map, the pin, or the booking.
              resolve(null)
              return
            }
            resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy })
          },
          () => resolve(null),
          { ...GEOLOCATION_OPTIONS, maximumAge },
        )
      }),
    [],
  )

  // Asked for as the booking screen opens, so the map is already in the right
  // place by the time the requester looks at it. One reading, not a watcher: the
  // technician's live tracking is what needs a watcher, not this form.
  useEffect(() => {
    let cancelled = false
    readPreciseDeviceLocation().then((fix) => {
      if (cancelled) return
      setLocating(false)
      if (fix) setDeviceLocation(fix)
    })
    return () => {
      cancelled = true
    }
  }, [readPreciseDeviceLocation])

  // The registered address, fetched alongside the device reading rather than
  // after it: it is needed the instant the device turns out to have nothing
  // precise, and waiting for the geolocation timeout first would double how long
  // the map stays blank.
  useEffect(() => {
    if (session.status !== 'ready') return undefined
    let cancelled = false
    setResolvingRegistered(true)
    fetchRegisteredLocation()
      .then((place) => {
        if (cancelled || !place) return
        setRegisteredLocation({
          latitude: place.latitude,
          longitude: place.longitude,
          // No accuracy: this is an address, not a reading off a sensor. The map
          // zooms by `zoom` instead, which says how specific the lookup was.
          accuracy: null,
          zoom: place.zoom,
          name: place.label || '',
        })
      })
      .catch(() => {
        /* Best effort: the requester can always search. */
      })
      .finally(() => {
        if (!cancelled) setResolvingRegistered(false)
      })
    return () => {
      cancelled = true
    }
  }, [session.status])

  // Said only when it explains something: the pin sitting on the registered
  // address rather than on the requester. Never when the device placed it.
  useEffect(() => {
    // A precise fix can land after the address has: the note has to go with it,
    // or the map would still claim to be showing the registered location.
    if (manualLocation || deviceLocation) {
      setLocationNote('')
      return
    }
    if (registeredLocation) setLocationNote(REGISTERED_NOTE)
  }, [manualLocation, deviceLocation, registeredLocation])

  /** The requester chose a place: from the search, or by moving the pin. */
  const chooseLocation = useCallback((point, name) => {
    setManualLocation({ latitude: point[0], longitude: point[1], accuracy: null, name: name || '' })
    setLocationNote('')
  }, [])

  /**
   * The small recentre control: "put the pin where I am".
   *
   * Asks for a fresh fix, past the cache, and moves the pin only if that fix is
   * precise. A coarse answer leaves the destination exactly where it is --
   * moving it to a city centre is the bug this screen exists not to have.
   */
  const recentre = useCallback(async () => {
    setLocating(true)
    const fix = await readPreciseDeviceLocation(0)
    setLocating(false)
    if (!fix) {
      setLocationNote(IMPRECISE_NOTE)
      return
    }
    setManualLocation(null)
    setDeviceLocation(fix)
    setLocationNote('')
  }, [readPreciseDeviceLocation])

  // Loaded only once the booking session is confirmed: the catalog sits behind
  // that session, so asking before it exists fails with nothing to recover it.
  // Re-runs when the session comes back after a reconnect, and on "Try again".
  const tradeCode = type?.code
  useEffect(() => {
    if (!serviceSlug || !tradeCode) {
      setServiceLoad({ status: 'idle', service: null, message: '' })
      return undefined
    }
    setServiceLoad({ status: 'loading', service: null, message: '' })
    if (session.status !== 'ready') return undefined
    let cancelled = false
    fetchService(tradeCode, serviceSlug)
      .then((row) => {
        if (cancelled) return
        // The server only returns live services; this makes sure the one that
        // came back is the one the URL names, for the trade being booked.
        if (!row?.id || row.trade !== tradeCode || row.slug !== serviceSlug.toLowerCase()) {
          setServiceLoad({ status: 'error', service: null, message: 'That service is not available for this trade.' })
          return
        }
        setServiceLoad({ status: 'ready', service: row, message: '' })
      })
      .catch((error) => {
        if (cancelled) return
        setServiceLoad({ status: 'error', service: null, message: apiErrorMessage(error, 'That service could not be loaded.') })
        if (error?.response?.status === 401) session.reconnect()
      })
    return () => { cancelled = true }
    // `session.reconnect` is stable; the session is followed through its status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceSlug, tradeCode, session.status, serviceAttempt])

  if (!type) return <Navigate to="/book-technician" replace />
  const requester = session.requester

  const submit = async (event) => {
    event.preventDefault()
    if (!serviceLocation) {
      setState({ status: 'form', message: 'Choose where the work is needed on the map first.', existingId: null })
      return
    }
    // The button is already disabled until the service is loaded; this holds
    // even if a submit arrives some other way.
    if (!serviceReady) return
    setState({ status: 'searching', message: '', existingId: null })
    const started = Date.now()
    try {
      const booking = await createBooking({
        technicianType: type.code,
        // The id only. The price is resolved on the server from the catalog.
        serviceId: serviceRequired ? service.id : null,
        description: serviceArea,
        // Exactly what is on the map: a chosen place if there is one, otherwise
        // this device's own position. Never the profile's PIN code or address.
        serviceLatitude: serviceLocation.latitude,
        serviceLongitude: serviceLocation.longitude,
        serviceAccuracy: serviceLocation.accuracy,
      })
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, MINIMUM_SEARCH_MS - (Date.now() - started))))
      navigate(`/book-technician/bookings/${booking.id}`, { replace: true })
    } catch (error) {
      if (error?.response?.status === 401) {
        setState({ status: 'form', message: `Your booking session had expired. Click Book ${type.label} again.`, existingId: null })
        session.reconnect()
        return
      }
      const detail = error?.response?.data?.detail
      setState({
        status: 'form',
        message: apiErrorMessage(error, 'The booking could not be created.'),
        existingId: error?.response?.status === 409 && detail?.booking_id ? detail.booking_id : null,
      })
    }
  }

  return (
    <BookingShell session={session} wide>
      {requester && (
        <div className="space-y-6">
          <Link
            to={serviceSlug ? `/book-technician/${type.slug}` : '/book-technician'}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-oc-muted hover:text-oc-deep"
          >
            <ArrowLeft className="h-4 w-4" /> {serviceSlug ? `All ${type.label.toLowerCase()} services` : 'All services'}
          </Link>

          {serviceLoad.status === 'error' && (
            <Alert tone="error">
              {serviceLoad.message}{' '}
              <button
                type="button"
                className="font-extrabold underline"
                onClick={() => setServiceAttempt((attempt) => attempt + 1)}
              >
                Try again
              </button>
            </Alert>
          )}

          {state.status === 'searching' ? (
            <SearchLoader image={type.heroImage}message={`Finding ${type.plural} near that location...`} />
          ) : (
            <form onSubmit={submit} className="card overflow-hidden">
              <div className={`flex items-center gap-3 bg-gradient-to-b ${type.tint} px-4 py-2`}>
                <img src={type.heroImage} alt="" className="h-14 w-auto shrink-0" />
                <div className="min-w-0">
                  <h1 className="text-lg font-extrabold tracking-[-0.02em] text-oc-deep">Book a {type.label.toLowerCase()}</h1>
                  <p className="truncate text-xs text-oc-muted">{type.description}</p>
                </div>
              </div>

              {/* Two columns from tablet width up: what is booked, and the controls
                  that place it, in a narrow column on the left; where the work is,
                  with the map, taking the wider right one. The DOM order -- service,
                  location, controls -- is the phone's stacking order, so a phone
                  reads the service, then the map, then the button. */}
              <div className="grid gap-5 p-5 sm:p-6 md:grid-cols-[minmax(260px,2fr)_minmax(0,3fr)] md:grid-rows-[auto_1fr] lg:grid-cols-[minmax(300px,1fr)_minmax(0,2fr)] lg:gap-6">
                {(service || serviceLoad.status === 'loading') && (
                  <div className="md:col-start-1 md:row-start-1">
                    {/* What is being booked and what it costs, shown before the job is
                        placed. Rendered only when the page was reached through the
                        catalog; without it the form is exactly what it always was. */}
                    {service && <ServiceSummary service={service} />}
                    {serviceLoad.status === 'loading' && (
                      <div className="flex items-center gap-2 text-sm text-oc-muted" role="status">
                        <Spinner className="h-4 w-4" /> Loading the service and its price...
                      </div>
                    )}
                  </div>
                )}

                <div className="min-w-0 space-y-4 md:col-start-2 md:row-span-2 md:row-start-1">
                  <ServiceLocationPicker
                    location={serviceLocation}
                    placeName={manualLocation?.name || registeredLocation?.name || ''}
                    locating={locating}
                    resolving={stillLooking && !serviceLocation}
                    note={locationNote}
                    onChoose={chooseLocation}
                    onRecentre={recentre}
                    className="h-[300px] sm:h-[360px] md:h-[440px] lg:h-[min(60vh,560px)]"
                  />
                  {/* An alert only for the one case that needs the requester to act:
                      nothing could be worked out at all. Sitting on the registered
                      address is the normal, working state and says so quietly, in
                      the picker, rather than through a coloured box. */}
                  {!stillLooking && !serviceLocation && <Alert tone="info">{NO_LOCATION_MESSAGE}</Alert>}

                  {!requester.has_service_location && (
                    <Alert tone="error">Add your address and PIN code to your CREWNBUILD profile, then click Book Technician again.</Alert>
                  )}
                </div>

                <div className="space-y-4 md:col-start-1 md:row-start-2">
                  <label className="block">
                    <span className="field-label">Service area</span>
                    <select
                      className="field-input"
                      required
                      value={serviceArea}
                      onChange={(event) => setServiceArea(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose the area to be worked on
                      </option>
                      {SERVICE_AREAS.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs text-oc-muted">
                      Which part of the property the {type.label.toLowerCase()} is needed for.
                    </span>
                  </label>

                  {/* Only when there is something to say: an empty message must not draw an empty red box. */}
                  {state.message && (
                    <Alert tone="error">
                      {state.message}
                      {state.existingId && (
                        <>
                          {' '}<Link to={`/book-technician/bookings/${state.existingId}`} className="font-extrabold underline">Track that booking</Link>
                        </>
                      )}
                    </Alert>
                  )}

                  <button
                    type="submit"
                    className="btn-primary w-full py-3"
                    disabled={!requester.has_service_location || !serviceArea || !serviceLocation || !serviceReady || state.status !== 'form'}
                  >
                    {state.status !== 'form' || serviceLoad.status === 'loading' ? <Spinner className="h-4 w-4" /> : <CalendarCheck className="h-4 w-4" />} Find nearby {type.plural}
                  </button>
                  <p className="text-center text-xs text-oc-muted">
                    We ask the {type.plural} nearest to that pin first. Their name and phone number appear once one accepts.
                  </p>
                </div>
              </div>
            </form>
          )}
        </div>
      )}
    </BookingShell>
  )
}
