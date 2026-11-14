import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Wrench } from 'lucide-react'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { serviceImage } from '../../../shared/constants/serviceImages.js'
import { technicianTypeBySlug } from '../../../shared/constants/technicianTypes.js'
import useRequesterSession from '../useRequesterSession.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { fetchServices } from '../bookingApi.js'
import { formatRupees } from '../../../shared/utils/money.js'
import BookingShell from '../components/BookingShell.jsx'

/**
 * A trade's catalog: what can be booked, and what each one costs.
 *
 * The step between choosing Plumber and placing the job on the map. Prices come
 * from the server and are shown as they arrive; nothing is calculated here.
 */
export default function ServiceListPage() {
  const { typeSlug } = useParams()
  const type = technicianTypeBySlug(typeSlug)
  const session = useRequesterSession()
  const requester = session.requester

  const [services, setServices] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!requester || !type) return undefined
    let cancelled = false
    fetchServices(type.code)
      .then((rows) => { if (!cancelled) setServices(rows) })
      .catch((error) => { if (!cancelled) setMessage(apiErrorMessage(error, 'The services could not be loaded.')) })
    return () => { cancelled = true }
  }, [requester, type])

  if (!type) return <Navigate to="/book-technician" replace />

  return (
    <BookingShell session={session} wide>
      {requester && (
        <div className="space-y-8">
          <div>
            <Link to="/book-technician" className="inline-flex items-center gap-1.5 text-sm font-bold text-oc-muted hover:text-oc-deep">
              <ArrowLeft className="h-4 w-4" /> All trades
            </Link>
            <h1 className="mt-4 text-[clamp(1.7rem,3vw,2.4rem)] font-extrabold tracking-[-0.03em] text-oc-deep">
              {type.label} services
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-oc-muted">Choose what you need. The price is shown before you book.</p>
          </div>

          <Alert tone="error">{message}</Alert>

          {services === null && !message ? (
            <div className="flex justify-center py-16 text-oc-green"><Spinner className="h-8 w-8" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
              {(services || []).map((service) => (
                <Link
                  key={service.id}
                  to={`/book-technician/${type.slug}/${service.slug}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-oc-line bg-white shadow-ocsoft transition duration-300 ease-soft hover:-translate-y-1 hover:shadow-lift"
                >
                  {serviceImage(service) ? (
                    <img src={serviceImage(service)} alt={service.service_name} className="h-24 w-full object-cover" />
                  ) : (
                    /* No artwork supplied yet: a neutral tile, never a stand-in
                       photograph of work this service may not be. */
                    <div className="grid h-24 w-full place-items-center border-b border-dashed border-oc-line bg-oc-sunken text-oc-muted" aria-hidden="true">
                      <Wrench className="h-6 w-6" />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <h2 className="font-display text-sm font-extrabold leading-snug text-oc-ink">{service.service_name}</h2>
                    {service.service_kind === 'CONSULTATION' && (
                      <span className="w-fit rounded-full bg-oc-mint px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-oc-deep">
                        Consultation
                      </span>
                    )}
                    <p className="mt-auto pt-2 font-display text-base font-extrabold text-oc-deep">{formatRupees(service.price)}</p>
                    <span className="inline-flex items-center gap-1 text-xs font-extrabold text-oc-green">
                      View &amp; book <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
              ))}
              {services !== null && services.length === 0 && !message && (
                <p className="text-sm text-oc-muted col-span-full">No {type.plural} services are listed yet.</p>
              )}
            </div>
          )}
        </div>
      )}
    </BookingShell>
  )
}
