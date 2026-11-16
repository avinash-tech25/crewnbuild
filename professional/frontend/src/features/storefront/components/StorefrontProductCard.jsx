/**
 * A storefront product card: discount badge, image, brand, name, size,
 * service chips, selling price with the original struck through, bulk line,
 * and stock, drawn as the shared ListCard. The supplier's own controls (Edit,
 * Publish/Unpublish, Delete) sit in the card's footer. No quantity or Add to
 * Cart: a supplier sells here, never buys.
 *
 *   layout="grid"  the product grid
 *   layout="row"   "You may also like": brand, name, size and price only
 */
import { useEffect, useState } from 'react'
import { Eye, EyeOff, ImageOff, Pencil, Trash2 } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { StockCardStatus } from '../../catalog/components/StockBadge.jsx'
import { CardAvatar, CardChip, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { ProductServiceBadges } from '../../catalog/components/ProductServiceBadges.jsx'
import { BulkPricingList } from '../../catalog/components/BulkPricing.jsx'
import { discountOf, money, sellingPrice, sizeOf } from '../storefrontShared.js'

export function ProductImage({ src, alt, className = '' }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (!src || broken) {
    return (
      <span className={`flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-300 ${className}`}>
        <ImageOff className="h-7 w-7" />
        <span className="text-[11px] font-semibold text-slate-400">No image yet</span>
      </span>
    )
  }
  return <img src={imageUrl(src)} alt={alt} onError={() => setBroken(true)} className={`h-full w-full object-contain ${className}`} />
}

const DiscountBadge = ({ discount, className = '' }) => (
  <span className={`rounded-md bg-oc-amber px-2 py-0.5 text-xs font-bold text-graphite shadow-sm ${className}`}>{Number(discount.toFixed(2))}% OFF</span>
)

const BrandRow = ({ listing }) => (
  <span className="flex h-4 min-w-0 items-center gap-1.5">
    <BrandLogo src={listing.brand_logo_url} name={listing.brand || 'Generic'} size="xs" className="!h-4 !w-4 !rounded" />
    <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-brand-800">{listing.brand || 'Generic'}</span>
  </span>
)

export function StorefrontProductCard({ listing, country, onOpen, onEdit, onTogglePublish, onDelete, showControls = true, layout = 'grid' }) {
  const discount = discountOf(listing)
  const unpublished = listing.is_published === false
  // "You may also like" (layout="row") shows the brand, name, size and price;
  // the product grid adds the service chips, bulk line and stock.
  const full = layout !== 'row'

  return (
    <ListCard
      onClick={onOpen}
      avatar={<CardAvatar src={listing.image_url ? imageUrl(listing.image_url) : null} alt="" fallback={<ImageOff aria-hidden="true" className="h-5 w-5" />} />}
      title={listing.name}
      subtitle={sizeOf(listing) || null}
      status={full ? <StockCardStatus quantity={listing.quantity} threshold={listing.low_stock_threshold} /> : null}
      chips={[
        unpublished && <CardChip key="hidden" icon={EyeOff}>Hidden</CardChip>,
      ]}
      // The supplier's own listing controls: Edit, Publish/Unpublish, Delete.
      secondary={showControls ? (
        <>
          <button type="button" onClick={onEdit} aria-label="Edit listing" title="Edit listing" className={cardButtonClass('secondary')}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onTogglePublish}
            aria-label={unpublished ? 'Publish listing' : 'Unpublish listing'}
            title={unpublished ? 'Publish listing' : 'Unpublish listing'}
            className={cardButtonClass('secondary')}
          >
            {unpublished ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={onDelete} aria-label={`Delete ${listing.name}`} title={`Delete ${listing.name}`} className={cardButtonClass('danger')}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
    >
      {/* The photo, at one height on every card. */}
      <button type="button" onClick={onOpen} className="relative h-32 w-full shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-100" aria-label={`View ${listing.name}`}>
        <ProductImage src={listing.image_url} alt={listing.name} className="px-8 py-1" />
        {discount > 0 && <DiscountBadge discount={discount} className="absolute left-0 top-0" />}
      </button>
      <BrandRow listing={listing} />
      {full && <ProductServiceBadges className="[&>li]:text-[11px]" />}
      <div className="mt-auto">
        <p className="flex items-baseline gap-x-1.5 overflow-hidden whitespace-nowrap">
          <span className="text-lg font-extrabold leading-6 tracking-[-0.02em] text-graphite">{money(sellingPrice(listing), country)}</span>
          {discount > 0 && (
            <>
              <span className="text-xs text-graphite/40 line-through">{money(listing.price, country)}</span>
              {full && <span className="text-[13px] font-bold text-brand-600">{Number(discount.toFixed(2))}% OFF</span>}
            </>
          )}
        </p>
        {full && (
          <div className="mt-0.5 min-h-4">
            <BulkPricingList tiers={listing.bulk_pricing} country={country} compact className="!text-xs !font-semibold !text-graphite/70" />
          </div>
        )}
      </div>
    </ListCard>
  )
}
