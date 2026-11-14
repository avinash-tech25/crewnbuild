/**
 * Buyer facing product view, shared by the House Owner and the Site Engineer.
 *
 * Laid out like a storefront listing: the photo holds the left half, and
 * everything needed to decide on a purchase sits on the right — price per unit,
 * what is in stock, the written description, the specifications, and who is
 * selling it. A quantity is chosen here, then the product is either put in the
 * cart or sent straight to the supplier as a buy request.
 *
 * A listing made from the Master Catalog arrives with the canonical product
 * under `product.catalog` (see supplier_product_payload): its images, video,
 * category, subcategory, brand, variant, unit, description and specifications
 * are shown from there, and only the price and stock come from the supplier.
 * An older listing the supplier typed in shows what they typed, as before.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, ShoppingCart, Store, X } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { PriceTag } from '../../catalog/components/PriceTag.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'
import { CatalogGallery, CatalogVideo, ExpandableText, sellingBasis, unitQuantity } from '../../catalog/components/CatalogMedia.jsx'

function Spec({ label, value }) {
  if (!value) return null
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{label}</p>
      <p className="mt-1 break-words text-sm font-extrabold leading-snug text-graphite">{value}</p>
    </div>
  )
}

export default function BuyerProductCard({
  product,
  supplierName,
  storeName,
  busy = false,
  message = '',
  onAddToCart,
  onSendBuyRequest,
  onClose,
}) {
  const { t, td } = useLanguage()
  const available = Number(product.quantity || 0)
  const [quantity, setQuantity] = useState(available > 0 ? 1 : 0)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const step = (delta) => setQuantity((current) => {
    const next = Number(current || 0) + delta
    if (next < 1) return 1
    if (next > available) return available
    return next
  })

  const outOfStock = available <= 0
  const lineTotal = Number(product.price || 0) * Number(quantity || 0)
  // Every value here is free text the supplier typed about their own product —
  // a brand, a grade, a unit of sale — so there is no key to look any of it up
  // by and it is machine-translated for display instead.
  const specs = [
    [t('dash.supplier.brand'), td(product.brand)],
    [t('shop.type'), td(product.product_type)],
    [t('shop.grade'), td(product.grade)],
    [t('dash.supplier.size'), td(product.size)],
    [t('dash.supplier.unit'), td(product.unit)],
  ]

  // ---- Master Catalog listing: canonical values from the catalog only, and a
  // tile only for a value that exists.
  const catalog = product.catalog || null
  const catalogUnit = catalog ? catalog.variant?.unit || catalog.unit || null : null
  const catalogSpecs = catalog
    ? [
        [t('dash.supplier.category'), catalog.category_name],
        [t('catalog.subcategory'), catalog.subcategory_name],
        [t('dash.supplier.brand'), catalog.brand_name],
        [t('catalog.variant'), catalog.variant?.name],
        [t('dash.supplier.unit'), catalogUnit ? sellingBasis(catalogUnit) : ''],
        [t('dash.supplier.standard'), catalog.standard_code],
      ]
    : []
  const catalogSpecifications = catalog
    ? Object.entries(catalog.variant?.specifications || catalog.specifications || {}).filter(([key, value]) => key && String(value ?? '').trim())
    : []
  const title = catalog ? catalog.name : td(product.name)
  const unitWord = catalog ? catalogUnit?.name || '' : td(product.unit)
  const stockText = catalog ? unitQuantity(available, catalogUnit) : `${formatNumber(available)} ${td(product.unit)}`

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[150] flex justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl
                   sm:h-[min(92dvh,880px)] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-slate-200"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('dash.common.close')}
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/95 text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)] lg:overflow-hidden">
          {catalog ? (
            <div className="flex flex-col items-center justify-center gap-4 border-b border-slate-100 bg-slate-50 p-6 lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-e">
              <CatalogGallery
                images={catalog.images || []}
                alt={title}
                noImageLabel={t('dash.msg.noImage')}
                mainClassName="mx-auto max-h-[38vh] w-full lg:max-h-[52vh]"
              />
              <CatalogVideo videoUrl={catalog.video_url} label={t('catalog.video')} className="w-full max-w-md" />
            </div>
          ) : (
          <div className="group relative flex items-center justify-center overflow-hidden border-b border-slate-100 bg-slate-50 p-6 lg:h-full lg:border-b-0 lg:border-e">
            <SmartImage
              src={product.image_url ? imageUrl(product.image_url) : ''}
              alt={td(product.name)}
              onClick={() => setZoomed((on) => !on)}
              className={`max-h-[38vh] w-auto max-w-full cursor-zoom-in object-contain transition-transform duration-300 lg:max-h-full
                          ${zoomed ? 'scale-[1.9] cursor-zoom-out' : 'group-hover:scale-105'}`}
            />
            <span className="pointer-events-none absolute bottom-3 end-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-bold text-graphite/50 ring-1 ring-slate-200">
              {zoomed ? t('shop.clickToShrink') : t('shop.clickToZoom')}
            </span>
          </div>
          )}

          <div className="p-5 sm:p-6 lg:h-full lg:overflow-y-auto">
            <h4 className="font-display text-2xl font-extrabold leading-tight text-graphite sm:text-3xl">{title}</h4>
            {catalog ? (
              <p className="mt-1.5 text-sm font-semibold text-graphite/50">
                {[catalog.category_name, catalog.subcategory_name, catalog.brand_name].filter(Boolean).join(' › ')}
              </p>
            ) : product.category && (
              <p className="mt-1.5 text-sm font-semibold text-graphite/50">
                {t('dash.supplier.inCategory')} <span className="font-extrabold text-graphite/70">{optionLabel(t, SUPPLIER_CATEGORY_KEYS, product.category)}</span>
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <PriceTag price={product.price} discountPercentage={product.discount_percentage} size="lg" />
                {unitWord && <p className="mt-1.5 text-xs font-semibold text-graphite/50">{t('dash.supplier.per')} {unitWord}</p>}
              </div>
              <p className={`text-sm font-extrabold ${outOfStock ? 'text-rose-600' : 'text-emerald-600'}`}>
                {outOfStock
                  ? t('dash.supplier.outOfStock')
                  /* Was pinned to en-IN, so the grouping ignored the reader. */
                  : `${stockText} ${t('shop.inStock')}`}
              </p>
            </div>

            {catalog ? (
              <ExpandableText
                text={catalog.description}
                className="mt-4 text-sm leading-relaxed text-graphite/70"
                moreLabel={t('catalog.showMore')}
                lessLabel={t('catalog.showLess')}
              />
            ) : product.description && (
              <p className="mt-4 text-sm leading-relaxed text-graphite/70">{td(product.description)}</p>
            )}

            <hr className="mt-5 border-slate-100" />

            <h5 className="mt-5 font-display text-sm font-extrabold uppercase tracking-wide text-graphite/70">
              {t('shop.specifications')}
            </h5>
            <div className="mt-2.5 grid grid-cols-2 gap-2.5 xl:grid-cols-3">
              {(catalog ? catalogSpecs : specs).map(([label, value]) => <Spec key={label} label={label} value={value} />)}
              <Spec label={t('shop.availability')} value={outOfStock ? t('dash.supplier.outOfStock') : stockText} />
            </div>

            {catalogSpecifications.length > 0 && (
              <dl className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {catalogSpecifications.map(([key, value]) => (
                  <div key={key} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <dt className="font-extrabold text-graphite/50">{key}</dt>
                    <dd className="font-semibold text-graphite">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {!catalog && product.usage && (
              <div className="mt-4 rounded-xl bg-cream/55 px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.usage')}</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-graphite/70">{td(product.usage)}</p>
              </div>
            )}

            {(supplierName || storeName) && (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                  <Store className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.supplierDetails')}</p>
                  <p className="truncate text-sm font-extrabold text-graphite">{td(storeName || supplierName)}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* No quantity or Buy without the buy callbacks (a browse-only catalogue). */}
        {onAddToCart && onSendBuyRequest && <div className="shrink-0 border-t border-slate-100 bg-white p-4">
          {/* Either our own confirmation or the server's refusal, which is
              written in English; `td` covers the latter. */}
          {message && <p className="mb-2 text-xs font-bold text-brand-700">{td(message)}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 items-center overflow-hidden rounded-xl border border-slate-200">
              <button type="button" onClick={() => step(-1)} disabled={outOfStock} aria-label={t('shop.decrease')} className="grid h-full w-10 place-items-center bg-slate-50 text-graphite/60 transition hover:bg-slate-100 hover:text-graphite disabled:opacity-40">
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min="1"
                max={available || 1}
                value={quantity}
                disabled={outOfStock}
                onChange={(event) => setQuantity(Math.max(1, Math.min(available, Number(event.target.value || 1))))}
                aria-label={t('shop.quantity')}
                className="h-full w-16 border-x border-slate-200 bg-white text-center text-sm font-extrabold text-graphite outline-none"
              />
              <button type="button" onClick={() => step(1)} disabled={outOfStock} aria-label={t('shop.increase')} className="grid h-full w-10 place-items-center bg-slate-50 text-graphite/60 transition hover:bg-slate-100 hover:text-graphite disabled:opacity-40">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm font-extrabold text-graphite">{countryFormatMoney(lineTotal)}</p>

            <div className="ms-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onAddToCart(quantity)}
                disabled={outOfStock || busy || quantity < 1}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-extrabold text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
              >
                <ShoppingCart className="h-4 w-4" />
                {t('shop.addToCart')}
              </button>
              <button
                type="button"
                onClick={() => onSendBuyRequest(quantity)}
                disabled={outOfStock || busy || quantity < 1}
                className="h-11 rounded-xl bg-brand-700 px-4 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-50"
              >
                {t('shop.sendBuyRequest')}
              </button>
            </div>
          </div>
        </div>}
      </div>
    </div>,
    document.body,
  )
}
