/**
 * The Site Engineer's Orders screen (Suppliers > Orders).
 *
 * Same data and behaviour as the shared OrdersPanel -- the same
 * /material-requests/mine feed, grouped by request code into one order per
 * checkout, the same Pending / Previous split and the same order detail card --
 * laid out as the Orders reference design: Pending / Previous tabs, a
 * filter card and an orders table. Nothing new is fetched or saved.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpDown, ChevronDown, Clock, Eye, FileText, Filter, MapPin,
  Package, PackageSearch, RefreshCw, Search,
} from 'lucide-react'
import OrderDetailCard from '../../shop/components/OrderDetailCard.jsx'
import { STATUS_ICONS, TAB_STATUSES, groupOrders, orderStatus } from '../../shop/components/OrdersPanel.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { fetchMyMaterialRequests } from '../../shop/materialRequestsApi.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { formatDate, formatNumber, formatTime } from '../../../shared/utils/formatters.js'
import { SUPPLIER_CATEGORY_KEYS, optionLabel } from '../../../i18n/optionKeys.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'

const STATUS_PILLS = {
  PENDING: 'bg-amber-100/80 text-amber-700',
  ACCEPTED: 'bg-sky-100/80 text-sky-700',
  FULFILLED: 'bg-emerald-100/80 text-emerald-700',
  REJECTED: 'bg-rose-100/80 text-rose-700',
}

const EMPTY_FILTERS = { status: 'ALL', fromDate: '', toDate: '', category: 'ALL', supplierId: 'ALL', projectId: 'ALL' }

// The order reference the supplier's notification already quotes ("#1A2B3C4D").
const displayCode = (code) => `#${String(code || '').replace(/^row-/, '').slice(0, 8).toUpperCase()}`

const fieldLabel = 'mb-1 block text-xs font-semibold text-graphite/60'
const selectShell = 'relative block'
const inputClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-graphite outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100'
const selectClass = 'h-10 w-full appearance-none truncate rounded-lg border border-slate-200 bg-white pe-8 ps-3 text-[13px] font-semibold text-graphite outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100'

function SelectField({ label, value, onChange, children }) {
  return (
    <label className="block min-w-0">
      <span className={fieldLabel}>{label}</span>
      <span className={selectShell}>
        <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite/50" />
      </span>
    </label>
  )
}

export default function EngineerOrdersPanel({ projectId }) {
  const { t, td } = useLanguage()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openOrder, setOpenOrder] = useState(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('pending')
  const [sort, setSort] = useState('newest')
  // The filter row is edited as a draft and takes effect on Apply Filters.
  const [draft, setDraft] = useState(EMPTY_FILTERS)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // Latest load wins: a live refresh can overlap a load already in flight.
  const loadGuard = useLatestOnly()
  const load = ({ quiet = false } = {}) => {
    const isLatest = loadGuard()
    if (!quiet) setLoading(true)
    fetchMyMaterialRequests(projectId)
      .then((data) => { if (isLatest()) setRows(Array.isArray(data) ? data : []) })
      .catch(() => { if (isLatest() && !quiet) setRows([]) })
      .finally(() => { if (isLatest()) setLoading(false) })
  }

  useEffect(() => {
    setDraft((current) => ({ ...current, supplierId: 'ALL', projectId: 'ALL' }))
    setFilters((current) => ({ ...current, supplierId: 'ALL', projectId: 'ALL' }))
  }, [projectId])
  useEffect(() => { load() }, [projectId])
  // The supplier accepting, rejecting or fulfilling an order sends this
  // engineer a live hint; reload quietly so the list does not flash.
  useLiveRefresh(() => load({ quiet: true }))

  const orders = useMemo(() => groupOrders(rows).map((order) => ({
    ...order,
    projectId: order.items[0]?.project_id ?? null,
    city: order.items[0]?.project_city || order.items[0]?.project_pincode || '',
  })), [rows])
  // An open order's details follow the reloaded rows, so a live status change
  // shows in the open card too.
  const shownOrder = useMemo(() => {
    if (!openOrder) return null
    const fresh = orders.find((order) => order.code === openOrder.code)
    return fresh ? { ...fresh, status: orderStatus(fresh.items) } : openOrder
  }, [openOrder, orders])

  // Every dropdown lists only what the orders on screen actually carry.
  const options = useMemo(() => {
    const suppliers = new Map()
    const projects = new Map()
    const categories = new Set()
    orders.forEach((order) => {
      if (order.supplierId != null && !suppliers.has(order.supplierId)) suppliers.set(order.supplierId, order.supplier)
      if (order.projectId != null && !projects.has(order.projectId)) projects.set(order.projectId, order.project)
      order.items.forEach((item) => { if (item.category) categories.add(item.category) })
    })
    const byName = (a, b) => String(a.name).localeCompare(String(b.name))
    return {
      suppliers: [...suppliers].map(([id, name]) => ({ id, name })).sort(byName),
      projects: [...projects].map(([id, name]) => ({ id, name })).sort(byName),
      categories: [...categories].sort(),
    }
  }, [orders])

  const categoryLabel = (value) => {
    const label = optionLabel(t, SUPPLIER_CATEGORY_KEYS, value)
    return label === value ? td(value) : label
  }

  const visibleOrders = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const from = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`) : null
    const to = filters.toDate ? new Date(`${filters.toDate}T23:59:59`) : null

    const matching = orders.filter((order) => {
      const state = orderStatus(order.items)
      if (!TAB_STATUSES[tab].includes(state)) return false
      if (filters.status !== 'ALL' && state !== filters.status) return false
      if (filters.supplierId !== 'ALL' && String(order.supplierId) !== filters.supplierId) return false
      if (filters.projectId !== 'ALL' && String(order.projectId) !== filters.projectId) return false
      if (filters.category !== 'ALL' && !order.items.some((item) => item.category === filters.category)) return false
      if (from || to) {
        const placed = order.placedAt ? new Date(order.placedAt) : null
        if (!placed) return false
        if (from && placed < from) return false
        if (to && placed > to) return false
      }
      if (!needle) return true
      const haystack = [
        order.supplier, order.project, order.code, displayCode(order.code),
        ...order.items.flatMap((item) => [item.material_name, item.brand]),
      ]
      return haystack.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    })

    const byDate = (a, b) => String(b.placedAt).localeCompare(String(a.placedAt))
    if (sort === 'oldest') return [...matching].sort((a, b) => -byDate(a, b))
    if (sort === 'highest') return [...matching].sort((a, b) => b.total - a.total)
    if (sort === 'lowest') return [...matching].sort((a, b) => a.total - b.total)
    return [...matching].sort(byDate)
  }, [orders, tab, search, filters, sort])

  const countFor = (tabId) => orders.filter((order) => TAB_STATUSES[tabId].includes(orderStatus(order.items))).length
  const switchTab = (tabId) => {
    setTab(tabId)
    setDraft((current) => ({ ...current, status: 'ALL', supplierId: 'ALL' }))
    setFilters((current) => ({ ...current, status: 'ALL', supplierId: 'ALL' }))
  }
  const setDraftField = (field) => (value) => setDraft((current) => ({ ...current, [field]: value }))
  const clearAll = () => { setSearch(''); setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS) }
  const reverseSort = () => setSort((current) => ({ newest: 'oldest', oldest: 'newest', highest: 'lowest', lowest: 'highest' })[current])
  const openDetails = (order) => setOpenOrder({ ...order, status: orderStatus(order.items) })
  const tabs = [
    { id: 'pending', label: t('shop.eo.pendingTab'), icon: Clock, count: countFor('pending') },
    { id: 'previous', label: t('shop.eo.previousTab'), icon: FileText, count: countFor('previous') },
  ]

  return (
    // One white page: the tabs, filters and table are bands of a single card,
    // which the Suppliers hub joins to its tab bar above.
    <section className="rounded-2xl border border-slate-200 bg-white shadow-[0_14px_40px_-34px_rgba(15,23,42,0.35)]">
      {/* Pending / Previous */}
      <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4">
        {tabs.map((item) => {
          const active = item.id === tab
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => switchTab(item.id)}
              className={`relative inline-flex h-12 shrink-0 items-center gap-2 px-4 text-sm font-bold transition ${
                active ? 'text-brand-800' : 'text-graphite/65 hover:text-graphite'
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? 'text-brand-700' : 'text-graphite/55'}`} />
              {item.label}
              <span className={`grid h-5 min-w-5 place-items-center rounded-md px-1.5 text-[11px] font-extrabold ${
                active ? 'bg-brand-700 text-white' : 'bg-slate-100 text-graphite/60'
              }`}>
                {formatNumber(item.count)}
              </span>
              {active && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-brand-700" />}
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite/45" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('shop.eo.searchPlaceholder')}
              className={`${inputClass} ps-9 font-medium placeholder:text-graphite/45`}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFilters(draft)}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-brand-800 px-4 text-[13px] font-bold text-white shadow-sm transition hover:bg-brand-900 sm:flex-none"
            >
              <Filter className="h-4 w-4" /> {t('shop.eo.applyFilters')}
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="h-10 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-graphite/70 transition hover:bg-slate-50"
            >
              {t('shop.eo.clear')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SelectField label={t('shop.eo.orderStatus')} value={draft.status} onChange={setDraftField('status')}>
            <option value="ALL">{t('shop.eo.all')}</option>
            {TAB_STATUSES[tab].map((item) => <option key={item} value={item}>{t(`shop.status.${item.toLowerCase()}`)}</option>)}
          </SelectField>

          <label className="block min-w-0">
            <span className={fieldLabel}>{t('shop.eo.orderDate')} · {t('shop.from')}</span>
            <input
              type="date"
              value={draft.fromDate}
              max={draft.toDate || undefined}
              onChange={(event) => setDraftField('fromDate')(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block min-w-0">
            <span className={fieldLabel}>{t('shop.eo.orderDate')} · {t('shop.to')}</span>
            <input
              type="date"
              value={draft.toDate}
              min={draft.fromDate || undefined}
              onChange={(event) => setDraftField('toDate')(event.target.value)}
              className={inputClass}
            />
          </label>

          <SelectField label={t('shop.eo.productCategory')} value={draft.category} onChange={setDraftField('category')}>
            <option value="ALL">{t('shop.eo.all')}</option>
            {options.categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
          </SelectField>

          <SelectField label={t('shop.eo.supplier')} value={draft.supplierId} onChange={setDraftField('supplierId')}>
            <option value="ALL">{t('shop.eo.all')}</option>
            {options.suppliers.map((item) => <option key={item.id} value={String(item.id)}>{td(item.name)}</option>)}
          </SelectField>

          <SelectField label={t('dash.common.project')} value={draft.projectId} onChange={setDraftField('projectId')}>
            <option value="ALL">{t('shop.eo.all')}</option>
            {options.projects.map((item) => <option key={item.id} value={String(item.id)}>{td(item.name)}</option>)}
          </SelectField>
        </div>
      </div>

      {/* Orders table */}
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-[13px] font-medium text-graphite/70">
            {t(tab === 'pending' ? 'shop.eo.showingPending' : 'shop.eo.showingPrevious', {
              from: formatNumber(visibleOrders.length ? 1 : 0),
              to: formatNumber(visibleOrders.length),
              total: formatNumber(visibleOrders.length),
            })}
          </p>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[13px] font-medium text-graphite/60">{t('shop.eo.sortBy')}</span>
            <span className={selectShell}>
              <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 appearance-none rounded-lg border border-slate-200 bg-white pe-8 ps-3 text-[13px] font-semibold text-graphite outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                <option value="newest">{t('shop.sortNewest')}</option>
                <option value="oldest">{t('shop.sortOldest')}</option>
                <option value="highest">{t('shop.sortHighest')}</option>
                <option value="lowest">{t('shop.sortLowest')}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite/50" />
            </span>
            <button type="button" onClick={reverseSort} title={t('shop.eo.reverseSort')} aria-label={t('shop.eo.reverseSort')} className="grid h-9 w-9 place-items-center rounded-lg text-graphite/70 transition hover:bg-slate-50">
              <ArrowUpDown className="h-4 w-4" />
            </button>
            <button type="button" onClick={load} title={t('dash.engineer.refresh')} aria-label={t('dash.engineer.refresh')} className="grid h-9 w-9 place-items-center rounded-lg text-graphite/70 transition hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <p className="mt-3 rounded-xl bg-slate-50 p-8 text-center text-sm font-semibold text-graphite/50">{t('shop.loading')}</p>
        ) : !visibleOrders.length ? (
          <div className="mt-3 rounded-xl bg-slate-50/70 p-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
              <PackageSearch className="h-5 w-5" />
            </span>
            <p className="mt-3 font-display text-lg font-extrabold text-graphite">{orders.length ? t('shop.noMatchingOrders') : t('shop.noOrders')}</p>
            <p className="mt-1 text-sm font-medium text-graphite/55">{orders.length ? t('shop.clearFilters') : t('shop.noOrdersHint')}</p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 text-xs text-graphite/60">
                  <th className="px-3 py-2.5 font-semibold">{t('shop.eo.orderId')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('shop.eo.products')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('shop.eo.supplier')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('dash.common.project')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('shop.eo.quantity')}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t('shop.eo.amount')}</th>
                  <th className="px-3 py-2.5 font-semibold">{t('dash.common.status')}</th>
                  <th className="px-3 py-2.5 font-semibold text-right">{t('shop.eo.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleOrders.map((order) => {
                  const status = orderStatus(order.items)
                  const StatusIcon = STATUS_ICONS[status] || Clock
                  const first = order.items[0] || {}
                  const extra = order.items.length - 1
                  const detail = [first.brand, first.size].filter(Boolean).join(' ') || first.subcategory_name || (first.category ? categoryLabel(first.category) : '')
                  return (
                    <tr key={order.code} className="align-middle text-[13px] text-graphite transition hover:bg-slate-50/60">
                      {/* The order reference, with when it was placed beneath it. */}
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="block font-bold">{displayCode(order.code)}</span>
                        <span className="block text-xs text-graphite/55">{formatDate(order.placedAt)} · {formatTime(order.placedAt)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {first.image_url ? (
                            <SmartImage src={imageUrl(first.image_url)} alt={td(first.material_name)} className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 object-cover" />
                          ) : (
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-100 bg-slate-50 text-graphite/35">
                              <Package className="h-4 w-4" />
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block max-w-[11rem] truncate font-semibold" title={td(first.material_name)}>{td(first.material_name)}</span>
                            {detail && <span className="block max-w-[11rem] truncate text-xs text-graphite/55">{td(detail)}</span>}
                            {extra > 0 && <span className="block text-[11px] font-semibold text-brand-700">{t('shop.eo.moreItems', { count: formatNumber(extra) })}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="block max-w-[10rem] truncate font-semibold" title={td(order.supplier)}>{td(order.supplier)}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="block max-w-[9rem] truncate font-semibold" title={td(order.project)}>{td(order.project)}</span>
                        {order.city && (
                          <span className="mt-0.5 flex max-w-[9rem] items-center gap-1 text-xs text-graphite/55">
                            <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{td(order.city)}</span>
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {order.items.length === 1
                          ? `${formatNumber(first.quantity)} ${first.unit || ''}`.trim()
                          : `${formatNumber(order.items.length)} ${t('shop.itemMany')}`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{countryFormatMoney(order.total)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${STATUS_PILLS[status]}`}>
                          <StatusIcon className="h-3.5 w-3.5" />
                          {t(`shop.status.${status.toLowerCase()}`)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => openDetails(order)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-100/80 px-3 text-xs font-semibold text-graphite transition hover:bg-slate-200/70"
                          >
                            <Eye className="h-3.5 w-3.5" /> {t('shop.eo.view')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {shownOrder && (
        <OrderDetailCard
          order={shownOrder}
          counterpartyLabel={t('shop.soldBy')}
          counterparty={shownOrder.supplier}
          onClose={() => setOpenOrder(null)}
        />
      )}
    </section>
  )
}
