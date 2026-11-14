/**
 * A storefront product card: discount badge, image, brand, name, size,
 * service chips, selling price with the original struck through, bulk line,
 * and stock. The supplier's own controls (Edit, Publish/Unpublish, Delete) sit
 * on the image. No quantity or Add to Cart: a supplier sells here, never buys.
 *
 *   layout="grid"  the product grid: every row has a fixed (or reserved)
 *                  height, so names, prices and stock line up across cards
 *   layout="row"   "You may also like": a compact card, image on top
 */
import { useEffect, useState } from 'react'
import { Eye, EyeOff, ImageOff, Pencil, Trash2 } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { StockBadge } from '../../catalog/components/StockBadge.jsx'
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

  if (layout === 'row') {
    // Every row is a fixed height (or reserved), so all four cards are the same
    // size and their prices line up.
    return (
      <article className="group flex h-full min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_12px_28px_-16px_rgba(15,23,42,0.3)]">
        <button type="button" onClick={onOpen} className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-white ring-1 ring-slate-100" aria-label={`View ${listing.name}`}>
          <ProductImage src={listing.image_url} alt={listing.name} className="p-3 transition duration-300 group-hover:scale-[1.05]" />
          {discount > 0 && <DiscountBadge discount={discount} className="absolute left-2 top-2 !text-[11px]" />}
        </button>
        <div className="mt-3 flex min-w-0 flex-1 flex-col">
          <BrandRow listing={listing} />
          <button type="button" onClick={onOpen} className="mt-1.5 text-left">
            <h3 className="line-clamp-2 min-h-[2.5rem] !text-sm !font-semibold !leading-5 text-graphite transition group-hover:text-brand-800">{listing.name}</h3>
          </button>
          <p className="mt-0.5 h-4 truncate text-xs leading-4 text-graphite/50">{sizeOf(listing)}</p>
          <p className="mt-2 flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
            <span className="text-base font-extrabold tracking-tight text-graphite">{money(sellingPrice(listing), country)}</span>
            {discount > 0 && <span className="text-xs text-graphite/40 line-through">{money(listing.price, country)}</span>}
          </p>
        </div>
      </article>
    )
  }

  return (
    <article className="group relative flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_10px_24px_-12px_rgba(15,23,42,0.25)]">
      <button type="button" onClick={onOpen} className="relative h-[8.5rem] w-full shrink-0 overflow-hidden rounded-lg bg-white" aria-label={`View ${listing.name}`}>
        <ProductImage src={listing.image_url} alt={listing.name} className="px-8 py-1 transition duration-300 group-hover:scale-[1.04]" />
        {discount > 0 && <DiscountBadge discount={discount} className="absolute left-0 top-0" />}
        {unpublished && (
          <span className={`absolute left-0 inline-flex items-center gap-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${discount > 0 ? 'top-7' : 'top-0'}`}>
            <EyeOff className="h-3 w-3" /> Hidden
          </span>
        )}
      </button>
      {/* The supplier's own listing controls: Edit, Publish/Unpublish, Delete. */}
      {showControls && (
        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          {[
            { label: 'Edit listing', icon: Pencil, onClick: onEdit, hover: 'hover:text-brand-800' },
            { label: unpublished ? 'Publish listing' : 'Unpublish listing', icon: unpublished ? Eye : EyeOff, onClick: onTogglePublish, hover: 'hover:text-brand-800' },
            { label: `Delete ${listing.name}`, icon: Trash2, onClick: onDelete, hover: 'hover:text-red-600' },
          ].map(({ label, icon: Icon, onClick, hover }) => (
            <button key={label} type="button" onClick={onClick} aria-label={label} title={label} className={`grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-graphite/55 shadow-sm transition hover:border-slate-300 ${hover}`}>
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-1 flex-col">
        <BrandRow listing={listing} />
        <button type="button" onClick={onOpen} className="mt-1 text-left">
          {/* Two lines reserved, so a one-line name does not lift the rest. */}
          <h3 className="line-clamp-2 min-h-[2.25rem] !text-[15px] !font-semibold !leading-[1.125rem] !tracking-[-0.005em] text-graphite transition group-hover:text-brand-800">{listing.name}</h3>
        </button>
        <p className="mt-0.5 h-[1.125rem] truncate !text-[13px] !leading-[1.125rem] text-graphite/55">{sizeOf(listing)}</p>
        <ProductServiceBadges className="mt-1.5 [&>li]:text-[11px]" />
        <div className="mt-auto pt-2">
          <p className="flex items-baseline gap-x-1.5 overflow-hidden whitespace-nowrap">
            <span className="text-[1.3rem] font-extrabold leading-6 tracking-[-0.02em] text-graphite">{money(sellingPrice(listing), country)}</span>
            {discount > 0 && (
              <>
                <span className="text-xs text-graphite/40 line-through">{money(listing.price, country)}</span>
                <span className="text-[13px] font-bold text-brand-600">{Number(discount.toFixed(2))}% OFF</span>
              </>
            )}
          </p>
          <div className="mt-0.5 min-h-4">
            <BulkPricingList tiers={listing.bulk_pricing} country={country} compact className="!text-xs !font-semibold !text-graphite/70" />
          </div>
          <StockBadge quantity={listing.quantity} threshold={listing.low_stock_threshold} className="mt-1 !text-xs" />
        </div>
      </div>
    </article>
  )
}
