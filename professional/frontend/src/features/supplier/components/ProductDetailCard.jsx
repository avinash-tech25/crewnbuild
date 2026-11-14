/**
 * Full screen product card, laid out like a storefront listing: the photo holds
 * the left half and everything written about the product sits on the right.
 *
 * The card fills the viewport. On wide screens the photo stays put while the
 * details column scrolls on its own; on narrow screens the two stack and the
 * whole body scrolls. Values wrap rather than truncate, because a clipped brand
 * or size is the thing the card exists to show.
 *
 * Two kinds of listing:
 *   - A Master Catalog listing (master_product_id set). What the product IS --
 *     name, category, subcategory, brand, variant, unit, standard,
 *     specifications, image -- is read live from the catalog and shown
 *     read-only -- the description included. The supplier edits only what
 *     they own: price, stock, low-stock threshold, discount and whether the
 *     listing is published.
 *   - An older listing the supplier typed in themselves, which keeps the full
 *     form it always had.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Save, X } from 'lucide-react'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { supplierCategoryOptions } from '../../onboarding/profileConstants.js'
import { UNIT_LABEL_KEYS } from '../supplierConstants.js'
import { NoListingImage, listingImageSrc } from './ListingImage.jsx'
import { formatMoney, splitEditableList } from '../supplierHelpers.js'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { fetchCatalogProduct } from '../../catalog/catalogApi.js'
import { CatalogGallery, CatalogVideo, ExpandableText, unitQuantity } from '../../catalog/components/CatalogMedia.jsx'
import { PriceTag, validDiscount } from '../../catalog/components/PriceTag.jsx'
import { BrandLogo } from '../../catalog/components/BrandPicker.jsx'
import { StockBadge } from '../../catalog/components/StockBadge.jsx'
import { BulkPricingPanel } from '../../catalog/components/BulkPricing.jsx'
import { formatDate, formatNumber } from '../../../shared/utils/formatters.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'

const UNIT_OPTIONS = ['bag', 'kg', 'piece', 'ton', 'litre', 'cubic foot', 'cubic metre']

const fieldClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-graphite outline-none transition focus:border-brand-500'

// `statusKey` arrives as the catalogue's own stored vocabulary, so the keys here
// are those four values verbatim: the tone and the wording are two readings of
// one status rather than two lists that can drift apart.
const AVAILABILITY_TONES = {
  'Active': 'text-emerald-600',
  'Low Stock': 'text-amber-600',
  'Out of Stock': 'text-rose-600',
  'Unpublished': 'text-slate-500',
}
const AVAILABILITY_KEYS = {
  'Active': 'dash.supplier.availableInStock',
  'Low Stock': 'dash.supplier.lowStock',
  'Out of Stock': 'dash.supplier.outOfStock',
  'Unpublished': 'dash.supplier.unpublished',
}

function DetailTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{label}</p>
      <p className="mt-1 break-words text-sm font-extrabold leading-snug text-graphite">{value}</p>
    </div>
  )
}

/** A value shown as plain text inside the edit form: part of the listing, not the supplier's to change. */
function ReadOnlyField({ label, value }) {
  return (
    <div>
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{label}</p>
      <p className="mt-1 flex min-h-10 items-center rounded-lg bg-slate-50 px-3 text-sm font-extrabold text-graphite/70">{value}</p>
    </div>
  )
}

function EditField({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function draftFromProduct(product) {
  return {
    name: product.name || '',
    brand: product.brand || '',
    category: product.category || '',
    size: product.size || '',
    unit: product.unit || '',
    price: String(product.price ?? ''),
    quantity: String(product.quantity ?? ''),
    low_stock_threshold: String(product.low_stock_threshold ?? ''),
    discount_percentage: String(product.discount_percentage ?? 0),
    features: product.features || '',
    description: product.description || '',
    product_type: product.product_type || '',
    grade: product.grade || '',
    usage: product.usage || '',
    is_published: product.is_published !== false,
  }
}

export default function ProductDetailCard({ product, statusKey, onSave, onClose, startInEdit = false }) {
  const { t, td, country } = useLanguage()
  // `startInEdit`: opened from a card's Edit button, straight into the form.
  const [editing, setEditing] = useState(startInEdit)
  const [draft, setDraft] = useState(() => draftFromProduct(product))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // A catalog listing's canonical half, read live from the Master Catalog
  // (GET /catalog/products/{id}) rather than from the text copied onto the
  // listing when it was added.
  const isCatalog = Boolean(product.master_product_id)
  const [catalog, setCatalog] = useState({ status: isCatalog ? 'loading' : 'none', product: null })
  useEffect(() => {
    if (!isCatalog) return undefined
    let cancelled = false
    setCatalog({ status: 'loading', product: null })
    fetchCatalogProduct(product.master_product_id)
      .then((master) => !cancelled && setCatalog({ status: 'ready', product: master }))
      .catch(() => !cancelled && setCatalog({ status: 'error', product: null }))
    return () => {
      cancelled = true
    }
  }, [isCatalog, product.master_product_id])

  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }))

  const startEditing = () => {
    setDraft(draftFromProduct(product))
    setSaveError('')
    setEditing(true)
  }

  const saveChanges = async () => {
    if (isCatalog) {
      const values = ['price', 'quantity', 'low_stock_threshold'].map((field) => Number(draft[field] || 0))
      if (values.some((value) => !Number.isFinite(value) || value < 0)) {
        setSaveError(t('dash.supplier.msg.unableUpdate'))
        return
      }
      if (!validDiscount(draft.discount_percentage)) {
        setSaveError('Discount must be a number from 0 to 100.')
        return
      }
      setSaving(true)
      setSaveError('')
      try {
        // Only what the supplier owns. Sending a catalog field is refused by the
        // server, which is why the old full form could never save a catalog listing.
        await onSave(product.id, {
          price: values[0],
          quantity: values[1],
          low_stock_threshold: values[2],
          is_published: draft.is_published,
          discount_percentage: Number(draft.discount_percentage || 0),
        })
        setEditing(false)
      } catch (error) {
        setSaveError(error?.response?.data?.detail || error?.message || t('dash.supplier.msg.unableUpdate'))
      } finally {
        setSaving(false)
      }
      return
    }
    if (!draft.name.trim()) {
      setSaveError(t('dash.supplier.msg.pleaseEnter') + ': ' + t('sup.field.productName'))
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await onSave(product.id, {
        name: draft.name.trim(),
        brand: draft.brand.trim(),
        category: draft.category,
        size: draft.size.trim(),
        unit: draft.unit,
        price: Number(draft.price || 0),
        quantity: Number(draft.quantity || 0),
        low_stock_threshold: Number(draft.low_stock_threshold || 0),
        features: draft.features.trim(),
        description: draft.description.trim(),
        product_type: draft.product_type.trim(),
        grade: draft.grade.trim(),
        usage: draft.usage.trim(),
        is_published: draft.is_published,
      })
      setEditing(false)
    } catch (error) {
      setSaveError(error?.response?.data?.detail || t('dash.supplier.msg.unableUpdate'))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    // The page behind must not scroll while the card covers it.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const features = splitEditableList(product.features)
  const quantity = Number(product.quantity || 0)
  const listedOn = formatDate(product.created_at, '—')
  // Every listing state, including Unpublished — which used to fall through to
  // "Available in stock" and tell the supplier the opposite of the truth.
  const availability = t(AVAILABILITY_KEYS[statusKey] || AVAILABILITY_KEYS.Active)
  const unitName = product.unit ? optionLabel(t, UNIT_LABEL_KEYS, product.unit) : ''

  const perUnit = [unitName && `${t('dash.supplier.per')} ${unitName}`, product.size && td(product.size)]
    .filter(Boolean)
    .join(' · ')

  const details = [
    [t('dash.supplier.brand'), product.brand ? td(product.brand) : '—'],
    [t('shop.type'), product.product_type ? td(product.product_type) : '—'],
    [t('shop.grade'), product.grade || '—'],
    [t('dash.supplier.size'), product.size ? td(product.size) : '—'],
    [t('dash.supplier.unit'), unitName || '—'],
    [t('dash.supplier.stock'), `${formatNumber(quantity, '0')} ${unitName}`.trim()],
    [t('dash.supplier.lowStockThreshold'), String(product.low_stock_threshold || 0)],
    [t('dash.supplier.published'), product.is_published === false ? t('dash.common.no') : t('dash.common.yes')],
    [t('dash.supplier.listedOn'), listedOn],
  ]

  const imageSource = listingImageSrc(product)

  // ---- Master Catalog listing: every canonical value from the catalog itself,
  // and a tile only for a value that exists. Nothing is filled in with a dash.
  const master = catalog.product
  const masterVariant = master?.variants?.find((variant) => variant.id === product.master_variant_id) || null
  const catalogUnitRecord = masterVariant?.unit || master?.unit || null
  const catalogUnit = catalogUnitRecord?.name || ''
  const catalogSpecifications = Object.entries((masterVariant || master)?.specifications || {}).filter(
    ([key, value]) => key && value !== null && value !== undefined && String(value).trim() !== '',
  )
  const catalogDetails = master
    ? [
        [t('dash.supplier.category'), master.category_name],
        [t('dash.supplier.subcategory'), master.subcategory_name],
        [t('dash.supplier.brand'), master.brand_name],
        [t('dash.supplier.variant'), masterVariant?.name],
        [t('dash.supplier.unit'), catalogUnit],
        [t('dash.supplier.standard'), master.standard_code],
      ].filter(([, value]) => value)
    : []
  // Stock and threshold in the catalog unit's own words: "12 Bags", "1 Bag".
  const listingDetails = [
    ['Discount', Number(product.discount_percentage || 0) > 0 ? `${Number(product.discount_percentage)}% off` : 'None'],
    [t('dash.supplier.stock'), unitQuantity(quantity, catalogUnitRecord)],
    [t('dash.supplier.lowStockThreshold'), unitQuantity(product.low_stock_threshold, catalogUnitRecord)],
    [t('dash.supplier.published'), product.is_published === false ? t('dash.common.no') : t('dash.common.yes')],
    [t('dash.supplier.listedOn'), listedOn],
  ]
  const title = master?.name || product.name
  const catalogPerUnit = catalogUnit ? `${t('dash.supplier.per')} ${catalogUnit}` : ''

  // Rendered outside the dashboard so the shell's heading typography and any
  // ancestor overflow or transform cannot reach into a full screen overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dash.supplier.productDetails')}
      onClick={onClose}
      className="fixed inset-0 z-[140] flex justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl
                   sm:h-[min(92dvh,880px)] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-slate-200"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('dash.supplier.closeProductDetails')}
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/95 text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)] lg:overflow-hidden">
          <div className="flex flex-col items-center justify-center gap-4 border-b border-slate-100 bg-slate-50 p-6 lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-e">
            {isCatalog && master ? (
              <>
                {/* The administrator's images and video for this product. */}
                <CatalogGallery
                  images={master.images || []}
                  alt={title}
                  noImageLabel={t('dash.msg.noImage')}
                  mainClassName="mx-auto max-h-[38vh] w-full lg:max-h-[52vh]"
                />
                <CatalogVideo videoUrl={master.video_url} className="w-full max-w-md" />
              </>
            ) : imageSource ? (
              <SmartImage
                src={imageSource}
                alt={td(product.name)}
                className="max-h-[38vh] w-auto max-w-full object-contain lg:max-h-full"
              />
            ) : (
              <NoListingImage label={t('dash.msg.noImage')} className="h-48 w-full max-w-sm rounded-xl ring-1 ring-slate-200" />
            )}
          </div>

          <div className="p-5 sm:p-6 lg:h-full lg:overflow-y-auto">
            <h4 className="font-display text-2xl font-extrabold leading-tight text-graphite sm:text-3xl">
              {isCatalog ? title : td(product.name)}
            </h4>
            {isCatalog ? (
              master && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <BrandLogo src={master.brand_logo_url || product.brand_logo_url} name={master.brand_name || 'Generic'} size="md" />
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">{master.brand_name || 'Generic'}</p>
                    <p className="text-sm font-semibold text-graphite/50">
                      {[master.category_name, master.subcategory_name].filter(Boolean).join(' › ')}
                    </p>
                  </div>
                </div>
              )
            ) : product.category && (
              <p className="mt-1.5 text-sm font-semibold text-graphite/50">
                {t('dash.supplier.inCategory')} <span className="font-extrabold text-graphite/70">{optionLabel(t, SUPPLIER_CATEGORY_KEYS, product.category)}</span>
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                {isCatalog ? (
                  <PriceTag price={product.price} discountPercentage={product.discount_percentage} size="lg" />
                ) : (
                  <p className="font-display text-3xl font-extrabold leading-none text-graphite">
                    {formatMoney(product.price)}
                  </p>
                )}
                {(isCatalog ? catalogPerUnit : perUnit) && (
                  <p className="mt-1.5 text-xs font-semibold text-graphite/50">{isCatalog ? catalogPerUnit : perUnit}</p>
                )}
              </div>
              <p className={`text-sm font-extrabold ${AVAILABILITY_TONES[statusKey] || AVAILABILITY_TONES.Unpublished}`}>
                {availability}
              </p>
            </div>

            {isCatalog && (
              // Stock at a glance: the level, the alert threshold, the status.
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.supplier.stock')}</p>
                  <p className="text-sm font-extrabold text-graphite">{unitQuantity(quantity, catalogUnitRecord)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.supplier.lowStockThreshold')}</p>
                  <p className="text-sm font-extrabold text-graphite">{unitQuantity(product.low_stock_threshold, catalogUnitRecord)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.common.status')}</p>
                  <p className="text-sm font-extrabold text-graphite">{product.is_published === false ? t('dash.supplier.unpublished') : t('sup.card.published')}</p>
                </div>
                <div className="flex items-center rounded-xl bg-slate-50 px-3 py-2">
                  <StockBadge quantity={product.quantity} threshold={product.low_stock_threshold} />
                </div>
              </div>
            )}

            {!isCatalog && !editing && product.description && (
              <p className="mt-4 text-sm leading-relaxed text-graphite/70">{td(product.description)}</p>
            )}

            <hr className="mt-5 border-slate-100" />

            {isCatalog ? (
              <CatalogListingBody
                t={t}
                country={country}
                catalog={catalog}
                title={title}
                variantName={masterVariant?.name}
                unitLabel={catalogUnitRecord ? catalogUnitRecord.plural_name || catalogUnitRecord.name : ''}
                catalogDetails={catalogDetails}
                listingDetails={listingDetails}
                specifications={catalogSpecifications}
                description={master?.description}
                editing={editing}
                draft={draft}
                setField={setField}
                saveError={saveError}
              />
            ) : editing ? (
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <EditField label={t('sup.field.productName')}>
                    <input value={draft.name} onChange={(event) => setField('name', event.target.value)} className={fieldClass} />
                  </EditField>
                </div>
                <EditField label={t('dash.supplier.brand')}>
                  <input value={draft.brand} onChange={(event) => setField('brand', event.target.value)} className={fieldClass} />
                </EditField>
                <EditField label={t('dash.supplier.category')}>
                  <select value={draft.category} onChange={(event) => setField('category', event.target.value)} className={fieldClass}>
                    <option value="">{t('dash.supplier.category')}</option>
                    {supplierCategoryOptions.map((option) => <option key={option} value={option}>{optionLabel(t, SUPPLIER_CATEGORY_KEYS, option)}</option>)}
                  </select>
                </EditField>
                <EditField label={t('dash.supplier.size')}>
                  <input value={draft.size} onChange={(event) => setField('size', event.target.value)} className={fieldClass} />
                </EditField>
                <EditField label={t('dash.supplier.unit')}>
                  <select value={draft.unit} onChange={(event) => setField('unit', event.target.value)} className={fieldClass}>
                    <option value="">{t('dash.supplier.selectUnit')}</option>
                    {UNIT_OPTIONS.map((option) => <option key={option} value={option}>{optionLabel(t, UNIT_LABEL_KEYS, option)}</option>)}
                  </select>
                </EditField>
                <EditField label={t('dash.supplier.price')}>
                  <input type="number" min="0" value={draft.price} onChange={(event) => setField('price', event.target.value)} className={fieldClass} />
                  <BudgetInWords value={draft.price} country={country} />
                </EditField>
                <EditField label={t('dash.supplier.stock')}>
                  <input type="number" min="0" value={draft.quantity} onChange={(event) => setField('quantity', event.target.value)} className={fieldClass} />
                </EditField>
                <EditField label={t('dash.supplier.lowStockThreshold')}>
                  <input type="number" min="0" value={draft.low_stock_threshold} onChange={(event) => setField('low_stock_threshold', event.target.value)} className={fieldClass} />
                </EditField>
                <label className="flex h-10 items-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3">
                  <input
                    type="checkbox"
                    checked={draft.is_published}
                    onChange={(event) => setField('is_published', event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  />
                  <span className="text-xs font-extrabold text-graphite">{t('dash.supplier.published')}</span>
                </label>
                <EditField label={t('shop.type')}>
                  <input value={draft.product_type} onChange={(event) => setField('product_type', event.target.value)} className={fieldClass} />
                </EditField>
                <EditField label={t('shop.grade')}>
                  <input value={draft.grade} onChange={(event) => setField('grade', event.target.value)} className={fieldClass} />
                </EditField>
                <div className="sm:col-span-2">
                  <EditField label={t('shop.description')}>
                    <textarea rows={2} value={draft.description} onChange={(event) => setField('description', event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-graphite outline-none transition focus:border-brand-500" />
                  </EditField>
                </div>
                <div className="sm:col-span-2">
                  <EditField label={t('shop.usage')}>
                    <input value={draft.usage} onChange={(event) => setField('usage', event.target.value)} className={fieldClass} />
                  </EditField>
                </div>
                <div className="sm:col-span-2">
                  <EditField label={t('dash.supplier.features')}>
                    <textarea
                      rows={3}
                      value={draft.features}
                      onChange={(event) => setField('features', event.target.value)}
                      placeholder={t('dash.supplier.featuresHint')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-graphite outline-none transition focus:border-brand-500"
                    />
                  </EditField>
                </div>
                {saveError && (
                  <p className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{saveError}</p>
                )}
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2.5 xl:grid-cols-3">
                  {details.map(([label, value]) => (
                    <DetailTile key={label} label={label} value={value} />
                  ))}
                </div>

                {product.usage && (
                  <div className="mt-5 rounded-xl bg-cream/55 px-3 py-2.5">
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.usage')}</p>
                    <p className="mt-1 text-xs font-semibold leading-relaxed text-graphite/70">{td(product.usage)}</p>
                  </div>
                )}

                {features.length > 0 && (
                  <div className="mt-6">
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">
                      {t('dash.supplier.features')}
                    </p>
                    {/* Free text the supplier typed — or, when they typed none,
                        the English sentence the listing form composed and saved.
                        The stored string is untouched; this is only how it is
                        read back. */}
                    <ul className="mt-2 grid gap-2">
                      {features.map((feature) => (
                        <li key={feature} className="rounded-xl bg-cream/55 px-3 py-2 text-xs font-semibold leading-relaxed text-graphite/70">
                          {td(feature)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {/* Optional bulk pricing of this listing: its own Save. */}
            {editing && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <BulkPricingPanel productId={product.id} unit={product.unit} normalPrice={Number(product.price || 0)} country={country} />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 bg-white p-4">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="h-11 flex-1 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-graphite/70 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {t('dash.common.cancel')}
              </button>
              <button
                type="button"
                onClick={saveChanges}
                disabled={saving}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? t('reset.saving') : isCatalog ? t('dash.supplier.saveChanges') : t('dash.common.save')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={startEditing}
                disabled={isCatalog && catalog.status !== 'ready'}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 text-sm font-extrabold text-brand-800 transition hover:bg-brand-100 disabled:opacity-50"
              >
                <Pencil className="h-4 w-4" />
                {t('dash.common.edit')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-11 flex-1 rounded-xl bg-slate-800 text-sm font-extrabold text-white transition hover:bg-slate-900"
              >
                {t('dash.common.close')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The body of a Master Catalog listing. View: the catalog's own values, then the
 * supplier's listing values. Edit: the product and variant as plain text, and
 * form controls only for what the supplier owns.
 */
function CatalogListingBody({
  t, country, catalog, title, variantName, unitLabel, catalogDetails, listingDetails, specifications, description,
  editing, draft, setField, saveError,
}) {
  if (catalog.status === 'loading') {
    return <p className="mt-5 text-sm font-semibold text-graphite/45">{t('dash.supplier.catalogLoading')}</p>
  }
  if (catalog.status === 'error') {
    return (
      <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
        {t('dash.supplier.catalogUnavailable')}
      </p>
    )
  }

  if (editing) {
    return (
      <div className="mt-5 space-y-3">
        <p className="text-sm font-extrabold text-graphite">{t('dash.supplier.editListing')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ReadOnlyField label={t('dash.supplier.product')} value={title} />
          {variantName && <ReadOnlyField label={t('dash.supplier.variant')} value={variantName} />}
          <EditField label={t('dash.supplier.sellingPrice')}>
            <input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => setField('price', event.target.value)} className={fieldClass} />
            <BudgetInWords value={draft.price} country={country} />
          </EditField>
          <EditField label={unitLabel ? `${t('dash.supplier.stock')} (${unitLabel})` : t('dash.supplier.stock')}>
            <input type="number" min="0" value={draft.quantity} onChange={(event) => setField('quantity', event.target.value)} className={fieldClass} />
          </EditField>
          <EditField label={unitLabel ? `${t('dash.supplier.lowStockThreshold')} (${unitLabel})` : t('dash.supplier.lowStockThreshold')}>
            <input type="number" min="0" value={draft.low_stock_threshold} onChange={(event) => setField('low_stock_threshold', event.target.value)} className={fieldClass} />
          </EditField>
          <label className="flex h-10 items-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3">
            <input
              type="checkbox"
              checked={draft.is_published}
              onChange={(event) => setField('is_published', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            <span className="text-xs font-extrabold text-graphite">{t('dash.supplier.published')}</span>
          </label>
          <EditField label="Discount (%)">
            <input type="number" min="0" max="100" step="0.01" value={draft.discount_percentage} onChange={(event) => setField('discount_percentage', event.target.value)} className={fieldClass} />
          </EditField>
        </div>
        <p className="text-[11px] font-semibold text-graphite/45">{t('dash.supplier.catalogReadOnly')}</p>
        {saveError && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{saveError}</p>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2.5 xl:grid-cols-3">
        {catalogDetails.map(([label, value]) => (
          <DetailTile key={label} label={label} value={value} />
        ))}
      </div>

      <ExpandableText
        text={description}
        className="mt-4 text-sm leading-relaxed text-graphite/70"
        moreLabel={t('catalog.showMore')}
        lessLabel={t('catalog.showLess')}
      />

      {specifications.length > 0 && (
        <div className="mt-5">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">{t('shop.specifications')}</p>
          <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {specifications.map(([key, value]) => (
              <div key={key} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <dt className="font-extrabold text-graphite/50">{key}</dt>
                <dd className="font-semibold text-graphite">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <hr className="mt-5 border-slate-100" />
      <div className="mt-5 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        {listingDetails.map(([label, value]) => (
          <DetailTile key={label} label={label} value={value} />
        ))}
      </div>
      <p className="mt-4 text-[11px] font-semibold text-graphite/45">{t('dash.supplier.catalogReadOnly')}</p>
    </>
  )
}
