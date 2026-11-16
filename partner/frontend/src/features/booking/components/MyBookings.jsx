import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarDays, ChevronDown, ClipboardList, Phone, Star } from 'lucide-react'
import { Alert, EmptyState, Spinner } from '../../../shared/ui/ui.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchMyBookings } from '../bookingApi.js'
import { CardAvatar, CardGrid, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { TradeThumb, statusSentence } from './BookingUi.jsx'

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
  // The filter is in the address (?filter=completed), so it survives a refresh and Back.
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = FILTERS.some((item) => item.id === searchParams.get('filter')) ? searchParams.get('filter') : 'all'
  const setFilter = (value) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (value && value !== 'all') next.set('filter', value)
    else next.delete('filter')
    return next
  })

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
        <CardGrid label="My bookings" testId="booking-list">
          {shown.map((booking) => {
            const type = technicianTypeByCode(booking.technician_type)
            return (
              <ListCard
                key={booking.id}
                testId="booking-card"
                dataStatus={booking.status}
                avatar={<CardAvatar fallback={<TradeThumb type={type} size="h-12 w-12" />} />}
                title={type?.label}
                subtitle={bookingTime(booking.created_at)}
                status={<CardStatus status={booking.status}>{statusSentence(booking.status_label || booking.status)}</CardStatus>}
                rows={[
                  { key: 'technician', label: 'Technician', value: booking.technician?.name },
                  {
                    key: 'phone',
                    label: 'Phone',
                    title: booking.technician?.phone,
                    value: booking.technician?.phone ? (
                      <a href={`tel:${booking.technician.phone}`} className="inline-flex items-center gap-1.5 rounded hover:text-oc-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oc-green">
                        <Phone className="h-3.5 w-3.5 text-oc-muted" aria-hidden="true" /> {booking.technician.phone}
                      </a>
                    ) : null,
                  },
                ]}
                secondary={booking.can_rate && (
                  <Link
                    to={`/book-technician/bookings/${booking.id}`}
                    className={cardButtonClass('secondary')}
                    data-testid="rate-technician-badge"
                  >
                    <Star className="h-3.5 w-3.5 fill-current text-amber-500" aria-hidden="true" /> Rate technician
                  </Link>
                )}
                primary={(
                  <Link to={`/book-technician/bookings/${booking.id}`} className={cardButtonClass('primary')}>
                    Track booking <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              />
            )
          })}
        </CardGrid>
      )}
    </section>
  )
}
