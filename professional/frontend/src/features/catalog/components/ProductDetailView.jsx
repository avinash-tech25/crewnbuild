/**
 * The product page: what a product IS (the admin's master product) beside what
 * each supplier sells it for (their listing).
 *
 *   product  a master catalog product payload -- images, brand + logo, name,
 *            unit, variants, highlights, description, FAQs, returns policy,
 *            specifications. Never supplier text.
 *   offers   supplier listings of it the viewer may buy from -- price, discount,
 *            stock -- already limited by the caller's own supplier rules.
 *
 * Presentation only: it fetches nothing.
 */
import { useState } from 'react'
import { AppDownloadBanner } from './AppDownloadBanner.jsx'
import { ArrowLeft, ChevronDown, Loader2, ShoppingCart, Store, Tags } from 'lucide-react'
import { CatalogGallery, CatalogVideo } from './CatalogMedia.jsx'
import { StoredImage } from './CatalogProductBrowser.jsx'
import { PriceTag, discountedPrice } from './PriceTag.jsx'
import { BrandLogo } from './BrandPicker.jsx'
import { StockBadge } from './StockBadge.jsx'
import { ProductServiceBadges } from './ProductServiceBadges.jsx'
import { BulkPricingList } from './BulkPricing.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'

/** One collapsible section, open by default when asked. Native <details>, so it
 *  works with the keyboard and a screen reader with no extra code. */
function Section({ title, open = false, children }) {
  return (
    <details open={open} className="group border-b border-slate-200 py-3 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-extrabold text-graphite">
        {title}
        <ChevronDown className="h-4 w-4 text-graphite/40 transition group-open:rotate-180" />
      </summary>
      <div className="mt-2 text-sm leading-relaxed text-graphite/75">{children}</div>
    </details>
  )
}

const NotAdded = () => <p className="text-xs font-semibold text-graphite/40">Not added yet.</p>

/** The cheapest offer after discount: the one the price line shows. */
export function bestOffer(offers = []) {
  return offers.reduce(
    (best, offer) =>
      !best || discountedPrice(offer.price, offer.discount_percentage) < discountedPrice(best.price, best.discount_percentage)
        ? offer
        : best,
    null,
  )
}

/** "Unlock Bulk Price of ₹400 / Bag · for 100+ Bag" -- the lowest price among
 *  the listing's own saved tiers. Clicking it opens the normal price and the
 *  tiers inline, on this page. Nothing at all when the listing has no tiers. */
function BulkPricePrompt({ offer, unit = '' }) {
  const [open, setOpen] = useState(false)
  const tiers = offer?.bulk_pricing || []
  if (!tiers.length) return null
  const tier = tiers.reduce((low, row) =>
    !low || row.unit_price < low.unit_price || (row.unit_price === low.unit_price && row.min_quantity < low.min_quantity) ? row : low, null)
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        aria-expanded={open}
        className="group inline-flex flex-col items-start text-left"
      >
        <span className="inline-flex items-center gap-1.5 border-b-2 border-dotted border-sky-400 pb-0.5 text-sm font-extrabold text-sky-700 transition group-hover:border-sky-600 group-hover:text-sky-800">
          <Tags className="h-4 w-4" aria-hidden="true" />
          Unlock Bulk Price of {formatMoney(tier.unit_price)}{unit ? ` / ${unit}` : ''}
          <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
        {tier.min_quantity != null && (
          <span className="mt-0.5 text-xs font-bold text-graphite/55">for {Number(tier.min_quantity)}+{unit ? ` ${unit}` : ''}</span>
        )}
      </button>
      {open && (
        <div className="mt-2 max-w-sm space-y-2">
          <p className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-graphite">
            Normal price
            <PriceTag price={offer.price} discountPercentage={offer.discount_percentage} unit={unit} size="sm" />
          </p>
          <BulkPricingList tiers={tiers} unit={unit} />
        </div>
      )}
    </div>
  )
}

export function ProductDetailView({
  product,
  offers = [],
  onBack,
  onAddToCart,
  addingOfferId = null,
  // Optional: the cart control for one offer (replaces the plain button).
  renderOfferAction,
  // false hides the Specifications row (the owner marketplace shows only
  // Highlights, Description, FAQs and Returns & Exchange Policy).
  showSpecifications = true,
  // true shows Free Delivery · 60 Mins · Pay on Delivery above the title
  // (the House Owner marketplace).
  showServiceBadges = false,
  message = '',
  related = [],
  onOpenProduct,
  relatedPrice,
  // true ends the page with the CREWNBUILD app-download banner (buyer
  // product pages; off for the admin's customer preview).
  showAppBanner = false,
}) {
  if (!product) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm font-semibold text-graphite/45">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading product…
      </p>
    )
  }
  const best = bestOffer(offers)
  const unitName = product.unit?.name || product.unit_code || ''
  const highlights = product.highlights || []
  const faqs = product.faqs || []
  const specifications = Object.entries(product.specifications || {})

  return (
    <div className="space-y-6">
      {onBack && (
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to products
        </button>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: the admin's pictures and video. */}
        <div className="space-y-3">
          <CatalogGallery
            images={product.images || []}
            alt={product.name}
            noImageLabel="No image uploaded"
            mainClassName="aspect-square w-full border border-slate-200"
          />
          <CatalogVideo videoUrl={product.video_url} className="w-full" />
        </div>

        {/* Right: brand, name, price, offers, then the product sections. */}
        <div className="min-w-0">
          {/* Service information first, above the brand and title. */}
          {showServiceBadges && <ProductServiceBadges size="md" className="mb-3" />}
          <div className="flex items-center gap-2">
            {product.brand_logo_url && (
              <StoredImage src={product.brand_logo_url} alt={product.brand_name || ''} className="h-8 w-8 rounded-md border border-slate-200 bg-white object-contain" />
            )}
            <span className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{product.brand_name || 'Generic'}</span>
          </div>
          <h2 className="mt-1.5 font-display text-2xl font-extrabold leading-tight text-graphite">{product.name}</h2>
          <p className="mt-1 text-xs font-semibold text-graphite/50">
            {[product.category_name, product.subcategory_name].filter(Boolean).join(' › ')}
            {unitName ? ` · Sold by ${unitName}` : ''}
          </p>
          {(product.variants || []).length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {product.variants.map((variant) => (
                <span key={variant.id} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-graphite/70">
                  {variant.name}
                </span>
              ))}
            </p>
          )}

          <div className="mt-4">
            {best ? (
              <>
                <PriceTag price={best.price} discountPercentage={best.discount_percentage} unit={best.unit || unitName} size="lg" />
                {/* Bulk tiers of THIS listing (the one whose price is shown). */}
                <BulkPricePrompt key={best.id} offer={best} unit={best.unit || unitName} />
              </>
            ) : (
              <p className="text-sm font-bold text-graphite/45">Not currently offered by your suppliers.</p>
            )}
          </div>

          {offers.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">
                Sold by {offers.length} supplier{offers.length === 1 ? '' : 's'}
              </p>
              {offers.map((offer) => (
                <div key={offer.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-extrabold text-graphite">
                      <Store className="h-3.5 w-3.5 text-graphite/40" />
                      {offer.supplier_name}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-graphite/50">
                      {[offer.size, offer.stock_status === 'OUT_OF_STOCK' ? 'Out of stock' : `${Number(offer.quantity || 0)} ${offer.unit || ''} in stock`].filter(Boolean).join(' · ')}
                    </p>
                    {/* This supplier's own bulk tiers, when it offers any. */}
                    <BulkPricingList tiers={offer.bulk_pricing} unit={offer.unit} compact className="mt-0.5" />
                  </div>
                  <div className="flex items-center gap-3">
                    <PriceTag price={offer.price} discountPercentage={offer.discount_percentage} size="sm" />
                    {renderOfferAction ? renderOfferAction(offer) : onAddToCart && (
                      <button
                        type="button"
                        disabled={addingOfferId === offer.id || offer.stock_status === 'OUT_OF_STOCK'}
                        onClick={() => onAddToCart(offer)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1f2937] px-3 text-xs font-extrabold text-white transition hover:bg-brand-950 disabled:bg-slate-300"
                      >
                        {addingOfferId === offer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                        Add to cart
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {message && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-graphite/70">{message}</p>}
            </div>
          )}

          <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4">
            <Section title="Product Highlights" open>
              {highlights.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {highlights.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : <NotAdded />}
            </Section>
            <Section title="Product Description">
              {product.description ? <p className="whitespace-pre-line">{product.description}</p> : <NotAdded />}
            </Section>
            <Section title="FAQs">
              {faqs.length ? (
                <div className="space-y-2">
                  {faqs.map((faq) => (
                    <div key={faq.question}>
                      <p className="font-extrabold text-graphite">{faq.question}</p>
                      <p className="mt-0.5 whitespace-pre-line">{faq.answer}</p>
                    </div>
                  ))}
                </div>
              ) : <NotAdded />}
            </Section>
            <Section title="Returns & Exchange Policy">
              {product.returns_exchange_policy ? <p className="whitespace-pre-wrap">{product.returns_exchange_policy}</p> : <NotAdded />}
            </Section>
            {showSpecifications && specifications.length > 0 && (
              <Section title="Specifications">
                <dl className="divide-y divide-slate-100">
                  {specifications.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-1.5 text-xs">
                      <dt className="font-bold text-graphite/55">{key}</dt>
                      <dd className="font-extrabold text-graphite">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-graphite">You may also like</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {related.map((item) => (
              <ProductTile key={item.id} product={item} offer={relatedPrice ? relatedPrice(item) : null} onOpen={() => onOpenProduct?.(item.id)} />
            ))}
          </div>
        </section>
      )}

      {showAppBanner && <AppDownloadBanner />}
    </div>
  )
}

/** A product card: image with its discount badge, brand with logo, name,
 *  sizes, best price and stock. `footer` (e.g. the cart control) sits below,
 *  outside the card's open button. */
export function ProductTile({ product, offer, onOpen, footer }) {
  const discount = Number(offer?.discount_percentage || 0)
  const sizes = (product.variants || []).map((variant) => variant.name).filter(Boolean)
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md">
      <button type="button" onClick={onOpen} className="relative grid aspect-square place-items-center bg-slate-50" aria-label={`View ${product.name}`}>
        {product.image_url ? (
          <img src={imageUrl(product.image_url)} alt={product.name} className="h-full w-full object-contain p-2 transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <span className="text-[11px] font-bold text-slate-400">No image</span>
        )}
        {discount > 0 && (
          <span className="absolute left-2 top-2 rounded-md bg-oc-amber px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-graphite shadow-sm">
            {Number(discount.toFixed(2))}% OFF
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <BrandLogo src={product.brand_logo_url} name={product.brand_name || 'Generic'} size="xs" />
          <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-brand-700">{product.brand_name || 'Generic'}</span>
        </span>
        <button type="button" onClick={onOpen} className="text-left">
          <span className="line-clamp-2 text-xs font-extrabold leading-snug text-graphite">{product.name}</span>
        </button>
        <span className="truncate text-[11px] font-semibold text-graphite/50">
          {[product.subcategory_name, offer?.size || sizes.join(' / ')].filter(Boolean).join(' · ')}
        </span>
        {offer ? (
          <>
            <PriceTag price={offer.price} discountPercentage={offer.discount_percentage} unit={offer.unit} size="sm" className="mt-auto pt-1" />
            <StockBadge quantity={offer.quantity} threshold={offer.low_stock_threshold} className="self-start" />
          </>
        ) : null}
        {footer && <div className="pt-1.5">{footer}</div>}
      </div>
    </article>
  )
}
