/**
 * One of the seller's own listings, as a card on the Sell tab.
 *
 * Laid out as the Buy & Sell reference: a photo with "For sale / For rent" and
 * the property type on it and the photo count in its corner; the price with
 * Negotiable; the title; the place; three facts in equal boxes; then View
 * Details and View & Manage. Every value is the listing's own. Both buttons
 * (and the card) open the same detail panel as before, where Edit, the status
 * moves and Delete live -- nothing about what they do has changed.
 */
import { Bath, BedDouble, Camera, Compass, Eye, Home, Layers, MapPin, Maximize2, Sofa, SlidersHorizontal } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { statusLabel } from '../../../shared/dashboard/StatusPill.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { areaLabel, bhkLabel, codeLabel, facingLabel } from './PropertyCard.jsx'

// A listing that is not simply live says so on the photo, in its own colour.
const STATUS_TONES = {
  draft: 'bg-slate-700 text-white',
  under_offer: 'bg-amber-500 text-white',
  sold: 'bg-sky-600 text-white',
  withdrawn: 'bg-rose-600 text-white',
}

// `browse`: the same card for a listing on the Buy tab -- no status badge
// (every listing there is live) and one View Details button, since only the
// seller can manage a listing.
export default function SellListingCard({ listing, onOpen, browse = false }) {
  const { t, td } = useLanguage()
  const cover = listing.cover_image_url || listing.images?.[0]?.image_url || ''
  const photoCount = listing.images?.length || (cover ? 1 : 0)
  const status = String(listing.status || '').toLowerCase()
  const place = [
    [listing.city, listing.state].filter(Boolean).map((part) => td(part)).join(', '),
    listing.pincode,
  ].filter(Boolean).join(' - ')

  // The first three facts the seller gave, each in its own box.
  const bhk = bhkLabel(listing, t)
  const area = areaLabel(listing, t)
  const facts = [
    area ? { key: 'area', icon: Maximize2, text: area } : null,
    bhk ? { key: 'bhk', icon: BedDouble, text: bhk } : null,
    Number(listing.bathrooms) > 0 ? { key: 'bath', icon: Bath, text: `${listing.bathrooms} ${t('property.bathrooms')}` } : null,
    listing.facing ? { key: 'facing', icon: Compass, text: facingLabel(t, listing.facing, td) } : null,
    listing.furnishing ? { key: 'furnishing', icon: Sofa, text: codeLabel(t, 'property.furnishing', listing.furnishing, td) } : null,
    Number(listing.floors) > 0 ? { key: 'floors', icon: Layers, text: `${listing.floors} ${t('property.floors')}` } : null,
  ].filter(Boolean).slice(0, 3)

  const open = (event) => { event.stopPropagation(); onOpen?.() }

  return (
    <article
      onClick={onOpen}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-oc-line bg-white shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-ocbrand-200 hover:shadow-[0_18px_38px_-26px_rgba(15,23,42,0.45)]"
    >
      <div className="relative h-28 overflow-hidden bg-oc-sunken sm:h-32">
        {cover ? (
          <SmartImage src={imageUrl(cover)} alt={td(listing.title)} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="grid h-full place-items-center text-oc-faint"><Home className="h-8 w-8" strokeWidth={1.5} /></div>
        )}
        <div className="absolute start-3 top-3 flex flex-col items-start gap-1.5">
          <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            {codeLabel(t, 'property.listing', listing.listing_type, td) || t('property.listing.SALE')}
          </span>
          {!browse && STATUS_TONES[status] && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-sm ${STATUS_TONES[status]}`}>{statusLabel(listing.status, t)}</span>
          )}
        </div>
        <span className="absolute end-3 top-3 rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-semibold text-oc-ink shadow-sm">
          {codeLabel(t, 'property.type', listing.property_type, td) || t('property.property')}
        </span>
        {photoCount > 0 && (
          <span className="absolute bottom-3 end-3 inline-flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            <Camera className="h-3 w-3" /> {t('property.photosCount', { count: photoCount })}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-lg font-bold tracking-tight text-oc-deep">{formatMoney(listing.price, listing.country)}</p>
          {listing.is_negotiable && (
            <span className="shrink-0 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-600">{t('property.negotiable')}</span>
          )}
        </div>
        <h3 className="mt-0.5 truncate font-display text-sm font-semibold leading-snug text-oc-ink" title={td(listing.title)}>{td(listing.title)}</h3>
        {place && (
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-oc-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{place}</span>
          </p>
        )}
        {facts.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {facts.map((fact) => (
              <span key={fact.key} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-slate-50 px-1.5 py-1.5 text-[11px] font-medium text-oc-ink/85">
                <fact.icon className="h-3.5 w-3.5 shrink-0 text-oc-muted" /> <span className="truncate">{fact.text}</span>
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-3">
          <div className={`grid gap-2 border-t border-oc-line pt-3 ${browse ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={open}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-oc-line bg-white px-2.5 py-2 text-xs font-semibold text-oc-ink transition hover:bg-slate-50"
            >
              <Eye className="h-3.5 w-3.5" /> {t('property.viewDetails')}
            </button>
            {!browse && (
              <button
                type="button"
                onClick={open}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-oc-deep px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-oc-green"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> {t('property.viewManage')}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
