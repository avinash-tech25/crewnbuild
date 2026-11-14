/**
 * The product catalog buyers browse: search with a Top Categories panel,
 * category products, and the product page.
 *
 * Two sources, never mixed:
 *   - the admin's MASTER catalog (/catalog/*): categories with pictures, what a
 *     product is -- name, brand, images, highlights, description, FAQs,
 *     returns policy;
 *   - OFFERS from `loadSuppliers`, the same supplier feed the caller's supplier
 *     browser already uses (nearby / approved / assigned suppliers with their
 *     published listings). Location and approval rules are therefore exactly
 *     the existing ones.
 *
 * A product is listed only when at least one of those suppliers sells it, and
 * its price is theirs. A master product alone is never shown as available.
 *
 * `cartProjectId` is optional: House Owners and Site Engineers pass their
 * active project and can add an offer to that project's cart through the same
 * cart action the supplier browser uses; a Builder's page is browse-only.
 */
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { PackageSearch, ShoppingCart } from 'lucide-react'
import {
  closeBrowseProduct,
  loadBrowseCategories,
  loadBrowseCategoryProducts,
  loadBrowseOffers,
  loadBrowseProduct,
  openBrowseProduct,
  resetBrowse,
  searchBrowseCatalog,
  selectBrowseCategory,
  selectCatalogBrowse,
  setBrowseQuery,
} from '../../catalog/catalogSlice.js'
import { addProductToCart, loadCart, selectCartCount } from '../cartSlice.js'
import { CartStepper } from './CartStepper.jsx'
import { CategoryStrip } from '../../catalog/components/CategoryStrip.jsx'
import { CatalogSearchOverlay } from '../../catalog/components/CatalogSearchOverlay.jsx'
import { ProductDetailView, ProductTile, bestOffer } from '../../catalog/components/ProductDetailView.jsx'
import { discountedPrice } from '../../catalog/components/PriceTag.jsx'

export default function ProductCatalogPage({ loadSuppliers, reloadKey = '', cartProjectId = null, canAddToCart = false, title = 'Product Catalog', onOpenCart, compactHeader = false }) {
  const dispatch = useDispatch()
  const cartCount = useSelector(selectCartCount)
  const {
    categories,
    selectedCategoryId,
    categoryProducts,
    searchQuery,
    searchResults,
    searching,
    selectedProductId,
    selectedProduct,
    offers,
    offersLoaded,
    loading,
    error,
  } = useSelector(selectCatalogBrowse)
  const [addingOfferId, setAddingOfferId] = useState(null)
  const [cartMessage, setCartMessage] = useState('')

  // Fresh on every visit and whenever the caller's supplier feed changes
  // (another project, pincode or country).
  useEffect(() => {
    dispatch(resetBrowse())
    dispatch(loadBrowseCategories())
    dispatch(loadBrowseOffers(loadSuppliers))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, reloadKey])

  // The cart the steppers read: the active project's, from the existing cart API.
  useEffect(() => {
    if (canAddToCart && cartProjectId) dispatch(loadCart(cartProjectId))
  }, [canAddToCart, cartProjectId, dispatch])

  useEffect(() => {
    if (selectedCategoryId) dispatch(loadBrowseCategoryProducts(selectedCategoryId))
  }, [selectedCategoryId, dispatch])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) return undefined
    const timer = setTimeout(() => dispatch(searchBrowseCatalog(query)), 250)
    return () => clearTimeout(timer)
  }, [searchQuery, dispatch])

  useEffect(() => {
    if (selectedProductId) dispatch(loadBrowseProduct(selectedProductId))
    setCartMessage('')
  }, [selectedProductId, dispatch])

  // master_product_id -> the offers for it, cheapest (after discount) first.
  const offersByProduct = useMemo(() => {
    const map = {}
    for (const offer of offers) (map[offer.master_product_id] ||= []).push(offer)
    for (const list of Object.values(map)) {
      list.sort((a, b) => discountedPrice(a.price, a.discount_percentage) - discountedPrice(b.price, b.discount_percentage))
    }
    return map
  }, [offers])
  const offered = (product) => Boolean(offersByProduct[product.id]?.length)
  const cheapest = (product) => bestOffer(offersByProduct[product.id] || [])

  const categoryList = categoryProducts.filter(offered)
  const searchList = searchResults.filter(offered)
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) || null

  const addToCart = async (offer) => {
    if (!cartProjectId) {
      setCartMessage('Choose a project first; the cart belongs to a project.')
      return
    }
    setAddingOfferId(offer.id)
    setCartMessage('')
    const result = await dispatch(addProductToCart({ projectId: cartProjectId, productId: offer.id, quantity: 1 }))
    setAddingOfferId(null)
    setCartMessage(result.meta.requestStatus === 'fulfilled' ? `${offer.name} added to your cart.` : result.payload)
  }

  if (selectedProductId) {
    const related = selectedProduct
      ? categoryProducts
          .concat(searchResults)
          .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
          .filter((item) => item.id !== selectedProduct.id && offered(item))
          .filter((item) => item.subcategory_id === selectedProduct.subcategory_id || item.category_id === selectedProduct.category_id)
          .sort((a, b) => Number(b.subcategory_id === selectedProduct.subcategory_id) - Number(a.subcategory_id === selectedProduct.subcategory_id))
          .slice(0, 10)
      : []
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ProductDetailView
          showAppBanner
          product={selectedProduct}
          offers={offersByProduct[selectedProductId] || []}
          onBack={() => dispatch(closeBrowseProduct())}
          onAddToCart={canAddToCart ? addToCart : undefined}
          renderOfferAction={canAddToCart ? (offer) => <CartStepper offer={offer} projectId={cartProjectId} onMessage={setCartMessage} size="sm" /> : undefined}
          addingOfferId={addingOfferId}
          message={cartMessage}
          related={related}
          relatedPrice={cheapest}
          onOpenProduct={(id) => dispatch(openBrowseProduct(id))}
        />
      </section>
    )
  }

  const searchBox = (
    <CatalogSearchOverlay
      categories={categories}
      query={searchQuery}
      onQueryChange={(value) => dispatch(setBrowseQuery(value))}
      results={searchList}
      searching={searching}
      onSelectCategory={(id) => {
        dispatch(setBrowseQuery(''))
        dispatch(selectBrowseCategory(id))
      }}
      onOpenProduct={(id) => dispatch(openBrowseProduct(id))}
    />
  )
  const cartButton = canAddToCart && onOpenCart ? (
    <button
      type="button"
      onClick={onOpenCart}
      className={`relative inline-flex ${compactHeader ? 'h-12' : 'h-10'} shrink-0 items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 text-sm font-extrabold text-brand-800 transition hover:bg-brand-100`}
    >
      <ShoppingCart className="h-4 w-4" /> Cart
      {cartCount > 0 && (
        <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-oc-amber px-1 text-[11px] font-extrabold text-graphite">{cartCount}</span>
      )}
    </button>
  ) : null

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {compactHeader ? (
        // Opt-in (Site Engineer): no heading; a half-width search with the cart beside it.
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 sm:flex-none sm:basis-1/2">{searchBox}</div>
          {cartButton}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {/* A page whose section is already named (the Builder's) passes no title. */}
              {title && <h3 className="font-display text-xl font-extrabold text-graphite">{title}</h3>}
              <p className={`${title ? 'mt-0.5 ' : ''}text-xs font-semibold text-graphite/50`}>
                Products your suppliers sell, with their prices and discounts.
              </p>
            </div>
            {cartButton}
          </div>
          {searchBox}
        </>
      )}

      {/* The admin's categories, as circles with their pictures. */}
      {categories.length > 0 && (
        <CategoryStrip categories={categories} selectedId={selectedCategoryId ?? ''} onSelect={(id) => dispatch(selectBrowseCategory(id))} />
      )}

      {cartMessage && <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800">{cartMessage}</p>}

      {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{error}</p>}

      {!selectedCategoryId ? (
        <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-xs font-semibold text-graphite/55">
          <PackageSearch className="h-4 w-4 text-graphite/30" />
          Choose a category, or search, to see products.
        </p>
      ) : (
        <div>
          <h4 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-graphite">
            {selectedCategory?.name}
            {offersLoaded && !loading && <span className="ml-2 text-xs font-bold text-graphite/40">{categoryList.length}</span>}
          </h4>
          {loading || !offersLoaded ? (
            <p className="text-xs font-semibold text-graphite/45">Loading…</p>
          ) : categoryList.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs font-semibold text-graphite/55">
              None of your suppliers sells a product in this category yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {categoryList.map((product) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  offer={cheapest(product)}
                  onOpen={() => dispatch(openBrowseProduct(product.id))}
                  footer={canAddToCart && cheapest(product) ? (
                    <CartStepper offer={cheapest(product)} projectId={cartProjectId} onMessage={setCartMessage} size="sm" full />
                  ) : null}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
