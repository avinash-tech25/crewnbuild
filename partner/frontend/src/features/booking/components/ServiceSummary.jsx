import { Wrench } from 'lucide-react'
import { serviceImage } from '../../../shared/constants/serviceImages.js'
import { formatRupees } from '../../../shared/utils/money.js'

/**
 * What the customer is booking, and what it costs.
 *
 * The price shown is the one the server sent with the service. The booking does
 * not send it back -- it sends the service's id, and the amount is read from the
 * catalog again on the server -- so what is on screen cannot drift from what is
 * charged, and nothing here can influence it.
 *
 * `image_url`, `description` and `includes` are all optional. A service with
 * none of them still books: the block renders the name and the price, and simply
 * leaves out what has not been supplied rather than showing invented copy.
 */
export default function ServiceSummary({ service, compact = false }) {
  if (!service) return null
  const imageSrc = serviceImage(service)
  const includes = (service.includes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <div className={compact ? 'flex items-center gap-4' : 'space-y-4'}>
      <div className={compact ? 'shrink-0' : ''}>
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={service.service_name}
            // The full-size picture keeps its own shape and is shown whole, never
            // cropped: a wide, short box with object-cover showed only a band of
            // it (the Consultation technician lost his head). It shrinks to the
            // column and is capped in height so it stays compact.
            className={`rounded-2xl border border-oc-line ${
              compact ? 'h-16 w-16 object-cover' : 'mx-auto block h-auto max-h-64 w-auto max-w-full object-contain'
            }`}
          />
        ) : (
          // No artwork yet. A neutral tile rather than a broken image or a
          // stand-in photograph of work this service may not be.
          <div
            className={`grid place-items-center rounded-2xl border border-dashed border-oc-line bg-oc-sunken text-oc-muted ${
              compact ? 'h-16 w-16' : 'aspect-[3/2] max-h-64 w-full'
            }`}
            aria-hidden="true"
          >
            <Wrench className={compact ? 'h-5 w-5' : 'h-8 w-8'} />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={`font-display font-extrabold text-oc-ink ${compact ? 'text-base' : 'text-xl'}`}>
            {service.service_name}
          </h2>
          <p className={`font-display font-extrabold text-oc-deep ${compact ? 'text-base' : 'text-xl'}`}>
            {formatRupees(service.price)}
          </p>
        </div>

        {service.service_kind === 'CONSULTATION' && (
          <span className="mt-1 inline-flex items-center rounded-full bg-oc-mint px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-oc-deep">
            Consultation
          </span>
        )}

        {service.description && (
          <p className={`text-sm leading-relaxed text-oc-muted ${compact ? 'mt-1' : 'mt-3'}`}>{service.description}</p>
        )}

        {includes.length > 0 && !compact && (
          <div className="mt-4">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-oc-muted">Includes</p>
            <ul className="mt-2 space-y-1 text-sm text-oc-ink">
              {includes.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-oc-green" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
