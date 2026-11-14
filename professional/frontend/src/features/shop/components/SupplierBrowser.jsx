/**
 * Browsing a supplier and their materials.
 *
 * One component for every buyer. A House Owner and a Site Engineer see the same
 * screen — the same supplier cards, the same filters, the same product grid and
 * the same product details — while what each of them may do stays with the
 * caller: the owner passes a send-request action, the engineer does not, and the
 * supplier list itself comes from whatever `loadSuppliers` the caller gives.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Package,
  Search,
  Send,
  Settings,
  ShoppingCart,
  Star,
  Store,
  Truck,
  UserRound,
  Warehouse,
  Wrench,
} from 'lucide-react'
import { fetchSupplierProfile } from '../../accounts/publicProfileApi.js'
import BuyerProductCard from './BuyerProductCard.jsx'
import ProductCard from './ProductCard.jsx'
import { categoryImage, categorySlug } from './categoryImagery.js'
import { fetchCatalogCategories } from '../../catalog/catalogApi.js'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar, EntityPill } from '../../../shared/ui/EntityPill.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { addProductToCart, selectCartCount } from '../cartSlice.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatNumber } from '../../../shared/utils/formatters.js'
import { listingSearchScore } from '../../../shared/utils/catalogSearch.js'
import { optionLabel, SUPPLIER_CATEGORY_KEYS, SUPPLIER_TYPE_KEYS, SUPPLIER_OFFERING_KEYS, DEFAULT_SUPPLIER_OFFERING_KEYS } from '../../../i18n/optionKeys.js'
import { supplierTypeOptions } from '../../onboarding/profileConstants.js'

// The wording for one supplier's catalogue, chosen by that supplier's own saved
// category. Falls back to the screen's existing wording when they have not
// chosen one, so nothing regresses for an uncategorised supplier.
const offeringKeys = (supplier) => SUPPLIER_OFFERING_KEYS[supplier?.supplier_category] || DEFAULT_SUPPLIER_OFFERING_KEYS

// The icon each supplier type wears on its type chip and its Availability row
// in the reference card layout. A supplier with no saved type gets the store
// mark and the material row, the same fallback the wording above uses.
const SUPPLIER_TYPE_ICONS = {
  'Material Supplier': { chip: Warehouse, availability: Truck },
  'Labor Supplier': { chip: UserRound, availability: Wrench },
  'Equipment Supplier': { chip: Settings, availability: Package },
}
const supplierTypeIcons = (supplier) => SUPPLIER_TYPE_ICONS[supplier?.supplier_category] || { chip: Store, availability: Truck }

function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <section className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
      <Icon className="mx-auto mb-3 h-8 w-8 text-brand-400" />
      <h3 className="font-display text-base font-extrabold text-slate-950">{title}</h3>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm font-medium text-slate-500">{hint}</p>}
      {action}
    </section>
  )
}

export default function SupplierBrowser({
  projects,
  loadSuppliers,
  onOpenCart,
  activeProjectId,
  // Optional. A caller that owns the active project is told when the project
  // control below changes, so its copy stays in step. Callers that own it
  // elsewhere (the House Owner) omit this and are unaffected.
  onProjectChange,
  reloadKey = '',
  // Opt-in. Each change re-reads the supplier list quietly (no loading state),
  // e.g. on a live hint; callers that omit it are unaffected.
  refreshKey = 0,
  // Opt-in. Called before a supplier's catalogue opens; returning true means the
  // caller showed that supplier elsewhere (the engineer's Labor / Equipment
  // tabs), so the material catalogue is not opened.
  onOpenSupplier,
  searchOnly = false,
  // Hides the supplier/material search field for a caller that does not
  // want it. Opt-in, so every existing caller keeps its search.
  hideSearch = false,
  // Opt-in. A caller that draws the search box itself (the Site Engineer's
  // Material Suppliers tab row) passes the text in and receives changes; every
  // other caller leaves both unset and keeps the search state held here.
  searchValue,
  onSearchChange,
  // Opt-in. Drops the card's "Suppliers" heading.
  hideHeading = false,
  warnWithoutProjects = false,
  // Opt-in. Only a caller whose feed actually returns supplier_category asks
  // for this; /suppliers/nearby does not, so the House Owner's browse is
  // unchanged and never shows a filter that could match nothing.
  showSupplierTypeFilter = false,
  // Opt-in. With this on, choosing a supplier replaces the browse screen with
  // that supplier's catalogue instead of unfolding it underneath — the caller
  // decides, so a screen that has always shown both keeps doing so.
  catalogAsView = false,
  // Opt-in. Opens this supplier (a user_id) once it is in the loaded feed, then
  // calls onSupplierOpened. A supplier missing from the feed is never opened.
  openSupplierId = null,
  onSupplierOpened,
  onSendRequest,
  sendingReceiverId,
  requestMessage = '',
  // Opt-in. Draws the supplier cards and type tabs in the Suppliers reference
  // layout (the Site Engineer's Suppliers tab). Same data, same click and the
  // same actions; every other caller keeps the EntityCard it has today.
  referenceCards = false,
  // Opt-out. false makes the catalogue browse-only: no Add to Cart and no Buy (a
  // Site Engineer asks the Store Manager instead). Every other caller can buy.
  canBuy = true,
}) {
  const { t, td } = useLanguage()
  // A category the platform knows has a written label in every language.
  // Categories are free text on a product, though, so a supplier can publish
  // into one nobody has named — `optionLabel` hands that back as the raw stored
  // English, and this machine-translates it rather than printing it.
  const categoryLabel = (value) => {
    const label = optionLabel(t, SUPPLIER_CATEGORY_KEYS, value)
    return label === value ? td(value) : label
  }
  const buyerProjects = Array.isArray(projects) ? projects : []
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [projectId, setProjectId] = useState(buyerProjects[0]?.id || '')
  const [ownSearch, setOwnSearch] = useState('')
  const search = searchValue ?? ownSearch
  const setSearch = onSearchChange ?? setOwnSearch
  const [category, setCategory] = useState('')
  const [supplierTypeFilter, setSupplierTypeFilter] = useState('')
  const dispatch = useDispatch()
  // The live basket count, straight off the existing cart state — the same
  // number the Cart tab badge shows, never a second tally.
  const cartCount = useSelector(selectCartCount)
  const [viewedSupplier, setViewedSupplier] = useState(null)
  const [supplierCategory, setSupplierCategory] = useState('')
  const [viewedProduct, setViewedProduct] = useState(null)
  const [cartMessage, setCartMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const materialsRef = useRef(null)
  // The Master Catalog's own category pictures, keyed by category slug (from
  // both the category's name and its stored slug). Read once, the first time a
  // supplier's catalogue is opened, from the existing /catalog/categories list
  // the Product Catalog tab already uses. Empty until then -- or for good if
  // the request fails -- and the tiles fall back to the bundled artwork.
  const [masterCategoryImages, setMasterCategoryImages] = useState(() => new Map())
  const masterCategoryImagesRequested = useRef(false)
  useEffect(() => {
    if (!viewedSupplier || masterCategoryImagesRequested.current) return
    masterCategoryImagesRequested.current = true
    fetchCatalogCategories()
      .then((rows) => {
        const images = new Map()
        ;(Array.isArray(rows) ? rows : []).forEach((row) => {
          if (!row?.image_url) return
          images.set(categorySlug(row.name), row.image_url)
          if (row.slug) images.set(categorySlug(row.slug), row.image_url)
        })
        setMasterCategoryImages(images)
      })
      .catch(() => {})
  }, [viewedSupplier])

  // Re-runs when the dashboard's project changes, since the suppliers shown are
  // the ones near that project.
  useEffect(() => {
    let active = true
    setLoading(true)
    loadSuppliers()
      .then((list) => { if (active) setSuppliers(Array.isArray(list) ? list : []) })
      .catch(() => { if (active) setSuppliers([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  // A quiet re-read for refreshKey: keeps the current list on screen and on
  // failure, so a live refresh never flashes the loading state.
  useEffect(() => {
    if (!refreshKey) return undefined
    let active = true
    loadSuppliers()
      .then((list) => { if (active && Array.isArray(list)) setSuppliers(list) })
      .catch(() => {})
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // The project picked in the topbar is the project being bought for.
  useEffect(() => {
    if (activeProjectId) setProjectId(String(activeProjectId))
  }, [activeProjectId])

  const allCategories = useMemo(() => {
    const set = new Set()
    suppliers.forEach((supplier) => (Array.isArray(supplier.categories) ? supplier.categories : []).forEach((item) => set.add(item)))
    return [...set].sort()
  }, [suppliers])

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase()
    return suppliers.filter((supplier) => {
      // The supplier's own saved category. A supplier who has not chosen one
      // holds null, so they match no specific type and appear only under All.
      if (supplierTypeFilter && supplier.supplier_category !== supplierTypeFilter) return false
      if (category && !(supplier.categories || []).includes(category)) return false
      if (!query) return true
      const nameMatch = `${supplier.store_name || ''} ${supplier.name || ''}`.toLowerCase().includes(query)
      // Plain words across each listing's name, brand, size, category, unit,
      // specifications and description -- "10kg ultratech cement bag".
      const materialMatch = (supplier.products || []).some((product) => listingSearchScore(query, product) > 0)
      return nameMatch || materialMatch
    })
  }, [suppliers, search, category, supplierTypeFilter])

  // The listings themselves that match the search, best first, so a buyer can
  // spot the right product before opening a supplier.
  const matchingProducts = useMemo(() => {
    const query = search.trim()
    if (!query) return []
    const matches = []
    filteredSuppliers.forEach((supplier) => {
      ;(supplier.products || []).forEach((product) => {
        const score = listingSearchScore(query, product)
        if (score > 0) matches.push({ supplier, product, score })
      })
    })
    return matches.sort((a, b) => b.score - a.score).slice(0, 8)
  }, [filteredSuppliers, search])

  const viewSupplier = async (supplier, openProductId = null) => {
    if (onOpenSupplier?.(supplier)) return
    setCartMessage('')
    setSupplierCategory('')
    try {
      const profile = await fetchSupplierProfile(supplier.user_id)
      setViewedSupplier({ ...supplier, ...profile, products: profile.profile_products || [] })
      // Opened from a matching product: show that product straight away.
      const opened = openProductId && (profile.profile_products || []).find((item) => item.id === openProductId)
      if (opened) setViewedProduct(opened)
    } catch (error) {
      setErrorMessage(error.response?.data?.detail || t('dash.engineer.suppliers.unableLoad'))
    }
  }

  // Auto-scroll to the materials section when a supplier is selected.
  useEffect(() => {
    if (!viewedSupplier) return undefined
    // As a view of its own the catalogue starts at its top, the way arriving on
    // a page does; unfolded below the list it is still scrolled into view.
    if (catalogAsView) {
      window.scrollTo({ top: 0 })
      return undefined
    }
    if (!materialsRef.current) return undefined
    // Small delay to let the DOM render the materials section.
    const timer = window.setTimeout(() => {
      materialsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [viewedSupplier, catalogAsView])

  useEffect(() => {
    if (openSupplierId == null || loading) return
    const target = suppliers.find((item) => item.user_id === openSupplierId)
    if (target) viewSupplier(target)
    onSupplierOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSupplierId, loading, suppliers])

  const closeSupplier = () => {
    setViewedSupplier(null)
    setCartMessage('')
    // Scroll back to the supplier list.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addToCart = async (product, wanted) => {
    setBusy(true)
    setCartMessage('')
    const result = await dispatch(addProductToCart({ projectId: activeProjectId, productId: product.id, quantity: wanted }))
    setBusy(false)
    setCartMessage(result.meta.requestStatus === 'fulfilled'
      ? t('shop.addedNamed', { name: product.name })
      : result.payload)
  }

  const visibleProducts = viewedSupplier ? viewedSupplier.products || [] : []
  // Whatever categories this supplier's own products carry, in name order.
  // Sorted by the names themselves rather than against a list of known
  // materials, so a category no one anticipated sits in its natural place
  // instead of being herded to the end.
  const materialCategories = useMemo(() => {
    if (!viewedSupplier) return []
    const cats = [...new Set(visibleProducts.map((p) => p.category).filter(Boolean))]
    return cats.sort((first, second) => first.localeCompare(second))
  }, [visibleProducts, viewedSupplier])
  // What each category card shows, read entirely off the supplier's own
  // products: how many they hold, and the images those products were published
  // with. Nothing here is a fixed list and nothing is chosen by category name —
  // a supplier who publishes into a new category gets a card built from their
  // own photographs, and a supplier with none gets none. Up to four distinct
  // images are kept so a category can be pictured by the things actually in it
  // rather than by one arbitrary product.
  const categorySummary = useMemo(() => {
    const summary = new Map()
    visibleProducts.forEach((product) => {
      if (!product.category) return
      const entry = summary.get(product.category) || { count: 0, images: [] }
      entry.count += 1
      if (product.image_url && entry.images.length < 4 && !entry.images.includes(product.image_url)) {
        entry.images.push(product.image_url)
      }
      summary.set(product.category, entry)
    })
    return summary
  }, [visibleProducts])

  const filteredMaterialProducts = supplierCategory
    ? visibleProducts.filter((p) => p.category === supplierCategory)
    : visibleProducts

  // Categories are worth browsing only when there is more than one; a supplier
  // with a single category would otherwise face a card that just reveals the
  // products already on the screen.
  const browsingCategories = supplierCategory === '' && materialCategories.length > 1
  // Standing inside one supplier's catalogue, with the browse screen put away.
  const inCatalogView = catalogAsView && Boolean(viewedSupplier)
  const hasProjects = buyerProjects.length > 0
  const canShop = (supplier) => !onSendRequest || supplier.request_status === 'accepted'

  // With the search as the only field, the type tabs lead and the search sits
  // beside them on one line (the Site Engineer's Suppliers tab).
  const inlineTypeFilter = showSupplierTypeFilter && searchOnly && !hideSearch
  const supplierTypeRow = (className = '') => (
    <div className={`flex gap-1.5 overflow-x-auto rounded-2xl border p-1.5 ${referenceCards ? 'border-oc-line bg-white' : 'border-slate-200 bg-slate-50/70'} ${className}`}>
      {supplierTypeOptions.map((supplierType) => {
        const count = suppliers.filter((item) => item.supplier_category === supplierType).length
        return (
          <button
            key={supplierType}
            type="button"
            // No "All" pill: clicking the chosen type again shows every supplier.
            onClick={() => setSupplierTypeFilter((current) => (current === supplierType ? '' : supplierType))}
            aria-pressed={supplierTypeFilter === supplierType}
            className={referenceCards
              ? `inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
                supplierTypeFilter === supplierType
                  ? 'bg-emerald-50 text-oc-deep'
                  : 'text-oc-muted hover:bg-oc-sunken hover:text-oc-ink'
              }`
              : `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[11px] font-extrabold transition ${
                supplierTypeFilter === supplierType
                  ? 'bg-brand-700 text-white shadow-sm'
                  : 'text-graphite/55 hover:bg-white hover:text-graphite'
              }`}
          >
            {optionLabel(t, SUPPLIER_TYPE_KEYS, supplierType)}
            <span className={referenceCards
              ? `grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-bold ${supplierTypeFilter === supplierType ? 'bg-emerald-100 text-oc-deep' : 'bg-oc-sunken text-oc-muted'}`
              : 'rounded-full bg-current/10 px-1.5 py-0.5 text-[9px] font-bold leading-none opacity-70'}>{count}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={`space-y-4 ${referenceCards ? 'engineer-supplier-cards' : ''}`}>
      {requestMessage && (
        <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {td(requestMessage)}
        </p>
      )}
      {errorMessage && (
        <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700">
          {/* Often the server's own refusal, written in English. */}
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {td(errorMessage)}
        </p>
      )}

      {/* 1. Nearby suppliers — put away while inside one supplier's catalogue,
             so the catalogue is a place the user has gone to rather than a
             panel that unfolded below the list they came from. */}
      {!inCatalogView && (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
        {(!hideHeading || (warnWithoutProjects && !hasProjects)) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {!hideHeading && (
          <div>
            <h2 className="text-sm font-extrabold text-slate-950">{t('role.suppliers')}</h2>
          </div>
          )}
          {warnWithoutProjects && !hasProjects && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[11px] font-extrabold text-brand-700 ring-1 ring-brand-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {t('dash.engineer.noAssignedProjects')}
            </span>
          )}
        </div>
        )}

        {inlineTypeFilter ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {supplierTypeRow('sm:shrink-0')}
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={t('dash.engineer.suppliers.searchSupplier')}
                placeholder={t('dash.engineer.suppliers.searchPlaceholder')}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
        ) : (
        <div className={`grid grid-cols-1 gap-2.5 ${
          searchOnly ? '' : 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,1fr)]'
        }`}>
          {!searchOnly && (
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.common.project')}</span>
              <select
                value={projectId}
                onChange={(event) => {
                  const { value } = event.target
                  setProjectId(value)
                  // The id as the server sent it (a UUID); blank means "no project".
                  onProjectChange?.(value || null)
                }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">{t('dash.engineer.analytics.selectProject')}</option>
                {buyerProjects.map((project) => (
                  <option key={project.id} value={project.id}>{td(project.title)}</option>
                ))}
              </select>
            </label>
          )}
          {!hideSearch && (
          <label className="grid gap-1 text-xs font-bold text-slate-600">
            <span>{t('dash.engineer.suppliers.searchSupplier')}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('dash.engineer.suppliers.searchPlaceholder')}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </label>
          )}
          {!searchOnly && (
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.supplier.category')}</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">{t('dash.supplier.allCategories')}</option>
                {allCategories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
              </select>
            </label>
          )}
        </div>
        )}

        {showSupplierTypeFilter && !inlineTypeFilter && supplierTypeRow('mt-3')}

        {loading ? (
          <div className="mt-4 grid gap-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
            ))}
          </div>
        ) : suppliers.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Store}
              title={t('dash.owner.suppliers.emptyTitle')}
              hint={t('dash.engineer.suppliers.noSuppliersHint')}
            />
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Search}
              title={t('dash.engineer.suppliers.noMatch')}
              hint={t('dash.engineer.suppliers.noMatchHint')}
              action={
                <button
                  type="button"
                  onClick={() => { setSearch(''); setCategory('') }}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                >
                  {t('dash.engineer.suppliers.clearFilters')}
                </button>
              }
            />
          </div>
        ) : (
          <>
          {matchingProducts.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{t('catalog.matchingProducts')}</p>
              <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                {matchingProducts.map(({ supplier, product }) => (
                  <button
                    key={`${supplier.user_id}-${product.id}`}
                    type="button"
                    onClick={() => viewSupplier(supplier, product.id)}
                    className="flex w-64 shrink-0 items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    {product.image_url ? (
                      <img src={imageUrl(product.image_url)} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover" />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
                        <Package className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-extrabold text-slate-900">{td(product.name)}</span>
                      <span className="block truncate text-[11px] font-semibold text-slate-500">
                        {[product.brand, product.category && categoryLabel(product.category), product.size, product.unit].filter(Boolean).join(' · ')}
                      </span>
                      <span className="block truncate text-[10px] font-bold text-slate-400">{supplier.store_name || supplier.name}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSuppliers.map((supplier) => {
              const products = supplier.products || []
              const shoppable = canShop(supplier)
              const inStockCount = products.filter((product) => Number(product.quantity) > 0).length
              const stockPill = !shoppable
                ? <EntityPill tone="warning">{t('dash.common.lockedUntilAccepted')}</EntityPill>
                : products.length === 0
                ? <EntityPill>{t(offeringKeys(supplier).none)}</EntityPill>
                : inStockCount === 0
                  ? <EntityPill tone="warning">{t('dash.supplier.outOfStock')}</EntityPill>
                  : <EntityPill tone="positive" dot>{`${inStockCount} ${t('dash.engineer.suppliers.items')}`}</EntityPill>
              if (referenceCards) {
                // The Suppliers reference card: avatar with
                // the person and their store, the type / pincode / rating
                // chips, then Availability with the stock chip and an arrow.
                // Every value is one the EntityCard below already shows.
                const icons = supplierTypeIcons(supplier)
                const TypeIcon = icons.chip
                const AvailabilityIcon = icons.availability
                // A Labor / Equipment supplier's real trades or equipment, when
                // the caller supplied them; otherwise the material stock pill.
                const offerings = Array.isArray(supplier.offerings) ? supplier.offerings : null
                const availabilityPill = !offerings || !shoppable
                  ? stockPill
                  : offerings.length === 0
                    ? <EntityPill>{t(supplier.supplier_category === 'Labor Supplier' ? 'dash.engineer.suppliers.noServicesAvailable' : 'dash.engineer.suppliers.noEquipmentAvailable')}</EntityPill>
                    : (
                      <span title={offerings.map((name) => td(name)).join(', ')}>
                        <EntityPill tone="positive" dot>
                          <span className="block max-w-[8.5rem] truncate sm:max-w-[11rem]">
                            {offerings.slice(0, 2).map((name) => td(name)).join(', ')}{offerings.length > 2 ? ` +${offerings.length - 2}` : ''}
                          </span>
                        </EntityPill>
                      </span>
                    )
                const storeLine = supplier.store_name && supplier.store_name !== supplier.name ? td(supplier.store_name) : ''
                const chip = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold'
                return (
                  <article
                    key={supplier.user_id}
                    onClick={shoppable ? (event) => { if (!event.target.closest('button, a, input, select, textarea')) viewSupplier(supplier) } : undefined}
                    className={`oc-entity-card flex flex-col rounded-2xl border border-oc-line bg-white p-3 shadow-ocsoft transition-[border-color,box-shadow,transform] duration-300 ${shoppable ? 'cursor-pointer hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_18px_38px_-24px_rgba(18,107,69,0.38)]' : ''}`}
                  >
                    {/* No SUPPLIER eyebrow: every card on this tab is a
                        supplier, so the card opens on the avatar and name. */}
                    <div className="flex items-center gap-2.5">
                      <EntityAvatar
                        src={supplier.store_logo_url ? imageUrl(supplier.store_logo_url) : userAvatarSrc(supplier, 'SUPPLIER')}
                        alt={td(supplier.store_name || supplier.name)}
                        className="!h-11 !w-11"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-oc-ink">{td(supplier.name || supplier.store_name)}</p>
                        {storeLine && <p className="truncate text-xs font-medium text-oc-muted">{storeLine}</p>}
                      </div>
                    </div>

                    <div className="mb-2.5 mt-2.5 flex flex-wrap gap-1.5">
                      {supplier.supplier_category && (
                        <span className={`${chip} bg-emerald-50 font-bold text-oc-deep`}>
                          <TypeIcon className="h-3.5 w-3.5" /> {optionLabel(t, SUPPLIER_TYPE_KEYS, supplier.supplier_category)}
                        </span>
                      )}
                      <span className={`${chip} bg-oc-sunken text-oc-muted`}>
                        <MapPin className="h-3 w-3" /> {`${t('dash.common.pincode')} ${supplier.pincode || '—'}`}
                      </span>
                      <span className={`${chip} bg-emerald-50 font-bold text-oc-deep`}>
                        <Star className="h-3 w-3" /> {String(supplier.rating || t('dash.common.new'))}
                      </span>
                    </div>

                    <div className="mt-auto flex items-center gap-1.5 border-t border-oc-line pt-2">
                      <AvailabilityIcon className="h-4 w-4 shrink-0 text-oc-muted" />
                      <span className="text-xs font-medium text-oc-muted">{t('dash.engineer.suppliers.availability')}</span>
                      <span className="ms-auto min-w-0">{availabilityPill}</span>
                      {shoppable && (
                        <button
                          type="button"
                          aria-label={td(supplier.store_name || supplier.name)}
                          onClick={() => viewSupplier(supplier)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-oc-ink transition hover:bg-emerald-50"
                        >
                          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
                        </button>
                      )}
                    </div>
                  </article>
                )
              }
              return (
                <EntityCard
                  key={supplier.user_id}
                  compact
                  icon={Store}
                  label={t('role.supplier')}
                  onClick={shoppable ? () => viewSupplier(supplier) : undefined}
                  avatar={
                    /* The store mark when the shop has one, otherwise the
                        supplier's own avatar -- the card is titled with their
                        name. */
                    <EntityAvatar
                      src={supplier.store_logo_url ? imageUrl(supplier.store_logo_url) : userAvatarSrc(supplier, 'SUPPLIER')}
                      alt={td(supplier.store_name || supplier.name)}
                    />
                  }
                  // The person first, their business under it. Both come from
                  // the supplier payload already loaded here -- `name` is the
                  // users row, `store_name` the supplier profile.
                  title={td(supplier.name || supplier.store_name)}
                  // EntityCard styles the subtitle muted and light, so the store
                  // name carries its own weight and ink colour to read as the
                  // business rather than a caption. Shown only when it says
                  // something the line above does not: a supplier who never set
                  // a store name has it equal to their own, and printing that
                  // twice looks like a fault rather than data.
                  subtitle={
                    supplier.store_name && supplier.store_name !== supplier.name
                      ? <span className="font-bold text-oc-ink">{td(supplier.store_name)}</span>
                      : undefined
                  }
                  pills={[
                    // What kind of supplier this is, from their own saved
                    // profile. Absent until that supplier chooses one.
                    ...(supplier.supplier_category
                      ? [{
                          key: 'supplierCategory',
                          text: optionLabel(t, SUPPLIER_TYPE_KEYS, supplier.supplier_category),
                          tone: 'brand',
                          icon: Store,
                        }]
                      : []),
                    { key: 'pincode', text: `${t('dash.common.pincode')} ${supplier.pincode || '—'}`, icon: MapPin },
                    { key: 'rating', text: String(supplier.rating || t('dash.common.new')), tone: 'brand', icon: Star },
                  ]}
                  footerLabel={t('dash.engineer.suppliers.availability')}
                  footerValue={stockPill}
                >
                  {onSendRequest && (
                    // The action reflects the request state the API reports for
                    // this supplier, so it stays correct across refresh and
                    // sign-in rather than only changing after a click.
                    supplier.request_status === 'accepted' ? (
                      <span className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t('dash.common.accepted')}
                      </span>
                    ) : supplier.request_status === 'pending' ? (
                      <span className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ocaccent-50 px-3 py-2 text-xs font-bold text-ocaccent-600 ring-1 ring-ocaccent-100">
                        <span className="h-1.5 w-1.5 rounded-full bg-ocaccent-400" /> {t('dash.common.requestPending')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={sendingReceiverId === supplier.user_id}
                        onClick={() => onSendRequest(supplier)}
                        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-oc-green px-3 py-2 text-xs font-bold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {sendingReceiverId === supplier.user_id ? t('dash.common.sending') : t('dash.common.sendRequest')}
                        <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
                      </button>
                    )
                  )}
                </EntityCard>
              )
            })}
          </div>
          </>
        )}
      </section>
      )}

      {/* 2. Supplier details + materials */}
      {viewedSupplier && (
        <section ref={materialsRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Inside the catalogue this is the only way back, so it is
                  spelled out; unfolded below the list it is still the icon it
                  has always been, with the list itself in view above. */}
              <button
                type="button"
                onClick={closeSupplier}
                aria-label={t('dash.contractor.backToSuppliers')}
                className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-slate-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 ${
                  inCatalogView ? 'px-3 text-xs font-extrabold' : 'w-9'
                }`}
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                {inCatalogView && <span className="hidden sm:inline">{t('dash.contractor.backToSuppliers')}</span>}
              </button>
              <div>
                <h2 className="text-sm font-extrabold text-slate-950">{td(viewedSupplier.store_name || viewedSupplier.name)}</h2>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-slate-500">
                  <span className="flex items-center gap-1 font-bold text-brand-700">
                    <Star className="h-3 w-3 fill-brand-500 text-brand-500" /> {viewedSupplier.rating || t('dash.common.new')}
                  </span>
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {viewedSupplier.address ? td(viewedSupplier.address) : `${t('dash.common.pincode')} ${viewedSupplier.pincode || '—'}`}</span>
                  {viewedSupplier.phone && <span>{viewedSupplier.phone}</span>}
                </p>
              </div>
            </div>
            {/* Inside the catalogue this slot carries the real cart: it opens
                the existing Cart tab through the caller's `onOpenCart` and
                shows the live basket count. Elsewhere it stays the label it
                has always been. Labor and Equipment suppliers sell nothing
                through the material cart, so the slot stays empty for them. */}
            {!canBuy || ['Labor Supplier', 'Equipment Supplier'].includes(viewedSupplier?.supplier_category) ? null : inCatalogView && onOpenCart ? (
              <button
                type="button"
                onClick={onOpenCart}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-100"
              >
                <ShoppingCart className="h-3 w-3" /> {t('shop.cart')}
                {cartCount > 0 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand-700 px-1 text-[9px] leading-none text-white">
                    {cartCount}
                  </span>
                )}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-800 ring-1 ring-brand-200">
                <ShoppingCart className="h-3 w-3" /> {t('shop.addToCart')}
              </span>
            )}
          </div>

          {/* What the supplier wrote about their own business. */}
          {viewedSupplier.about && <p className="mt-3 text-xs font-medium leading-relaxed text-slate-500">{td(viewedSupplier.about)}</p>}

          {visibleProducts.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={Package}
                title={t(offeringKeys(viewedSupplier).empty)}
                hint={t('dash.engineer.suppliers.noPublishedMaterialsHint')}
              />
            </div>
          ) : (
            <>
              {/* The horizontal category chip row that used to sit here has
                  been removed: the category cards below list the same
                  categories from the same data and set the same state, so it
                  was the identical navigation shown twice. Selecting is done on
                  a card; returning to them is the back control on the heading.
                  `supplierCategory` and its filtering are untouched. */}

              <div className="mt-4 space-y-6">
                {browsingCategories ? (
                  /* Category browsing. Every tile is one of this supplier's own
                     categories, standing for the products it holds — picking one
                     narrows the catalogue to it, which is the same state the
                     category chips above already drive. */
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {materialCategories.map((categoryName) => {
                      const summary = categorySummary.get(categoryName)
                      // The Master Catalog's picture for this category when the
                      // admin has uploaded one; else the bundled artwork; else
                      // the supplier's own product photographs as before.
                      const fallbackArtwork = categoryImage(categoryName)
                      const masterImage = masterCategoryImages.get(categorySlug(categoryName))
                      const artwork = masterImage ? imageUrl(masterImage) : fallbackArtwork
                      const images = artwork ? [] : (summary?.images || [])
                      return (
                        <button
                          key={categoryName}
                          type="button"
                          onClick={() => { setCartMessage(''); setSupplierCategory(categoryName) }}
                          className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-start
                                     shadow-[0_10px_30px_-24px_rgba(15,23,42,0.4)] transition duration-200
                                     hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[0_20px_40px_-24px_rgba(15,23,42,0.45)]"
                        >
                          {/* Pictured by the products themselves. One image
                              fills the tile; several are tiled, with the first
                              spanning the top row when there are three, so the
                              grid never leaves a hole. */}
                          <span className="block aspect-[16/9] overflow-hidden bg-slate-50 p-1.5">
                            {artwork ? (
                              // A photograph, so it fills the tile rather than
                              // floating in it the way a cut-out product shot does.
                              <img
                                src={artwork}
                                alt=""
                                loading="lazy"
                                // A catalog picture that fails to load drops back
                                // to the bundled artwork, once, never a broken tile.
                                onError={(event) => {
                                  if (masterImage && fallbackArtwork && event.currentTarget.dataset.fellBack !== '1') {
                                    event.currentTarget.dataset.fellBack = '1'
                                    event.currentTarget.src = fallbackArtwork
                                  }
                                }}
                                className="h-full w-full rounded-md object-cover transition duration-300 group-hover:scale-[1.03]"
                              />
                            ) : images.length === 0 ? (
                              <span className="grid h-full place-items-center text-slate-300"><Package className="h-6 w-6" /></span>
                            ) : (
                              <span className={`grid h-full w-full gap-1 ${images.length === 1 ? '' : 'grid-cols-2'} ${images.length > 2 ? 'grid-rows-2' : ''}`}>
                                {images.map((source, index) => (
                                  <img
                                    key={source}
                                    src={imageUrl(source)}
                                    alt=""
                                    className={`h-full w-full rounded-md bg-white object-contain p-0.5 transition duration-300 group-hover:scale-[1.03] ${
                                      images.length === 3 && index === 0 ? 'col-span-2' : ''
                                    }`}
                                  />
                                ))}
                              </span>
                            )}
                          </span>
                          {/* Name over count, both on their own line, so a long
                              category name has the full width to truncate in
                              instead of squeezing the number off the card. */}
                          <span className="block px-3 py-2.5">
                            <span className="block truncate font-display text-sm font-extrabold leading-tight text-graphite" title={categoryLabel(categoryName)}>
                              {categoryLabel(categoryName)}
                            </span>
                            <span className="mt-1 block text-[11px] font-bold leading-none text-graphite/60">
                              {formatNumber(summary?.count ?? 0)} {t('dash.supplier.products')}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div>
                    {supplierCategory && (
                      <div className="mb-2 flex items-center gap-3">
                        {/* Back to the category tiles — the same "all" state the
                            chip row already exposes, reachable from down here. */}
                        {materialCategories.length > 1 && (
                          <button
                            type="button"
                            onClick={() => { setCartMessage(''); setSupplierCategory('') }}
                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-extrabold text-graphite/60 transition hover:border-brand-300 hover:text-graphite"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            {t('dash.supplier.allCategories')}
                          </button>
                        )}
                        <h4 className="truncate text-sm font-extrabold uppercase tracking-wide text-slate-500">{categoryLabel(supplierCategory)}</h4>
                        <span className="h-px flex-1 bg-slate-200" />
                      </div>
                    )}
                    {cartMessage && (
                      <p className="mb-3 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800">{td(cartMessage)}</p>
                    )}
                    {/* Denser than before, to match the compact card: the
                        narrower column is what makes the card small. */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {filteredMaterialProducts.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          busy={busy}
                          onOpen={(item) => { setCartMessage(''); setViewedProduct(item) }}
                          onAddToCart={canBuy ? addToCart : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {viewedProduct && (
        <BuyerProductCard
          product={viewedProduct}
          supplierName={viewedSupplier?.name}
          storeName={viewedSupplier?.store_name}
          message={cartMessage}
          onAddToCart={canBuy ? async (wanted) => {
            const result = await dispatch(addProductToCart({ projectId: activeProjectId, productId: viewedProduct.id, quantity: wanted }))
            setCartMessage(result.meta.requestStatus === 'fulfilled' ? t('shop.addedToCart') : result.payload)
          } : undefined}
          onSendBuyRequest={canBuy ? async (wanted) => {
            const result = await dispatch(addProductToCart({ projectId: activeProjectId, productId: viewedProduct.id, quantity: wanted }))
            if (result.meta.requestStatus !== 'fulfilled') return setCartMessage(result.payload)
            setViewedProduct(null)
            onOpenCart?.()
          } : undefined}
          onClose={() => setViewedProduct(null)}
        />
      )}
    </div>
  )
}
