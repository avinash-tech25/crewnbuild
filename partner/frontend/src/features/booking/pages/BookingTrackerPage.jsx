import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Clock, MapPin, Navigation, Phone, RefreshCw, SearchX, X } from 'lucide-react'
import { Alert, EmptyState, SearchLoader, Spinner, formatDate } from '../../../shared/ui/ui.jsx'
import LiveTrackingPanel from '../../tracking/components/LiveTrackingPanel.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import { formatDistance } from '../../../shared/constants/tracking.js'
import useRequesterSession from '../useRequesterSession.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { cancelBooking, fetchBooking, retryBooking } from '../bookingApi.js'
import { requesterWorkBillApi } from '../../technician/workBillApi.js'
import WorkBill from '../../technician/components/WorkBill.jsx'
import BookingShell from '../components/BookingShell.jsx'
import JobProgressPanel from '../components/JobProgressPanel.jsx'
import { StartWorkOtpCard, WorkStartedNote } from '../components/StartWorkOtpCard.jsx'
import RateTechnicianCard from '../components/RateTechnicianCard.jsx'
import { ratingSummary } from '../rating.js'
import { PROGRESS_STATUSES } from '../jobProgress.js'
import { BookingStatusBadge, TradeThumb } from '../components/BookingUi.jsx'

// The requester's view of progress, in order. SEARCHING/OFFERED share the first steps.
const TIMELINE = [
  { key: 'created_at', label: 'Requested' },
  { key: 'assigned_at', label: 'Offered to nearby technicians' },
  { key: 'accepted_at', label: 'Accepted' },
  { key: 'en_route_at', label: 'On the way' },
  { key: 'arrived_at', label: 'Arrived' },
  { key: 'started_at', label: 'Work started' },
  { key: 'completed_at', label: 'Completed' },
]
const FINISHED = ['COMPLETED', 'CANCELLED', 'NO_TECHNICIAN_FOUND', 'EXPIRED']
const POLL_MS = 8000

function TrackerBody({ bookingId, onUnauthorized }) {
  const [booking, setBooking] = useState(null)
  const [message, setMessage] = useState({ tone: 'info', text: '' })
  const [busy, setBusy] = useState('')
  // Reported by the live tracking panel below, so the technician's card and the
  // map's summary quote the same remaining road distance. Null until there is a
  // route -- while the job is still being offered there is nothing to quote, and
  // the distance the search matched on stands.
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState(null)

  const load = useCallback(async () => {
    try {
      setBooking(await fetchBooking(bookingId))
    } catch (error) {
      if (error?.response?.status === 401) { onUnauthorized(); return }
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'This booking could not be loaded.') })
    }
  }, [bookingId, onUnauthorized])

  useEffect(() => { load() }, [load])

  // Status changes come from the technician's side; follow them while the booking is open.
  useEffect(() => {
    if (!booking || FINISHED.includes(booking.status)) return undefined
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [booking, load])

  const run = async (action) => {
    setBusy(action)
    setMessage({ tone: 'info', text: '' })
    try {
      setBooking(action === 'cancel' ? await cancelBooking(bookingId) : await retryBooking(bookingId))
      if (action === 'cancel') setMessage({ tone: 'success', text: 'Booking cancelled.' })
    } catch (error) {
      setMessage({ tone: 'error', text: apiErrorMessage(error, 'That could not be done.') })
      load()
    } finally {
      setBusy('')
    }
  }

  if (!booking) {
    return message.text
      ? <div className="mx-auto max-w-lg"><Alert tone="error">{message.text}</Alert></div>
      : <div className="flex justify-center py-16 text-oc-green"><Spinner className="h-8 w-8" /></div>
  }

  const type = technicianTypeByCode(booking.technician_type)
  const technician = booking.technician
  // `match_label` is how the technician was *found*: a straight-line distance
  // frozen at the moment the job was offered, or the postal area that matched.
  // It is the honest answer right up until a route exists, and the wrong one
  // from the moment one does.
  const distanceLabel =
    remainingDistanceMeters === null || remainingDistanceMeters === undefined
      ? technician?.match_label
      : `${formatDistance(remainingDistanceMeters)} away`

  return (
    <div className="space-y-5">
      {/* Renders nothing until the technician has accepted; closes itself when the booking ends. */}
      <LiveTrackingPanel booking={booking} onRemainingDistance={setRemainingDistanceMeters} />

      {/* Rate the technician: only once the job is completed; skipping is fine. */}
      {booking.status === 'COMPLETED' && <RateTechnicianCard bookingId={bookingId} onRated={load} />}

      <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="card space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <TradeThumb type={type} size="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">Track booking</p>
            <h1 className="truncate text-lg font-extrabold tracking-tight text-oc-deep">{type?.label} booking</h1>
          </div>
        </div>

        {/* The three things people look for first, from the booking itself. */}
        <dl className="grid grid-cols-1 gap-2 rounded-xl border border-oc-line bg-oc-sunken/60 p-3 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">Status</dt>
            <dd className="mt-1"><BookingStatusBadge status={booking.status} label={booking.status_label} /></dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">Technician</dt>
            <dd className="mt-1 truncate text-sm font-bold text-oc-ink">{technician?.name || <span className="font-semibold text-oc-muted">{FINISHED.includes(booking.status) ? '—' : 'Not assigned yet'}</span>}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">Booked</dt>
            <dd className="mt-1 text-sm font-bold text-oc-ink">{formatDate(booking.created_at)}</dd>
          </div>
        </dl>

        <Alert tone={message.tone}>{message.text}</Alert>

        {booking.status === 'SEARCHING' && <SearchLoader image={type?.heroImage} message={`Finding a nearby ${type?.label?.toLowerCase() || 'technician'}...`} />}

        {booking.status === 'OFFERED' && (
          <SearchLoader
            image={type?.heroImage}
            message={`Waiting for a ${type?.label?.toLowerCase() || 'technician'} to accept...`}
          />
        )}

        {(booking.status === 'NO_TECHNICIAN_FOUND' || booking.status === 'EXPIRED') && (
          <EmptyState icon={SearchX} title={booking.message || `No available ${type?.plural || 'technicians'} were found in your locality.`}>
            Try again in a little while: technicians near you may become available.
          </EmptyState>
        )}

        {technician && booking.status !== 'NO_TECHNICIAN_FOUND' && (
          <div className="rounded-xl border border-oc-line p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-oc-muted">Your technician</p>
            <p className="mt-0.5 font-display text-base font-extrabold text-oc-ink">{technician.name}</p>
            <p className={`text-sm font-bold ${technician.rating_count ? 'text-oc-amber' : 'text-oc-muted'}`} data-testid="technician-rating">
              {ratingSummary(technician.average_rating, technician.rating_count).short}
            </p>
            <p className="text-sm text-oc-muted">
              <Clock className="mr-1 inline h-3.5 w-3.5" />{technician.experience_years} {technician.experience_years === 1 ? 'year' : 'years'} experience
              {technician.area ? ` · ${technician.area}` : ''}
            </p>
            {distanceLabel && <p className="mt-1 flex items-center gap-1 text-xs font-bold text-oc-green"><Navigation className="h-3.5 w-3.5" /> {distanceLabel}</p>}
            {technician.phone ? (
              <a href={`tel:${technician.phone}`} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-3 text-sm font-extrabold text-white transition hover:bg-oc-deep"><Phone className="h-4 w-4" /> Call {technician.phone}</a>
            ) : (
              <p className="mt-2 text-xs text-oc-muted">Their phone number appears here once they accept.</p>
            )}
          </div>
        )}

        {(booking.can_retry || booking.can_cancel) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-oc-line pt-3">
            {booking.can_retry && (
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-3 text-sm font-extrabold text-white transition hover:bg-oc-deep disabled:opacity-60" disabled={Boolean(busy)} onClick={() => run('retry')}>
                {busy === 'retry' ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} Search again
              </button>
            )}
            {/* Available, but secondary: never the loudest thing on the page. */}
            {booking.can_cancel && (
              <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-60" disabled={Boolean(busy)} onClick={() => run('cancel')}>
                {busy === 'cancel' ? <Spinner className="h-4 w-4" /> : <X className="h-4 w-4" />} Cancel booking
              </button>
            )}
          </div>
        )}
      </section>

      <aside className="card min-w-0 space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-2 text-sm text-oc-ink">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-oc-green" />
          <span>{booking.service_address}{booking.service_area ? `, ${booking.service_area}` : ''} · PIN {booking.pincode}</span>
        </div>
        {booking.description && <p className="rounded-xl bg-oc-sunken px-3 py-2 text-sm text-oc-ink">“{booking.description}”</p>}
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">Progress</p>
        <ol className="space-y-2">
          {TIMELINE.map((step) => {
            const at = booking[step.key]
            return (
              <li key={step.key} className="flex items-center gap-3">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${at ? 'bg-oc-green text-white' : 'bg-oc-sunken text-oc-muted'}`}>
                  {at ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <span className={`flex-1 text-[13px] font-bold ${at ? 'text-oc-ink' : 'text-oc-muted'}`}>{step.label}</span>
                {at && <span className="text-xs text-oc-muted">{formatDate(at)}</span>}
              </li>
            )
          })}
          {booking.cancelled_at && (
            <li className="flex items-center gap-3">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200"><X className="h-3.5 w-3.5" /></span>
              <span className="flex-1 text-[13px] font-bold text-oc-ink">Cancelled</span>
              <span className="text-xs text-oc-muted">{formatDate(booking.cancelled_at)}</span>
            </li>
          )}
        </ol>
      </aside>
      </div>

      {/* The Start Work code: only while the technician is at the address. */}
      {booking.status === 'ARRIVED' && <StartWorkOtpCard bookingId={bookingId} />}
      {booking.status === 'IN_PROGRESS' && <WorkStartedNote />}

      {/* Checklist and photos as the technician works, read-only. */}
      {PROGRESS_STATUSES.includes(booking.status) && <JobProgressPanel bookingId={bookingId} status={booking.status} />}

      {/* Materials and additional labour the technician billed, read-only. */}
      {['IN_PROGRESS', 'COMPLETED'].includes(booking.status) && (
        <WorkBill jobId={bookingId} status={booking.status} api={requesterWorkBillApi} readOnly />
      )}
    </div>
  )
}

export default function BookingTrackerPage() {
  const { bookingId } = useParams()
  const session = useRequesterSession()

  return (
    <BookingShell session={session}>
      <div className="space-y-6">
        <Link to="/book-technician" className="inline-flex items-center gap-1.5 text-sm font-bold text-oc-muted hover:text-oc-deep">
          <ArrowLeft className="h-4 w-4" /> Services and my bookings
        </Link>
        <TrackerBody bookingId={bookingId} onUnauthorized={session.reconnect} />
      </div>
    </BookingShell>
  )
}
