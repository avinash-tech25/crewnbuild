/**
 * The product page: breadcrumb; gallery on the left (vertical thumbnails +
 * large image); on the right the purchase card -- discount, service info,
 * brand, name, category, variant, unit, price, discount, bulk pricing, stock,
 * the supplier's own stock / status / actions (no cart: a supplier sells) --
 * and directly under it exactly four accordion rows -- Product Highlights,
 * Product Description, FAQs, Returns & Exchange Policy -- read from the
 * product's own master_products columns (highlights, description, faqs,
 * returns_exchange_policy); then "You may also like".
 * (Specifications stay in the database untouched; they are not shown here.)
 *
 * Responsibilities stay separate:
 *   - what the product IS (images, highlights, description, FAQs, returns
 *     policy) comes from its master product (/catalog/products/{id}; a supplier receives the
 *     images only of products they list);
 *   - what it costs and how much is in stock comes from THIS supplier's
 *     listing;
 *   - related products are passed in by the storefront, chosen from this
 *     supplier's own listings only.
 * Nothing is invented: a content section without data is not shown.
 */
import { useEffect, useState } from 'react'
import {
  ArrowLeft, BellRing, Boxes, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Eye, EyeOff, FileText,
  ImageOff, IndianRupee, Loader2, Maximize2, Pencil, RotateCcw, Star, Tags, Trash2, Truck,
} from 'lucide-react'
import { fetchCatalogProduct } from '../../catalog/catalogApi.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import PhotoViewer from '../../../shared/ui/PhotoViewer.jsx'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { AppDownloadBanner } from '../../catalog/components/AppDownloadBanner.jsx'
import { StockBadge } from '../../catalog/components/StockBadge.jsx'
import { StorefrontProductCard } from './StorefrontProductCard.jsx'
import { ProductServiceBadges } from '../../catalog/components/ProductServiceBadges.jsx'
import { BulkPricingList } from '../../catalog/components/BulkPricing.jsx'
import { productServiceItems } from '../../../shared/utils/productServiceDefaults.js'
import { discountOf, money, sellingPrice } from '../storefrontShared.js'

const SERVICE_ICONS = { freeDelivery: Truck, deliveryTime: Clock3, payOnDelivery: IndianRupee }

function Section({ icon: Icon, title, open = false, children }) {
  return (
    <details open={open} className="group">
      <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 px-4 py-2 text-[15px] font-semibold text-graphite transition-colors hover:bg-slate-50/80 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 transition-colors group-open:bg-brand-700 group-open:text-white">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="flex-1">{title}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-graphite/40 transition-transform duration-200 group-open:rotate-180 group-open:text-brand-700" aria-hidden="true" />
      </summary>
      <div className="storefront-reveal px-4 pb-4 pl-[3.75rem] text-sm leading-relaxed text-graphite/75 sm:px-5 sm:pl-16">{children}</div>
    </details>
  )
}

const Empty = ({ children }) => <p className="text-graphite/45">{children}</p>

// One look for every small round control on the image (arrows, full screen).
const imageControl = 'grid h-9 w-9 place-items-center rounded-full bg-white/90 text-graphite/70 shadow-sm ring-1 ring-slate-200 backdrop-blur transition hover:bg-white hover:text-graphite hover:shadow active:scale-95'
const imageHeight = 'h-72 sm:h-[22rem] lg:h-[26rem]'

/** Vertical thumbnails beside the large image (a row under it on phones);
 *  arrows step through the images and the corner button opens them full screen. */
function DetailGallery({ images, alt, loading }) {
  const [active, setActive] = useState(0)
  const [broken, setBroken] = useState({})
  const [viewer, setViewer] = useState(null)
  const key = images.map((image) => image.image_url).join('|')
  useEffect(() => setActive(0), [key])

  if (loading) {
    return <div className={`grid ${imageHeight} place-items-center rounded-xl bg-slate-50`}><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!images.length) {
    return (
      <div className={`flex ${imageHeight} flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 text-slate-400`}>
        <ImageOff className="h-8 w-8" />
        <span className="text-xs font-bold">No image yet</span>
      </div>
    )
  }
  const index = Math.min(active, images.length - 1)
  const current = images[index]
  const step = (delta) => setActive((index + delta + images.length) % images.length)
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row">
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5 sm:w-16 sm:shrink-0 sm:flex-col sm:overflow-y-auto sm:pb-0">
          {images.map((image, position) => (
            <button
              key={image.id ?? image.image_url}
              type="button"
              onClick={() => setActive(position)}
              aria-label={`Image ${position + 1}`}
              aria-current={position === index}
              className={`grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white p-1 transition sm:h-16 sm:w-16 ${
                position === index ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 opacity-75 hover:border-slate-300 hover:opacity-100'
              }`}
            >
              <img src={imageUrl(image.image_url)} alt="" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
      <div className={`group/gallery relative ${imageHeight} min-w-0 flex-none sm:flex-1 overflow-hidden rounded-xl bg-gradient-to-b from-slate-50 to-white ring-1 ring-slate-100`}>
        {broken[current.image_url] ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-slate-400"><ImageOff className="h-8 w-8" /></div>
        ) : (
          <img
            key={current.image_url}
            src={imageUrl(current.image_url)}
            alt={current.alt_text || alt}
            onError={() => setBroken((state) => ({ ...state, [current.image_url]: true }))}
            className="storefront-fade h-full w-full object-contain p-6 transition-transform duration-500 group-hover/gallery:scale-[1.03] sm:p-8"
          />
        )}
        {images.length > 1 && (
          <>
            <button type="button" onClick={() => step(-1)} aria-label="Previous image" className={`absolute left-3 top-1/2 -translate-y-1/2 ${imageControl}`}>
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Next image" className={`absolute right-3 top-1/2 -translate-y-1/2 ${imageControl}`}>
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
        <button type="button" onClick={() => setViewer(index)} aria-label="View full screen" className={`absolute bottom-3 right-3 ${imageControl}`}>
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <PhotoViewer photos={images} activeIndex={viewer} onChange={setViewer} onBack={() => setViewer(null)} title={alt} />
    </div>
  )
}

/** One of the supplier's own figures (stock, low-stock alert, status): a
 *  compact block of the "Your listing" panel. */
function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-3.5 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-700 ring-1 ring-slate-200"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[11px] font-medium text-graphite/50">{label}</span>
        <span className="mt-0.5 block truncate text-sm font-bold text-graphite">{value}</span>
      </span>
    </div>
  )
}

export function StorefrontProductDetail({
  listing,
  country,
  related = [],
  onOpenRelated,
  onBack,
  onEdit,
  onTogglePublish,
  onDelete,
}) {
  const [master, setMaster] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!listing?.master_product_id) {
      setMaster(null)
      return undefined
    }
    let live = true
    setLoading(true)
    fetchCatalogProduct(listing.master_product_id)
      .then((row) => live && setMaster(row))
      .catch(() => live && setMaster(null))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [listing?.master_product_id])

  // Only the master product that belongs to this listing (never a stale one
  // while the next product loads).
  const product = master && master.id === listing.master_product_id ? master : null
  const discount = discountOf(listing)
  const variant = (product?.variants || []).find((row) => row.id === listing.master_variant_id) || null
  const images = product?.images?.length ? product.images : listing.image_url ? [{ id: 'listing', image_url: listing.image_url, is_primary: true }] : []
  const category = product?.category_name || listing.category
  const subcategory = product?.subcategory_name || listing.subcategory_name
  const variantName = variant?.name || listing.size
  const unitName = variant?.unit?.name || product?.unit?.name || listing.unit
  const faqs = (product?.faqs || []).filter((faq) => faq && (faq.question || faq.answer))
  // Highlights: the admin's highlight lines; the short description when there are none.
  const highlights = (product?.highlights || []).map((line) => String(line || '').trim()).filter(Boolean)
  // The service strip: the marketplace service items, plus this listing's
  // lowest bulk price when it has bulk tiers (nothing when it has none).
  const tiers = listing.bulk_pricing || []
  const bestTier = tiers.reduce((low, tier) => (!low || tier.unit_price < low.unit_price ? tier : low), null)
  // One action-button shape for the supplier's own actions.
  const actionButton = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 !text-sm font-semibold transition active:scale-[0.98]'

  return (
    <section className="storefront mx-auto w-full max-w-[1240px] space-y-8">
      {/* Products / Category / Subcategory / Product */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-graphite/50">
        <button type="button" onClick={onBack} className="inline-flex shrink-0 items-center gap-1.5 rounded-md !text-sm font-semibold text-brand-800 transition hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Products
        </button>
        {[category, subcategory].filter(Boolean).map((part) => (
          <span key={part} className="shrink-0">/ {part}</span>
        ))}
        <span className="min-w-0 truncate font-medium text-graphite/80">/ {listing.name}</span>
      </nav>

      {/* The product: one surface, gallery left and everything about it right. */}
      <div className="-mt-3 rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
          {/* Left: the master product's images (stays in view while the details scroll) */}
          <div className="p-4 sm:p-6 lg:sticky lg:top-20 lg:self-start">
            <DetailGallery images={images} alt={listing.name} loading={loading && !product} />
          </div>

          {/* Right: what a buyer sees, then the supplier's own figures and actions */}
          <div className="min-w-0 border-t border-slate-100 p-5 sm:p-7 lg:border-l lg:border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {discount > 0 ? (
                <span className="rounded-md bg-oc-amber px-2.5 py-1 text-xs font-extrabold tracking-wide text-graphite">{Number(discount.toFixed(2))}% OFF</span>
              ) : <span />}
              <ProductServiceBadges size="md" />
            </div>

            <p className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-brand-700">
              <BrandLogo src={listing.brand_logo_url} name={listing.brand || 'Generic'} size="sm" className="!h-7 !w-7" /> {listing.brand || 'Generic'}
            </p>
            <h1 className="mt-2 !text-2xl font-extrabold !leading-tight !tracking-tight text-graphite sm:!text-[1.875rem]">{listing.name}</h1>
            <p className="mt-1.5 text-sm text-graphite/55">{[category, subcategory].filter(Boolean).join(' / ')}</p>
            <p className="text-sm text-graphite/55">{[variantName, unitName && `Sold per ${unitName}`].filter(Boolean).join(' · ')}</p>

            {/* Price */}
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[2rem] font-extrabold leading-none tracking-tight text-graphite sm:text-[2.25rem]">{money(sellingPrice(listing), country)}</span>
                {discount > 0 && <span className="text-base font-medium text-graphite/40 line-through">{money(listing.price, country)}</span>}
                {discount > 0 && <span className="rounded-md bg-brand-50 px-2 py-0.5 text-sm font-bold text-brand-700">{Number(discount.toFixed(2))}% OFF</span>}
              </p>
              <BulkPricingList tiers={listing.bulk_pricing} unit={listing.unit} country={country} className="mt-3" />
              <div className="mt-3"><StockBadge quantity={listing.quantity} threshold={listing.low_stock_threshold} unit={listing.unit} /></div>
            </div>

            {/* Service strip: one bar, thin dividers between the items */}
            <ul className="mt-5 flex flex-wrap overflow-hidden rounded-xl bg-brand-50/60 ring-1 ring-brand-100">
              {[
                ...productServiceItems().map((item) => ({ key: item.key, icon: SERVICE_ICONS[item.key], label: item.label })),
                ...(bestTier ? [{ key: 'bulk', icon: Tags, label: `Bulk: ${Number(bestTier.min_quantity)}+ ${money(bestTier.unit_price, country)}` }] : []),
              ].map(({ key, icon: Icon, label }, position) => (
                <li
                  key={key}
                  className={`flex min-w-[45%] flex-1 items-center justify-center gap-2 whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold text-graphite sm:min-w-0 ${
                    position > 0 ? 'sm:border-l sm:border-brand-100' : ''
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>

            {/* The supplier's own listing figures and actions, in one panel. */}
            <aside aria-label="Your listing" className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70">
              <div className="grid divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                <StatCard icon={Boxes} label="Your stock" value={Number(listing.quantity || 0).toLocaleString('en-IN')} />
                <StatCard icon={BellRing} label="Low-stock alert" value={Number(listing.low_stock_threshold || 0).toLocaleString('en-IN')} />
                <StatCard icon={FileText} label="Status" value={listing.is_published === false ? 'Hidden' : 'Published'} />
              </div>
              <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-3">
                <button type="button" onClick={onEdit} className={`${actionButton} bg-graphite text-white hover:bg-brand-950`}>
                  <Pencil className="h-4 w-4" /> Edit price & stock
                </button>
                <button type="button" onClick={onTogglePublish} className={`${actionButton} border border-slate-200 bg-white text-graphite/75 hover:border-slate-300 hover:text-graphite`}>
                  {listing.is_published === false ? <><Eye className="h-4 w-4" /> Publish</> : <><EyeOff className="h-4 w-4" /> Unpublish</>}
                </button>
                <button type="button" onClick={onDelete} className={`${actionButton} border border-red-100 bg-white text-red-600 hover:border-red-600 hover:bg-red-600 hover:text-white`}>
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </aside>

            {/* Product content, from the master product's own columns: exactly these four rows. */}
            <div className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Section icon={Star} title="Product Highlights">
                {highlights.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {highlights.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
                  </ul>
                ) : product?.short_description ? (
                  <p>{product.short_description}</p>
                ) : (
                  <Empty>{loading ? 'Loading…' : 'No information available.'}</Empty>
                )}
              </Section>
              <Section icon={FileText} title="Product Description">
                {product?.description ? <p className="whitespace-pre-line">{product.description}</p> : <Empty>{loading ? 'Loading…' : 'No information available.'}</Empty>}
              </Section>
              <Section icon={CircleHelp} title="FAQs">
                {faqs.length > 0 ? (
                  <div className="space-y-3">
                    {faqs.map((faq, index) => (
                      <div key={`${faq.question}-${index}`}>
                        <p className="font-extrabold text-graphite">{faq.question}</p>
                        <p className="mt-0.5 whitespace-pre-line">{faq.answer}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>{loading ? 'Loading…' : 'No information available.'}</Empty>
                )}
              </Section>
              <Section icon={RotateCcw} title="Returns & Exchange Policy">
                {product?.returns_exchange_policy ? (
                  <p className="whitespace-pre-wrap">{product.returns_exchange_policy}</p>
                ) : (
                  <Empty>{loading ? 'Loading…' : 'No information available.'}</Empty>
                )}
              </Section>
            </div>
          </div>
        </div>
      </div>

      {/* You may also like: this supplier's own listings only (chosen by the storefront). */}
      {related.length > 0 && (
        <section aria-label="You may also like">
          <h2 className="!text-xl font-extrabold !tracking-tight text-graphite">You may also like</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {related.map((item) => (
              <StorefrontProductCard
                key={item.id}
                listing={item}
                country={country}
                onOpen={() => onOpenRelated(item)}
                showControls={false}
                layout="row"
              />
            ))}
          </div>
        </section>
      )}

      {/* Last on the product page, after everything about the product. */}
      <AppDownloadBanner />
    </section>
  )
}
