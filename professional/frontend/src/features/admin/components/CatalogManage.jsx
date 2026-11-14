/**
 * Admin > Master Catalog management: categories (with their pictures),
 * subcategories, brands (with their logos) and the master product itself --
 * name, category, brand, unit, description, highlights, FAQs, returns policy,
 * specifications and variants. Everything is saved through the admin catalog
 * API into SQL; nothing here is kept only on the page.
 *
 * Admin-only by construction: it is imported by the admin catalog page alone,
 * and the server refuses every one of these calls without catalog.manage.
 */
import { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { ArrowLeft, Boxes, ChevronRight, ImageOff, ImagePlus, Images, Loader2, PackageSearch, Plus, Save, Search, Trash2, X } from 'lucide-react'
import { FittedImage, StoredImage } from '../../catalog/components/CatalogProductBrowser.jsx'
import { BrandLogo, BrandPicker } from '../../catalog/components/BrandPicker.jsx'
import { createAdminCatalogVariant, fetchAdminCatalogProducts, fetchAdminCatalogSubcategories } from '../../catalog/catalogApi.js'
import {
  saveAdminCatalogCategory,
  saveAdminCatalogProduct,
  uploadAdminBrandLogo,
  uploadAdminCategoryImage,
  uploadAdminSubcategoryImage,
} from '../../catalog/catalogSlice.js'

const field =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-graphite outline-none focus:border-ocbrand-400'
const area =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold leading-relaxed text-graphite outline-none focus:border-ocbrand-400'
const caption = 'text-[10px] font-bold uppercase tracking-wide text-slate-400'
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
// The upload service's image limit (MAX_UPLOAD_BYTES), checked first so the
// admin is told at once instead of after a round trip.
const MAX_PICTURE_BYTES = 10 * 1024 * 1024

/** Why a chosen picture cannot be uploaded, or '' when it can. */
function pictureProblem(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Choose a PNG, JPEG or WebP image.'
  if (file.size > MAX_PICTURE_BYTES) return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB.`
  return ''
}

/** The outcome of a card's last upload, shown on that card. */
function CardNote({ note }) {
  if (!note?.text) return null
  return (
    <p
      role={note.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md px-2 py-1 text-center text-[11px] font-bold ${
        note.tone === 'error' ? 'bg-red-50 text-red-700' : note.tone === 'success' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500'
      }`}
    >
      {note.text}
    </p>
  )
}

export const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

function Label({ text, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className={caption}>{text}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Status({ status }) {
  if (!status.text) return null
  return (
    <p className={`rounded-lg px-3 py-2 text-xs font-bold ${status.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
      {status.text}
    </p>
  )
}

/** A hidden file input behind a button; hands the chosen image back.
 *  `large`: a full-width button, for the subcategory cards. */
function PictureButton({ label, onFile, busy, large = false }) {
  const input = useRef(null)
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={
          large
            ? 'inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 text-xs font-extrabold text-brand-800 transition hover:bg-brand-100 disabled:opacity-50'
            : 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-extrabold text-graphite/70 hover:bg-slate-50 disabled:opacity-50'
        }
      >
        {busy ? <Loader2 className={large ? 'h-4 w-4 animate-spin' : 'h-3 w-3 animate-spin'} /> : <ImagePlus className={large ? 'h-4 w-4' : 'h-3 w-3'} />}
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
    </>
  )
}

/** A round catalog picture, or a dashed "No image" circle when there is none. */
function RoundPicture({ src, className = 'h-28 w-28' }) {
  if (src) return <StoredImage src={src} alt="" className={`${className} rounded-full bg-white object-cover ring-1 ring-slate-200`} />
  return (
    <span className={`${className} flex flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400`}>
      <ImageOff className="h-5 w-5" />
      <span className="text-[10px] font-bold">No image</span>
    </span>
  )
}

/** The on/off switch for a category's active status (existing PATCH). */
function ActiveSwitch({ name, active, busy, onToggle }) {
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(active)}
        aria-label={`${name} active`}
        disabled={busy}
        onClick={onToggle}
        className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-60 ${active ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className={`text-[11px] font-extrabold ${active ? 'text-emerald-700' : 'text-slate-400'}`}>{active ? 'Active' : 'Inactive'}</span>
    </span>
  )
}

// Exactly four cards a row on a desktop (the fifth starts the next row), two
// on a tablet, one on a phone. Fixed columns, never horizontal scrolling.
const cardGrid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'

/**
 * Categories tab: a management area for the catalog's tree.
 *
 *   All categories    large cards: picture, name, status, subcategories, and
 *                     Change image. Opening one shows its details.
 *   Category details  the category's picture and status, and its
 *                     subcategories as picture cards, each with its own
 *                     Change image. Opening a subcategory lists its products.
 *
 * Four separate pictures, each stored where its own upload endpoint puts it:
 * category  master_categories.image_url, subcategory master_subcategories.image_url,
 * (brand logos and product images live on their own tabs). Categories and
 * subcategories come from the catalog SQL, so there is no "add" here.
 */
export function CategoryManager({ categories, onChanged, onOpenProduct }) {
  const dispatch = useDispatch()
  const [subcategories, setSubcategories] = useState([])
  const [openCategoryId, setOpenCategoryId] = useState(null)
  const [openSubcategoryId, setOpenSubcategoryId] = useState(null)
  const [products, setProducts] = useState({ loading: false, rows: [] })
  // 'category-12' / 'subcategory-40': the row whose upload or toggle is running.
  const [busyKey, setBusyKey] = useState(null)
  const [status, setStatus] = useState({ tone: '', text: '' })

  // Every subcategory once (the endpoint lists them all without a category):
  // the counts and names on the category cards.
  useEffect(() => {
    fetchAdminCatalogSubcategories().then(setSubcategories).catch(() => {})
  }, [categories])

  // Opening a category reads that category's subcategories from the server
  // again, so the management screen never depends on the background list
  // above having succeeded. A failure is shown, with Try again -- never an
  // empty screen.
  const [subLoad, setSubLoad] = useState({ state: 'idle', message: '' })
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!openCategoryId) return undefined
    let current = true
    setSubLoad({ state: 'loading', message: '' })
    fetchAdminCatalogSubcategories(openCategoryId)
      .then((rows) => {
        if (!current) return
        setSubcategories((all) => [...all.filter((row) => row.category_id !== openCategoryId), ...rows])
        setSubLoad({ state: 'ready', message: '' })
      })
      .catch((error) => {
        if (!current) return
        setSubLoad({ state: 'error', message: error.response?.data?.detail || error.message || 'The subcategories could not be loaded.' })
      })
    return () => {
      current = false
    }
  }, [openCategoryId, reloadKey])

  // The result of each subcategory's last upload, shown on its own card.
  const [cardNotes, setCardNotes] = useState({})

  // Opening a category (or one of its subcategories) shows that screen from
  // its top, even when the admin clicked from further down the page.
  const viewRef = useRef(null)
  useEffect(() => {
    const top = viewRef.current?.getBoundingClientRect().top
    if (top != null && top < 0) viewRef.current.scrollIntoView({ block: 'start' })
  }, [openCategoryId, openSubcategoryId])

  const openCategory = categories.find((row) => row.id === openCategoryId) || null
  const subsOf = (categoryId) => subcategories.filter((row) => row.category_id === categoryId)
  const openSubs = openCategory ? subsOf(openCategory.id) : []
  const openSubcategory = openSubs.find((row) => row.id === openSubcategoryId) || null

  // The chosen subcategory's products, through the admin products API.
  useEffect(() => {
    if (!openSubcategoryId) {
      setProducts({ loading: false, rows: [] })
      return undefined
    }
    let current = true
    setProducts({ loading: true, rows: [] })
    fetchAdminCatalogProducts({ subcategoryId: openSubcategoryId })
      .then((rows) => current && setProducts({ loading: false, rows }))
      .catch(() => current && setProducts({ loading: false, rows: [] }))
    return () => {
      current = false
    }
  }, [openSubcategoryId])

  const run = async (key, work, success) => {
    setBusyKey(key)
    setStatus({ tone: '', text: '' })
    try {
      await work()
      setStatus({ tone: 'success', text: success })
    } catch (error) {
      setStatus({ tone: 'error', text: String(error?.message || error) })
    } finally {
      setBusyKey(null)
    }
  }

  const uploadCategoryImage = (category, file) =>
    run(
      `category-${category.id}`,
      async () => {
        await dispatch(uploadAdminCategoryImage({ id: category.id, file })).unwrap()
        onChanged?.()
      },
      `${category.name}: image updated.`,
    )
  const toggleCategory = (category) =>
    run(
      `category-${category.id}`,
      async () => {
        await dispatch(saveAdminCatalogCategory({ id: category.id, values: { is_active: !category.is_active } })).unwrap()
        onChanged?.()
      },
      `${category.name} is now ${category.is_active ? 'inactive' : 'active'}.`,
    )
  // The saved row comes back from the server and replaces the card's, so the
  // new picture shows at once. The outcome is written on that card.
  const uploadSubcategoryImage = async (subcategory, file) => {
    const note = (tone, text) => setCardNotes((notes) => ({ ...notes, [subcategory.id]: { tone, text } }))
    const problem = pictureProblem(file)
    if (problem) {
      note('error', problem)
      return
    }
    setBusyKey(`subcategory-${subcategory.id}`)
    note('', 'Uploading…')
    try {
      const saved = await dispatch(uploadAdminSubcategoryImage({ id: subcategory.id, file })).unwrap()
      setSubcategories((rows) => rows.map((row) => (row.id === saved.id ? saved : row)))
      note('success', 'Image saved.')
    } catch (error) {
      note('error', String(error?.message || error))
    } finally {
      setBusyKey(null)
    }
  }

  const back = (to) => {
    setStatus({ tone: '', text: '' })
    setCardNotes({})
    if (to === 'categories') setOpenCategoryId(null)
    setOpenSubcategoryId(null)
  }

  if (categories.length === 0) {
    return (
      <section className="p-4 sm:p-6">
        <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center">
          <Boxes className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-xs font-semibold text-slate-500">No categories yet. They appear here once the catalog SQL has created them.</p>
        </div>
      </section>
    )
  }

  // ---- One category: its picture, status and subcategories --------------------
  if (openCategory) {
    return (
      <section ref={viewRef} className="scroll-mt-24 space-y-5 p-4 sm:p-6">
        <nav aria-label="Category path" className="flex flex-wrap items-center gap-1 text-xs font-extrabold">
          <button type="button" onClick={() => back('categories')} className="inline-flex items-center gap-1.5 text-brand-800 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Categories
          </button>
          {openSubcategory && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              <button type="button" onClick={() => back('category')} className="text-brand-800 hover:underline">{openCategory.name}</button>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              <span className="text-graphite">{openSubcategory.name}</span>
            </>
          )}
        </nav>

        {!openSubcategory ? (
          <>
            <div>
              {/* The subcategory screen leads with its subcategories; the
                  category itself is one compact line (its image is managed on
                  the category card). */}
              <div className="flex flex-wrap items-center gap-3">
                <RoundPicture src={openCategory.image_url} className="h-12 w-12" />
                <div className="min-w-0">
                  <h4 className="font-display text-xl font-extrabold text-graphite">{openCategory.name} Subcategories</h4>
                  <p className="text-xs font-semibold text-slate-500">
                    {openSubs.length} subcategor{openSubs.length === 1 ? 'y' : 'ies'} · {openCategory.is_active ? 'Active category' : 'Inactive category'} ·
                    {' '}Upload one image per subcategory. Suppliers see it in Add Product.
                  </p>
                </div>
              </div>
              {subLoad.state === 'error' ? (
                <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-xs font-bold text-red-700">
                  <span>The subcategories could not be loaded: {subLoad.message}</span>
                  <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="h-8 rounded-lg bg-red-600 px-3 text-white hover:bg-red-700">
                    Try again
                  </button>
                </div>
              ) : subLoad.state === 'loading' && openSubs.length === 0 ? (
                <p className="mt-3 flex items-center gap-2 px-1 py-6 text-xs font-semibold text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading subcategories…
                </p>
              ) : openSubs.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-slate-200 px-6 py-8 text-center text-xs font-semibold text-slate-500">This category has no subcategories yet.</p>
              ) : (
                <ul aria-label={`${openCategory.name} subcategories`} className={`mt-3 ${cardGrid}`}>
                  {openSubs.map((row) => (
                    <li key={row.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_6px_20px_-16px_rgba(15,23,42,0.35)] ${row.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
                      {/* The large image area: master_subcategories.image_url. */}
                      <div className="aspect-[4/3] w-full border-b border-slate-100 bg-slate-50">
                        {row.image_url ? (
                          // Trimmed to the subject, then fitted with a little
                          // padding, so every subcategory's bag is the same size
                          // however much empty space its upload had around it.
                          <FittedImage src={row.image_url} alt={row.name} className="h-full w-full object-contain p-3" />
                        ) : (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-300">
                            <ImageOff className="h-8 w-8" />
                            <span className="text-[11px] font-bold text-slate-400">No image yet</span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-3 p-4">
                        <div>
                          <h5 className="line-clamp-2 font-display text-sm font-extrabold text-graphite">{row.name}</h5>
                          {!row.is_active && <span className="text-[11px] font-extrabold text-slate-400">Inactive</span>}
                        </div>
                        <div className="mt-auto space-y-2">
                          <PictureButton
                            large
                            label={row.image_url ? 'Change Image' : 'Upload Image'}
                            busy={busyKey === `subcategory-${row.id}`}
                            onFile={(file) => uploadSubcategoryImage(row, file)}
                          />
                          <CardNote note={cardNotes[row.id]} />
                          <button type="button" onClick={() => setOpenSubcategoryId(row.id)} className="w-full text-center text-[11px] font-extrabold text-brand-800 hover:underline">
                            View products
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <header className="flex flex-col items-center gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row">
              <div className="flex shrink-0 flex-col items-center gap-2">
                <RoundPicture src={openSubcategory.image_url} className="h-32 w-32" />
                <PictureButton
                  label={openSubcategory.image_url ? 'Change Image' : 'Upload Image'}
                  busy={busyKey === `subcategory-${openSubcategory.id}`}
                  onFile={(file) => uploadSubcategoryImage(openSubcategory, file)}
                />
              </div>
              <div className="min-w-0 text-center sm:text-left">
                <p className={caption}>Subcategory of {openCategory.name}</p>
                <h3 className="font-display text-xl font-extrabold text-graphite">{openSubcategory.name}</h3>
                {openSubcategory.description && <p className="mt-1 text-xs font-semibold text-slate-500">{openSubcategory.description}</p>}
                <p className="mt-2 text-[11px] font-bold text-slate-400">
                  {products.loading ? 'Loading products…' : `${products.rows.length} product${products.rows.length === 1 ? '' : 's'}`}
                </p>
              </div>
            </header>

            {products.loading ? (
              <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading products…</p>
            ) : products.rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center">
                <PackageSearch className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-xs font-semibold text-slate-500">No products in this subcategory yet.</p>
              </div>
            ) : (
              <ul className={cardGrid}>
                {products.rows.map((product) => {
                  const count = product.media?.image_count ?? (product.image_url ? 1 : 0)
                  const required = product.media?.images_required || 5
                  return (
                    <li key={product.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <span className="relative block aspect-[4/3] bg-slate-50">
                        {product.image_url ? (
                          <StoredImage src={product.image_url} alt="" className="h-full w-full object-contain p-3" />
                        ) : (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-300">
                            <ImageOff className="h-7 w-7" />
                            <span className="text-[11px] font-bold text-slate-400">No image yet</span>
                          </span>
                        )}
                        <span className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${count >= required ? 'bg-emerald-600 text-white' : 'bg-oc-amber text-graphite'}`}>
                          <Images className="h-3 w-3" /> {count}/{required} images
                        </span>
                      </span>
                      <div className="flex flex-1 flex-col gap-1 p-3">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <BrandLogo src={product.brand_logo_url} name={product.brand_name || 'Generic'} size="xs" />
                          <span className="truncate text-[11px] font-extrabold uppercase text-brand-700">{product.brand_name || 'Generic'}</span>
                        </span>
                        <span className="line-clamp-2 text-sm font-extrabold text-graphite">{product.name}</span>
                        <span className="truncate text-xs font-semibold text-slate-500">
                          {(product.variants || []).map((variant) => variant.name).join(' / ') || product.unit?.name}
                        </span>
                        {onOpenProduct && (
                          <button
                            type="button"
                            onClick={() => onOpenProduct(product.id)}
                            className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 text-xs font-extrabold text-brand-800 hover:bg-brand-100"
                          >
                            <ImagePlus className="h-3.5 w-3.5" /> Manage Images
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
        <Status status={status} />
      </section>
    )
  }

  const categoryCards = (rows) => (
      <ul className={cardGrid}>
        {rows.map((category) => {
          const subs = subsOf(category.id)
          const busy = busyKey === `category-${category.id}`
          return (
            <li
              key={category.id}
              className={`flex flex-col items-center gap-3 rounded-2xl border bg-white p-5 text-center shadow-[0_6px_20px_-16px_rgba(15,23,42,0.35)] transition hover:border-brand-300 ${
                category.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-80'
              }`}
            >
              <button type="button" onClick={() => setOpenCategoryId(category.id)} className="group flex flex-col items-center gap-3" aria-label={`Open ${category.name}`}>
                <span className="rounded-full transition group-hover:ring-4 group-hover:ring-brand-100">
                  <RoundPicture src={category.image_url} className="h-32 w-32" />
                </span>
                <span className="font-display text-base font-extrabold text-graphite group-hover:text-brand-800">{category.name}</span>
              </button>
              <ActiveSwitch name={category.name} active={category.is_active} busy={busy} onToggle={() => toggleCategory(category)} />
              <button type="button" onClick={() => setOpenCategoryId(category.id)} className="text-xs font-bold text-slate-500 hover:text-brand-800">
                {subs.length} subcategor{subs.length === 1 ? 'y' : 'ies'}
                {subs.length > 0 && <span className="mt-0.5 line-clamp-2 block text-[11px] font-semibold text-slate-400">{subs.map((row) => row.name).join(' · ')}</span>}
              </button>
              <div className="mt-auto flex w-full flex-col items-center gap-2">
                <PictureButton label={category.image_url ? 'Change Image' : 'Upload Image'} busy={busy} onFile={(file) => uploadCategoryImage(category, file)} />
                <button
                  type="button"
                  onClick={() => setOpenCategoryId(category.id)}
                  className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-brand-700 px-3 text-xs font-extrabold text-white transition hover:bg-brand-800"
                >
                  Manage Subcategories <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
  )

  // Active categories fill the 4-column grid; switched-off ones (kept, never
  // deleted, so they can be switched back on) are listed apart, below it.
  const activeCategories = categories.filter((row) => row.is_active)
  const inactiveCategories = categories.filter((row) => !row.is_active)

  // ---- All categories: four large cards a row --------------------------------
  return (
    <section className="p-4 sm:p-6">
      <p className="text-xs font-semibold text-slate-500">
        The category image is shown in the round category navigation suppliers and buyers use. Open a category to manage its subcategories.
      </p>
      <div className="mt-4">{categoryCards(activeCategories)}</div>
      {inactiveCategories.length > 0 && (
        <div className="mt-8">
          <h4 className="font-display text-sm font-extrabold text-slate-500">Inactive categories</h4>
          <p className="mb-3 text-xs font-semibold text-slate-400">Hidden from suppliers and buyers. Switch one on to bring it back.</p>
          {categoryCards(inactiveCategories)}
        </div>
      )}
      <div className="mt-3"><Status status={status} /></div>
    </section>
  )
}

/**
 * Subcategories tab: every active subcategory of every active category, in one
 * place, with a category filter. Each has its own picture,
 * master_subcategories.image_url -- separate from the category image, brand
 * logos and product images -- uploaded through the same endpoint the
 * Categories tab uses (POST /admin/catalog/subcategories/{id}/image, India
 * Super Admin only). Subcategories come from the catalog SQL; nothing here
 * creates one.
 */
export function SubcategoryManager({ categories, onCount }) {
  const dispatch = useDispatch()
  const [rows, setRows] = useState([])
  const [load, setLoad] = useState({ state: 'loading', message: '' })
  const [reloadKey, setReloadKey] = useState(0)
  const [categoryId, setCategoryId] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notes, setNotes] = useState({})

  useEffect(() => {
    let current = true
    setLoad({ state: 'loading', message: '' })
    fetchAdminCatalogSubcategories()
      .then((list) => {
        if (!current) return
        setRows(list)
        setLoad({ state: 'ready', message: '' })
      })
      .catch((error) => {
        if (current) setLoad({ state: 'error', message: error.response?.data?.detail || error.message || 'The subcategories could not be loaded.' })
      })
    return () => {
      current = false
    }
  }, [reloadKey])

  // Active subcategories of active categories, in the catalog's category order.
  const activeCategories = categories.filter((row) => row.is_active)
  const categoryIndex = new Map(activeCategories.map((row, index) => [row.id, index]))
  const categoryName = new Map(activeCategories.map((row) => [row.id, row.name]))
  const active = rows
    .filter((row) => row.is_active && categoryIndex.has(row.category_id))
    .sort((a, b) => categoryIndex.get(a.category_id) - categoryIndex.get(b.category_id) || a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  const shown = categoryId ? active.filter((row) => String(row.category_id) === categoryId) : active

  useEffect(() => {
    if (load.state === 'ready') onCount?.(active.length)
  }, [active.length, load.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (subcategory, file) => {
    const note = (tone, text) => setNotes((all) => ({ ...all, [subcategory.id]: { tone, text } }))
    const problem = pictureProblem(file)
    if (problem) {
      note('error', problem)
      return
    }
    setBusyId(subcategory.id)
    note('', 'Uploading…')
    try {
      // The saved row comes back from the server and replaces the card's.
      const saved = await dispatch(uploadAdminSubcategoryImage({ id: subcategory.id, file })).unwrap()
      setRows((list) => list.map((row) => (row.id === saved.id ? saved : row)))
      note('success', 'Image saved.')
    } catch (error) {
      note('error', String(error?.message || error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-500">
          One image per subcategory. Suppliers see it when they choose a subcategory in Add Product.
        </p>
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          aria-label="Filter by category"
          className={`${field} h-10 w-full text-sm sm:w-56`}
        >
          <option value="">All Categories</option>
          {activeCategories.map((row) => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
        </select>
      </div>

      {load.state === 'error' ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-xs font-bold text-red-700">
          <span>The subcategories could not be loaded: {load.message}</span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="h-8 rounded-lg bg-red-600 px-3 text-white hover:bg-red-700">
            Try again
          </button>
        </div>
      ) : load.state === 'loading' ? (
        <p className="mt-4 flex items-center gap-2 px-1 py-6 text-xs font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subcategories…
        </p>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center text-xs font-semibold text-slate-500">
          No active subcategories{categoryId ? ' in this category' : ''} yet. They appear here once the catalog SQL has created them.
        </p>
      ) : (
        <ul aria-label="Subcategories" className={`mt-4 ${cardGrid}`}>
          {shown.map((row) => (
            <li key={row.id} className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-[0_6px_20px_-16px_rgba(15,23,42,0.35)]">
              <RoundPicture src={row.image_url} className="h-32 w-32" />
              <div className="min-w-0">
                <h5 className="line-clamp-2 font-display text-base font-extrabold text-graphite">{row.name}</h5>
                <p className="text-xs font-bold text-slate-400">{categoryName.get(row.category_id)}</p>
              </div>
              <div className="mt-auto w-full space-y-2">
                <PictureButton
                  large
                  label={row.image_url ? 'Change Image' : 'Upload Image'}
                  busy={busyId === row.id}
                  onFile={(file) => upload(row, file)}
                />
                <CardNote note={notes[row.id]} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Brands tab: every brand with its logo (master_brands.logo_url), separate
 * from product images. Brands come from the catalog SQL; the admin manages
 * their logos.
 */
export function BrandManager({ brands }) {
  const dispatch = useDispatch()
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [status, setStatus] = useState({ tone: '', text: '' })
  const shown = brands.filter((brand) => !query.trim() || brand.name.toLowerCase().includes(query.trim().toLowerCase()))

  const upload = async (brand, file) => {
    setBusyId(brand.id)
    setStatus({ tone: '', text: '' })
    try {
      await dispatch(uploadAdminBrandLogo({ id: brand.id, file })).unwrap()
      setStatus({ tone: 'success', text: `${brand.name}: logo updated.` })
    } catch (error) {
      setStatus({ tone: 'error', text: String(error) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-500">The logo is shown wherever the brand appears: brand selection, product cards and product pages.</p>
        <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 sm:w-64">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brands" aria-label="Search brands" className="w-full bg-transparent text-sm font-semibold outline-none" />
        </label>
      </div>
      {brands.length === 0 ? (
        <p className="mt-6 text-center text-xs font-semibold text-slate-500">No brands yet. They appear here once the catalog SQL has created them.</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-center text-xs font-semibold text-slate-500">No brand matches “{query}”.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((brand) => (
            <li key={brand.id} className={`flex flex-col items-center gap-2 rounded-2xl border bg-white p-4 text-center ${brand.is_active === false ? 'border-dashed border-slate-300 opacity-70' : 'border-slate-200'}`}>
              <span className="line-clamp-1 text-sm font-extrabold text-graphite">{brand.name}</span>
              <BrandLogo src={brand.logo_url} name={brand.name} size="lg" />
              {brand.manufacturer && <span className="line-clamp-2 text-[11px] font-semibold text-slate-400">{brand.manufacturer}</span>}
              <PictureButton label={brand.logo_url ? 'Change logo' : 'Upload logo'} busy={busyId === brand.id} onFile={(file) => upload(brand, file)} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3"><Status status={status} /></div>
    </section>
  )
}

const emptyFaq = () => ({ question: '', answer: '' })
const emptySpec = () => ({ key: '', value: '' })

function valuesFromProduct(product) {
  return {
    name: product?.name || '',
    slug: product?.slug || '',
    categoryId: product?.category_id ? String(product.category_id) : '',
    subcategoryId: product?.subcategory_id ? String(product.subcategory_id) : '',
    brandId: product?.brand_id ? String(product.brand_id) : '',
    unitId: product?.unit?.id ? String(product.unit.id) : '',
    productType: product?.product_type || '',
    standardCode: product?.standard_code || '',
    shortDescription: product?.short_description || '',
    description: product?.description || '',
    highlights: (product?.highlights || []).join('\n'),
    faqs: product?.faqs?.length ? product.faqs.map((faq) => ({ ...faq })) : [emptyFaq()],
    returnsPolicy: product?.returns_exchange_policy || '',
    specifications: Object.entries(product?.specifications || {}).map(([key, value]) => ({ key, value: String(value) })),
    newVariants: [],
  }
}

/**
 * Create or edit a master product. On create the product starts inactive:
 * it is activated on the product panel once its images are uploaded (the
 * server's five-image rule), exactly as before.
 */
export function ProductEditor({ product, categories, brands, units, onClose, onSaved }) {
  const dispatch = useDispatch()
  const editing = Boolean(product?.id)
  const [values, setValues] = useState(() => valuesFromProduct(product))
  const [subcategories, setSubcategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState({ tone: '', text: '' })
  const set = (key) => (value) => setValues((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    if (!values.categoryId) {
      setSubcategories([])
      return
    }
    fetchAdminCatalogSubcategories(values.categoryId).then(setSubcategories).catch(() => setSubcategories([]))
  }, [values.categoryId])

  const updateList = (key, index, patch) =>
    setValues((current) => ({ ...current, [key]: current[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) }))
  const removeFrom = (key, index) => setValues((current) => ({ ...current, [key]: current[key].filter((_, i) => i !== index) }))
  const addTo = (key, item) => setValues((current) => ({ ...current, [key]: [...current[key], item] }))

  const submit = async (event) => {
    event.preventDefault()
    setStatus({ tone: '', text: '' })
    if (!values.name.trim() || !values.subcategoryId) {
      setStatus({ tone: 'error', text: 'Name, category and subcategory are required.' })
      return
    }
    const payload = {
      name: values.name.trim(),
      subcategory_id: values.subcategoryId,
      brand_id: values.brandId || null,
      unit_id: values.unitId || null,
      product_type: values.productType.trim() || null,
      standard_code: values.standardCode.trim() || null,
      short_description: values.shortDescription.trim() || null,
      description: values.description.trim() || null,
      highlights: values.highlights.split('\n').map((line) => line.trim()).filter(Boolean),
      faqs: values.faqs
        .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() }))
        .filter((faq) => faq.question && faq.answer),
      returns_exchange_policy: values.returnsPolicy.trim() || null,
      specifications: Object.fromEntries(
        values.specifications.filter((row) => row.key.trim() && String(row.value).trim()).map((row) => [row.key.trim(), String(row.value).trim()]),
      ),
    }
    if (!editing) {
      payload.slug = slugify(values.slug || values.name)
      payload.is_active = false
    }
    setSaving(true)
    try {
      const saved = await dispatch(saveAdminCatalogProduct({ id: product?.id, values: payload })).unwrap()
      for (const variant of values.newVariants.filter((row) => row.name.trim())) {
        await createAdminCatalogVariant(saved.id, {
          name: variant.name.trim(),
          slug: slugify(variant.name),
          unit_id: payload.unit_id,
          specifications: variant.size.trim() ? { Size: variant.size.trim() } : {},
        })
      }
      onSaved?.(saved)
    } catch (error) {
      setStatus({ tone: 'error', text: String(error?.response?.data?.detail || error?.message || error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={editing ? 'Edit product' : 'New product'} className="fixed inset-0 z-[140] flex justify-center overflow-y-auto bg-slate-900/60 p-4">
      <form onSubmit={submit} className="my-auto w-full max-w-3xl space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
        <header className="flex items-center justify-between">
          <h3 className="font-display text-base font-extrabold text-graphite">{editing ? `Edit ${product.name}` : 'New master product'}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="Product name" className="sm:col-span-2">
            <input value={values.name} onChange={(e) => set('name')(e.target.value)} className={field} />
          </Label>
          {!editing && (
            <Label text="Key (slug)" className="sm:col-span-2">
              <input value={values.slug} onChange={(e) => set('slug')(e.target.value)} placeholder={slugify(values.name)} className={field} />
            </Label>
          )}
          <Label text="Category">
            <select value={values.categoryId} onChange={(e) => setValues((current) => ({ ...current, categoryId: e.target.value, subcategoryId: '' }))} className={field}>
              <option value="">Choose</option>
              {categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Label>
          <Label text="Subcategory">
            <select value={values.subcategoryId} onChange={(e) => set('subcategoryId')(e.target.value)} disabled={!values.categoryId} className={field}>
              <option value="">Choose</option>
              {subcategories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Label>
          <div className="sm:col-span-2">
            <span className={caption}>Brand</span>
            <div className="mt-1">
              <BrandPicker
                brands={brands}
                value={values.brandId}
                onChange={set('brandId')}
                leading={[{ value: '', label: 'No brand (generic)' }]}
                emptyLabel="No brands yet -- add one with Manage Brands."
              />
            </div>
          </div>
          <Label text="Unit">
            <select value={values.unitId} onChange={(e) => set('unitId')(e.target.value)} className={field}>
              <option value="">Choose</option>
              {units.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Label>
          <Label text="Product type"><input value={values.productType} onChange={(e) => set('productType')(e.target.value)} className={field} /></Label>
          <Label text="Standard"><input value={values.standardCode} onChange={(e) => set('standardCode')(e.target.value)} placeholder="IS 269:2015" className={field} /></Label>
          <Label text="Short description" className="sm:col-span-2"><input value={values.shortDescription} onChange={(e) => set('shortDescription')(e.target.value)} className={field} /></Label>
          <Label text="Product description" className="sm:col-span-2"><textarea rows={4} value={values.description} onChange={(e) => set('description')(e.target.value)} className={area} /></Label>
          <Label text="Product highlights (one per line)" className="sm:col-span-2"><textarea rows={4} value={values.highlights} onChange={(e) => set('highlights')(e.target.value)} className={area} /></Label>
        </div>

        <div>
          <p className={caption}>FAQs</p>
          <div className="mt-1 space-y-2">
            {values.faqs.map((faq, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                <input value={faq.question} onChange={(e) => updateList('faqs', index, { question: e.target.value })} placeholder="Question" className={field} />
                <input value={faq.answer} onChange={(e) => updateList('faqs', index, { answer: e.target.value })} placeholder="Answer" className={field} />
                <button type="button" onClick={() => removeFrom('faqs', index)} aria-label="Remove FAQ" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => addTo('faqs', emptyFaq())} className="text-xs font-extrabold text-ocbrand-700"><Plus className="mr-1 inline h-3 w-3" />Add FAQ</button>
          </div>
        </div>

        <Label text="Returns & Exchange Policy"><textarea rows={3} value={values.returnsPolicy} onChange={(e) => set('returnsPolicy')(e.target.value)} className={area} /></Label>

        <div>
          <p className={caption}>Specifications</p>
          <div className="mt-1 space-y-2">
            {values.specifications.map((row, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                <input value={row.key} onChange={(e) => updateList('specifications', index, { key: e.target.value })} placeholder="Name (e.g. Grade)" className={field} />
                <input value={row.value} onChange={(e) => updateList('specifications', index, { value: e.target.value })} placeholder="Value (e.g. 53)" className={field} />
                <button type="button" onClick={() => removeFrom('specifications', index)} aria-label="Remove specification" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => addTo('specifications', emptySpec())} className="text-xs font-extrabold text-ocbrand-700"><Plus className="mr-1 inline h-3 w-3" />Add specification</button>
          </div>
        </div>

        <div>
          <p className={caption}>Variants / sizes</p>
          {editing && (product.variants || []).length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {product.variants.map((variant) => (
                <span key={variant.id} className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-graphite/70">{variant.name}</span>
              ))}
            </p>
          )}
          <div className="mt-1 space-y-2">
            {values.newVariants.map((row, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <input value={row.name} onChange={(e) => updateList('newVariants', index, { name: e.target.value })} placeholder="Variant (e.g. 50 kg Bag)" className={field} />
                <input value={row.size} onChange={(e) => updateList('newVariants', index, { size: e.target.value })} placeholder="Size (e.g. 50 kg)" className={field} />
                <button type="button" onClick={() => removeFrom('newVariants', index)} aria-label="Remove variant" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => addTo('newVariants', { name: '', size: '' })} className="text-xs font-extrabold text-ocbrand-700"><Plus className="mr-1 inline h-3 w-3" />Add variant</button>
          </div>
        </div>

        {!editing && (
          <p className="text-[11px] font-semibold text-slate-500">
            A new product starts inactive. Upload its images, then activate it on the product panel.
          </p>
        )}
        <Status status={status} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-extrabold text-graphite/70">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-4 text-xs font-extrabold text-white disabled:opacity-60">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {editing ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </form>
    </div>
  )
}
