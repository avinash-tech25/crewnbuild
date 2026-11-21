/**
 * The Site Engineer's Equipment tab.
 *
 * Shows ONLY the Equipment Supplier(s) the Builder assigned to this engineer on
 * the selected project -- read from the existing GET /projects/{id}/suppliers --
 * never a marketplace. A request names an item; the backend takes the supplier
 * from that item and checks the assignment, so no other supplier is reachable.
 *
 * RENT: quantity + rate unit + dates; BUY: quantity. The supplier accepts or
 * rejects, then marks a rental returned or a purchase delivered. The engineer
 * cancels pending requests and logs daily hours on accepted rentals. Prices and
 * availability are always the backend's. No quotation, negotiation or payment.
 */
import useUrlState from '../../../shared/hooks/useUrlState.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Construction, History, Loader2, Send, ShoppingCart, Truck, XCircle } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import { CardAvatar, CardChip, CardGrid, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchProjectSuppliers } from '../../engineers/engineersApi.js'
import {
  allowsBuy, allowsRent, cancelEquipmentRequest, createEquipmentRequest, EQUIPMENT_SUPPLIER_CATEGORY, equipmentErrorMessage,
  fetchProjectEquipmentItems, fetchProjectEquipmentRequests, modeLabel, rentableUnits, saveEquipmentUsage,
} from '../../equipment/equipmentApi.js'
import { localIsoDate } from '../../labour/labourApi.js'
import { formatLaborDate as formatDate, LaborDialog as Dialog } from '../../labour/components/SupplierLaborSections.jsx'
import {
  conditionLabel, EquipmentCardStatus, EquipmentImage, EquipmentPrices, EquipmentRequestFacts, EquipmentUsageHistory, MoneyCountryContext, useMoney,
} from '../../equipment/components/SupplierEquipmentSections.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { SkeletonList } from '../../../shared/ui/Skeleton.jsx'

const inputClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const labelClass = 'mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-graphite/55'

const isEquipmentSupplier = (supplier) => supplier?.supplier_category === EQUIPMENT_SUPPLIER_CATEGORY

function Notice({ notice }) {
  if (!notice?.text) return null
  return <p className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
}

// ---------------------------------------------------------- request forms

function RentDialog({ projectId, supplierId, item, onClose, onSent }) {
  const { t } = useLanguage()
  const money = useMoney()
  const units = rentableUnits(item)
  const today = localIsoDate()
  const [form, setForm] = useState({ quantity: '1', rate_unit: units[0]?.unit || '', start_date: today, end_date: today, notes: '' })
  const [periodFree, setPeriodFree] = useState({ loading: false, value: item.available_to_rent })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const unit = units.find((rate) => rate.unit === form.rate_unit)

  // Availability for exactly the chosen period, from the backend.
  useEffect(() => {
    if (!form.start_date || !form.end_date || form.end_date < form.start_date) return
    let current = true
    setPeriodFree((state) => ({ ...state, loading: true }))
    fetchProjectEquipmentItems(projectId, supplierId, { start: form.start_date, end: form.end_date })
      .then((list) => {
        if (!current) return
        const match = list.find((row) => row.id === item.id)
        setPeriodFree({ loading: false, value: match ? match.available_to_rent : 0 })
      })
      .catch(() => { if (current) setPeriodFree({ loading: false, value: null }) })
    return () => { current = false }
  }, [projectId, supplierId, item.id, form.start_date, form.end_date])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const quantity = Number(form.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) { setError(t('equipment.error.quantityOne')); return }
    if (!form.rate_unit) { setError(t('equipment.error.rateUnit')); return }
    if (!form.start_date || !form.end_date) { setError(t('equipment.error.rentalDates')); return }
    if (form.end_date < form.start_date) { setError(t('labor.error.endBeforeStart')); return }
    setBusy(true)
    try {
      await createEquipmentRequest(projectId, {
        equipment_item_id: item.id, request_kind: 'RENT', quantity, rate_unit: form.rate_unit,
        start_date: form.start_date, end_date: form.end_date, notes: form.notes || null,
      })
      onSent({ tone: 'success', text: t('equipment.msg.rentalSent', { count: quantity, name: item.name }) })
    } catch (failure) {
      // e.g. the units were taken meanwhile: shown as the backend says it.
      setError(equipmentErrorMessage(failure, t('equipment.error.rentalSend')))
      setBusy(false)
    }
  }

  const availability = periodFree.loading
    ? t('equipment.availability.checking')
    : periodFree.value == null
      ? t('equipment.availability.failed')
      : t('equipment.availability.forDates', { count: periodFree.value, total: item.quantity_total })

  return (
    <Dialog title={t('equipment.engineer.requestRental')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={labelClass}>{t('equipment.field.equipment')}</span>
          <input className={`${inputClass} bg-slate-50`} value={item.name} readOnly disabled />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>{t('equipment.field.quantity')}</span>
            <input className={inputClass} type="number" min="1" step="1" inputMode="numeric" value={form.quantity} onChange={set('quantity')} required />
          </label>
          <label className="block">
            <span className={labelClass}>{t('equipment.field.rateUnit')}</span>
            {/* Only units this item has a rate for. */}
            <select className={inputClass} value={form.rate_unit} onChange={set('rate_unit')} required>
              {units.map((rate) => <option key={rate.unit} value={rate.unit}>{rate.label}</option>)}
            </select>
            {unit && <span className="mt-1 block text-[11px] font-bold text-graphite/70">{t('equipment.engineer.currentRate')} {money(item[unit.field])} / {unit.per}</span>}
          </label>
          <label className="block">
            <span className={labelClass}>{t('labor.field.startDate')}</span>
            <input className={inputClass} type="date" min={today} value={form.start_date} onChange={set('start_date')} required />
          </label>
          <label className="block">
            <span className={labelClass}>{t('labor.field.endDate')}</span>
            <input className={inputClass} type="date" min={form.start_date || today} value={form.end_date} onChange={set('end_date')} required />
          </label>
        </div>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-emerald-700">{availability}</p>
        <label className="block">
          <span className={labelClass}>{t('labor.field.notes')}</span>
          <textarea className={`${inputClass} h-16 py-2`} value={form.notes} onChange={set('notes')} />
        </label>
        <p className="text-[11px] font-semibold text-graphite/55">{t('equipment.engineer.rateFixed')}</p>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="submit" disabled={busy || !units.length} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t('equipment.engineer.sendRental')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function BuyDialog({ projectId, item, onClose, onSent }) {
  const { t } = useLanguage()
  const money = useMoney()
  const [form, setForm] = useState({ quantity: '1', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const quantity = Number(form.quantity)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!Number.isInteger(quantity) || quantity < 1) { setError(t('equipment.error.quantityOne')); return }
    setBusy(true)
    try {
      await createEquipmentRequest(projectId, { equipment_item_id: item.id, request_kind: 'BUY', quantity, notes: form.notes || null })
      onSent({ tone: 'success', text: t('equipment.msg.purchaseSent', { count: quantity, name: item.name }) })
    } catch (failure) {
      setError(equipmentErrorMessage(failure, t('equipment.error.purchaseSend')))
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('equipment.engineer.requestPurchase')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={labelClass}>{t('equipment.field.equipment')}</span>
          <input className={`${inputClass} bg-slate-50`} value={item.name} readOnly disabled />
        </label>
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
          <div><dt className="font-bold text-graphite/50">{t('equipment.field.availableQuantity')}</dt><dd className="font-extrabold text-emerald-700">{item.available_to_buy}</dd></div>
          <div><dt className="font-bold text-graphite/50">{t('equipment.field.salePrice')}</dt><dd className="font-extrabold text-graphite">{money(item.sale_price)}</dd></div>
        </dl>
        <label className="block">
          <span className={labelClass}>{t('equipment.field.quantity')}</span>
          <input className={inputClass} type="number" min="1" step="1" inputMode="numeric" value={form.quantity} onChange={set('quantity')} required />
          {Number.isInteger(quantity) && quantity > 0 && <span className="mt-1 block text-[11px] font-bold text-graphite/70">{t('equipment.engineer.totalAtPrice')} {money(quantity * Number(item.sale_price || 0))}</span>}
        </label>
        <label className="block">
          <span className={labelClass}>{t('labor.field.notes')}</span>
          <textarea className={`${inputClass} h-16 py-2`} value={form.notes} onChange={set('notes')} />
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t('equipment.engineer.sendPurchase')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------ rental usage

function RentalUsage({ request, refreshKey, onSaved }) {
  const { t } = useLanguage()
  const today = localIsoDate()
  const lastAllowed = request.end_date && request.end_date < today ? request.end_date : today
  const startsLater = request.start_date > today
  const editable = request.status === 'ACCEPTED' && !startsLater
  const [form, setForm] = useState({ usage_date: lastAllowed, hours_used: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const save = async (event) => {
    event.preventDefault()
    setNotice({ tone: '', text: '' })
    const hours = Number(form.hours_used)
    if (form.hours_used === '' || Number.isNaN(hours) || hours < 0) { setNotice({ tone: 'error', text: t('equipment.error.hours') }); return }
    setBusy(true)
    try {
      await saveEquipmentUsage(request.id, form.usage_date, { hours_used: hours, notes: form.notes || null })
      setNotice({ tone: 'success', text: t('equipment.msg.usageSaved', { date: formatDate(form.usage_date) }) })
      setForm((current) => ({ ...current, hours_used: '', notes: '' }))
      onSaved()
    } catch (failure) {
      setNotice({ tone: 'error', text: equipmentErrorMessage(failure, t('equipment.error.usageSave')) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {editable ? (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="font-display text-sm font-extrabold text-graphite">{t('equipment.usage.record')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={labelClass}>{t('equipment.field.usageDate')}</span>
              <input className={inputClass} type="date" min={request.start_date} max={lastAllowed} value={form.usage_date} onChange={set('usage_date')} required />
            </label>
            <label className="block">
              <span className={labelClass}>{t('equipment.field.hoursUsed')}</span>
              <input className={inputClass} type="number" min="0" step="0.5" inputMode="decimal" value={form.hours_used} onChange={set('hours_used')} required />
            </label>
            <label className="block">
              <span className={labelClass}>{t('labor.field.notes')}</span>
              <input className={inputClass} value={form.notes} onChange={set('notes')} />
            </label>
          </div>
          <p className="text-[11px] font-semibold text-graphite/55">{t('equipment.usage.replaceHint')}</p>
          <Notice notice={notice} />
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />} {t('equipment.usage.record')}
            </button>
          </div>
        </form>
      ) : request.status === 'ACCEPTED' && startsLater ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/60">{t('equipment.usage.fromDate', { date: formatDate(request.start_date) })}</p>
      ) : null}
      <div>
        <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">{t('equipment.usage.history')}</p>
        <EquipmentUsageHistory requestId={request.id} refreshKey={refreshKey} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- requests

// The daily usage a rental card opens is drawn full width under the card list
// (`open` / `onToggle`), where its form has room.
function RequestCard({ request, open, onToggle, onChanged, setNotice }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const rent = request.request_kind === 'RENT'

  const cancel = async () => {
    if (!window.confirm(t(rent ? 'equipment.confirm.cancelRental' : 'equipment.confirm.cancelPurchase'))) return
    setBusy(true)
    setNotice({ tone: '', text: '' })
    try {
      await cancelEquipmentRequest(request.id)
      setNotice({ tone: 'success', text: t('equipment.msg.cancelled') })
      onChanged()
    } catch (failure) {
      setNotice({ tone: 'error', text: equipmentErrorMessage(failure, t('equipment.error.cancel')) })
    } finally {
      setBusy(false)
    }
  }

  const heading = request.status === 'ACCEPTED'
    ? t(rent ? 'equipment.engineer.rentedReserved' : 'equipment.engineer.purchasedAwaiting')
    : request.status === 'COMPLETED'
      ? t(rent ? 'equipment.engineer.rentalReturned' : 'equipment.engineer.purchaseDelivered')
      : t(rent ? 'equipment.requests.rental' : 'equipment.requests.purchase')

  const cancelButton = request.status === 'PENDING' ? (
    <button type="button" disabled={busy} onClick={cancel} className={cardButtonClass('danger')}>
      <XCircle className="h-3.5 w-3.5" /> {t('labor.action.cancelRequest')}
    </button>
  ) : null
  const usageButton = rent && (request.status === 'ACCEPTED' || request.status === 'COMPLETED') ? (
    <button type="button" onClick={onToggle} aria-expanded={open} className={cardButtonClass('secondary')}>
      <CalendarDays className="h-3.5 w-3.5" /> {open ? t('equipment.usage.hide') : t('equipment.usage.label')}
    </button>
  ) : null
  const KindIcon = rent ? Truck : ShoppingCart

  return (
    <ListCard
      highlighted={request.status === 'ACCEPTED'}
      avatar={<CardAvatar fallback={<KindIcon aria-hidden="true" className="h-5 w-5" />} />}
      title={`${request.item_name} · ${request.supplier_name}`}
      subtitle={heading}
      status={<EquipmentCardStatus status={request.status} />}
      secondary={(cancelButton || usageButton) ? <>{cancelButton}{usageButton}</> : null}
      // A request with no action still draws the footer, so every card in the list
      // keeps the same shape.

    >
      {/* The request's facts (equipment, type, quantity, period / price). */}
      <EquipmentRequestFacts request={request} />
      {request.notes && <p className="line-clamp-3 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/70" title={request.notes}>{request.notes}</p>}
      {request.status === 'REJECTED' && (
        <p className="text-xs font-bold text-rose-700">{request.decision_note ? t('labor.engineer.rejectedNote', { note: request.decision_note }) : t('labor.engineer.rejected')}</p>
      )}
      {request.status === 'COMPLETED' && request.completed_at && (
        <p className="text-[11px] font-bold text-sky-800">{t(rent ? 'equipment.returnedOn' : 'equipment.deliveredOn', { date: formatDate(request.completed_at) })}</p>
      )}
      {request.status === 'ACCEPTED' && !request.supplier_assignment_active && (
        <p className="text-[11px] font-bold text-amber-700">{t(rent ? 'equipment.engineer.unassignedRental' : 'equipment.engineer.unassignedPurchase')}</p>
      )}
    </ListCard>
  )
}

// ------------------------------------------------------------------- panel

export default function EngineerEquipmentPanel({ projects = [], activeProjectId = null, onProjectChange, openSupplierOnLoad = null }) {
  const { t } = useLanguage()
  const projectId = activeProjectId ?? projects[0]?.id ?? null
  const project = projects.find((item) => item.id === projectId) || null
  const [suppliers, setSuppliers] = useState([])
  const [itemsBySupplier, setItemsBySupplier] = useState({})
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // Opened from that supplier's card on the Suppliers tab: start with its
  // equipment unfolded. A later project change folds it as before.
  const [openSupplierId, setOpenSupplierId] = useState(openSupplierOnLoad)
  const loadedProjectId = useRef(projectId)
  const [dialog, setDialog] = useState(null) // { kind: 'RENT'|'BUY', item, supplierId }
  const [notice, setNotice] = useState({ tone: '', text: '' })
  // The list shown, in the address (?list=...).
  const [tab, setTab] = useUrlState('list', 'active', ['active', 'pending', 'history'])
  const [refreshKey, setRefreshKey] = useState(0)
  // The rentals whose daily usage is open (each card's toggle).
  const [openIds, setOpenIds] = useState([])
  const toggleOpen = (id) => setOpenIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const guard = useLatestOnly()

  const load = async () => {
    if (!projectId) { setLoading(false); return }
    const isLatest = guard()
    try {
      const [assigned, equipmentRequests] = await Promise.all([fetchProjectSuppliers(projectId), fetchProjectEquipmentRequests(projectId)])
      const equipmentSuppliers = assigned.filter(isEquipmentSupplier)
      const itemLists = await Promise.all(equipmentSuppliers.map((supplier) => (
        fetchProjectEquipmentItems(projectId, supplier.user_id).catch(() => [])
      )))
      if (!isLatest()) return
      setSuppliers(equipmentSuppliers)
      setItemsBySupplier(Object.fromEntries(equipmentSuppliers.map((supplier, index) => [supplier.user_id, itemLists[index]])))
      setRequests(equipmentRequests)
      setLoadError('')
      setRefreshKey((key) => key + 1)
    } catch (failure) {
      if (isLatest()) setLoadError(equipmentErrorMessage(failure, t('equipment.error.panelLoad')))
    } finally {
      if (isLatest()) setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLoading(true)
    // Only a real project change folds it (StrictMode's repeated effect runs keep it).
    if (loadedProjectId.current !== projectId) setOpenSupplierId(null)
    loadedProjectId.current = projectId
    load()
  }, [projectId])
  // The supplier's accept/reject/return/delivery, and our own changes, arrive
  // through the existing live hint.
  useLiveRefresh(load)

  const groups = useMemo(() => ({
    active: requests.filter((request) => request.status === 'ACCEPTED'),
    pending: requests.filter((request) => request.status === 'PENDING'),
    history: requests.filter((request) => ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(request.status)),
  }), [requests])
  const tabs = [
    { id: 'active', label: t('labor.tab.active'), list: groups.active },
    { id: 'pending', label: t('labor.status.PENDING'), list: groups.pending },
    { id: 'history', label: t('labor.tab.history'), list: groups.history },
  ]
  const shown = tabs.find((item) => item.id === tab) || tabs[0]

  if (!projects.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-4"><EmptyState icon={Construction} title={t('labor.engineer.noProjectsTitle')} message={t('equipment.engineer.noProjectsMessage')} /></div>
  }

  return (
    <MoneyCountryContext.Provider value={project?.project_country || null}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="min-w-0">
            <h2 className="font-display text-base font-extrabold text-graphite">{t('equipment.engineer.title')}</h2>
            <p className="text-xs font-semibold text-graphite/55">{t('equipment.engineer.subtitle')}</p>
          </div>
          {projects.length > 1 && (
            <label className="block w-full sm:w-64">
              <span className="sr-only">{t('labor.project')}</span>
              <select className={inputClass} value={projectId ?? ''} onChange={(event) => onProjectChange?.(event.target.value || null)}>
                {projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
          )}
        </div>

        {loading ? (
          <SkeletonList rows={3} rowClassName="h-60" />
        ) : loadError ? (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{loadError}</p>
        ) : (
          <>
            {suppliers.length ? (
              <CardGrid testId="engineer-equipment-supplier-cards">
                {suppliers.map((supplier) => {
                  const items = itemsBySupplier[supplier.user_id] || []
                  const availableCount = items.filter((item) => (allowsRent(item) && item.available_to_rent > 0) || (allowsBuy(item) && item.available_to_buy > 0)).length
                  const open = openSupplierId === supplier.user_id
                  return (
                    <ListCard
                      key={supplier.user_id}
                      highlighted={open}
                      avatar={<CardAvatar fallback={<Construction aria-hidden="true" className="h-5 w-5" />} />}
                      title={supplier.store_name || supplier.name}
                      subtitle={t('equipment.engineer.assignedSupplier', { count: availableCount, total: items.length })}
                      status={<CardStatus tone="green">{t('labor.assigned')}</CardStatus>}
                      primary={(
                        <button type="button" onClick={() => setOpenSupplierId(open ? null : supplier.user_id)} aria-expanded={open} className={cardButtonClass('primary')}>
                          <Construction className="h-3.5 w-3.5" /> {open ? t('equipment.engineer.hideEquipment') : t('equipment.engineer.viewEquipment')}
                        </button>
                      )}
                    />
                  )
                })}
              </CardGrid>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <EmptyState icon={Construction} title={t('equipment.engineer.noSupplierTitle')} message={t('equipment.engineer.noSupplierMessage')} />
              </div>
            )}

            {/* The opened supplier's equipment, full width under the supplier cards. */}
            {suppliers.filter((supplier) => supplier.user_id === openSupplierId).map((supplier) => {
              const items = itemsBySupplier[supplier.user_id] || []
              return (
                <section key={supplier.user_id} aria-label={supplier.store_name || supplier.name} className="space-y-3">
                  {items.length ? (
                    <CardGrid testId="engineer-equipment-item-cards">
                      {items.map((item) => {
                        const rentButton = allowsRent(item) ? (
                          <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setDialog({ kind: 'RENT', item, supplierId: supplier.user_id }) }} className={cardButtonClass('primary')}>
                            <Truck className="h-3.5 w-3.5" /> {allowsBuy(item) ? t('equipment.mode.rent') : t('equipment.engineer.requestRental')}
                          </button>
                        ) : null
                        // Buy sits beside Rent as the second choice; on a sale-only item it is the main one.
                        const buyButton = allowsBuy(item) ? (
                          <button type="button" disabled={item.available_to_buy < 1} onClick={() => { setNotice({ tone: '', text: '' }); setDialog({ kind: 'BUY', item, supplierId: supplier.user_id }) }} className={cardButtonClass(rentButton ? 'secondary' : 'primary')}>
                            <ShoppingCart className="h-3.5 w-3.5" /> {allowsRent(item) ? t('equipment.mode.buy') : t('equipment.engineer.requestPurchase')}
                          </button>
                        ) : null
                        const makeModel = [item.brand, item.model].filter(Boolean)
                        return (
                          <ListCard
                            key={item.id}
                            avatar={<CardAvatar src={item.image_url ? imageUrl(item.image_url) : ''} alt={item.name} fallback={<Construction aria-hidden="true" className="h-5 w-5" />} />}
                            title={item.name}
                            subtitle={`${item.category}${makeModel.length ? ` · ${makeModel.join(' ')}` : ''}`}
                            chips={[
                              <CardChip key="condition">{conditionLabel(item.condition)}</CardChip>,
                              <CardChip key="mode" tone="green">{modeLabel(item.mode)}</CardChip>,
                            ]}
                            secondary={rentButton ? buyButton : null}
                            primary={rentButton || buyButton}

                          >
                            {/* The photo, shown whole at a fixed height so every tile is the same size. */}
                            <EquipmentImage src={item.image_url} className="h-14 w-full" />
                            <EquipmentPrices item={item} />
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold">
                              {allowsRent(item) && <span className="text-emerald-700">{t('equipment.engineer.toRentToday', { count: item.available_to_rent, total: item.quantity_total })}</span>}
                              {allowsBuy(item) && <span className="text-teal-700">{t('equipment.engineer.toBuy', { count: item.available_to_buy })}</span>}
                            </div>
                            {item.specifications && <p className="line-clamp-2 text-xs font-semibold text-graphite/60" title={item.specifications}>{item.specifications}</p>}
                          </ListCard>
                        )
                      })}
                    </CardGrid>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4"><EmptyState icon={Construction} title={t('equipment.engineer.noItemsTitle')} message={t('equipment.engineer.noItemsMessage')} /></div>
                  )}
                </section>
              )
            })}

            <Notice notice={notice} />

            <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
              {tabs.map((item) => {
                const isActive = shown.id === item.id
                return (
                  <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'}`}>
                    {item.id === 'history' && <History className="h-3.5 w-3.5" />}
                    {item.label}
                    {item.list.length > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{item.list.length}</span>}
                  </button>
                )
              })}
            </div>
            {shown.list.length ? (
              <div className="space-y-3">
                <CardGrid testId="engineer-equipment-request-cards">
                  {shown.list.map((request) => (
                    <RequestCard
                      key={request.id}
                      request={request}
                      open={openIds.includes(request.id)}
                      onToggle={() => toggleOpen(request.id)}
                      onChanged={load}
                      setNotice={setNotice}
                    />
                  ))}
                </CardGrid>
                {shown.list.filter((request) => openIds.includes(request.id)).map((request) => (
                  <section key={request.id} aria-label={`${request.item_name} · ${request.supplier_name}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="mb-3 truncate text-sm font-extrabold text-graphite">{request.item_name} · {request.supplier_name}</p>
                    <RentalUsage request={request} refreshKey={refreshKey} onSaved={load} />
                  </section>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <EmptyState
                  icon={Construction}
                  title={t(`equipment.engineer.empty.${shown.id}.title`)}
                  message={t(`equipment.engineer.empty.${shown.id}.message`)}
                />
              </div>
            )}
          </>
        )}

        {dialog?.kind === 'RENT' && (
          <RentDialog
            projectId={projectId}
            supplierId={dialog.supplierId}
            item={dialog.item}
            onClose={() => setDialog(null)}
            onSent={(result) => { setDialog(null); setNotice(result); setTab('pending'); load() }}
          />
        )}
        {dialog?.kind === 'BUY' && (
          <BuyDialog
            projectId={projectId}
            item={dialog.item}
            onClose={() => setDialog(null)}
            onSent={(result) => { setDialog(null); setNotice(result); setTab('pending'); load() }}
          />
        )}
      </div>
    </MoneyCountryContext.Provider>
  )
}
