/**
 * One property, in full.
 *
 * Opens as an overlay through a portal, the same way BuyerProductCard already
 * opens a material — photo on the left, everything needed to decide on the
 * right — so a property detail reads like the rest of this application rather
 * than like a new screen.
 *
 * Contact privacy: the seller's phone and e-mail are shown only when the API
 * said they may be. This component never decides that for itself and never
 * infers it from anything else in the payload — it renders `can_view_contact`
 * as the server sent it.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  Compass,
  Home,
  Layers,
  MapPin,
  Maximize2,
  Sofa,
  X,
} from 'lucide-react'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { EntityAvatar } from '../../../shared/ui/EntityPill.jsx'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { codeLabel, facingLabel, listingBedrooms, readableCode } from './PropertyCard.jsx'

// The seller's role code as the role name the rest of the app shows.
const SELLER_ROLE_KEYS = {
  OWNER: 'role.owner',
  CONTRACTOR: 'role.contractor',
  BUILDER: 'role.contractor',
  SUPPLIER: 'role.supplier',
  ENGINEER: 'role.engineer',
}

function Fact({ icon: Icon, label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="rounded-lg border border-oc-line bg-oc-sunken px-2.5 py-1.5">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-oc-faint">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className="mt-0.5 break-words text-[13px] font-semibold leading-snug text-oc-ink">{value}</p>
    </div>
  )
}

export default function PropertyDetailPanel({ listing, onClose, footer }) {
  const { t, td } = useLanguage()
  const [activeImage, setActiveImage] = useState(0)

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  if (!listing) return null

  // The cover first, then the gallery the seller ordered. Nothing is invented:
  // an empty gallery simply shows no photo.
  const gallery = [
    ...(listing.cover_image_url ? [listing.cover_image_url] : []),
    ...(listing.images || []).map((image) => image.image_url),
  ].filter((url, index, all) => url && all.indexOf(url) === index)
  const shown = gallery[Math.min(activeImage, gallery.length - 1)]
  // `toLocaleString()` with no locale followed the BROWSER's language, not the
  // one the reader picked. `formatNumber` follows the selection, and never rounds.
  const area = (value) => (Number(value) > 0 ? `${formatNumber(value)} ${t('property.sqft')}` : '')

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-oc-line bg-white shadow-[0_24px_60px_-30px_rgba(15,23,42,0.5)]">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-oc-line bg-white/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[.14em] text-oc-faint">
              {codeLabel(t, 'property.type', listing.property_type, td) || t('property.property')}
              {listing.listing_type ? ` · ${codeLabel(t, 'property.listing', listing.listing_type, td)}` : ''}
            </p>
            <h2 className="mt-0.5 truncate font-display text-base font-bold text-oc-ink">{td(listing.title)}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill status={listing.status} />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('dash.common.close')}
              className="grid h-8 w-8 place-items-center rounded-lg text-oc-muted transition hover:bg-oc-sunken hover:text-oc-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div>
            {shown ? (
              <>
                {/* object-contain, not object-cover: the whole photo is shown
                    whatever its aspect ratio, so a portrait, square or wide
                    property image is never cropped. The box stays a fixed
                    height so the panel does not resize per photo; any space
                    left over by the aspect ratio is filled by the neutral
                    surface behind it. */}
                <SmartImage src={imageUrl(shown)} alt={td(listing.title)} className="h-56 w-full rounded-xl bg-oc-sunken object-contain md:h-64" />
                {gallery.length > 1 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {gallery.map((url, index) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setActiveImage(index)}
                        aria-label={`${t('property.photo')} ${index + 1}`}
                        className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                          index === activeImage ? 'border-oc-green' : 'border-oc-line hover:border-ocbrand-200'
                        }`}
                      >
                        <SmartImage src={imageUrl(url)} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="grid h-56 w-full place-items-center rounded-xl border border-dashed border-oc-line bg-oc-sunken text-xs font-semibold text-oc-muted">
                {t('property.noPhotos')}
              </div>
            )}
            {/* The walkthrough video, when the seller added one. Below the
                photos so the existing gallery is untouched, and only rendered
                at all when there is a video. `controls preload="metadata"` is
                the same arrangement the site-record player already uses. */}
            {listing.video_url && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-bold text-oc-muted">{t('property.detail.video')}</p>
                <video
                  src={imageUrl(listing.video_url)}
                  controls
                  preload="metadata"
                  className="h-56 w-full rounded-xl bg-oc-sunken object-contain md:h-64"
                />
              </div>
            )}
          </div>

          <div>
            <p className="font-display text-xl font-bold text-oc-deep">
              {formatMoney(listing.price, listing.country)}
            </p>
            {listing.is_negotiable && (
              <p className="mt-0.5 text-xs font-semibold text-oc-muted">{t('property.negotiable')}</p>
            )}

            <p className="mt-3 flex items-start gap-1.5 text-sm font-semibold text-oc-ink">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-oc-green" />
              {/* The address the seller typed, then their city and state. */}
              <span>{td([listing.address, listing.city, listing.state].filter(Boolean).join(', '))}{listing.pincode ? `, ${listing.pincode}` : ''}</span>
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Fact icon={BedDouble} label={t('property.bedrooms')} value={listingBedrooms(listing) > 0 ? listingBedrooms(listing) : ''} />
              <Fact icon={Bath} label={t('property.bathrooms')} value={Number(listing.bathrooms) > 0 ? listing.bathrooms : ''} />
              <Fact icon={Maximize2} label={t('property.builtUpArea')} value={area(listing.built_up_area)} />
              <Fact icon={Maximize2} label={t('property.carpetArea')} value={area(listing.carpet_area)} />
              <Fact icon={Maximize2} label={t('property.landArea')} value={area(listing.land_area)} />
              <Fact icon={Layers} label={t('property.floors')} value={Number(listing.floors) > 0 ? listing.floors : ''} />
              <Fact icon={Sofa} label={t('property.furnishing')} value={codeLabel(t, 'property.furnishing', listing.furnishing, td)} />
              <Fact icon={Compass} label={t('property.facing')} value={facingLabel(t, listing.facing, td)} />
              <Fact icon={CalendarClock} label={t('property.age')} value={Number(listing.age_years) > 0 ? `${listing.age_years}` : ''} />
              <Fact icon={Home} label={t('property.type')} value={codeLabel(t, 'property.type', listing.property_type, td)} />
            </div>
          </div>

          {listing.description && (
            <section className="md:col-span-2">
              <h3 className="font-display text-sm font-extrabold text-oc-ink">{t('property.about')}</h3>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-oc-muted">{td(listing.description)}</p>
            </section>
          )}

          {listing.seller_name && (
            <section className="md:col-span-2 rounded-xl border border-oc-line bg-white p-4">
              <h3 className="font-display text-sm font-extrabold text-oc-ink">{t('property.seller')}</h3>
              <div className="mt-2 flex items-center gap-3">
                {/* The seller's own picture, else the default for the role
                    the listing records them under. */}
                <EntityAvatar
                  src={avatarFromPath(listing.seller_profile_image_url, listing.seller_role)}
                  alt={td(listing.seller_name)}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-oc-ink">{td(listing.seller_name)}</p>
                  <p className="truncate text-xs font-semibold text-oc-muted">
                    <Building2 className="mr-1 inline h-3 w-3" />
                    {/* A role code with no name of its own used to print as
                        English Title Case; it is machine-translated instead. */}
                    {SELLER_ROLE_KEYS[listing.seller_role] ? t(SELLER_ROLE_KEYS[listing.seller_role]) : td(readableCode(listing.seller_role))}
                  </p>
                </div>
              </div>
              {/* Rendered exactly as the server decided. The fields are absent
                  from the payload until a request between the two parties has
                  been accepted, so there is nothing here to bypass. */}
              {listing.can_view_contact ? (
                <p className="mt-2.5 text-xs font-bold text-oc-ink">
                  {[listing.seller_phone, listing.seller_email].filter(Boolean).join(' · ')}
                </p>
              ) : (
                <p className="mt-2.5 text-xs font-medium text-oc-muted">{t('property.contactHidden')}</p>
              )}
            </section>
          )}

          {footer ? <div className="md:col-span-2 flex flex-wrap gap-2 border-t border-oc-line pt-4">{footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
