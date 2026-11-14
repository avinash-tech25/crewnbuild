/**
 * Equipment Supplier screens: dashboard stats, Equipment Inventory, incoming
 * equipment Requests and Assignments (active rentals, purchases, completed).
 *
 * Availability, stock and prices are always the backend's: available_to_rent /
 * available_to_buy come from GET /equipment/items and unit_price is the
 * request's own snapshot. Accept/Reject/Complete send the request id only; the
 * backend decides, and a refusal is shown exactly as sent.
 *
 * No quotation, negotiation or payment.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import {
  CalendarDays, CheckCircle2, ChevronRight, ClipboardList, Construction, ImageOff, Loader2, Package, PackageCheck,
  Pencil, Plus, Power, ShoppingCart, Truck, Undo2, Wrench, XCircle,
} from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { translate } from '../../../i18n/translate.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { localIsoDate } from '../../labour/labourApi.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import {
  acceptEquipmentRequest, allowsBuy, allowsRent, completeEquipmentRequest, createEquipmentItem, deactivateEquipmentItem,
  EQUIPMENT_CONDITIONS, EQUIPMENT_MODES, equipmentErrorMessage, fetchEquipmentUsage, modeLabel, RATE_UNITS, ratePer,
  rejectEquipmentRequest, updateEquipmentItem,
} from '../equipmentApi.js'
import {
  formatLaborDate as formatDate, LaborDialog as Dialog, LaborStatusBadge as StatusBadge, REQUEST_FILTERS, requestFilterLabel,
} from '../../labour/components/SupplierLaborSections.jsx'

const inputClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const labelClass = 'mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-graphite/55'

// The currency to show prices in. A project screen provides the project's own
// country; anywhere else it is the signed-in account's country of residence.
export const MoneyCountryContext = createContext(null)

export function useMoney() {
  const projectCountry = useContext(MoneyCountryContext)
  const residence = useSelector((state) => state.auth.user?.country_of_residence)
  const country = projectCountry || residence
  return (value) => formatMoney(value, country)
}

function Notice({ notice }) {
  if (!notice?.text) return null
  return <p className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
}

export function EquipmentImage({ src, className = 'h-20 w-20' }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) {
    return <span className={`grid shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-300 ${className}`}><ImageOff className="h-6 w-6" /></span>
  }
  return <img src={imageUrl(src)} alt="" onError={() => setBroken(true)} className={`shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-1 ${className}`} />
}

export const kindLabel = (kind) => translate(kind === 'RENT' ? 'equipment.kind.rent' : 'equipment.kind.buy')
export const conditionLabel = (condition) => translate(condition === 'USED' ? 'equipment.condition.used' : 'equipment.condition.new')

/** The item's rental rates and sale price, as stored. */
export function EquipmentPrices({ item, compact = false }) {
  const { t } = useLanguage()
  const money = useMoney()
  const rates = allowsRent(item) ? RATE_UNITS.filter((rate) => item[rate.field] != null) : []
  return (
    <div className={`space-y-0.5 text-xs font-semibold ${compact ? '' : 'rounded-xl bg-slate-50 px-3 py-2'}`}>
      {rates.map((rate) => (
        <p key={rate.unit} className="text-graphite/75"><span className="font-extrabold text-graphite">{money(item[rate.field])}</span> / {rate.per}</p>
      ))}
      {allowsBuy(item) && item.sale_price != null && (
        <p className="text-graphite/75">{t('equipment.buyPrice')} <span className="font-extrabold text-graphite">{money(item.sale_price)}</span></p>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ stats

/** Totals from the backend's own item and request figures; nothing estimated. */
export function equipmentTotals(items = [], requests = [], today = localIsoDate()) {
  const active = items.filter((item) => item.is_active)
  return {
    total: active.reduce((sum, item) => sum + Number(item.quantity_total || 0), 0),
    // Free today: rentable items by today's rental availability, sale-only items by stock.
    available: active.reduce((sum, item) => sum + Number(allowsRent(item) ? item.available_to_rent : item.available_to_buy) || 0, 0),
    onRent: requests
      .filter((request) => request.request_kind === 'RENT' && request.status === 'ACCEPTED' && String(request.start_date) <= today)
      .reduce((sum, request) => sum + Number(request.quantity || 0), 0),
    forSale: active.filter(allowsBuy).reduce((sum, item) => sum + Number(item.available_to_buy || 0), 0),
    pending: requests.filter((request) => request.status === 'PENDING').length,
    activeRentals: requests.filter((request) => request.request_kind === 'RENT' && request.status === 'ACCEPTED').length,
    completedRentals: requests.filter((request) => request.request_kind === 'RENT' && request.status === 'COMPLETED').length,
    completedSales: requests.filter((request) => request.request_kind === 'BUY' && request.status === 'COMPLETED').length,
  }
}

export function EquipmentSupplierStatsGrid({ items, requests, onSelect }) {
  const { t } = useLanguage()
  const totals = equipmentTotals(items, requests)
  const stats = [
    { id: 'total', label: t('equipment.stats.total'), value: totals.total, icon: Construction, tone: { card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', arrow: 'bg-blue-100 text-blue-700' }, sectionId: 'equipmentInventory' },
    { id: 'available', label: t('equipment.stats.available'), value: totals.available, icon: PackageCheck, tone: { card: 'border-green-200 bg-green-50', chip: 'bg-green-100 text-green-700', arrow: 'bg-green-100 text-green-700' }, sectionId: 'equipmentInventory' },
    { id: 'onRent', label: t('equipment.stats.onRent'), value: totals.onRent, icon: Truck, tone: { card: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-600', arrow: 'bg-orange-100 text-orange-600' }, sectionId: 'equipmentAssignments' },
    { id: 'forSale', label: t('equipment.stats.forSale'), value: totals.forSale, icon: ShoppingCart, tone: { card: 'border-teal-200 bg-teal-50', chip: 'bg-teal-100 text-teal-700', arrow: 'bg-teal-100 text-teal-700' }, sectionId: 'equipmentInventory' },
    { id: 'pending', label: t('equipment.stats.pending'), value: totals.pending, icon: ClipboardList, tone: { card: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-700', arrow: 'bg-amber-100 text-amber-700' }, sectionId: 'incomingRequests' },
    { id: 'activeRentals', label: t('equipment.stats.activeRentals'), value: totals.activeRentals, icon: Wrench, tone: { card: 'border-purple-200 bg-purple-50', chip: 'bg-purple-100 text-purple-700', arrow: 'bg-purple-100 text-purple-700' }, sectionId: 'equipmentAssignments' },
    { id: 'completedRentals', label: t('equipment.stats.completedRentals'), value: totals.completedRentals, icon: Undo2, tone: { card: 'border-sky-200 bg-sky-50', chip: 'bg-sky-100 text-sky-700', arrow: 'bg-sky-100 text-sky-700' }, sectionId: 'equipmentAssignments' },
    { id: 'completedSales', label: t('equipment.stats.completedSales'), value: totals.completedSales, icon: Package, tone: { card: 'border-rose-200 bg-rose-50', chip: 'bg-rose-100 text-rose-700', arrow: 'bg-rose-100 text-rose-700' }, sectionId: 'equipmentAssignments' },
  ]
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect?.(item.sectionId)}
          className={`group flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-start shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${item.tone.card}`}
        >
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${item.tone.chip}`}>
            <item.icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-graphite/65">{item.label}</span>
            <span className="block truncate font-display text-2xl font-extrabold leading-tight text-graphite">{item.value}</span>
          </span>
          <span className={`hidden h-8 w-8 shrink-0 place-items-center rounded-full transition group-hover:translate-x-0.5 sm:grid ${item.tone.arrow}`}>
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        </button>
      ))}
    </section>
  )
}

// -------------------------------------------------------------- inventory

const EMPTY_FORM = {
  name: '', category: '', brand: '', model: '', specifications: '', condition: 'NEW', mode: 'RENT', quantity_total: '',
  hourly_rate: '', daily_rate: '', weekly_rate: '', monthly_rate: '', sale_price: '', image_url: '',
}

function ItemForm({ item, onSaved, onCancel }) {
  const { t } = useLanguage()
  const editing = Boolean(item)
  const [form, setForm] = useState(() => (item ? Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, item[key] == null ? '' : String(item[key])])) : EMPTY_FORM))
  const [imagePreview, setImagePreview] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const rentMode = form.mode === 'RENT' || form.mode === 'RENT_BUY'
  const buyMode = form.mode === 'BUY' || form.mode === 'RENT_BUY'

  const uploadImage = async (file) => {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const uploaded = await uploadLocalFile(file)
      setForm((current) => ({ ...current, image_url: uploaded.url }))
      setImagePreview(uploaded.previewUrl)
    } catch (failure) {
      setError(equipmentErrorMessage(failure, t('equipment.error.imageUpload')))
    } finally {
      setUploading(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const quantity = Number(form.quantity_total)
    if (form.quantity_total === '' || !Number.isInteger(quantity) || quantity < 0) { setError(t('equipment.error.quantityZero')); return }
    const price = (value) => (value === '' ? null : Number(value))
    // Prices the chosen mode does not use are cleared, so a BUY item carries no
    // stale rental rates and a RENT item no stale sale price.
    const payload = {
      name: form.name, category: form.category, brand: form.brand, model: form.model, specifications: form.specifications,
      condition: form.condition, mode: form.mode, quantity_total: quantity, image_url: form.image_url || null,
      ...Object.fromEntries(RATE_UNITS.map((rate) => [rate.field, rentMode ? price(form[rate.field]) : null])),
      sale_price: buyMode ? price(form.sale_price) : null,
    }
    if (rentMode && !RATE_UNITS.some((rate) => payload[rate.field] != null)) { setError(t('equipment.error.needRate')); return }
    if (buyMode && payload.sale_price == null) { setError(t('equipment.error.needSalePrice')); return }
    setBusy(true)
    try {
      const saved = editing ? await updateEquipmentItem(item.id, payload) : await createEquipmentItem(payload)
      onSaved(saved, editing)
    } catch (failure) {
      setError(equipmentErrorMessage(failure, t('equipment.error.save')))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-h-[75vh] space-y-3 overflow-y-auto pe-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClass}>{t('equipment.field.name')}</span>
          <input className={inputClass} value={form.name} onChange={set('name')} maxLength={120} required placeholder={t('equipment.field.namePh')} />
        </label>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.category')}</span>
          <input className={inputClass} value={form.category} onChange={set('category')} maxLength={60} required placeholder={t('equipment.field.categoryPh')} />
        </label>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.condition')}</span>
          <select className={inputClass} value={form.condition} onChange={set('condition')}>
            {EQUIPMENT_CONDITIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.brand')}</span>
          <input className={inputClass} value={form.brand} onChange={set('brand')} maxLength={80} />
        </label>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.model')}</span>
          <input className={inputClass} value={form.model} onChange={set('model')} maxLength={80} />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>{t('equipment.field.specifications')}</span>
          <textarea className={`${inputClass} h-16 py-2`} value={form.specifications} onChange={set('specifications')} />
        </label>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.mode')}</span>
          <select className={inputClass} value={form.mode} onChange={set('mode')}>
            {EQUIPMENT_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.quantity')}</span>
          <input className={inputClass} type="number" min="0" step="1" inputMode="numeric" value={form.quantity_total} onChange={set('quantity_total')} required />
        </label>
      </div>
      {rentMode && (
        <fieldset className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-[11px] font-extrabold uppercase tracking-wide text-graphite/55">{t('equipment.field.rentalRates')}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RATE_UNITS.map((rate) => (
              <label key={rate.unit} className="block">
                <span className={labelClass}>{rate.rateLabel}</span>
                <input className={inputClass} type="number" min="0.01" step="0.01" inputMode="decimal" value={form[rate.field]} onChange={set(rate.field)} />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {buyMode && (
        <label className="block">
          <span className={labelClass}>{t('equipment.field.salePrice')}</span>
          <input className={inputClass} type="number" min="0.01" step="0.01" inputMode="decimal" value={form.sale_price} onChange={set('sale_price')} required />
        </label>
      )}
      <div className="flex items-center gap-3">
        <EquipmentImage src={imagePreview || form.image_url} className="h-16 w-16" />
        <label className="block min-w-0 flex-1">
          <span className={labelClass}>{t('equipment.field.image')}</span>
          <input type="file" accept="image/*" onChange={(event) => uploadImage(event.target.files?.[0])} className="block w-full text-xs font-semibold text-graphite/70 file:me-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-extrabold" />
          {uploading && <span className="mt-1 flex items-center gap-1 text-[11px] font-bold text-graphite/55"><Loader2 className="h-3 w-3 animate-spin" /> {t('equipment.uploading')}</span>}
        </label>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
        <button type="submit" disabled={busy || uploading} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? t('labor.action.saveChanges') : t('equipment.action.add')}
        </button>
      </div>
    </form>
  )
}

export function EquipmentInventorySection({ items, onChanged }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(null) // null | 'new' | item
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const [busyId, setBusyId] = useState(null)

  const toggleActive = async (item) => {
    setBusyId(item.id)
    setNotice({ tone: '', text: '' })
    try {
      if (item.is_active) await deactivateEquipmentItem(item.id)
      else await updateEquipmentItem(item.id, { is_active: true })
      setNotice({ tone: 'success', text: t(item.is_active ? 'labor.msg.deactivated' : 'labor.msg.activated', { name: item.name }) })
      onChanged()
    } catch (failure) {
      setNotice({ tone: 'error', text: equipmentErrorMessage(failure, t('equipment.error.update')) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <h2 className="font-display text-base font-extrabold text-graphite">{t('equipment.inventory.title')}</h2>
          <p className="text-xs font-semibold text-graphite/55">{t('equipment.inventory.subtitle')}</p>
        </div>
        <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setEditing('new') }} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1f2937] px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-brand-950">
          <Plus className="h-3.5 w-3.5" /> {t('equipment.action.add')}
        </button>
      </div>
      <Notice notice={notice} />
      {items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={item.id} className={`flex min-w-0 flex-col rounded-2xl border bg-white p-4 ${item.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-75'}`}>
              {/* Image on the left at the full height of the details beside it,
                  shown whole (object-contain); the details take the rest. */}
              <div className="flex items-stretch gap-3">
                <div className="relative min-h-[6rem] w-[42%] shrink-0">
                  <EquipmentImage src={item.image_url} className="absolute inset-0 h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-base font-extrabold text-graphite" title={item.name}>{item.name}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${item.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{item.is_active ? t('labor.active') : t('labor.inactive')}</span>
                  </div>
                  <p className="truncate text-xs font-semibold text-graphite/60">{item.category}{[item.brand, item.model].filter(Boolean).length ? ` · ${[item.brand, item.model].filter(Boolean).join(' ')}` : ''}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-graphite/70">{conditionLabel(item.condition)}</span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-extrabold text-brand-800">{modeLabel(item.mode)}</span>
                  </div>
                  <div className="mt-2"><EquipmentPrices item={item} /></div>
                </div>
              </div>
              <dl className="mt-[13px] grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                {allowsRent(item) && <div><dt className="text-[10px] font-bold text-graphite/50">{t('equipment.inventory.availableRentToday')}</dt><dd className="font-display text-lg font-extrabold text-emerald-700">{item.available_to_rent} / {item.quantity_total}</dd></div>}
                {allowsBuy(item) && <div><dt className="text-[10px] font-bold text-graphite/50">{t('equipment.inventory.availableSell')}</dt><dd className="font-display text-lg font-extrabold text-teal-700">{item.available_to_buy} / {item.quantity_total}</dd></div>}
              </dl>
              {item.specifications && <p className="mt-2 line-clamp-2 text-xs font-semibold text-graphite/60">{item.specifications}</p>}
              <div className="mt-auto flex gap-2 pt-3">
                <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setEditing(item) }} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-extrabold text-graphite/75 hover:bg-slate-50">
                  <Pencil className="h-3.5 w-3.5" /> {t('labor.action.edit')}
                </button>
                <button type="button" disabled={busyId === item.id} onClick={() => toggleActive(item)} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-extrabold disabled:opacity-50 ${item.is_active ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-brand-700 text-white hover:bg-brand-800'}`}>
                  {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} {item.is_active ? t('labor.action.deactivate') : t('labor.action.activate')}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={Construction} title={t('equipment.inventory.emptyTitle')} message={t('equipment.inventory.emptyMessage')} />
      )}
      {editing && (
        <Dialog title={editing === 'new' ? t('equipment.action.add') : t('labor.services.editTitle', { name: editing.name })} onClose={() => setEditing(null)}>
          <ItemForm
            item={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(saved, wasEdit) => {
              setEditing(null)
              setNotice({ tone: 'success', text: t(wasEdit ? 'labor.msg.updated' : 'labor.msg.added', { name: saved.name }) })
              onChanged()
            }}
          />
        </Dialog>
      )}
    </section>
  )
}

// --------------------------------------------------------------- requests

/** What was asked, from the request itself (unit_price is its snapshot). */
export function EquipmentRequestFacts({ request }) {
  const { t } = useLanguage()
  const money = useMoney()
  const rent = request.request_kind === 'RENT'
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
      <div><dt className="font-bold text-graphite/50">{t('equipment.field.equipment')}</dt><dd className="truncate font-extrabold text-graphite">{request.item_name}</dd></div>
      <div><dt className="font-bold text-graphite/50">{t('equipment.field.requestType')}</dt><dd className="font-extrabold text-graphite">{kindLabel(request.request_kind)}</dd></div>
      <div><dt className="font-bold text-graphite/50">{t('equipment.field.quantity')}</dt><dd className="font-extrabold text-graphite">{request.quantity}</dd></div>
      {rent ? (
        <>
          <div><dt className="font-bold text-graphite/50">{t('equipment.field.rentalPeriod')}</dt><dd className="font-extrabold text-graphite">{formatDate(request.start_date)} – {formatDate(request.end_date)}</dd></div>
          <div><dt className="font-bold text-graphite/50">{t('equipment.field.rate')}</dt><dd className="font-extrabold text-graphite">{money(request.unit_price)} / {ratePer(request.rate_unit)}</dd></div>
        </>
      ) : (
        <div><dt className="font-bold text-graphite/50">{t('equipment.field.salePrice')}</dt><dd className="font-extrabold text-graphite">{money(request.unit_price)}</dd></div>
      )}
    </dl>
  )
}

function AcceptDialog({ request, onClose, onDone }) {
  const { t } = useLanguage()
  const money = useMoney()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rent = request.request_kind === 'RENT'
  const total = Number(request.unit_price || 0) * Number(request.quantity || 0)
  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      await acceptEquipmentRequest(request.id)
      onDone({ tone: 'success', text: t(rent ? 'equipment.msg.rentalAccepted' : 'equipment.msg.purchaseAccepted', { count: request.quantity, name: request.item_name }) })
    } catch (failure) {
      // Shown as sent (e.g. not enough units free); never retried.
      setError(equipmentErrorMessage(failure, t('labor.error.accept')))
      setBusy(false)
    }
  }
  return (
    <Dialog title={rent ? t('equipment.requests.acceptRentalTitle') : t('equipment.requests.acceptPurchaseTitle')} onClose={onClose}>
      <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-3 text-xs">
          <div className="col-span-2"><dt className="font-bold text-graphite/50">{t('equipment.field.equipment')}</dt><dd className="font-extrabold text-graphite">{request.item_name}</dd></div>
          <div><dt className="font-bold text-graphite/50">{t('equipment.field.quantity')}</dt><dd className="font-extrabold text-graphite">{request.quantity}</dd></div>
          {rent ? (
            <>
              <div><dt className="font-bold text-graphite/50">{t('equipment.field.rate')}</dt><dd className="font-extrabold text-graphite">{money(request.unit_price)} / {ratePer(request.rate_unit)}</dd></div>
              <div className="col-span-2"><dt className="font-bold text-graphite/50">{t('equipment.field.rentalPeriod')}</dt><dd className="font-extrabold text-graphite">{formatDate(request.start_date)} – {formatDate(request.end_date)}</dd></div>
              <div className="col-span-2"><dt className="font-bold text-graphite/50">{t('equipment.field.forAllUnits')}</dt><dd className="font-extrabold text-graphite">{money(total)} / {ratePer(request.rate_unit)}</dd></div>
            </>
          ) : (
            <>
              <div><dt className="font-bold text-graphite/50">{t('equipment.field.salePrice')}</dt><dd className="font-extrabold text-graphite">{money(request.unit_price)}</dd></div>
              <div className="col-span-2"><dt className="font-bold text-graphite/50">{t('equipment.field.total')}</dt><dd className="font-extrabold text-graphite">{money(total)}</dd></div>
            </>
          )}
        </dl>
        <p className="text-[11px] font-semibold text-graphite/55">{rent ? t('equipment.requests.acceptRentalHint') : t('equipment.requests.acceptPurchaseHint')}</p>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="button" disabled={busy} onClick={accept} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t('labor.action.accept')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

function RejectDialog({ request, onClose, onDone }) {
  const { t } = useLanguage()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await rejectEquipmentRequest(request.id, note)
      onDone({ tone: 'success', text: t('equipment.msg.rejected', { name: request.item_name }) })
    } catch (failure) {
      setError(equipmentErrorMessage(failure, t('labor.error.reject')))
      setBusy(false)
    }
  }
  return (
    <Dialog title={t('equipment.requests.rejectTitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs font-semibold text-graphite/65">{request.project_title} · {kindLabel(request.request_kind)} {request.quantity} x {request.item_name}</p>
        <label className="block">
          <span className={labelClass}>{t('labor.field.reasonOptional')}</span>
          <textarea className={`${inputClass} h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} {t('labor.action.reject')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function EquipmentRequestsSection({ requests, onChanged, compact = false }) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState('PENDING')
  const [accepting, setAccepting] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const visible = compact
    ? requests.filter((request) => request.status === 'PENDING').slice(0, 4)
    : requests.filter((request) => filter === 'ALL' || request.status === filter)

  const finish = (result) => {
    setAccepting(null)
    setRejecting(null)
    setNotice(result)
    onChanged()
  }

  const heading = (request) => {
    const rent = request.request_kind === 'RENT'
    if (request.status === 'PENDING') return t(rent ? 'equipment.requests.newRental' : 'equipment.requests.newPurchase')
    return t(rent ? 'equipment.requests.rental' : 'equipment.requests.purchase')
  }

  return (
    <section className="space-y-3">
      {!compact && (
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
          {REQUEST_FILTERS.map((option) => {
            const count = option === 'ALL' ? requests.length : requests.filter((request) => request.status === option).length
            const isActive = filter === option
            return (
              <button key={option} type="button" onClick={() => setFilter(option)} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'}`}>
                {requestFilterLabel(option)}
                {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{count}</span>}
              </button>
            )
          })}
        </div>
      )}
      <Notice notice={notice} />
      {visible.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((request) => (
            <article key={request.id} className={`flex min-w-0 flex-col rounded-2xl border bg-white p-4 ${request.status === 'PENDING' ? 'border-oc-amber shadow-[0_0_0_3px_rgba(244,183,64,0.18)]' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-800">
                  {request.request_kind === 'RENT' ? <Truck className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                  {heading(request)}
                </p>
                <StatusBadge status={request.status} />
              </div>
              <p className="mt-2 truncate text-base font-extrabold text-graphite">{request.project_title || t('labor.project')}</p>
              <p className="text-xs font-semibold text-graphite/60">
                {t('labor.siteEngineerName', { name: request.engineer_name || '—' })}
                {request.contractor_name ? ` · ${t('labor.builderName', { name: request.contractor_name })}` : ''}
              </p>
              <EquipmentRequestFacts request={request} />
              {request.notes && <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/70">{request.notes}</p>}
              {request.decision_note && <p className="mt-2 text-[11px] font-bold text-graphite/55">{t('labor.noteLine', { note: request.decision_note })}</p>}
              {request.status === 'PENDING' && (
                <>
                  {!request.supplier_assignment_active && <p className="mt-2 text-[11px] font-bold text-amber-700">{t('labor.requests.unassigned')}</p>}
                  <div className="mt-auto flex gap-2 pt-3">
                    <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setAccepting(request) }} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-700 text-xs font-extrabold text-white hover:bg-brand-800">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('labor.action.accept')}
                    </button>
                    <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setRejecting(request) }} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-extrabold text-rose-700 hover:bg-rose-100">
                      <XCircle className="h-3.5 w-3.5" /> {t('labor.action.reject')}
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={compact || filter === 'PENDING' ? t('equipment.requests.emptyPending') : t('equipment.requests.emptyFiltered')}
          message={t('equipment.requests.emptyMessage')}
        />
      )}
      {accepting && <AcceptDialog request={accepting} onClose={() => setAccepting(null)} onDone={finish} />}
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={finish} />}
    </section>
  )
}

// ------------------------------------------------------------ assignments

export function EquipmentUsageTable({ logs }) {
  const { t } = useLanguage()
  if (!logs.length) return <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs font-semibold text-graphite/50">{t('equipment.usage.none')}</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[360px] text-start text-xs">
        <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-graphite/50">
          <tr><th className="px-3 py-2 text-start">{t('labor.field.date')}</th><th className="px-3 py-2 text-center">{t('equipment.field.hoursUsed')}</th><th className="px-3 py-2 text-start">{t('labor.field.notes')}</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-semibold text-graphite/80">
          {logs.map((log) => (
            <tr key={log.id}>
              <td className="whitespace-nowrap px-3 py-2 font-extrabold text-graphite">{formatDate(log.usage_date)}</td>
              <td className="px-3 py-2 text-center">{log.hours_used}</td>
              <td className="px-3 py-2">{log.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Re-read whenever the dashboard reloads (refreshKey), so usage the engineer
// logs shows up through the same live refresh as everything else.
export function EquipmentUsageHistory({ requestId, refreshKey }) {
  const { t } = useLanguage()
  const [state, setState] = useState({ loading: true, logs: [], error: '' })
  useEffect(() => {
    let current = true
    fetchEquipmentUsage(requestId)
      .then((logs) => { if (current) setState({ loading: false, logs, error: '' }) })
      .catch((failure) => { if (current) setState({ loading: false, logs: [], error: equipmentErrorMessage(failure, translate('equipment.error.usageLoad')) }) })
    return () => { current = false }
  }, [requestId, refreshKey])
  if (state.loading) return <p className="flex items-center gap-2 py-3 text-xs font-semibold text-graphite/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('equipment.usage.loading')}</p>
  if (state.error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{state.error}</p>
  return <EquipmentUsageTable logs={state.logs} />
}

const ASSIGNMENT_TABS = [
  { id: 'rentals', labelKey: 'equipment.tab.activeRentals', match: (request) => request.request_kind === 'RENT' && request.status === 'ACCEPTED' },
  { id: 'purchases', labelKey: 'equipment.tab.purchases', match: (request) => request.request_kind === 'BUY' && request.status === 'ACCEPTED' },
  { id: 'completed', labelKey: 'labor.tab.completed', match: (request) => request.status === 'COMPLETED' },
]

export function EquipmentAssignmentsSection({ requests, onChanged, refreshKey = 0 }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState('rentals')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const lists = useMemo(() => Object.fromEntries(ASSIGNMENT_TABS.map((item) => [item.id, requests.filter(item.match)])), [requests])
  const list = lists[tab] || []

  const complete = async (request) => {
    const rent = request.request_kind === 'RENT'
    if (!window.confirm(t(rent ? 'equipment.confirm.returned' : 'equipment.confirm.delivered', { count: request.quantity, name: request.item_name }))) return
    setBusyId(request.id)
    setNotice({ tone: '', text: '' })
    try {
      await completeEquipmentRequest(request.id)
      setNotice({ tone: 'success', text: t(rent ? 'equipment.msg.returned' : 'equipment.msg.delivered', { name: request.item_name }) })
      onChanged()
    } catch (failure) {
      setNotice({ tone: 'error', text: equipmentErrorMessage(failure, t('equipment.error.complete')) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {ASSIGNMENT_TABS.map((item) => (
          <button key={item.id} type="button" onClick={() => { setTab(item.id); setOpenId(null) }} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${tab === item.id ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'}`}>
            {t(item.labelKey)}
            {lists[item.id].length > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${tab === item.id ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{lists[item.id].length}</span>}
          </button>
        ))}
      </div>
      <Notice notice={notice} />
      {list.length ? (
        <div className="space-y-3">
          {list.map((request) => {
            const rent = request.request_kind === 'RENT'
            return (
              <article key={request.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-extrabold text-graphite">{request.project_title || t('labor.project')}</p>
                    <p className="text-xs font-semibold text-graphite/60">{t('labor.siteEngineerName', { name: request.engineer_name || '—' })}</p>
                  </div>
                  <StatusBadge status={request.status} />
                </div>
                <EquipmentRequestFacts request={request} />
                {request.status === 'COMPLETED' && request.completed_at && (
                  <p className="mt-2 text-[11px] font-bold text-sky-800">{t(rent ? 'equipment.returnedOn' : 'equipment.deliveredOn', { date: formatDate(request.completed_at) })}</p>
                )}
                {request.status === 'ACCEPTED' && !request.supplier_assignment_active && (
                  <p className="mt-2 text-[11px] font-bold text-amber-700">{t('equipment.assignments.unassignedContinues')}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {rent && (
                    <button type="button" onClick={() => setOpenId(openId === request.id ? null : request.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite/75 hover:bg-slate-50">
                      <CalendarDays className="h-3.5 w-3.5" /> {openId === request.id ? t('equipment.usage.hide') : t('equipment.usage.view')}
                    </button>
                  )}
                  {request.status === 'ACCEPTED' && (
                    <button type="button" disabled={busyId === request.id} onClick={() => complete(request)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
                      {busyId === request.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : rent ? <Undo2 className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />} {rent ? t('equipment.action.markReturned') : t('equipment.action.markDelivered')}
                    </button>
                  )}
                </div>
                {openId === request.id && <div className="mt-3"><EquipmentUsageHistory requestId={request.id} refreshKey={refreshKey} /></div>}
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={tab === 'purchases' ? ShoppingCart : Truck}
          title={t(`equipment.assignments.empty.${tab}.title`)}
          message={t(`equipment.assignments.empty.${tab}.message`)}
        />
      )}
    </section>
  )
}
