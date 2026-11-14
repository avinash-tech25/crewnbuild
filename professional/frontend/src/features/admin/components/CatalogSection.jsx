/**
 * The Master Catalog, as a country's administrator sees it.
 *
 * What a product IS -- its category, brand, name, unit, variants and
 * specifications -- is written by the backend team in SQL
 * (database/india_master_catalog/master_catalog_seed.sql) and shown
 * here read-only. The administrator's job on this screen is the product's
 * canonical IMAGE: upload it, replace it, choose which one is primary, remove
 * it. Every supplier selling the product shows that primary image, and a
 * supplier can never change it.
 *
 * Three tabs, one job each:
 *   Catalog Products  every product the SQL created, as cards. Opening one
 *                     manages its images (and video); nothing here creates a
 *                     product -- the catalog SQL is the only source.
 *   Brands            brand logos (master_brands.logo_url)
 *   Categories        category images and active status (master_categories),
 *                     and per category its subcategories' images
 *                     (master_subcategories.image_url) and products
 * Product images, brand logos and category images are separate things, each
 * stored where the existing upload endpoints put it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ArrowLeft, Boxes, CheckCircle2, CircleDot, ChevronLeft, ChevronRight, Film, ImageOff, ImagePlus, Images, LayoutGrid, Loader2, PackageSearch, RefreshCw, Search, Star, Tags, Trash2, Upload, X } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import {
  deleteAdminCatalogImage,
  deleteAdminCatalogVideo,
  reorderAdminCatalogImages,
  setAdminCatalogPrimaryImage,
  updateAdminCatalogProduct,
  uploadAdminCatalogImage,
  uploadAdminCatalogVideo,
} from '../../catalog/catalogApi.js'
import { ExpandableText, sellingBasis } from '../../catalog/components/CatalogMedia.jsx'
import { Chip, StoredImage } from '../../catalog/components/CatalogProductBrowser.jsx'
import { BrandManager, CategoryManager, ProductEditor, SubcategoryManager } from './CatalogManage.jsx'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { ProductDetailView } from '../../catalog/components/ProductDetailView.jsx'
import {
  loadAdminCatalogProduct,
  loadAdminCatalogProducts,
  loadAdminCatalogReference,
  loadAdminCatalogSubcategories,
  loadAdminCatalogUnits,
  resetAdminCatalog,
  selectAdminCatalog,
  selectAdminCatalogProduct,
  setAdminCatalogFilter,
} from '../../catalog/catalogSlice.js'

const field =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-graphite outline-none focus:border-ocbrand-400'
const caption = 'text-[10px] font-bold uppercase tracking-wide text-slate-400'

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_VIDEO_BYTES = 100 * 1024 * 1024
// The upload service's own limit for images (MAX_UPLOAD_BYTES); checked here
// only so an oversized file is named at once instead of after a round trip.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
// The server's rule (REQUIRED_PRODUCT_IMAGES); the product payload states it too.
const REQUIRED_IMAGES = 5
const COUNTRY_NAMES = { IN: 'India' }

/** One read-only fact about the product. Rendered only when there is a value. */
function Fact({ label, children }) {
  return (
    <div>
      <dt className={caption}>{label}</dt>
      <dd className="mt-0.5 text-xs font-semibold text-graphite">{children}</dd>
    </div>
  )
}

/** One catalog product as a card: picture, brand, name, where it sits, its
 *  sizes, and how far its images are. The whole card opens it. */
function AdminProductCard({ product, onOpen, canManage }) {
  const count = product.media?.image_count ?? (product.image_url ? 1 : 0)
  const required = product.media?.images_required || REQUIRED_IMAGES
  const complete = count >= required
  const sizes = (product.variants || []).map((variant) => variant.name).filter(Boolean)
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_20px_-16px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:border-brand-300">
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full bg-slate-50" aria-label={canManage ? `Manage images of ${product.name}` : `View ${product.name}`}>
        {product.image_url ? (
          <StoredImage src={product.image_url} alt="" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-300">
            <ImageOff className="h-8 w-8" />
            <span className="text-[11px] font-bold text-slate-400">No image yet</span>
          </span>
        )}
        <span
          className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
            complete ? 'bg-emerald-600 text-white' : 'bg-oc-amber text-graphite'
          }`}
        >
          <Images className="h-3 w-3" aria-hidden="true" /> {count}/{required} images
        </span>
        {!product.is_active && (
          <span className="absolute right-2.5 top-2.5 rounded-md bg-slate-800 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">Inactive</span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <BrandLogo src={product.brand_logo_url} name={product.brand_name || 'Generic'} size="xs" />
          <span className="truncate text-[11px] font-extrabold uppercase tracking-wide text-brand-700">{product.brand_name || 'Generic'}</span>
        </span>
        <h3 className="line-clamp-2 font-display text-sm font-extrabold leading-snug text-graphite">{product.name}</h3>
        <p className="truncate text-xs font-semibold text-graphite/55">{product.subcategory_name}</p>
        <p className="truncate text-xs font-semibold text-graphite/55">{sizes.length ? sizes.join(' / ') : product.unit?.name}</p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 text-xs font-extrabold text-brand-800 transition hover:bg-brand-100"
        >
          {canManage ? <><ImagePlus className="h-3.5 w-3.5" /> Manage Images</> : 'View product'}
        </button>
      </div>
    </article>
  )
}

const TABS = [
  { key: 'products', label: 'Catalog Products', icon: LayoutGrid },
  { key: 'brands', label: 'Brands', icon: Tags },
  { key: 'categories', label: 'Categories', icon: Boxes },
  { key: 'subcategories', label: 'Subcategories', icon: CircleDot },
]

// `canManage` (catalog.manage): without it the catalog is read only -- the products in
// their customer view, and none of the editing tabs or controls (the server refuses the
// changes anyway).
export function CatalogPage({ Panel, canManage = false }) {
  const dispatch = useDispatch()
  const { categories, subcategories, brands, units, products, filters, loading, error, selectedId, detail } =
    useSelector(selectAdminCatalog)
  const [tab, setTab] = useState('products')
  // Active subcategories, reported by the Subcategories tab once it has loaded them.
  const [subcategoryCount, setSubcategoryCount] = useState(null)
  // null | { product } -- the details editor for the open product.
  const [editor, setEditor] = useState(null)
  const [preview, setPreview] = useState(!canManage)
  const { categoryId, subcategoryId, brandId, search } = filters
  const [message, setMessage] = useState('')
  const setFilter = (key) => (value) => dispatch(setAdminCatalogFilter({ key, value }))

  // The reference lists, loaded once per mount. This page is remounted per
  // country, so it starts from an empty catalog each time.
  useEffect(() => {
    dispatch(resetAdminCatalog())
    dispatch(loadAdminCatalogReference())
    dispatch(loadAdminCatalogUnits())
  }, [dispatch])

  useEffect(() => {
    if (error) setMessage(error)
  }, [error])

  // Subcategories follow the chosen category (setAdminCatalogFilter clears a
  // subcategory that belonged to another).
  useEffect(() => {
    if (categoryId) dispatch(loadAdminCatalogSubcategories(categoryId))
  }, [categoryId, dispatch])

  const loadProducts = useCallback(() => {
    dispatch(
      loadAdminCatalogProducts({
        categoryId: categoryId || undefined,
        subcategoryId: subcategoryId || undefined,
        brandId: brandId || undefined,
        search,
      }),
    )
  }, [categoryId, subcategoryId, brandId, search, dispatch])

  // Debounced, because this runs on every keystroke in the search box.
  useEffect(() => {
    const timer = setTimeout(loadProducts, 250)
    return () => clearTimeout(timer)
  }, [loadProducts])

  const openProduct = (id) => {
    setPreview(!canManage)
    dispatch(selectAdminCatalogProduct(id))
    dispatch(loadAdminCatalogProduct(id))
  }
  const closeProduct = () => {
    setPreview(false)
    dispatch(selectAdminCatalogProduct(null))
  }

  // After any image change: read the product back from the server, so what the
  // screen shows is what the database now holds, not what was hoped for.
  const reload = async () => {
    const fresh = await dispatch(loadAdminCatalogProduct(selectedId)).unwrap()
    loadProducts()
    return fresh
  }

  const refresh = () => {
    dispatch(loadAdminCatalogReference())
    loadProducts()
  }

  const counts = { products: products.length, brands: brands.length, categories: categories.length, subcategories: subcategoryCount }
  const managing = tab === 'products' && selectedId != null

  return (
    <Panel
      title="Master Catalog"
      subtitle="Products come from the catalog SQL. Add their images here, and the brand logos and category images suppliers and buyers see."
      right={
        <button
          type="button"
          onClick={refresh}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      }
    >
      {/* Tabs */}
      <div role="tablist" aria-label="Master catalog sections" className="flex gap-1 overflow-x-auto border-b border-slate-200/80 px-4 pt-2 sm:px-6">
        {TABS.filter(({ key }) => canManage || key === 'products').map(({ key, label, icon: Icon }) => {
          const active = tab === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-extrabold transition ${
                active ? 'border-brand-600 text-brand-800' : 'border-transparent text-slate-500 hover:text-graphite'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
              {counts[key] != null && (
                <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-500'}`}>{counts[key]}</span>
              )}
            </button>
          )
        })}
      </div>

      {message && (
        <p className="flex items-center justify-between gap-3 border-b border-slate-200/80 bg-amber-50/60 px-6 py-2 text-xs font-bold text-amber-700">
          {message}
          <button type="button" onClick={() => setMessage('')} aria-label="Dismiss" className="text-amber-600"><X className="h-3.5 w-3.5" /></button>
        </p>
      )}

      {canManage && tab === 'brands' && <BrandManager brands={brands} />}
      {canManage && tab === 'subcategories' && <SubcategoryManager categories={categories} onCount={setSubcategoryCount} />}
      {canManage && tab === 'categories' && (
        <CategoryManager
          categories={categories}
          onChanged={() => dispatch(loadAdminCatalogReference())}
          // A subcategory's product opens the same image manager as the Catalog Products tab.
          onOpenProduct={(id) => {
            setTab('products')
            openProduct(id)
          }}
        />
      )}

      {tab === 'products' && !managing && (
        <>
          {/* Search and filters */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200/80 bg-slate-50/60 px-4 py-3 sm:px-6">
            <label className="flex h-10 min-w-[14rem] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setFilter('search')(e.target.value)}
                placeholder="Search products"
                aria-label="Search products"
                className="h-full w-full bg-transparent text-sm font-semibold text-graphite outline-none"
              />
              {search && (
                <button type="button" onClick={() => setFilter('search')('')} aria-label="Clear search" className="text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <select value={categoryId} onChange={(e) => setFilter('categoryId')(e.target.value)} aria-label="Category" className={`${field} w-40`}>
              <option value="">All categories</option>
              {categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select
              value={subcategoryId}
              onChange={(e) => setFilter('subcategoryId')(e.target.value)}
              disabled={!categoryId}
              aria-label="Subcategory"
              className={`${field} w-44 disabled:bg-slate-100 disabled:text-slate-400`}
            >
              <option value="">All subcategories</option>
              {subcategories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select value={brandId} onChange={(e) => setFilter('brandId')(e.target.value)} aria-label="Brand" className={`${field} w-40`}>
              <option value="">All brands</option>
              {brands.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </div>

          {/* The cards: whatever the catalog holds, straight from the API. */}
          <div className="p-4 sm:p-6">
            {products.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
                <PackageSearch className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm font-extrabold text-graphite">{loading ? 'Loading products…' : 'No catalog products found'}</p>
                {!loading && (
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {search || categoryId || brandId ? 'Try another search or filter.' : 'Products appear here as soon as the catalog SQL has created them. Press Refresh after running it.'}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <AdminProductCard key={product.id} product={product} canManage={canManage} onOpen={() => openProduct(product.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {managing && (
        <div className="space-y-5 p-4 sm:p-6">
          <button type="button" onClick={closeProduct} className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-800 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> All catalog products
          </button>
          {!detail ? (
            <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading product…</p>
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <BrandLogo src={detail.brand_logo_url} name={detail.brand_name || 'Generic'} size="lg" />
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-extrabold text-graphite">{detail.name}</h3>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">
                      {COUNTRY_NAMES[detail.country_code] || detail.country_code} · {detail.category_name} › {detail.subcategory_name}
                      {detail.brand_name ? ` › ${detail.brand_name}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-400">
                      {(detail.variants || []).map((variant) => variant.name).join(' / ') || detail.unit?.name}
                      {' · '}
                      {detail.listing_count} supplier listing{detail.listing_count === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                {canManage && (
                <div className="flex flex-wrap items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setPreview((open) => !open)}
                    className="h-8 rounded-lg border border-slate-200 px-3 text-[11px] font-extrabold text-slate-600 hover:bg-slate-50"
                  >
                    {preview ? 'Manage images' : 'Customer view'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditor({ product: detail })}
                    className="h-8 rounded-lg border border-slate-200 px-3 text-[11px] font-extrabold text-slate-600 hover:bg-slate-50"
                  >
                    Edit details
                  </button>
                  <ActiveToggle detail={detail} onChanged={reload} />
                </div>
                )}
              </header>

              {preview ? (
                // The product page as buyers see it; prices come from suppliers.
                <ProductDetailView product={detail} />
              ) : (
                <>
                  <ImageManager key={detail.id} detail={detail} reload={reload} />
                  <ProductFacts detail={detail} />
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Edits the open product's details; never creates a product. */}
      {canManage && editor && editor.product && (
        <ProductEditor
          product={editor.product}
          categories={categories}
          brands={brands}
          units={units}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null)
            loadProducts()
            openProduct(saved.id)
          }}
        />
      )}
    </Panel>
  )
}

/** Withdraw a product from suppliers' dropdowns, or bring it back. Listings that
 *  already sell it keep working either way. */
function ActiveToggle({ detail, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = async () => {
    setBusy(true)
    setError('')
    try {
      await updateAdminCatalogProduct(detail.id, { is_active: !detail.is_active })
      await onChanged()
    } catch (failure) {
      setError(failure.response?.data?.detail || 'That change could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="text-right">
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        className={`h-8 shrink-0 rounded-lg px-3 text-[11px] font-extrabold ${
          detail.is_active
            ? 'border border-slate-200 text-slate-600 hover:bg-slate-50'
            : 'bg-oc-green text-white hover:bg-oc-deep'
        }`}
      >
        {detail.is_active ? 'Deactivate' : 'Activate'}
      </button>
      {error && <p className="mt-1 max-w-[16rem] text-[10px] font-bold text-red-600">{error}</p>}
      {!detail.is_active && detail.media && !detail.media.complete && !error && (
        <p className="mt-1 max-w-[16rem] text-[10px] font-bold text-amber-700">
          {`${detail.media.images_required} images required to activate.`}
        </p>
      )}
    </div>
  )
}

/**
 * The product's canonical media: its images and its video, and the one control
 * on this screen that changes anything a supplier or buyer sees.
 *
 * Images: any number, and REQUIRED_IMAGES before the product can be activated.
 * They are added progressively: "Add more images" opens the file picker, and
 * every chosen file is uploaded at once -- one after another through the same
 * upload endpoint -- and joins the grid as soon as the server has it. Nothing
 * already uploaded is replaced or hidden while that happens, so the admin keeps
 * adding until the product has what it needs. The grid is always what the
 * database holds: it is re-read after every upload. The primary (starred)
 * image is the one every supplier card shows; the rest form the gallery.
 *
 * Video: one per product. Uploading another replaces it.
 */
function ImageManager({ detail, reload }) {
  const images = [...(detail.images || [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id)),
  )
  const required = detail.media?.images_required || REQUIRED_IMAGES
  const imageInput = useRef(null)
  const videoInput = useRef(null)
  const [videoFile, setVideoFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ tone: '', text: '' })
  // Files on their way up, shown in the grid (with their local preview) until
  // the server has them and the re-read grid shows the stored image instead.
  const [uploading, setUploading] = useState([])

  // Choosing files uploads them straight away, in the order chosen. The first
  // image of a product becomes its primary on the server; later ones join the
  // gallery. A file the server refuses is named, and the rest still go up.
  const chooseImages = async (chosen) => {
    const list = Array.from(chosen || [])
    if (!list.length) return
    const refused = []
    const accepted = list.filter((file) => {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        refused.push(`${file.name}: only PNG, JPEG or WebP`)
        return false
      }
      if (file.size > MAX_IMAGE_BYTES) {
        refused.push(`${file.name}: larger than 10 MB`)
        return false
      }
      return true
    })
    const queue = accepted.map((file, index) => ({ key: `${Date.now()}-${index}`, file, url: URL.createObjectURL(file) }))
    setBusy(true)
    setStatus({ tone: '', text: '' })
    setUploading(queue)
    let done = 0
    for (const item of queue) {
      try {
        await uploadAdminCatalogImage(detail.id, item.file)
        done += 1
        await reload()
      } catch (error) {
        refused.push(`${item.file.name}: ${error.response?.data?.detail || 'upload failed'}`)
      } finally {
        URL.revokeObjectURL(item.url)
        setUploading((current) => current.filter((entry) => entry.key !== item.key))
      }
    }
    setBusy(false)
    if (refused.length) {
      setStatus({
        tone: 'error',
        text: `${done ? `${done} image${done === 1 ? '' : 's'} uploaded. ` : ''}Not uploaded — ${refused.join('; ')}`,
      })
    } else {
      setStatus({ tone: 'success', text: `${done} image${done === 1 ? '' : 's'} uploaded.` })
    }
  }

  const chooseVideo = (chosen) => {
    setStatus({ tone: '', text: '' })
    if (!chosen) return
    if (!ACCEPTED_VIDEO_TYPES.includes(chosen.type)) {
      setStatus({ tone: 'error', text: 'The video must be an MP4, MOV or WebM file.' })
      return
    }
    if (chosen.size > MAX_VIDEO_BYTES) {
      setStatus({ tone: 'error', text: 'The video must be 100 MB or smaller.' })
      return
    }
    setVideoFile(chosen)
  }

  const run = async (work, success) => {
    setBusy(true)
    setStatus({ tone: '', text: '' })
    try {
      const result = await work()
      await reload()
      setStatus({ tone: 'success', text: typeof success === 'function' ? success(result) : success })
    } catch (error) {
      await reload().catch(() => {})
      setStatus({ tone: 'error', text: error.response?.data?.detail || error.message || 'That could not be saved. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const uploadVideo = () =>
    run(async () => {
      await uploadAdminCatalogVideo(detail.id, videoFile)
      setVideoFile(null)
    }, detail.video_url ? 'Video replaced.' : 'Video uploaded.')

  const imageCount = images.length
  const complete = imageCount >= required

  // Move a gallery image one place left or right. The primary always shows
  // first, so only the others move, and the whole order is sent at once.
  const gallery = images.filter((image) => !image.is_primary)
  const move = (image, step) => {
    const order = gallery.map((row) => row.id)
    const from = order.indexOf(image.id)
    const to = from + step
    if (from < 0 || to < 0 || to >= order.length) return
    ;[order[from], order[to]] = [order[to], order[from]]
    const primaryIds = images.filter((row) => row.is_primary).map((row) => row.id)
    run(() => reorderAdminCatalogImages(detail.id, [...primaryIds, ...order]), 'Image order saved.')
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={caption}>Product media</p>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-extrabold ${
              complete ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            Images: {imageCount} uploaded · {required} required
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-extrabold ${
              detail.video_url ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            Video: {detail.video_url ? '1 uploaded' : 'none'}
          </span>
        </div>
      </div>

      {/* Images: the primary first, then files still uploading, then "Add more". */}
      <div className="mt-3 flex flex-wrap gap-3">
        {images.length === 0 && uploading.length === 0 && (
          <div className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
            <ImageOff className="h-5 w-5" />
            <span className="text-[10px] font-bold">No image uploaded</span>
          </div>
        )}
        {images.map((image) => (
          <div key={image.id} className="w-28">
            <div className="relative">
              <StoredImage
                src={image.image_url}
                alt=""
                className={`h-28 w-28 rounded-lg border object-cover ${
                  image.is_primary ? 'border-ocbrand-400 ring-2 ring-ocbrand-200' : 'border-slate-200'
                }`}
              />
              {image.is_primary && (
                <span className="absolute left-1 top-1 rounded bg-ocbrand-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                  Primary
                </span>
              )}
            </div>
            <div className="mt-1 flex justify-center gap-1">
              {!image.is_primary && gallery.length > 1 && (
                <button
                  type="button"
                  disabled={busy || gallery[0]?.id === image.id}
                  title="Move left"
                  aria-label="Move image left"
                  onClick={() => move(image, -1)}
                  className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-brand-700 disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              )}
              {!image.is_primary && (
                <button
                  type="button"
                  disabled={busy}
                  title="Make this the primary image (shown on every supplier card)"
                  onClick={() => run(() => setAdminCatalogPrimaryImage(image.id), 'Primary image changed.')}
                  className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-amber-500"
                >
                  <Star className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                title="Remove this image"
                onClick={() =>
                  run(
                    () => deleteAdminCatalogImage(image.id),
                    image.is_primary
                      ? 'Primary image removed. Choose another as primary, or suppliers show no image.'
                      : 'Image removed.',
                  )
                }
                className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {!image.is_primary && gallery.length > 1 && (
                <button
                  type="button"
                  disabled={busy || gallery[gallery.length - 1]?.id === image.id}
                  title="Move right"
                  aria-label="Move image right"
                  onClick={() => move(image, 1)}
                  className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:text-brand-700 disabled:opacity-30"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}

        {uploading.map((item) => (
          <div key={item.key} className="w-28">
            <div className="relative">
              <img src={item.url} alt={item.file.name} className="h-28 w-28 rounded-lg border border-slate-200 object-cover opacity-60" />
              <span className="absolute inset-0 grid place-items-center">
                <Loader2 className="h-5 w-5 animate-spin text-ocbrand-700" />
              </span>
            </div>
            <p className="mt-1 truncate text-center text-[10px] font-bold text-slate-400">Uploading…</p>
          </div>
        ))}

        {/* Always here, so images can be added one at a time or several at once. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => imageInput.current?.click()}
          className="flex h-28 w-28 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-ocbrand-300 bg-ocbrand-50/40 text-ocbrand-700 transition hover:border-ocbrand-500 hover:bg-ocbrand-50 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          <span className="px-2 text-center text-[11px] font-extrabold leading-tight">
            {images.length === 0 ? '+ Add images' : '+ Add more images'}
          </span>
        </button>
      </div>

      <div className="mt-2">
        <input
          ref={imageInput}
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(event) => {
            chooseImages(event.target.files)
            event.target.value = ''
          }}
        />
        <p className="mt-1.5 text-[10px] font-semibold text-slate-400">
          PNG, JPEG or WebP, up to 10 MB each. {required} images are needed to activate a product; the starred one is
          shown on supplier cards.
        </p>
      </div>

      {/* The video. */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className={caption}>Product video</p>
        {detail.video_url ? (
          <video
            src={imageUrl(detail.video_url)}
            controls
            preload="metadata"
            className="mt-1.5 w-full max-w-sm rounded-lg bg-black"
          />
        ) : (
          <p className="mt-1 text-xs font-semibold text-slate-400">No video uploaded.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {videoFile ? (
            <>
              <span className="max-w-[14rem] truncate text-xs font-bold text-graphite">{videoFile.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={uploadVideo}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-4 text-xs font-extrabold text-white hover:bg-oc-deep disabled:bg-slate-300"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {detail.video_url ? 'Replace video' : 'Upload video'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setVideoFile(null)}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => videoInput.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite hover:bg-slate-50"
              >
                <Film className="h-3.5 w-3.5" /> {detail.video_url ? 'Choose a new video' : 'Choose video'}
              </button>
              {detail.video_url && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => deleteAdminCatalogVideo(detail.id), 'Video removed.')}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove video
                </button>
              )}
            </>
          )}
          <input
            ref={videoInput}
            type="file"
            accept={ACCEPTED_VIDEO_TYPES.join(',')}
            className="hidden"
            onChange={(event) => {
              chooseVideo(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
        <p className="mt-1.5 text-[10px] font-semibold text-slate-400">One video per product · MP4, MOV or WebM, up to 100 MB.</p>
      </div>

      {status.text && (
        <p
          role="status"
          className={`mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${
            status.tone === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {status.tone === 'success' && <CheckCircle2 className="h-3.5 w-3.5" />}
          {status.text}
        </p>
      )}
    </section>
  )
}

/** What the product is, as the catalog SQL defines it. Read-only: the backend
 *  team maintains these through the seed template, not through this screen. */
function ProductFacts({ detail }) {
  const specifications = Object.entries(detail.specifications || {})
  const variants = detail.variants || []
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className={caption}>Product details</p>
        <p className="text-[10px] font-semibold text-slate-400">Change these with Edit product</p>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Fact label="Product name">{detail.name}</Fact>
        <Fact label="Brand">{detail.brand_name || 'No brand (generic product)'}</Fact>
        <Fact label="Category">
          {detail.category_name} › {detail.subcategory_name}
        </Fact>
        <Fact label="Unit">
          {detail.unit ? `${sellingBasis(detail.unit)}${detail.unit.unit_family ? ` · ${detail.unit.unit_family}` : ''}` : '—'}
        </Fact>
        {detail.product_type && <Fact label="Product type">{detail.product_type}</Fact>}
        {detail.standard_code && <Fact label="Standard">{detail.standard_code}</Fact>}
        <Fact label="Status">{detail.is_active ? 'Active' : 'Inactive'}</Fact>
        <Fact label="Key">
          <span className="font-mono text-[11px] text-slate-500">{detail.slug}</span>
        </Fact>
      </dl>
      {detail.short_description && (
        <div className="mt-3">
          <p className={caption}>Short description</p>
          <p className="mt-0.5 text-xs font-semibold text-graphite">{detail.short_description}</p>
        </div>
      )}
      <div className="mt-3">
        <p className={caption}>Description</p>
        {detail.description ? (
          <ExpandableText text={detail.description} className="mt-0.5 text-xs font-semibold text-graphite" />
        ) : (
          <p className="mt-0.5 text-xs font-semibold text-amber-700">No description yet.</p>
        )}
      </div>
      {(detail.highlights || []).length > 0 && (
        <div className="mt-3">
          <p className={caption}>Highlights</p>
          <ul className="mt-0.5 list-disc pl-4 text-xs font-semibold text-graphite">
            {detail.highlights.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <p className={caption}>FAQs</p>
        {(detail.faqs || []).length ? (
          <dl className="mt-0.5 space-y-1 text-xs">
            {detail.faqs.map((faq) => (
              <div key={faq.question}>
                <dt className="font-bold text-graphite">{faq.question}</dt>
                <dd className="font-semibold text-graphite/70">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-0.5 text-xs font-semibold text-amber-700">No FAQs yet.</p>
        )}
      </div>
      <div className="mt-3">
        <p className={caption}>Returns & Exchange Policy</p>
        {detail.returns_exchange_policy ? (
          <p className="mt-0.5 whitespace-pre-line text-xs font-semibold text-graphite">{detail.returns_exchange_policy}</p>
        ) : (
          <p className="mt-0.5 text-xs font-semibold text-amber-700">No returns policy yet.</p>
        )}
      </div>
      <div className="mt-3">
        <p className={caption}>Variants</p>
        {variants.length === 0 ? (
          <p className="mt-0.5 text-xs font-semibold text-slate-400">None — suppliers list the product as it is.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {variants.map((variant) => (
              <li key={variant.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
                <span className="inline-flex items-center gap-1.5 font-bold text-graphite">
                  <Boxes className="h-3 w-3 text-slate-400" />
                  {variant.name}
                  {variant.unit_code && <Chip>{variant.unit_code}</Chip>}
                </span>
                {/* Only what this variant adds over the product's own specifications. */}
                {Object.entries(variant.specifications || {}).filter(
                  ([key, value]) => (detail.specifications || {})[key] !== value,
                ).length > 0 && (
                  <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                    {Object.entries(variant.specifications || {})
                      .filter(([key, value]) => (detail.specifications || {})[key] !== value)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {specifications.length > 0 && (
        <div className="mt-3">
          <p className={caption}>Specifications</p>
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {specifications.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs">
                <dt className="font-bold text-slate-500">{key}</dt>
                <dd className="font-semibold text-graphite">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  )
}
