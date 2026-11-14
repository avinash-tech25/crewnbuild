/**
 * A House Owner's Self Construction project -> Suppliers: the materials
 * marketplace for the project's location. No request first.
 *
 * Data (nothing mocked, nothing hard-coded):
 *   - GET /suppliers/nearby?project_id=... -- the suppliers serving the
 *     project's pincode (the project's own location, resolved by the server)
 *     with their PUBLISHED catalog listings (price, discount, stock, image,
 *     brand logo, category / subcategory). One request; every card is one real
 *     supplier listing, so the same product from two suppliers is two cards,
 *     each naming its supplier.
 *   - product page: GET /catalog/products/{id} for the product itself
 *     (images, highlights, description, FAQs, returns policy), plus every
 *     local supplier's listing of it.
 *   - cart: the existing cart (CartStepper -> /cart/items) against the listing
 *     id, so the cart line keeps the supplier. The server accepts a supplier
 *     serving this Self Construction project's location without a request.
 * Search: focusing the search bar opens the supplier page's search panel
 * ANCHORED under the bar (Top Categories from the catalog, and product cards)
 * -- no centered dialog, no route change -- over THIS project's marketplace
 * listings -- the ones the server already
 * limited to suppliers serving the project's pincode and to published
 * listings. Typing shows the matching categories and products (name, brand,
 * category, subcategory, size, supplier store name). A category or "See all
 * results" narrows the grid below; a product opens its product page. No
 * permanent filter row.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ImageOff, Loader2, MapPin, PackageSearch, Search, ShoppingCart, Store, X } from 'lucide-react'
import { fetchNearbySuppliers } from '../../projects/projectsApi.js'
import { fetchCatalogCategories, fetchCatalogProduct } from '../../catalog/catalogApi.js'
import { SearchOverlay } from '../../storefront/components/SearchOverlay.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { loadCart, selectCartCount } from '../cartSlice.js'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { StockBadge } from '../../catalog/components/StockBadge.jsx'
import { discountedPrice } from '../../catalog/components/PriceTag.jsx'
import { ProductDetailView } from '../../catalog/components/ProductDetailView.jsx'
import { CartStepper } from './CartStepper.jsx'
import { ProductServiceBadges } from '../../catalog/components/ProductServiceBadges.jsx'
import { BulkPricingList } from '../../catalog/components/BulkPricing.jsx'
import { CategoryStrip } from '../../catalog/components/CategoryStrip.jsx'
import { formatMoney } from '../../../shared/utils/countryConfig.js'

const selling = (listing) => discountedPrice(listing.price, listing.discount_percentage)
/** Every typed word must appear in the listing's name, brand, category,
 *  subcategory, size or supplier store name. */
const matchesListing = (row, query) => {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = [row.name, row.brand, row.category_name, row.category, row.subcategory_name, row.size, row.supplier_name].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

function CardImage({ src, alt }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (!src || broken) {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-300">
        <ImageOff className="h-6 w-6" />
        <span className="text-[10px] font-semibold text-slate-400">No image yet</span>
      </span>
    )
  }
  return <img src={imageUrl(src)} alt={alt} onError={() => setBroken(true)} className="h-full w-full object-contain p-2.5" />
}

function ListingCard({ listing, country, projectId, onOpen, onMessage }) {
  const discount = Number(listing.discount_percentage || 0)
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-brand-300 hover:shadow-sm">
      <button type="button" onClick={onOpen} className="relative aspect-[5/4] w-full overflow-hidden rounded-lg bg-slate-50" aria-label={`View ${listing.name} from ${listing.supplier_name}`}>
        <CardImage src={listing.image_url} alt={listing.name} />
        {discount > 0 && (
          <span className="absolute left-1.5 top-1.5 rounded bg-oc-amber px-1.5 py-0.5 text-[10px] font-extrabold text-graphite">{Number(discount.toFixed(2))}% OFF</span>
        )}
      </button>
      <span className="mt-2 flex min-w-0 items-center gap-1.5">
        <BrandLogo src={listing.brand_logo_url} name={listing.brand || 'Generic'} size="xs" />
        <span className="truncate text-[10px] font-extrabold uppercase tracking-wide text-brand-700">{listing.brand || 'Generic'}</span>
      </span>
      <button type="button" onClick={onOpen} className="text-left">
        <h3 className="line-clamp-2 text-[13px] font-bold leading-snug text-graphite">{listing.name}</h3>
      </button>
      <p className="truncate text-[11px] text-graphite/55">{[listing.subcategory_name, listing.size].filter(Boolean).join(' · ')}</p>
      <ProductServiceBadges className="mt-1" />
      <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-graphite/70">
        <Store className="h-3 w-3 shrink-0 text-graphite/40" /> <span className="truncate">Sold by {listing.supplier_name}</span>
      </p>
      <p className="mt-1 text-[15px] font-extrabold leading-tight text-graphite">
        {formatMoney(selling(listing), country)}
        {listing.unit && <span className="text-[11px] font-semibold text-graphite/45"> / {listing.unit}</span>}
      </p>
      {discount > 0 && (
        <p className="flex items-baseline gap-1.5 text-[11px]">
          <span className="font-semibold text-graphite/40 line-through">{formatMoney(listing.price, country)}</span>
          <span className="font-extrabold text-brand-700">{Number(discount.toFixed(2))}% OFF</span>
        </p>
      )}
      <BulkPricingList tiers={listing.bulk_pricing} country={country} compact className="mt-1" />
      <StockBadge quantity={listing.quantity} threshold={listing.low_stock_threshold} className="mt-1 self-start" />
      <div className="mt-auto pt-2">
        <CartStepper offer={listing} projectId={projectId} onMessage={onMessage} size="sm" full />
      </div>
    </article>
  )
}

export function OwnerMarketplace({ projectId, pincode, country = 'India', onOpenCart }) {
  const dispatch = useDispatch()
  const cartCount = useSelector(selectCartCount)
  const [listings, setListings] = useState([])
  const [supplierCount, setSupplierCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [categories, setCategories] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [draft, setDraft] = useState('') // what is typed in the bar while the panel is open
  const searchBar = useRef(null)
  const openSearch = () => { if (!searchOpen) { setDraft(search); setSearchOpen(true) } }
  const closeSearch = () => setSearchOpen(false)
  const [openListing, setOpenListing] = useState(null)
  const [product, setProduct] = useState(null)

  // The catalog's categories (with their own images) for the overlay's Top Categories.
  useEffect(() => {
    let live = true
    fetchCatalogCategories().then((rows) => live && setCategories(rows || [])).catch(() => live && setCategories([]))
    return () => { live = false }
  }, [])

  // The project's marketplace: local suppliers and their published listings.
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    fetchNearbySuppliers(pincode, country, projectId)
      .then((suppliers) => {
        if (!live) return
        const rows = []
        for (const supplier of suppliers || []) {
          for (const listing of supplier.products || []) {
            if (listing.master_product_id == null || listing.is_published === false) continue
            rows.push({ ...listing, supplier_id: supplier.user_id, supplier_name: supplier.store_name || supplier.name })
          }
        }
        setListings(rows)
        setSupplierCount((suppliers || []).length)
      })
      .catch((failure) => live && setError(failure.response?.data?.detail || 'The suppliers for this project could not be loaded.'))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [projectId, pincode, country])

  // The cart the Add to Cart controls read: this project's, from the existing cart API.
  useEffect(() => {
    if (projectId) dispatch(loadCart(projectId))
  }, [projectId, dispatch])

  // The product page: the product itself, read once when opened.
  useEffect(() => {
    if (!openListing) {
      setProduct(null)
      return undefined
    }
    let live = true
    setProduct(null)
    fetchCatalogProduct(openListing.master_product_id).then((row) => live && setProduct(row)).catch(() => live && setProduct(null))
    return () => { live = false }
  }, [openListing])

  const visible = useMemo(
    () => listings.filter((row) => (!categoryId || String(row.category_id) === String(categoryId)) && matchesListing(row, search)),
    [listings, search, categoryId],
  )
  // Newest listings first, for the overlay's product section.
  const launches = useMemo(
    () => [...listings].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id))).slice(0, 8),
    [listings],
  )
  const categoryName = categories.find((row) => String(row.id) === String(categoryId))?.name
    || listings.find((row) => String(row.category_id) === String(categoryId))?.category_name

  // "You may also like" for an opened listing: other local listings (never
  // another listing of the same product, which the page already lists as an
  // offer), same subcategory > same category > same brand, at most 4.
  const relatedFor = (listing) => {
    const same = (field) => (row) => listing[field] != null && listing[field] !== '' && String(row[field]) === String(listing[field])
    const rules = [same('subcategory_id'), same('category_id'), same('brand')]
    return listings
      .filter((row) => row.master_product_id !== listing.master_product_id)
      .map((row) => ({ row, rank: rules.findIndex((rule) => rule(row)) }))
      .filter(({ rank }) => rank >= 0)
      .sort((x, y) => x.rank - y.rank)
      .slice(0, 4)
      .map(({ row }) => row)
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="font-display text-lg font-extrabold text-graphite">Suppliers / Materials</h3>
        <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-graphite/60">
          Project delivery location: <MapPin className="h-3.5 w-3.5 text-brand-700" /> <span className="font-extrabold text-graphite">{pincode || '—'}</span>
        </p>
      </div>
      <button type="button" onClick={onOpenCart} className="relative inline-flex h-10 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-extrabold text-brand-800 hover:bg-brand-100">
        <ShoppingCart className="h-4 w-4" /> Cart
        {cartCount > 0 && <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-oc-amber px-1 text-[11px] font-extrabold text-graphite">{cartCount}</span>}
      </button>
    </div>
  )

  // ---- product page
  if (openListing) {
    const related = relatedFor(openListing)
    const offers = listings
      .filter((row) => row.master_product_id === openListing.master_product_id)
      .sort((a, b) => Number(b.id === openListing.id) - Number(a.id === openListing.id))
    return (
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        {header}
        {message && <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800">{message}</p>}
        <ProductDetailView
          showAppBanner
          product={product}
          offers={offers}
          onBack={() => setOpenListing(null)}
          renderOfferAction={(offer) => <CartStepper offer={offer} projectId={projectId} onMessage={setMessage} size="sm" />}
          showSpecifications={false}
          showServiceBadges
        />
        {related.length > 0 && (
          <section aria-label="You may also like" className="border-t border-slate-100 pt-4">
            <h4 className="font-display text-base font-extrabold text-graphite">You may also like</h4>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {related.map((listing) => (
                <ListingCard key={listing.id} listing={listing} country={country} projectId={projectId} onOpen={() => { setMessage(''); setOpenListing(listing) }} onMessage={setMessage} />
              ))}
            </div>
          </section>
        )}
      </section>
    )
  }

  const overlay = (
    <SearchOverlay
      open={searchOpen}
      anchorRef={searchBar}
      align="center"
      query={draft}
      categories={categories}
      launches={launches}
      productList={listings}
      country={country}
      onClose={closeSearch}
      onSubmitQuery={(words) => { setSearch(words); closeSearch() }}
      onSelectCategory={(category) => { setSearch(''); setDraft(''); setCategoryId(String(category.id)); closeSearch() }}
      onOpenListing={(listing) => { setMessage(''); setOpenListing(listing); closeSearch() }}
      typedResults="cards"
      detailedCards
      matchListing={matchesListing}
      productsTitle="New Launches"
      emptyProductsText={`No supplier products for ${pincode || 'this location'} yet.`}
      typedTitle="Products"
      noMatchText={`No products from suppliers serving ${pincode || 'this location'} match`}
    />
  )

  // ---- marketplace
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      {overlay}
      {header}

      <div
        ref={searchBar}
        className={`relative flex h-11 items-center gap-2.5 rounded-xl border-2 bg-white px-3.5 transition ${searchOpen ? 'border-brand-500 shadow-sm' : 'border-slate-200 hover:border-brand-400'}`}
      >
        <Search className="h-4 w-4 shrink-0 text-graphite" />
        <input
          value={searchOpen ? draft : search}
          onFocus={openSearch}
          onClick={openSearch}
          onChange={(event) => { openSearch(); setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); setSearch(draft.trim()); closeSearch(); event.currentTarget.blur() }
            if (event.key === 'Escape') { closeSearch(); event.currentTarget.blur() }
          }}
          placeholder="Search products, brands or materials..."
          aria-label="Search products, brands or materials"
          autoComplete="off"
          className="h-full w-full bg-transparent text-sm font-semibold text-graphite outline-none placeholder:font-normal placeholder:text-slate-400"
        />
        {(searchOpen || search) && (
          <button
            type="button"
            onClick={() => (searchOpen ? closeSearch() : setSearch(''))}
            aria-label={searchOpen ? 'Close search' : 'Clear search'}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* The catalog's categories (master_categories), the same shared strip
          the product catalog uses; "All" clears the choice. */}
      {categories.length > 0 && (
        <CategoryStrip categories={categories} selectedId={categoryId} onSelect={setCategoryId} allLabel="All" />
      )}

      {message && <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800">{message}</p>}
      {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{error}</p>}

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm font-semibold text-graphite/45"><Loader2 className="h-4 w-4 animate-spin" /> Loading suppliers near {pincode}…</p>
      ) : listings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-extrabold text-graphite">No supplier products for {pincode || 'this location'} yet</p>
          <p className="mt-1 text-xs text-graphite/55">Products appear here as soon as a supplier serving this location publishes them.</p>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold text-graphite/55">
            {search.trim() || categoryId
              ? `${visible.length} of ${listings.length} products match${search.trim() ? ` “${search.trim()}”` : ''}${categoryName ? ` in ${categoryName}` : ''}`
              : `${listings.length} product${listings.length === 1 ? '' : 's'} from ${supplierCount} supplier${supplierCount === 1 ? '' : 's'} serving ${pincode}`}
          </p>
          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
              <p className="text-sm font-extrabold text-graphite">No products from suppliers serving {pincode} match</p>
              <button type="button" onClick={() => { setSearch(''); setCategoryId('') }} className="mt-1 text-xs font-extrabold text-brand-800 hover:underline">Show all products</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 min-[1400px]:grid-cols-5">
              {visible.map((listing) => (
                <ListingCard key={listing.id} listing={listing} country={country} projectId={projectId} onOpen={() => { setMessage(''); setOpenListing(listing) }} onMessage={setMessage} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default OwnerMarketplace
