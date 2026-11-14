/**
 * Adding a product from the Master Catalog.
 *
 * A screen-by-screen visual selector. The supplier picks an existing catalog
 * product one level at a time -- Category > Subcategory > Brand > Product >
 * Variant -- by tapping picture tiles, and only then sees the commercial form:
 * selling price, stock, low-stock threshold, discount, published, and optional
 * bulk pricing. What a product IS (name, description, specifications, images)
 * belongs to the master catalog and is not edited here.
 *
 * Every tile is a query, never a hard-coded list. Running a seed script
 * against the database puts new categories, brands and products in front of the
 * supplier without a line of this file changing — which is the point of a
 * data-driven catalog.
 *
 * Pictures are the catalog's own: master_categories.image_url (CategoryImage),
 * master_subcategories.image_url (CategoryImage), master_brands.logo_url
 * (BrandLogo) and the product's primary master_product_images row (image_url,
 * as the API returns it to this viewer). A missing picture shows the placeholder.
 *
 * This is the supplier's only Add Product route: a supplier never types a
 * product's name, brand, specifications, image or video.
 */

import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ArrowLeft, Boxes, Check, ChevronRight, ImageOff, Loader2, PackageSearch, Search, X } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { CategoryImage } from '../../catalog/components/CategoryStrip.jsx'
import { addSupplierCatalogListing, searchCatalog } from '../../catalog/catalogApi.js'
import {
  clearPickerList,
  loadPickerBrands,
  loadPickerCategories,
  loadPickerProducts,
  loadPickerSubcategories,
  selectCatalogPicker,
} from '../../catalog/catalogSlice.js'
import { PriceTag, validDiscount } from '../../catalog/components/PriceTag.jsx'
import {
  resetSupplierProductForm,
  selectSupplierProductForm,
  selectSupplierProducts,
  setSupplierProductFormField,
} from '../../catalog/supplierCatalogSlice.js'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { BulkTierBuilder, blankSimpleTier, simpleTierProblem, simpleTiersForApi } from '../../catalog/components/BulkPricing.jsx'
import { saveBulkPricing } from '../../catalog/supplierProductsApi.js'
import { NoListingImage, listingImageSrc } from './ListingImage.jsx'

const labelClass = 'text-[10px] font-extrabold uppercase tracking-wide text-graphite/50'
// The Brand option for products that belong to no brand (brand_id NULL in the
// catalog): "OPC 43 Grade Cement", "Natural River Sand".
const GENERIC_BRAND = 'generic'

const fieldClass =
  'mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-graphite/40'

// The screens, in order. `step` is always one of these keys.
const STEPS = [
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'brand', label: 'Brand' },
  { key: 'product', label: 'Product' },
  { key: 'variant', label: 'Variant' },
  { key: 'selling', label: 'Selling' },
]
const stepIndex = (key) => STEPS.findIndex((step) => step.key === key)

// Category, subcategory and brand cards: exactly 4 a row from a tablet up
// (the 5th starts the next row), 2 a row on a phone; never sideways scrolling.
const circleGrid = 'grid grid-cols-2 gap-3 md:grid-cols-4'
const circleImageClass = 'h-24 w-24 rounded-full sm:h-28 sm:w-28'

/** A catalog picture in a circle, or a neutral "no image" circle when the
 *  master catalog has none: a subcategory's master_subcategories.image_url
 *  (`cover`), or a product's primary master_product_images row (`contain`,
 *  so a packshot is not cropped). All are uploaded in Admin > Master Catalog. */
function CircleImage({ src, name, fit = 'cover' }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (src && !broken) {
    return (
      <img
        src={imageUrl(src)}
        alt={name}
        onError={() => setBroken(true)}
        className={`${circleImageClass} bg-white ${fit === 'contain' ? 'object-contain p-2' : 'object-cover'}`}
      />
    )
  }
  return (
    <span aria-hidden="true" className={`${circleImageClass} flex flex-col items-center justify-center gap-1 bg-slate-50 text-slate-300`}>
      <ImageOff className="h-7 w-7" />
      <span className="text-[10px] font-bold text-slate-400">No image</span>
    </span>
  )
}

/** A listing key for "is this product / variant already in my catalog?". */
const listedKey = (variantId) => (variantId == null || variantId === '' ? 'none' : String(variantId))

/** A round picture tile: a category, subcategory or brand. */
/** A catalog choice -- category, subcategory, brand or product: a circular
 *  picture and its name, nothing else. The chosen one has a thin circular border. */
function CircleTile({ name, selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="group flex w-full min-w-0 flex-col items-center gap-2.5 rounded-2xl px-1 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <span
        className={`rounded-full transition ${
          selected ? 'ring-2 ring-brand-600 ring-offset-2' : 'ring-1 ring-slate-200 group-hover:ring-2 group-hover:ring-brand-200'
        }`}
      >
        {children}
      </span>
      <span className={`line-clamp-3 text-xs font-extrabold leading-tight sm:text-sm ${selected ? 'text-brand-800' : 'text-graphite'}`}>{name}</span>
    </button>
  )
}

/** The product's primary catalog image, or the listing placeholder. */
function ProductImage({ product, className = '', compact = false }) {
  const [broken, setBroken] = useState(false)
  const src = listingImageSrc(product)
  useEffect(() => setBroken(false), [src])
  if (!src || broken) return <NoListingImage label="No image" compact={compact} className={className} />
  return <img src={src} alt={product.image_alt || product.name} onError={() => setBroken(true)} className={`bg-white object-contain ${className}`} />
}

/** Category → Subcategory → … → Selling, the current screen highlighted.
 *  A screen already passed can be reopened without losing what was chosen. */
function Progress({ step, canOpen, onOpen }) {
  const current = stepIndex(step)
  return (
    <ol aria-label="Add Product progress" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[11px] font-extrabold sm:text-xs">
      {STEPS.map((item, index) => {
        const done = index < current
        const active = index === current
        const clickable = done && canOpen(item.key)
        const pill = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition ${
          active ? 'bg-brand-700 text-white' : done ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-graphite/45'
        }`
        return (
          <li key={item.key} className="flex items-center gap-1" aria-current={active ? 'step' : undefined}>
            {clickable ? (
              <button type="button" onClick={() => onOpen(item.key)} className={`${pill} hover:bg-brand-100`}>
                <Check className="h-3 w-3" /> {item.label}
              </button>
            ) : (
              <span className={pill}>
                {done && <Check className="h-3 w-3" />} {item.label}
              </span>
            )}
            {index < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-graphite/30" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

/** ← Back, the path chosen so far, and what this screen asks for. */
function ScreenHeader({ onBack, path = [], title, hint }) {
  return (
    <div className="mb-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-graphite transition hover:border-brand-300 hover:text-brand-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      {path.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs font-extrabold text-brand-800">
          {path.map((part, index) => (
            <span key={`${index}-${part}`} className="inline-flex items-center gap-1">
              {index > 0 && <span className="text-graphite/30">/</span>}
              {part}
            </span>
          ))}
        </p>
      )}
      <h4 className="mt-0.5 font-display text-base font-extrabold text-graphite sm:text-lg">{title}</h4>
      {hint && <p className="text-xs text-graphite/55">{hint}</p>}
    </div>
  )
}

function EmptyNote({ children }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm font-semibold text-graphite/55">
      <PackageSearch className="h-5 w-5 shrink-0 text-graphite/30" />
      {children}
    </p>
  )
}

function LoadingNote() {
  return (
    <p className="flex items-center gap-2 px-1 py-6 text-sm font-semibold text-graphite/50">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </p>
  )
}

export function SupplierCatalogPicker({ onAdded }) {
  const dispatch = useDispatch()
  const rootRef = useRef(null)
  // The tile lists, from the catalog slice. subcategoryProducts is every
  // product of the chosen subcategory; the brand narrows it here.
  // categoriesLoaded is false until the first categories request succeeds; it
  // separates "still loading" from "the catalog has nothing in it yet".
  const {
    categories,
    categoriesLoaded,
    subcategories,
    brands,
    products: subcategoryProducts,
  } = useSelector(selectCatalogPicker)
  // This supplier's own listings (GET /supplier-products, loaded by the
  // dashboard): which categories they already sell in, and which products /
  // variants are already in their catalog.
  const ownListings = useSelector(selectSupplierProducts)

  const [step, setStep] = useState('category')
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  // The chosen product's catalog row, kept whole so a product picked from the
  // search keeps its details while its subcategory's list is still loading.
  const [pickedProduct, setPickedProduct] = useState(null)
  const [loadingSubcategories, setLoadingSubcategories] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Screen 1 search, over the catalog search API.
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  // What the supplier owns: price, stock, threshold and discount -- nothing else.
  const { price, quantity, lowStockThreshold, discountPercentage, isPublished } = useSelector(selectSupplierProductForm)
  const setFormField = (key) => (value) => dispatch(setSupplierProductFormField({ key, value }))
  const setPrice = setFormField('price')
  const setQuantity = setFormField('quantity')
  const setLowStockThreshold = setFormField('lowStockThreshold')
  const setDiscountPercentage = setFormField('discountPercentage')
  const setIsPublished = setFormField('isPublished')
  const [saving, setSaving] = useState(false)
  // Optional bulk pricing, saved onto the new listing right after it is created.
  const [bulkEnabled, setBulkEnabled] = useState(false)
  const [bulkTiers, setBulkTiers] = useState([blankSimpleTier()])
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  // ---- What this supplier already sells -------------------------------------
  const listedCategoryIds = new Set()
  const listedVariants = new Map()
  for (const listing of ownListings || []) {
    if (listing.category_id != null) listedCategoryIds.add(String(listing.category_id))
    if (listing.master_product_id == null) continue
    const key = String(listing.master_product_id)
    if (!listedVariants.has(key)) listedVariants.set(key, new Set())
    listedVariants.get(key).add(listedKey(listing.master_variant_id))
  }
  const isListed = (productKey, variantKey) => Boolean(listedVariants.get(String(productKey))?.has(listedKey(variantKey)))
  const isFullyListed = (row) => {
    const rowVariants = row.variants || []
    return rowVariants.length ? rowVariants.every((item) => isListed(row.id, item.id)) : isListed(row.id, null)
  }

  // ---- The lists for the current choices --------------------------------------
  // Each list is narrowed to its parent, so an answer still showing for the
  // previous choice can never be picked.
  const yourCategories = categories.filter((row) => listedCategoryIds.has(String(row.id)))
  const otherCategories = categories.filter((row) => !listedCategoryIds.has(String(row.id)))
  const category = categories.find((row) => String(row.id) === String(categoryId)) || null
  const subcategoryRows = subcategories.filter((row) => String(row.category_id) === String(categoryId))
  const subcategory = subcategoryRows.find((row) => String(row.id) === String(subcategoryId)) || null
  const productsHere = subcategoryProducts.filter((row) => String(row.subcategory_id) === String(subcategoryId))
  // Brands: those the subcategory's products actually use, in the catalog's
  // brand order, with the logo from master_brands.logo_url.
  const brandOrder = new Map(brands.map((row, index) => [String(row.id), index]))
  const brandRows = [...new Map(
    productsHere
      .filter((row) => row.brand_id != null)
      .map((row) => [String(row.brand_id), { id: String(row.brand_id), name: row.brand_name, logo_url: row.brand_logo_url }]),
  ).values()].sort((a, b) => (brandOrder.get(a.id) ?? Infinity) - (brandOrder.get(b.id) ?? Infinity) || String(a.name).localeCompare(String(b.name)))
  const hasGenericProducts = productsHere.some((row) => row.brand_id == null)
  const brandName = brandId === GENERIC_BRAND
    ? 'Generic'
    : brandRows.find((row) => row.id === String(brandId))?.name || pickedProduct?.brand_name || ''

  const products = productsHere.filter((row) => {
    if (!brandId) return true
    if (brandId === GENERIC_BRAND) return row.brand_id == null
    return String(row.brand_id) === String(brandId)
  })
  const product = products.find((row) => String(row.id) === String(productId))
    || (pickedProduct && String(pickedProduct.id) === String(productId) ? pickedProduct : null)
  const variants = product?.variants || []
  const variant = variants.find((row) => String(row.id) === String(variantId)) || null
  const unitRecord = variant?.unit || product?.unit || null
  const unit = unitRecord?.name || variant?.unit_code || product?.unit_code || ''
  const unitPlural = unitRecord?.plural_name || unit
  const productChosen = Boolean(product && (variants.length === 0 || variant))
  const alreadyListed = productChosen && isListed(product.id, variant ? variant.id : null)

  useEffect(() => {
    // Every Add Product starts empty, as it did when these were local state.
    dispatch(resetSupplierProductForm())
    dispatch(loadPickerCategories())
      .unwrap()
      .catch((error) => {
        setFailed(true)
        setMessage(error)
      })
  }, [dispatch])

  // Lists load when their parent is chosen; the choose handlers clear the
  // choices below a changed level.
  useEffect(() => {
    if (!categoryId) {
      dispatch(clearPickerList('subcategories'))
      return undefined
    }
    let current = true
    setLoadingSubcategories(true)
    dispatch(loadPickerSubcategories(categoryId)).finally(() => {
      if (current) setLoadingSubcategories(false)
    })
    return () => {
      current = false
    }
  }, [categoryId, dispatch])

  // Brands and products load together once a subcategory is chosen; the brand
  // then narrows the products, "Generic (no brand)" included.
  useEffect(() => {
    if (!subcategoryId) {
      dispatch(clearPickerList('brands'))
      dispatch(clearPickerList('products'))
      return undefined
    }
    let current = true
    setLoadingProducts(true)
    Promise.all([dispatch(loadPickerBrands(subcategoryId)), dispatch(loadPickerProducts(subcategoryId))]).finally(() => {
      if (current) setLoadingProducts(false)
    })
    return () => {
      current = false
    }
  }, [subcategoryId, dispatch])

  // Search as the supplier types, a moment after they stop. Only the latest
  // answer is shown.
  useEffect(() => {
    const words = query.trim()
    if (!words) {
      setSearchResults([])
      setSearching(false)
      return undefined
    }
    let current = true
    setSearching(true)
    const timer = setTimeout(() => {
      searchCatalog(words, 12)
        .then((rows) => {
          if (current) setSearchResults(rows || [])
        })
        .catch(() => {
          if (current) setSearchResults([])
        })
        .finally(() => {
          if (current) setSearching(false)
        })
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  // A new screen starts at its top.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const top = rootRef.current?.getBoundingClientRect().top
    if (top != null && top < 0) rootRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [step])

  // Choosing a different item clears the levels below it; choosing the same
  // one again (after Back) keeps them.
  const chooseCategory = (value) => {
    if (String(value) !== String(categoryId)) {
      setCategoryId(String(value))
      setSubcategoryId('')
      setBrandId('')
      setProductId('')
      setVariantId('')
      setPickedProduct(null)
    }
    setMessage('')
    setStep('subcategory')
  }
  const chooseSubcategory = (value) => {
    if (String(value) !== String(subcategoryId)) {
      setSubcategoryId(String(value))
      setBrandId('')
      setProductId('')
      setVariantId('')
      setPickedProduct(null)
    }
    setStep('brand')
  }
  const chooseBrand = (value) => {
    if (String(value) !== String(brandId)) {
      setBrandId(String(value))
      setProductId('')
      setVariantId('')
      setPickedProduct(null)
    }
    setStep('product')
  }
  // A product sold in one form needs no variant choice; one with several does,
  // because the price would otherwise name no particular size.
  const chooseProduct = (row, preferredVariantId = null) => {
    const rowVariants = row.variants || []
    const sameProduct = String(row.id) === String(productId)
    setProductId(String(row.id))
    setPickedProduct(row)
    if (rowVariants.length <= 1) {
      setVariantId(rowVariants.length === 1 ? String(rowVariants[0].id) : '')
      setStep('selling')
      return
    }
    const preferred = rowVariants.find((item) => String(item.id) === String(preferredVariantId))
    if (preferred) setVariantId(String(preferred.id))
    else if (!sameProduct) setVariantId('')
    setStep('variant')
  }
  const chooseVariant = (value) => {
    setVariantId(String(value))
    setStep('selling')
  }
  // A search result carries its category, subcategory and brand ids, so
  // choosing it fills every level at once and opens the next open question.
  const chooseSearchResult = (row) => {
    if (row.category_id == null || row.subcategory_id == null) return
    setCategoryId(String(row.category_id))
    setSubcategoryId(String(row.subcategory_id))
    setBrandId(row.brand_id == null ? GENERIC_BRAND : String(row.brand_id))
    setQuery('')
    setMessage('')
    chooseProduct(row, row.matched_variant?.id)
  }

  // Back: to the previous screen, skipping a variant screen the product never needed.
  const hasVariantScreen = variants.length > 1
  const goBack = () => {
    if (step === 'selling') setStep(hasVariantScreen ? 'variant' : 'product')
    else setStep(STEPS[Math.max(0, stepIndex(step) - 1)].key)
  }
  const canOpen = (key) => key !== 'variant' || hasVariantScreen

  const stockNumbers = [quantity, lowStockThreshold].map((value) => (String(value).trim() === '' ? NaN : Number(value)))
  const priceNumber = String(price).trim() === '' ? NaN : Number(price)
  const bulkProblem = bulkEnabled ? simpleTierProblem(bulkTiers, Number.isFinite(priceNumber) ? priceNumber : null) : ''
  // Add Product stays disabled until every required answer is valid.
  const ready = Boolean(
    categoryId && subcategoryId && brandId && productChosen && !alreadyListed
    && Number.isFinite(priceNumber) && priceNumber > 0
    && stockNumbers.every((value) => Number.isFinite(value) && value >= 0)
    && validDiscount(discountPercentage)
    && !bulkProblem,
  )

  const submit = async (event) => {
    event.preventDefault()
    if (!ready) return
    const amount = priceNumber
    if (!Number.isFinite(amount) || amount <= 0) {
      setFailed(true)
      setMessage('Enter a valid selling price.')
      return
    }
    if (stockNumbers.some((value) => !Number.isFinite(value) || value < 0)) {
      setFailed(true)
      setMessage('Stock and low-stock threshold cannot be negative.')
      return
    }
    if (!validDiscount(discountPercentage)) {
      setFailed(true)
      setMessage('Discount must be a number from 0 to 100.')
      return
    }
    if (bulkProblem) {
      setFailed(true)
      setMessage(`Bulk pricing: ${bulkProblem}`)
      return
    }
    setSaving(true)
    setFailed(false)
    setMessage('')
    try {
      const listing = await addSupplierCatalogListing({
        master_product_id: productId,
        master_variant_id: variantId || null,
        price: amount,
        // The supplier's own stock fields; the listing already had them.
        quantity: stockNumbers[0],
        low_stock_threshold: stockNumbers[1],
        discount_percentage: String(discountPercentage).trim() === '' ? 0 : Number(discountPercentage),
        is_published: isPublished !== false,
      })
      // Bulk tiers, when offered, go onto the listing just created. If they
      // cannot be saved the product is still added; the supplier is told and
      // can set them from Edit.
      let note = ''
      const tiers = bulkEnabled ? simpleTiersForApi(bulkTiers) : []
      if (tiers.length) {
        try {
          await saveBulkPricing(listing.id, tiers)
          note = ` Bulk pricing saved (${tiers.length} tier${tiers.length === 1 ? '' : 's'}).`
        } catch (bulkError) {
          note = ` Bulk pricing was not saved: ${bulkError.response?.data?.detail || 'please set it from Edit'}.`
        }
      }
      setMessage(`${listing.name} added to your catalog.${note}`)
      setProductId('')
      setVariantId('')
      setPickedProduct(null)
      setStep('product')
      setBulkEnabled(false)
      setBulkTiers([blankSimpleTier()])
      dispatch(resetSupplierProductForm())
      if (onAdded) onAdded(listing, `${listing.name} added to your catalog.${note}`)
    } catch (error) {
      setFailed(true)
      setMessage(error.response?.data?.detail || 'That product could not be added.')
    } finally {
      setSaving(false)
    }
  }

  const sectionTitle = (title, hint) => (
    <div className="mb-3">
      <h4 className="text-sm font-extrabold text-graphite">{title}</h4>
      {hint && <p className="text-xs text-graphite/55">{hint}</p>}
    </div>
  )

  // Your categories first, then the rest of the catalog -- one grid, so a row
  // is always filled before the next begins.
  const categoryTiles = (rows) => (
    <div role="list" className={circleGrid}>
      {rows.map((row) => {
        return (
        <div role="listitem" key={row.id} className="min-w-0">
          <CircleTile name={row.name} selected={String(row.id) === String(categoryId)} onClick={() => chooseCategory(row.id)}>
            <CategoryImage src={row.image_url} name={row.name} className={circleImageClass} fallbackClassName="bg-brand-50 text-2xl text-brand-700" />
          </CircleTile>
        </div>
        )
      })}
    </div>
  )

  // ---- Screen 1: search + categories ---------------------------------------------
  const term = query.trim().toLowerCase()
  const renderCategoryScreen = () => (
    <section aria-label="Choose a category">
      <label className="flex h-12 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <Search className="h-5 w-5 shrink-0 text-graphite/40" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }}
          placeholder="Search products, brands or materials..."
          aria-label="Search products, brands or materials"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-graphite outline-none placeholder:text-graphite/40"
        />
        {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-graphite/40" />}
        {query && !searching && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="grid h-7 w-7 place-items-center rounded-full text-graphite/45 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </label>

      {term ? (
        <div className="mt-4 space-y-4">
          {categories.some((row) => row.name.toLowerCase().includes(term)) && (
            <div>
              <p className={`${labelClass} mb-2`}>Categories</p>
              {categoryTiles(categories.filter((row) => row.name.toLowerCase().includes(term)))}
            </div>
          )}
          <div>
            <p className={`${labelClass} mb-2`}>Catalog products</p>
            {searching && searchResults.length === 0 ? (
              <LoadingNote />
            ) : searchResults.length === 0 ? (
              <EmptyNote>No catalog products match “{query.trim()}”.</EmptyNote>
            ) : (
              <ul className="space-y-2">
                {searchResults.map((row) => {
                  const listed = isFullyListed(row)
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => chooseSearchResult(row)}
                        disabled={listed}
                        className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-300 hover:bg-brand-50/40 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-100">
                          <ProductImage product={row} compact className="h-full w-full p-1" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-extrabold text-graphite">{row.name}</span>
                          <span className="block truncate text-xs font-semibold text-graphite/55">
                            {[row.brand_name || 'Generic', [row.category_name, row.subcategory_name].filter(Boolean).join(' › ')].filter(Boolean).join(' · ')}
                          </span>
                          {(row.matched_variant?.name || listed) && (
                            <span className="block truncate text-[11px] font-bold text-brand-800">
                              {listed ? 'Already in your catalog' : row.matched_variant.name}
                            </span>
                          )}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-graphite/35" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : !categoriesLoaded ? (
        <LoadingNote />
      ) : categories.length === 0 ? (
        <div className="mt-4">
          <EmptyNote>No products available in the admin catalog.</EmptyNote>
        </div>
      ) : (
        <div className="mt-5">
          {sectionTitle('Choose a category', '')}
          {categoryTiles([...yourCategories, ...otherCategories])}
        </div>
      )}
    </section>
  )

  // ---- Screen 2: subcategories ---------------------------------------------------
  const renderSubcategoryScreen = () => (
    <section aria-label="Choose a subcategory">
      <ScreenHeader onBack={goBack} path={[category?.name].filter(Boolean)} title="Choose Subcategory" />
      {loadingSubcategories && subcategoryRows.length === 0 ? (
        <LoadingNote />
      ) : subcategoryRows.length === 0 ? (
        <EmptyNote>No subcategories in this category yet.</EmptyNote>
      ) : (
        <div role="list" className={circleGrid}>
          {subcategoryRows.map((row) => (
            <div role="listitem" key={row.id} className="min-w-0">
              <CircleTile name={row.name} selected={String(row.id) === String(subcategoryId)} onClick={() => chooseSubcategory(row.id)}>
                {/* master_subcategories.image_url, or the neutral placeholder. */}
                <CircleImage src={row.image_url} name={row.name} />
              </CircleTile>
            </div>
          ))}
        </div>
      )}
    </section>
  )

  // ---- Screen 3: brands -------------------------------------------------------------
  const brandLogoClass = '!h-24 !w-24 !rounded-full !border-0 !p-3 !text-lg sm:!h-28 sm:!w-28'
  const renderBrandScreen = () => (
    <section aria-label="Choose a brand">
      <ScreenHeader onBack={goBack} path={[category?.name, subcategory?.name].filter(Boolean)} title="Choose Brand" />
      {loadingProducts && productsHere.length === 0 ? (
        <LoadingNote />
      ) : brandRows.length === 0 && !hasGenericProducts ? (
        <EmptyNote>No products in this subcategory yet.</EmptyNote>
      ) : (
        <div role="list" className={circleGrid}>
          {brandRows.map((row) => (
            <div role="listitem" key={row.id} className="min-w-0">
              <CircleTile name={row.name} selected={row.id === String(brandId)} onClick={() => chooseBrand(row.id)}>
                <BrandLogo src={row.logo_url} name={row.name} size="lg" className={brandLogoClass} />
              </CircleTile>
            </div>
          ))}
          {hasGenericProducts && (
            <div role="listitem" className="min-w-0">
              <CircleTile name="Generic (no brand)" selected={brandId === GENERIC_BRAND} onClick={() => chooseBrand(GENERIC_BRAND)}>
                <BrandLogo src={null} name="Generic" size="lg" className={brandLogoClass} />
              </CircleTile>
            </div>
          )}
        </div>
      )}
    </section>
  )

  // ---- Screen 4: products -------------------------------------------------------------
  const renderProductScreen = () => (
    <section aria-label="Choose a product">
      <ScreenHeader onBack={goBack} path={[category?.name, subcategory?.name, brandName].filter(Boolean)} title="Choose Product" />
      {loadingProducts && products.length === 0 ? (
        <LoadingNote />
      ) : products.length === 0 ? (
        <EmptyNote>No products for this brand.</EmptyNote>
      ) : (
        <div role="list" className={circleGrid}>
          {products.map((row) => (
            <div role="listitem" key={row.id} className="min-w-0">
              <CircleTile name={row.name} selected={String(row.id) === String(productId)} onClick={() => chooseProduct(row)}>
                {/* The product's primary master_product_images image (image_url). */}
                <CircleImage src={row.image_url} name={row.name} fit="contain" />
              </CircleTile>
            </div>
          ))}
        </div>
      )}
    </section>
  )

  // ---- Screen 5: variants -------------------------------------------------------------
  const renderVariantScreen = () => (
    <section aria-label="Choose a variant">
      <ScreenHeader onBack={goBack} path={[product?.brand_name || 'Generic', product?.name].filter(Boolean)} title="Select Variant" />
      {!product ? (
        <EmptyNote>Choose a product first.</EmptyNote>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2.5">
          {variants.map((row) => {
            const listed = isListed(product.id, row.id)
            const selected = String(row.id) === String(variantId)
            const rowUnit = row.unit?.name || row.unit_code || ''
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => chooseVariant(row.id)}
                disabled={listed}
                aria-pressed={selected}
                className={`flex min-h-[4.5rem] min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border px-3.5 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-slate-50'
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-graphite">{row.name}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-brand-700" />}
                </span>
                {rowUnit && <span className="text-[11px] font-semibold text-graphite/55">Sold by {rowUnit}</span>}
                {listed && <span className="text-[11px] font-bold text-brand-800">Already in your catalog</span>}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )

  // ---- Screen 6: selling information ----------------------------------------------
  const renderSellingScreen = () => (
    <div>
      <ScreenHeader onBack={goBack} title="Selling Information" hint="Set the price, stock and discount for your store." />

      {/* Confirmation only -- the catalog's details are not shown here. */}
      {productChosen && (
        <section aria-label="Selected product" className="mb-5 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
          <span className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <ProductImage product={product} compact className="h-full w-full p-1" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-extrabold text-graphite/55">
              <BrandLogo src={product.brand_logo_url} name={product.brand_name || 'Generic'} size="xs" />
              <span className="truncate">{product.brand_name || 'Generic'}</span>
            </p>
            <p className="truncate text-sm font-extrabold text-graphite">{product.name}</p>
            <p className="truncate text-xs font-semibold text-graphite/60">
              {[variant?.name, [product.category_name, product.subcategory_name].filter(Boolean).join(' › ')].filter(Boolean).join(' · ')}
            </p>
          </div>
        </section>
      )}
      {alreadyListed && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          This product is already in your catalog. Edit its price from your product list instead.
        </p>
      )}

      {/* How much, how many, when low, what discount, published? */}
      <section aria-label="Selling Information">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Selling price {unit ? `(per ${unit})` : ''}</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-[calc(50%+3px)] -translate-y-1/2 text-sm font-extrabold text-graphite/45">₹</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="300" aria-label="Selling price" className={`${fieldClass} pl-7`} />
            </div>
          </label>
          <label className="block">
            <span className={labelClass}>Stock {unitPlural ? `(${unitPlural})` : ''}</span>
            <input type="number" min="0" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="450" aria-label="Stock" className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Low-stock threshold {unitPlural ? `(${unitPlural})` : ''}</span>
            <input type="number" min="0" inputMode="decimal" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} placeholder="50" aria-label="Low-stock threshold" className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Discount</span>
            <div className="relative">
              <input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={discountPercentage} onChange={(e) => setDiscountPercentage(e.target.value)} placeholder="0" aria-label="Discount percentage" className={`${fieldClass} pr-8`} />
              <span className="pointer-events-none absolute right-3 top-[calc(50%+3px)] -translate-y-1/2 text-sm font-extrabold text-graphite/45">%</span>
            </div>
          </label>
        </div>
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={isPublished !== false}
            aria-label="Published"
            onClick={() => setIsPublished(isPublished === false)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${isPublished !== false ? 'bg-brand-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${isPublished !== false ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span className="text-xs font-extrabold text-graphite">
            {isPublished !== false ? 'Published — buyers can see it' : 'Hidden — buyers cannot see it'}
          </span>
        </label>
        {Number.isFinite(priceNumber) && priceNumber > 0 && validDiscount(discountPercentage) && Number(discountPercentage || 0) > 0 && (
          <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-graphite/55">
            Buyers see: <PriceTag price={priceNumber} discountPercentage={Number(discountPercentage || 0)} unit={unit} size="sm" />
          </p>
        )}
      </section>

      {/* Do I offer bulk pricing? */}
      <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4" aria-label="Bulk Pricing">
        {sectionTitle('Bulk Pricing', 'Optional: a lower price per unit from a quantity you choose.')}
        <BulkTierBuilder
          enabled={bulkEnabled}
          onToggle={setBulkEnabled}
          tiers={bulkTiers}
          onChange={setBulkTiers}
          unit={unit}
          normalPrice={Number.isFinite(priceNumber) ? priceNumber : null}
        />
      </section>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!ready || saving}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:bg-slate-300 sm:w-auto"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save Product
        </button>
      </div>
    </div>
  )

  // A screen whose earlier choice is missing (it can only happen through a
  // stale state) falls back to the first open question.
  const screen = (() => {
    if (step !== 'category' && !categoryId) return renderCategoryScreen()
    switch (step) {
      case 'subcategory':
        return renderSubcategoryScreen()
      case 'brand':
        return subcategoryId ? renderBrandScreen() : renderSubcategoryScreen()
      case 'product':
        return brandId ? renderProductScreen() : renderBrandScreen()
      case 'variant':
        return product ? renderVariantScreen() : renderProductScreen()
      case 'selling':
        return productChosen ? renderSellingScreen() : product ? renderVariantScreen() : renderProductScreen()
      default:
        return renderCategoryScreen()
    }
  })()

  return (
    <form ref={rootRef} onSubmit={submit} className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-extrabold text-graphite">Add Product</h3>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100">
            <Boxes className="h-4 w-4" />
          </span>
        </div>
        <Progress step={step} canOpen={canOpen} onOpen={setStep} />
      </div>

      <div className="p-4 sm:p-5">
        {screen}

        {message && (
          <p className={`mt-4 rounded-lg px-3 py-2 text-xs font-bold ${failed ? 'bg-red-50 text-red-600' : 'bg-ocbrand-50 text-ocbrand-700'}`}>{message}</p>
        )}
      </div>
    </form>
  )
}
