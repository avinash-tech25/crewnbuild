import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChevronDown, ClipboardList, Phone, Star } from 'lucide-react'
import { Alert, EmptyState, Spinner } from '../../../shared/ui/ui.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchMyBookings } from '../bookingApi.js'
import { BookingStatusBadge, TradeThumb } from './BookingUi.jsx'

// "Oct 1, 9:56 AM". The API sends UTC timestamps without a zone suffix, the
// same rule formatDate in ui.jsx applies.
function bookingTime(value) {
  if (!value) return ''
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// The filter only narrows the list already loaded; it asks the server nothing.
const FILTERS = [
  { id: 'all', label: 'All bookings', statuses: null },
  { id: 'active', label: 'Active', statuses: ['SEARCHING', 'OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
  { id: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['CANCELLED'] },
  { id: 'none', label: 'No technician found', statuses: ['NO_TECHNICIAN_FOUND', 'EXPIRED'] },
]

export default function MyBookings() {
  const [bookings, setBookings] = useState(null)
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState('all')

  const load = useCallback(() => {
    fetchMyBookings()
      .then(setBookings)
      .catch((error) => {
        setBookings([])
        setMessage(apiErrorMessage(error, 'Unable to load your bookings.'))
      })
  }, [])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const statuses = FILTERS.find((entry) => entry.id === filter)?.statuses
    return (bookings || []).filter((booking) => !statuses || statuses.includes(booking.status))
  }, [bookings, filter])

  return (
    <section id="my-bookings" className="scroll-mt-20 rounded-3xl border border-oc-line bg-white p-4 shadow-ocsoft sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-oc-deep">
          <CalendarDays className="h-5 w-5 text-oc-deep" aria-hidden="true" />
          My bookings
          {bookings?.length > 0 && (
            <span className="rounded-full bg-oc-sunken px-2 py-0.5 text-xs font-bold text-oc-ink">{bookings.length}</span>
          )}
        </h2>
        {bookings?.length > 0 && (
          <label className="relative">
            <span className="sr-only">Show</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="h-9 appearance-none rounded-xl border border-oc-line bg-white pl-3 pr-9 text-sm font-semibold text-oc-ink outline-none transition focus:border-oc-green"
              data-testid="bookings-filter"
            >
              {FILTERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oc-muted" aria-hidden="true" />
          </label>
        )}
      </div>
      <Alert tone="error">{message}</Alert>
      {bookings === null ? (
        <div className="flex justify-center py-8 text-oc-green"><Spinner className="h-6 w-6" /></div>
      ) : bookings.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No bookings yet">Choose a service above to book a technician near you.</EmptyState>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-oc-line px-4 py-6 text-center text-sm text-oc-muted">No bookings in this list.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((booking) => {
            const type = technicianTypeByCode(booking.technician_type)
            return (
              // One booking per row: who and what on the left, the contact in
              // the middle, the actions on the right.
              <article key={booking.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-oc-line bg-white px-3 py-2.5 sm:flex-nowrap">
                <TradeThumb type={type} size="h-12 w-12" />
                <div className="min-w-0 flex-1 sm:flex-none sm:basis-[300px]">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-display text-sm font-extrabold text-oc-ink">{type?.label}</span>
                    <BookingStatusBadge status={booking.status} label={booking.status_label} />
                  </div>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-oc-muted">
                    {booking.technician && <span className="font-semibold text-oc-ink">{booking.technician.name}</span>}
                    <span>{bookingTime(booking.created_at)}</span>
                  </p>
                </div>
                <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:w-auto sm:flex-1">
                  {booking.technician?.phone ? (
                    <a href={`tel:${booking.technician.phone}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-oc-ink hover:text-oc-green">
                      <Phone className="h-3.5 w-3.5 text-oc-muted" /> {booking.technician.phone}
                    </a>
                  ) : <span />}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {booking.can_rate && (
                      <Link
                        to={`/book-technician/bookings/${booking.id}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-3 py-1 text-xs font-extrabold text-amber-900 hover:bg-amber-200"
                        data-testid="rate-technician-badge"
                      >
                        <Star className="h-3.5 w-3.5 fill-current" /> Rate technician
                      </Link>
                    )}
                    <Link
                      to={`/book-technician/bookings/${booking.id}`}
                      className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-green transition hover:border-oc-green hover:bg-oc-mint sm:px-3.5 sm:text-sm"
                    >
                      Track booking <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
