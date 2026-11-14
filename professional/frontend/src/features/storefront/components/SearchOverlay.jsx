/**
 * The search dropdown shared by /supplier/products and the House Owner's
 * project Suppliers marketplace.
 *
 * It hangs directly under the page's own search bar (anchorRef), which stays
 * the input (query): no centered dialog, no backdrop, no second search field,
 * no route change. The page stays visible and usable around it; only the
 * panel itself has a border and a soft shadow. It is compact -- 650-900 px
 * wide following the bar (the viewport less a small margin on phones) and at
 * most ~520 px tall -- and scrolls inside.
 *
 *   empty query  Top Categories (the catalog's categories with their own
 *                images, one scrolling row), then the products the caller
 *                passes as `launches`
 *   typing       the caller's listings matching the words, updated in place
 *
 * Closes on the X in the bar (caller), Escape, or a click outside the bar and
 * the panel; a click inside it does not close it.
 *
 * Products are only the listings the caller passes in -- never a master
 * product on its own. The two pages keep their own data scope:
 *   /supplier/products          the supplier's own listings
 *   owner Suppliers marketplace listings of suppliers serving the project's
 *                               pincode (typedResults="cards", detailedCards,
 *                               matchListing with the store name)
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ImageOff, Store } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { StockBadge } from '../../catalog/components/StockBadge.jsx'
import { discountOf, matchesWords, money, sellingPrice, sizeOf } from '../storefrontShared.js'

const MIN_WIDTH = 650
const MAX_WIDTH = 900
const MAX_HEIGHT = 520
const GUTTER = 12

function CategoryCircle({ category, onSelect }) {
  const [broken, setBroken] = useState(false)
  return (
    <button type="button" onClick={() => onSelect(category)} className="group flex w-20 shrink-0 snap-start flex-col items-center gap-1.5">
      <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-full border-2 border-brand-200 bg-brand-50 transition group-hover:border-brand-500">
        {category.image_url && !broken ? (
          <img src={imageUrl(category.image_url)} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xl font-extrabold text-brand-700">{String(category.name || '?').charAt(0).toUpperCase()}</span>
        )}
      </span>
      <span className="line-clamp-2 text-center text-xs font-bold leading-tight text-graphite">{category.name}</span>
    </button>
  )
}

/** A compact product card: one listing. `detailed` adds subcategory, the
 *  supplier's store name and stock (the owner marketplace). */
function LaunchCard({ listing, country, onOpen, detailed = false }) {
  const [broken, setBroken] = useState(false)
  const discount = discountOf(listing)
  return (
    <button type="button" onClick={onOpen} className="flex min-w-0 flex-col rounded-lg p-1 text-left transition hover:bg-slate-50">
      <span className="relative grid aspect-[5/4] w-full place-items-center overflow-hidden rounded-lg bg-slate-50">
        {listing.image_url && !broken ? (
          <img src={imageUrl(listing.image_url)} alt={listing.name} onError={() => setBroken(true)} className="h-full w-full object-contain p-1.5" />
        ) : (
          <ImageOff className="h-6 w-6 text-slate-300" />
        )}
        {discount > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded bg-oc-amber px-1.5 py-0.5 text-[10px] font-extrabold text-graphite">{Number(discount.toFixed(2))}% OFF</span>
        )}
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-1">
        <BrandLogo src={listing.brand_logo_url} name={listing.brand || 'Generic'} size="xs" />
        <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-brand-700">{listing.brand || 'Generic'}</span>
      </span>
      <span className="line-clamp-2 text-xs font-bold leading-snug text-graphite">{listing.name}</span>
      {detailed ? (
        <span className="truncate text-[11px] text-graphite/50">{[listing.subcategory_name, listing.size || listing.unit].filter(Boolean).join(' · ')}</span>
      ) : (
        sizeOf(listing) && <span className="truncate text-[11px] text-graphite/50">{sizeOf(listing)}</span>
      )}
      {detailed && listing.supplier_name && (
        <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold text-graphite/70">
          <Store className="h-3 w-3 shrink-0 text-graphite/40" /> <span className="truncate">Sold by {listing.supplier_name}</span>
        </span>
      )}
      <span className="mt-0.5 text-xs font-extrabold text-graphite">
        {money(sellingPrice(listing), country)}
        {discount > 0 && <span className="ml-1 text-[10px] font-semibold text-graphite/40 line-through">{money(listing.price, country)}</span>}
      </span>
      {detailed && <StockBadge quantity={listing.quantity} threshold={listing.low_stock_threshold} className="mt-0.5 self-start" />}
    </button>
  )
}

export function SearchOverlay({
  open,
  anchorRef,                      // the search bar the dropdown hangs from
  query = '',                     // what is typed in that bar
  categories = [],
  launches = [],
  productList = [],
  country,
  onClose,
  onSubmitQuery,
  onSelectCategory,
  onOpenListing,
  typedResults = 'list',          // 'list' rows | 'cards' categories + product cards
  detailedCards = false,          // subcategory, store name, stock on cards
  matchListing = matchesWords,    // (listing, words) -> boolean
  productsTitle = 'New Launches',
  emptyProductsText = 'No products in your store yet.',
  typedTitle = 'In your store',
  noMatchText = 'None of your products matches',
  // 'start': left edge on the bar's left edge (the supplier header);
  // 'center': centered under the bar (a full-width bar, the owner page).
  align = 'start',
}) {
  const panel = useRef(null)
  const [box, setBox] = useState(null)

  // Directly under the search bar, following it on scroll and resize.
  useLayoutEffect(() => {
    if (!open) return undefined
    const place = () => {
      const rect = anchorRef?.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(window.innerWidth - GUTTER * 2, Math.min(MAX_WIDTH, Math.max(rect.width, MIN_WIDTH)))
      const wanted = align === 'center' ? rect.left + (rect.width - width) / 2 : rect.left
      const left = Math.min(Math.max(GUTTER, wanted), window.innerWidth - GUTTER - width)
      const room = window.innerHeight - rect.bottom - GUTTER - 6
      setBox({ top: rect.bottom + 6, left, width, maxHeight: Math.max(220, Math.min(MAX_HEIGHT, room)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, anchorRef, align])

  // Escape, or a click outside the bar and the dropdown, closes it.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (panel.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return
      onClose()
    }
    const onKey = (event) => event.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open, anchorRef, onClose])

  const words = query.trim()
  const results = useMemo(() => (words ? productList.filter((listing) => matchListing(listing, words)) : []), [words, productList, matchListing])
  // Typed search, cards mode: the categories whose name matches, or that hold a matching listing.
  const matchedCategories = useMemo(() => {
    if (!words || typedResults !== 'cards') return []
    const lower = words.toLowerCase()
    const held = new Set(results.map((listing) => String(listing.category_id)))
    return categories.filter((category) => String(category.name || '').toLowerCase().includes(lower) || held.has(String(category.id)))
  }, [words, results, categories, typedResults])

  if (!open || !box) return null

  const heading = (title) => <h3 className="text-sm font-extrabold text-graphite">{title}</h3>
  const categoryRow = (rows) => (
    <div className="-mx-1 mt-3 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
      {rows.map((category) => <CategoryCircle key={category.id} category={category} onSelect={onSelectCategory} />)}
    </div>
  )
  const cardGrid = (rows) => (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {rows.map((listing) => (
        <LaunchCard key={listing.id} listing={listing} country={country} detailed={detailedCards} onOpen={() => onOpenListing(listing)} />
      ))}
    </div>
  )
  const seeAll = (
    <button type="button" onClick={() => onSubmitQuery(words)} className="inline-flex items-center gap-1 text-xs font-extrabold text-brand-800 hover:underline">
      See all results <ArrowRight className="h-3.5 w-3.5" />
    </button>
  )

  let body
  if (words && typedResults === 'cards') {
    body = (
      <>
        {matchedCategories.length > 0 && (
          <section>
            {heading('Categories')}
            {categoryRow(matchedCategories)}
          </section>
        )}
        <section className={matchedCategories.length > 0 ? 'mt-4' : ''}>
          <div className="flex items-center justify-between gap-3">{heading(typedTitle)}{seeAll}</div>
          {results.length === 0 ? <p className="mt-2 text-xs text-graphite/55">{noMatchText} “{words}”.</p> : cardGrid(results.slice(0, 12))}
        </section>
      </>
    )
  } else if (words) {
    body = (
      <section>
        <div className="flex items-center justify-between gap-3">{heading(typedTitle)}{seeAll}</div>
        {results.length === 0 ? (
          <p className="mt-2 text-xs text-graphite/55">{noMatchText} “{words}”.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {results.slice(0, 8).map((listing) => (
              <li key={listing.id}>
                <button type="button" onClick={() => onOpenListing(listing)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50">
                  <BrandLogo src={listing.brand_logo_url} name={listing.brand || 'Generic'} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-graphite">{listing.name}</span>
                    <span className="block truncate text-[11px] text-graphite/50">{[listing.brand, listing.subcategory_name, listing.size || listing.unit].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="shrink-0 text-sm font-extrabold text-graphite">{money(sellingPrice(listing), country)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  } else {
    body = (
      <>
        <section>
          {heading('Top Categories')}
          {categories.length === 0 ? <p className="mt-2 text-xs text-graphite/55">No categories in the catalog yet.</p> : categoryRow(categories)}
        </section>
        <section className="mt-4">
          {heading(productsTitle)}
          {launches.length === 0 ? <p className="mt-2 text-xs text-graphite/55">{emptyProductsText}</p> : cardGrid(launches)}
        </section>
      </>
    )
  }

  return (
    <div
      ref={panel}
      role="region"
      aria-label="Search"
      className="fixed z-[120] overflow-y-auto rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.30)]"
      style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
    >
      {body}
    </div>
  )
}
