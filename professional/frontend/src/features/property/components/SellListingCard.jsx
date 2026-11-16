/**
 * One of the seller's own listings, as a card on the Sell tab.
 *
 * The shared list card (ListCard): the photo as the avatar and, at a fixed
 * height, in the body; the title and place; price and property type; "For
 * sale / For rent", Negotiable, three facts and the photo count as chips; then
 * View Details and View & Manage. Every value is the listing's own. Both buttons
 * (and the card) open the same detail panel as before, where Edit, the status
 * moves and Delete live -- nothing about what they do has changed.
 */
import { Bath, BedDouble, Camera, Compass, Eye, Home, Layers, Maximize2, Sofa, SlidersHorizontal } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { CardAvatar, CardChip, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { statusLabel } from '../../../shared/dashboard/StatusPill.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { areaLabel, bhkLabel, codeLabel, facingLabel } from './PropertyCard.jsx'

// A listing that is not simply live says so, in its own colour.
const SHOWN_STATUSES = ['draft', 'under_offer', 'sold', 'withdrawn']

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
  const title = td(listing.title)

  return (
    <ListCard
      onClick={onOpen}
      label={title}
      avatar={(
        <CardAvatar
          src={cover ? imageUrl(cover) : ''}
          alt={title}
          fallback={<Home className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />}
        />
      )}
      title={title}
      subtitle={place || null}
      // A listing that is not simply live says so (the seller's own cards only).
      status={!browse && SHOWN_STATUSES.includes(status) ? <CardStatus status={status}>{statusLabel(listing.status, t)}</CardStatus> : null}
      rows={[
        { key: 'price', label: t('property.price'), value: formatMoney(listing.price, listing.country) },
        { key: 'type', label: t('property.type'), value: codeLabel(t, 'property.type', listing.property_type, td) || t('property.property') },
      ]}
      chips={[
        <CardChip key="listing" tone="green">{codeLabel(t, 'property.listing', listing.listing_type, td) || t('property.listing.SALE')}</CardChip>,
        listing.is_negotiable && <CardChip key="negotiable" tone="amber">{t('property.negotiable')}</CardChip>,
        ...facts.map((fact) => <CardChip key={fact.key} icon={fact.icon}>{fact.text}</CardChip>),
        photoCount > 0 && <CardChip key="photos" icon={Camera}>{t('property.photosCount', { count: photoCount })}</CardChip>,
      ]}
      secondary={browse ? null : (
        <button type="button" onClick={open} className={cardButtonClass('secondary')}>
          <Eye className="h-3.5 w-3.5" /> {t('property.viewDetails')}
        </button>
      )}
      primary={browse ? (
        <button type="button" onClick={open} className={cardButtonClass('primary')}>
          <Eye className="h-3.5 w-3.5" /> {t('property.viewDetails')}
        </button>
      ) : (
        <button type="button" onClick={open} className={cardButtonClass('primary')}>
          <SlidersHorizontal className="h-3.5 w-3.5" /> {t('property.viewManage')}
        </button>
      )}
    >
      {/* The photo, at one fixed height so every card in the list is the same size. */}
      <div className="h-14 w-full overflow-hidden rounded-xl bg-oc-sunken">
        {cover ? (
          <SmartImage src={imageUrl(cover)} alt={title} className="h-14 w-full rounded-xl object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-oc-faint"><Home className="h-8 w-8" strokeWidth={1.5} /></div>
        )}
      </div>
    </ListCard>
  )
}
