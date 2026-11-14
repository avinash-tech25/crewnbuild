/**
 * The supplier's Products page as a construction-material store:
 *
 *   header      CREWNBUILD mark | deliver-to pincode | large search
 *   search      Top Categories + New Launches (this supplier's 4 newest
 *               listings), live results while typing
 *   grid        the supplier's listings as compact shop cards
 *   detail      gallery | brand, name, price, discount, stock,
 *               product details and specifications
 *
 * Data scope: every product shown here is one of THIS supplier's listings,
 * from GET /supplier-products (the server filters by supplier_id and joins
 * the master catalog for name, brand, category, image). Master products are
 * never listed on their own:
 *   - grid, search results and New Launches: those listings only
 *   - Top Categories: the catalog's categories (global) with their own
 *     master_categories.image_url -- no product images
 *   - product page: the listing, plus its own master product's details and
 *     gallery (/catalog/products/{id}, which sends a supplier images only for
 *     products they list)
 * The supplier's changes go through the dashboard's existing update/delete
 * handlers and the existing listing editor (ProductDetailCard). There is no
 * cart, quantity or Add to Cart here: a supplier sells these products, never
 * buys them.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, ChevronDown, ChevronRight, LayoutGrid, PackageSearch, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { CategoryImage } from '../../catalog/components/CategoryStrip.jsx'
import { fetchCatalogCategories } from '../../catalog/catalogApi.js'
import { useSupplierProductFilter } from '../../catalog/supplierCatalogSlice.js'
import { stockState } from '../../catalog/components/StockBadge.jsx'
import ProductDetailCard from '../../supplier/components/ProductDetailCard.jsx'
import { StorefrontHeader } from './StorefrontHeader.jsx'
import { SearchOverlay } from './SearchOverlay.jsx'
import { StorefrontProductCard } from './StorefrontProductCard.jsx'
import { StorefrontProductDetail } from './StorefrontProductDetail.jsx'
import { matchesWords, sellingPrice } from '../storefrontShared.js'

// Every filter control: one height, radius and padding. `active` marks a
// control whose value narrows the list.
const control = (active) => `h-10 w-full min-w-0 rounded-lg border px-3 !text-sm !leading-5 font-medium outline-none transition hover:border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${
  active ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-graphite'
}`
const NEW_LAUNCHES = 4
const RELATED = 4

/** A filter dropdown: the native select (same options and value), with one
 *  consistent arrow instead of each browser's own. */
function FilterSelect({ active, className = '', icon: Icon, children, ...props }) {
  return (
    <span className={`relative block min-w-0 ${className}`}>
      {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite/45" aria-hidden="true" />}
      <select {...props} className={`${control(active)} appearance-none pr-9 ${Icon ? 'pl-9' : ''}`}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite/45" aria-hidden="true" />
    </span>
  )
}

/** A category's admin-uploaded image (master_categories.image_url), or its
 *  initial on a neutral tile when there is none. */
function CategoryThumb({ src, name, size = 'h-8 w-8' }) {
  return <CategoryImage src={src} name={name} className={`${size} shrink-0 rounded-md ring-1 ring-slate-200`} fallbackClassName="bg-brand-50 text-sm text-brand-700" />
}

/** Categories of this supplier's listings: a sidebar list on large screens, a
 *  compact horizontal selector below that. `onChoose('')` = all categories. */
function CategoryNav({ options, images, selectedId, onChoose }) {
  const rows = [{ id: '', name: 'All categories' }, ...options.map(([id, name]) => ({ id, name }))]
  const isSelected = (id) => String(selectedId || '') === id
  const thumb = (row) => (row.id
    ? <CategoryThumb src={images.get(row.id)} name={row.name} size="h-7 w-7" />
    : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><LayoutGrid className="h-4 w-4" /></span>)
  return (
    <>
      <nav aria-label="Categories" className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:block">
        <p className="flex items-center gap-2 px-4 pb-2 pt-4 text-base font-bold text-graphite">
          <LayoutGrid className="h-4 w-4 text-graphite/50" aria-hidden="true" />
          <span className="flex-1">Categories</span>
          <ChevronRight className="h-4 w-4 text-graphite/30" aria-hidden="true" />
        </p>
        <ul className="pb-3">
          {rows.map((row) => {
            const selected = isSelected(row.id)
            return (
              <li key={row.id || 'all'}>
                <button
                  type="button"
                  onClick={() => onChoose(row.id)}
                  aria-pressed={selected}
                  className={`flex h-10 w-full items-center gap-3 border-l-[3px] pl-[13px] pr-4 text-left !text-[15px] !leading-5 transition ${
                    selected ? 'border-brand-700 bg-brand-50 font-semibold text-brand-800' : 'border-transparent font-medium text-graphite hover:bg-slate-50 hover:text-brand-800'
                  }`}
                >
                  {thumb(row)}
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <ChevronRight className={`h-4 w-4 shrink-0 transition ${selected ? 'text-brand-700' : 'text-graphite/30'}`} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div role="list" aria-label="Categories" className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 lg:hidden">
        {rows.map((row) => {
          const selected = isSelected(row.id)
          return (
            <button
              key={row.id || 'all'}
              type="button"
              role="listitem"
              onClick={() => onChoose(row.id)}
              aria-pressed={selected}
              className={`flex h-10 shrink-0 snap-start items-center gap-2 rounded-lg border pl-1.5 pr-3 !text-sm transition ${
                selected ? 'border-brand-500 bg-brand-50 font-extrabold text-brand-800' : 'border-slate-200 bg-white font-semibold text-graphite'
              }`}
            >
              {thumb(row)}
              <span className="whitespace-nowrap">{row.id ? row.name : 'All'}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/**
 * "You may also like" for one listing: this supplier's OTHER listings (the
 * same productList the grid shows -- GET /supplier-products, scoped to the
 * supplier by the server), ranked same subcategory > same category > same
 * brand > same product type, newest first within a rank. Listings sharing
 * none of those are left out; at most RELATED; never the listing itself.
 */
export function relatedListings(listing, productList) {
  if (!listing) return []
  const same = (field) => (other) => listing[field] != null && listing[field] !== '' && String(other[field]) === String(listing[field])
  const rules = [same('subcategory_id'), same('category_id'), same('brand'), same('product_type')]
  return productList
    .filter((other) => other.id !== listing.id)
    .map((other) => ({ other, rank: rules.findIndex((rule) => rule(other)) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || String(b.other.created_at || '').localeCompare(String(a.other.created_at || '')) || b.other.id - a.other.id)
    .slice(0, RELATED)
    .map(({ other }) => other)
}


const listingStatus = (product) => {
  if (product.is_published === false) return 'Unpublished'
  const state = stockState(product.quantity, product.low_stock_threshold)
  return state === 'out' ? 'Out of Stock' : state === 'low' ? 'Low Stock' : 'Active'
}

export function SupplierStorefront({ productList = [], message = '', pincode = '', onUpdateProduct, onDeleteProduct }) {
  const { country } = useLanguage()
  const [categoryId, setCategoryId] = useSupplierProductFilter('storeCategory')
  const [subcategoryId, setSubcategoryId] = useSupplierProductFilter('storeSubcategory')
  const [search, setSearch] = useSupplierProductFilter('search')
  const [brand, setBrand] = useSupplierProductFilter('brand')
  const [availability, setAvailability] = useSupplierProductFilter('availability')
  const [status, setStatus] = useSupplierProductFilter('status')
  const [priceMin, setPriceMin] = useSupplierProductFilter('priceMin')
  const [priceMax, setPriceMax] = useSupplierProductFilter('priceMax')
  const [sort, setSort] = useSupplierProductFilter('sort')

  const [categories, setCategories] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [draft, setDraft] = useState('') // typed in the bar while the dropdown is open
  const searchBar = useRef(null)
  const openSearch = () => { if (!searchOpen) { setDraft(search || ''); setSearchOpen(true) } }
  const closeSearch = () => setSearchOpen(false)
  const [viewedId, setViewedId] = useState(null)
  const [editing, setEditing] = useState(null) // listing id open in the editor

  // Top Categories: the catalog's categories (global entities, each with its
  // own image). No products are read from the catalog here.
  useEffect(() => {
    let live = true
    fetchCatalogCategories().then((rows) => live && setCategories(rows || [])).catch(() => live && setCategories([]))
    return () => { live = false }
  }, [])

  // New Launches: this supplier's newest listings (supplier_products.created_at).
  const launches = useMemo(
    () => [...productList]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)))
      .slice(0, NEW_LAUNCHES),
    [productList],
  )

  // Brand choices, from this supplier's own listings only.
  const brandOptions = useMemo(() => [...new Set(productList.map((product) => product.brand).filter(Boolean))].sort(), [productList])
  // Categories: only those this supplier has at least one listing in. productList
  // is GET /supplier-products -- the logged-in supplier's own listings, already
  // limited by the server to valid catalog listings -- and each listing carries
  // its master category_id. A category appears with the first listing in it and
  // disappears with the last; no category is named here. Ordered as the catalog
  // orders them (GET /catalog/categories), with the catalog's name.
  const categoryOptions = useMemo(() => {
    const listed = new Map()
    for (const product of productList) {
      if (product.category_id) listed.set(String(product.category_id), product.category)
    }
    const catalogOrder = new Map(categories.map((row, index) => [String(row.id), index]))
    const catalogName = new Map(categories.map((row) => [String(row.id), row.name]))
    return [...listed.entries()]
      .map(([id, name]) => [id, catalogName.get(id) || name])
      .sort((a, b) => (catalogOrder.get(a[0]) ?? Infinity) - (catalogOrder.get(b[0]) ?? Infinity) || String(a[1]).localeCompare(String(b[1])))
  }, [productList, categories])
  // Each category's admin-uploaded image, from the catalog categories.
  const categoryImages = useMemo(() => new Map(categories.map((row) => [String(row.id), row.image_url])), [categories])
  // The catalog categories (with images) this supplier lists in -- for the search
  // overlay's Top Categories, so search shows no category the supplier does not sell.
  const listedCategories = useMemo(() => {
    const ids = new Set(categoryOptions.map(([id]) => id))
    return categories.filter((row) => ids.has(String(row.id)))
  }, [categories, categoryOptions])
  // Subcategories: only those holding one of this supplier's listings (in the
  // chosen category, when one is chosen).
  const subcategoryOptions = useMemo(() => {
    const seen = new Map()
    for (const product of productList) {
      if (!product.subcategory_id) continue
      if (categoryId && String(product.category_id) !== String(categoryId)) continue
      seen.set(String(product.subcategory_id), product.subcategory_name)
    }
    return [...seen.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }, [productList, categoryId])

  const visible = useMemo(() => {
    const words = String(search || '').trim().toLowerCase()
    const min = String(priceMin).trim() === '' ? null : Number(priceMin)
    const max = String(priceMax).trim() === '' ? null : Number(priceMax)
    const rows = productList.filter((product) => {
      if (categoryId && String(product.category_id) !== String(categoryId)) return false
      if (subcategoryId && String(product.subcategory_id) !== String(subcategoryId)) return false
      if (brand && brand !== 'All' && product.brand !== brand) return false
      if (status === 'Published' && product.is_published === false) return false
      if (status === 'Unpublished' && product.is_published !== false) return false
      if (availability && availability !== 'All' && stockState(product.quantity, product.low_stock_threshold) !== availability) return false
      const price = sellingPrice(product)
      if (min !== null && price < min) return false
      if (max !== null && price > max) return false
      // Search matches this supplier's own listings: name, brand, category,
      // subcategory, size.
      if (words && !matchesWords(product, words)) return false
      return true
    })
    if (sort === 'price-asc') rows.sort((a, b) => sellingPrice(a) - sellingPrice(b))
    if (sort === 'price-desc') rows.sort((a, b) => sellingPrice(b) - sellingPrice(a))
    if (sort === 'discount-desc') rows.sort((a, b) => Number(b.discount_percentage || 0) - Number(a.discount_percentage || 0))
    if (sort === 'stock-asc') rows.sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0))
    return rows
  }, [productList, categoryId, subcategoryId, brand, status, availability, priceMin, priceMax, search, sort])

  const filtered = Boolean(categoryId || String(search || '').trim() || (brand && brand !== 'All') || (status && status !== 'All')
    || (availability && availability !== 'All') || String(priceMin).trim() || String(priceMax).trim())
  const clearAll = () => {
    setCategoryId('')
    setSubcategoryId('')
    setSearch('')
    setBrand('All')
    setStatus('All')
    setAvailability('All')
    setPriceMin('')
    setPriceMax('')
  }
  const chooseCategory = (category, subcategory = '') => {
    setCategoryId(category)
    setSubcategoryId(subcategory)
    setViewedId(null)
  }

  const viewed = viewedId == null ? null : productList.find((product) => product.id === viewedId) || null
  const editedListing = editing == null ? null : productList.find((product) => product.id === editing) || null
  const togglePublish = (listing) => onUpdateProduct(listing.id, { is_published: listing.is_published === false })

  return (
    <section className="storefront space-y-4">
      {/* The search bar belongs to the product list; the product page
          opens straight on the product, as in the reference. */}
      {!viewed && (
        <StorefrontHeader
          query={searchOpen ? draft : search}
          pincode={pincode}
          searchRef={searchBar}
          searchOpen={searchOpen}
          onOpenSearch={openSearch}
          onType={(value) => { openSearch(); setDraft(value) }}
          onSubmit={() => { setSearch(draft.trim()); setViewedId(null); closeSearch() }}
          onCloseSearch={closeSearch}
          onClearSearch={() => setSearch('')}
        />
      )}

      {message && <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>}

      {viewed ? (
        <StorefrontProductDetail
          key={viewed.id}
          listing={viewed}
          country={country}
          related={relatedListings(viewed, productList)}
          onOpenRelated={(listing) => {
            setViewedId(listing.id)
            if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          onBack={() => setViewedId(null)}
          onEdit={() => setEditing(viewed.id)}
          onTogglePublish={() => togglePublish(viewed)}
          onDelete={() => onDeleteProduct(viewed.id)}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-7">
          <CategoryNav options={categoryOptions} images={categoryImages} selectedId={categoryId} onChoose={(id) => chooseCategory(id)} />

          <div className="min-w-0 space-y-4">
            {/* The shopping filters, straight above the grid */}
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:flex xl:items-center xl:gap-3">
                {String(search || '').trim() && (
                  <button type="button" onClick={() => setSearch('')} className="col-span-2 inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-brand-50 px-3 !text-sm font-semibold text-brand-800 sm:col-span-3 xl:col-span-1">
                    <span className="max-w-[12rem] truncate">“{String(search).trim()}”</span> <X className="h-3.5 w-3.5 shrink-0" />
                  </button>
                )}
                <FilterSelect value={subcategoryId || ''} onChange={(e) => setSubcategoryId(e.target.value)} aria-label="Subcategory" active={Boolean(subcategoryId)} className="xl:min-w-0 xl:flex-[1.15]">
                  <option value="">All subcategories</option>
                  {subcategoryOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </FilterSelect>
                <FilterSelect value={brand || 'All'} onChange={(e) => setBrand(e.target.value)} aria-label="Brand" active={Boolean(brand && brand !== 'All')} className="xl:min-w-0 xl:flex-1">
                  <option value="All">All brands</option>
                  {brandOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </FilterSelect>
                <FilterSelect value={availability || 'All'} onChange={(e) => setAvailability(e.target.value)} aria-label="Availability" active={Boolean(availability && availability !== 'All')} className="xl:min-w-0 xl:flex-1">
                  <option value="All">Availability</option>
                  <option value="in">In Stock</option>
                  <option value="low">Low Stock</option>
                  <option value="out">Out of Stock</option>
                </FilterSelect>
                <FilterSelect value={status || 'All'} onChange={(e) => setStatus(e.target.value)} aria-label="Published status" active={Boolean(status && status !== 'All')} className="xl:min-w-0 xl:flex-[1.25]">
                  <option value="All">Published & hidden</option>
                  <option value="Published">Published</option>
                  <option value="Unpublished">Hidden</option>
                </FilterSelect>
                <input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} type="number" min="0" placeholder="Min ₹" aria-label="Minimum price" className={`${control(Boolean(String(priceMin).trim()))} xl:w-24 xl:shrink-0`} />
                <input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} type="number" min="0" placeholder="Max ₹" aria-label="Maximum price" className={`${control(Boolean(String(priceMax).trim()))} xl:w-24 xl:shrink-0`} />
                <FilterSelect value={sort || 'relevance'} onChange={(e) => setSort(e.target.value)} aria-label="Sort" active={false} icon={ArrowUpDown} className="xl:min-w-0 xl:flex-[1.15]">
                  <option value="relevance">Newest</option>
                  <option value="price-asc">Price: low to high</option>
                  <option value="price-desc">Price: high to low</option>
                  <option value="discount-desc">Biggest discount</option>
                  <option value="stock-asc">Lowest stock</option>
                </FilterSelect>
                {filtered && (
                  <button type="button" onClick={clearAll} className="h-10 shrink-0 whitespace-nowrap rounded-lg px-3 !text-sm font-semibold text-brand-800 hover:bg-brand-50">Clear all</button>
                )}
              </div>
            </div>

            {productList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                <PackageSearch className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-lg font-extrabold text-graphite">Your store is empty</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-graphite/55">Products you add from the catalog, with your price and stock, appear here.</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <PackageSearch className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-2 font-bold text-graphite">No products match</p>
                <button type="button" onClick={clearAll} className="mt-2 text-sm font-extrabold text-brand-800 hover:underline">Clear search and filters</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
                {visible.map((listing) => (
                  <StorefrontProductCard
                    key={listing.id}
                    listing={listing}
                    country={country}
                    onOpen={() => setViewedId(listing.id)}
                    onEdit={() => setEditing(listing.id)}
                    onTogglePublish={() => togglePublish(listing)}
                    onDelete={() => onDeleteProduct(listing.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <SearchOverlay
        open={searchOpen}
        anchorRef={searchBar}
        query={draft}
        categories={listedCategories}
        launches={launches}
        productList={productList}
        country={country}
        onClose={closeSearch}
        onSubmitQuery={(words) => { setSearch(words); setViewedId(null); setSearchOpen(false) }}
        onSelectCategory={(category) => { setSearch(''); chooseCategory(String(category.id)); setSearchOpen(false) }}
        onOpenListing={(listing) => { setViewedId(listing.id); setSearchOpen(false) }}
      />

      {/* The existing listing editor: price, discount, stock, threshold, published. */}
      {editedListing && (
        <ProductDetailCard
          key={`editor-${editedListing.id}`}
          product={editedListing}
          statusKey={listingStatus(editedListing)}
          startInEdit
          onSave={async (productId, updates) => {
            const saved = await onUpdateProduct(productId, updates)
            if (!saved) throw new Error('That change could not be saved.')
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
