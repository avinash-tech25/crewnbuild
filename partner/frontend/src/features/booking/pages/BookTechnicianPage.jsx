import { Link } from 'react-router-dom'
import { ArrowRight, MapPin } from 'lucide-react'
import { Alert } from '../../../shared/ui/ui.jsx'
import { TECHNICIAN_TYPES } from '../../../shared/constants/technicianTypes.js'
import useRequesterSession from '../useRequesterSession.js'
import BookingShell from '../components/BookingShell.jsx'
import MyBookings from '../components/MyBookings.jsx'

// Each trade's card colours on this page: a soft card, a rounder tint behind
// the figure. Presentation only -- the trades themselves are TECHNICIAN_TYPES.
const CARD_TONES = {
  PAINTER: { card: 'from-orange-50 to-amber-50/40 border-orange-100', disc: 'bg-orange-100/80' },
  PLUMBER: { card: 'from-sky-50 to-blue-50/40 border-sky-100', disc: 'bg-sky-100/80' },
  ELECTRICIAN: { card: 'from-yellow-50 to-amber-50/40 border-yellow-100', disc: 'bg-yellow-100/80' },
  CARPENTER: { card: 'from-rose-50 to-pink-50/40 border-rose-100', disc: 'bg-rose-100/80' },
}

export default function BookTechnicianPage() {
  const session = useRequesterSession()
  const requester = session.requester

  return (
    <BookingShell session={session} wide>
      {requester && (
        <div className="space-y-5">
          {/* The page's own banner: the existing heading and explanation on a
              soft mint-to-cream card. */}
          <section className="overflow-hidden rounded-3xl border border-oc-line bg-gradient-to-r from-[#e8f4ec] via-[#f3f7ee] to-[#fbf6e8] px-5 py-6 sm:px-8 sm:py-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-oc-line bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-oc-deep">
              <MapPin className="h-3.5 w-3.5 text-oc-green" /> Book for any location
            </p>
            <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em] text-oc-deep sm:text-3xl">What do you need help with?</h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-oc-muted">
              Choose a service, then place the job on the map. We ask the available technicians nearest to it first.
            </p>
            {!requester.has_service_location && (
              <div className="mt-4 max-w-2xl">
                <Alert tone="error">Add your address and PIN code to your CREWNBUILD profile, then click Book Technician again.</Alert>
              </div>
            )}
          </section>

          {/* The four trades: figure in a soft disc on the left, then the name,
              Partner's description and the same Book link as before. */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TECHNICIAN_TYPES.map((type) => {
              const tone = CARD_TONES[type.code] || CARD_TONES.PLUMBER
              return (
                <article key={type.code} className={`flex items-center gap-3 overflow-hidden rounded-2xl border bg-gradient-to-br p-3 ${tone.card}`}>
                  <span className="relative block h-32 w-28 shrink-0 overflow-hidden">
                    <span className={`absolute left-1/2 top-4 h-24 w-24 -translate-x-1/2 rounded-full ${tone.disc}`} aria-hidden="true" />
                    <img src={type.heroImage} alt="" loading="lazy" className="relative mx-auto h-[150%] w-auto max-w-none object-contain object-top" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="font-display text-base font-extrabold text-oc-ink">{type.label}</h3>
                    <p className="mt-1 line-clamp-3 text-xs leading-snug text-oc-muted">{type.description}</p>
                    <Link
                      to={`/book-technician/${type.slug}`}
                      className="mt-3 inline-flex h-9 items-center gap-1.5 self-start whitespace-nowrap rounded-lg bg-oc-deep px-3.5 text-xs font-extrabold text-white transition hover:bg-oc-green"
                    >
                      Book {type.label} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </article>
              )
            })}
          </section>

          <MyBookings />
        </div>
      )}
    </BookingShell>
  )
}
