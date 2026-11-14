/**
 * Two discovery panels on the House Owner's dashboard, laid out like the
 * reference design: a white panel, a small icon and title on the left,
 * "View all" on the right, compact cards with small images.
 *
 *   Available Technicians   Partner's four trades, each with Partner's own
 *                           figure artwork and description, opening Partner's
 *                           page for that trade. Presented as services: there
 *                           is no availability, count or rating data to show,
 *                           so none is claimed.
 *   Construction Materials  the products this owner may order, read from the
 *                           existing GET /shop/products -- nothing invented. A
 *                           click opens the existing catalog (the Order Product
 *                           Quick Action's handler), so ordering, cart and
 *                           checkout stay exactly as they are.
 */
import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight, Layers, Package, Store, Users } from 'lucide-react'
import { fetchShopProducts } from '../../catalog/supplierProductsApi.js'
import { categoryImage, categorySlug } from '../../shop/components/categoryImagery.js'
import { discountedPrice } from '../../catalog/components/PriceTag.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { money } from '../ownerHelpers.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const MAX_PRODUCTS = 6

// The panel every discovery section sits in. Plain <p> elements, not headings:
// `.dashboard-main` sizes every h2/h3 as a page section title.
function DiscoveryPanel({ icon: Icon, title, subtitle, actionLabel, onAction, actionDisabled, children }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-oc-line bg-white p-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-oc-green" strokeWidth={2.2} />
          <div className="min-w-0">
            <p className="font-display text-base font-extrabold leading-tight text-oc-ink">{title}</p>
            {subtitle && <p className="mt-0.5 text-xs text-oc-muted">{subtitle}</p>}
          </div>
        </div>
        {onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-extrabold text-oc-green transition hover:text-oc-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLabel} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

// The trades in the reference's order, each in its own soft tint.
const TRADES = [
  { slug: 'painter', labelKey: 'owner.tech.painter', descKey: 'owner.tech.painterDesc', card: 'from-emerald-50 to-white border-emerald-100', pill: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50', halo: 'bg-emerald-100/70' },
  { slug: 'plumber', labelKey: 'owner.tech.plumber', descKey: 'owner.tech.plumberDesc', card: 'from-sky-50 to-white border-sky-100', pill: 'border-sky-200 text-sky-700 hover:bg-sky-50', halo: 'bg-sky-100/70' },
  { slug: 'electrician', labelKey: 'owner.tech.electrician', descKey: 'owner.tech.electricianDesc', card: 'from-amber-50 to-white border-amber-100', pill: 'border-amber-200 text-amber-700 hover:bg-amber-50', halo: 'bg-amber-100/70' },
  { slug: 'carpenter', labelKey: 'owner.tech.carpenter', descKey: 'owner.tech.carpenterDesc', card: 'from-rose-50 to-white border-rose-100', pill: 'border-rose-200 text-rose-700 hover:bg-rose-50', halo: 'bg-rose-100/70' },
]

export function OwnerTechnicianSection({ onBook }) {
  const { t } = useLanguage()
  return (
    <DiscoveryPanel
      icon={Users}
      title={t('owner.tech.availableTitle')}
      subtitle={t('owner.tech.subtitle')}
      actionLabel={t('owner.viewAll')}
      onAction={() => onBook(null)}
    >
      {/* A swipeable row on a phone (inside the panel, never the page), a
          2-up grid on a tablet and four across from `lg`. */}
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
        {TRADES.map((trade) => (
          <div
            key={trade.slug}
            className={`flex min-w-[78%] snap-start items-center gap-2 overflow-hidden rounded-2xl border bg-gradient-to-br py-2 pl-1 pr-3 sm:min-w-0 ${trade.card}`}
          >
            {/* The trade's photograph (owner-technicians/), small: head to waist, its
                full width (both hands) inside the frame. */}
            <span className="relative h-24 w-[92px] shrink-0 overflow-hidden">
              <span className={`absolute inset-x-1 top-2 h-16 rounded-full ${trade.halo}`} aria-hidden="true" />
              <img src={`/landing/owner-technicians/${trade.slug}.png`} alt="" loading="lazy" className="relative mx-auto h-[140%] w-auto max-w-none object-contain object-top" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-display text-sm font-extrabold text-oc-ink">{t(trade.labelKey)}</span>
              <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-oc-muted">{t(trade.descKey)}</span>
              <button
                type="button"
                data-testid={`owner-trade-${trade.slug}`}
                onClick={() => onBook(trade.slug)}
                className={`mt-2 inline-flex min-h-7 max-w-full items-center gap-1 self-start rounded-lg border bg-white px-2.5 py-1 text-start text-[11px] font-extrabold leading-tight transition ${trade.pill}`}
              >
                {t('owner.tech.bookNow')} <ArrowRight className="h-3 w-3 shrink-0 rtl:-scale-x-100" />
              </button>
            </span>
          </div>
        ))}
      </div>
    </DiscoveryPanel>
  )
}

// Category pictures cut out of their photo's background, so they stand on the
// card's plain white. Only the categories listed here have one.
const CATEGORY_CUTOUTS = new Set(['cement', 'paint'])

// The product's own photo, else its category's cut-out, else the existing
// photo for its category, else a plain package mark -- never a stand-in for
// another product. Always contained on white, never stretched to fill.
function ProductImage({ product }) {
  const [broken, setBroken] = useState(false)
  const slug = categorySlug(product.category)
  const src = product.image_url
    ? imageUrl(product.image_url)
    : CATEGORY_CUTOUTS.has(slug) ? `/landing/cutouts/${slug}.png` : categoryImage(product.category)
  if (!src || broken) {
    return (
      <span className="grid h-full w-full place-items-center text-slate-300">
        <Package className="h-7 w-7" />
      </span>
    )
  }
  return <img src={src} alt="" onError={() => setBroken(true)} className="h-full w-full object-contain" loading="lazy" />
}

export function OwnerMaterialsSection({ onOpenCatalog, catalogAvailable = true, country = 'India' }) {
  const { t, td } = useLanguage()
  const [products, setProducts] = useState(null)

  useEffect(() => {
    let live = true
    fetchShopProducts()
      .then((reply) => { if (live) setProducts(reply?.products || []) })
      .catch(() => { if (live) setProducts([]) })
    return () => { live = false }
  }, [])

  const shown = (products || []).slice(0, MAX_PRODUCTS)

  return (
    <DiscoveryPanel
      icon={Layers}
      title={t('owner.materials.title')}
      subtitle={t('owner.materials.subtitle')}
      actionLabel={t('owner.viewAll')}
      onAction={onOpenCatalog}
      actionDisabled={!catalogAvailable}
    >
      {products === null ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-50" />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-oc-line px-4 py-4 text-xs text-oc-muted">{t('owner.materials.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          {shown.map((product) => (
            <button
              key={`${product.supplier_id}-${product.id}`}
              type="button"
              onClick={onOpenCatalog}
              disabled={!catalogAvailable}
              className="group flex min-w-0 items-center gap-2 rounded-xl border border-oc-line bg-white p-2 text-left transition hover:-translate-y-0.5 hover:border-oc-green/30 hover:shadow-sm disabled:cursor-default disabled:hover:translate-y-0"
            >
              {/* Small, contained image on the left, part of the card itself:
                  the frame only positions it (no background, border or radius). */}
              <span className="block h-14 w-14 shrink-0 sm:h-16 sm:w-16">
                <ProductImage product={product} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-start justify-between gap-1">
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-[12px] font-bold leading-snug text-oc-ink">{td(product.name)}</span>
                    <span className="mt-0.5 block text-[12px] font-extrabold leading-tight text-oc-ink">
                      {money(discountedPrice(product.price, product.discount_percentage), country)}
                      {product.unit && <span className="text-[10px] font-semibold text-oc-muted"> / {td(product.unit)}</span>}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-oc-muted transition group-hover:translate-x-0.5 group-hover:text-oc-green rtl:-scale-x-100" />
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-oc-muted">
                  <Store className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t('owner.materials.soldBy', { name: td(product.store_name || product.supplier_name) })}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </DiscoveryPanel>
  )
}
