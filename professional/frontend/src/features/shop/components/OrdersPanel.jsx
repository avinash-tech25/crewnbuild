/**
 * Orders placed by the House Owner or the Site Engineer.
 *
 * Buy requests are grouped by the request code they were sent under, so one
 * checkout reads as one order rather than a row per material. Partnership
 * requests stay on the Requests screen; this screen is only about materials.
 */
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, PackageSearch, RefreshCw, Search, XCircle } from 'lucide-react'
import OrderDetailCard from './OrderDetailCard.jsx'
import { fetchMyMaterialRequests } from '../materialRequestsApi.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatDate } from '../../../shared/utils/formatters.js'

const STATUS_TONES = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  FULFILLED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export const STATUS_ICONS = { PENDING: Clock, ACCEPTED: CheckCircle2, FULFILLED: CheckCircle2, REJECTED: XCircle }

// Pending covers everything still in flight; previous is the finished history.
export const TAB_STATUSES = {
  pending: ['PENDING', 'ACCEPTED'],
  previous: ['FULFILLED', 'REJECTED'],
}

// One checkout was written as several rows sharing a request code. Shared with
// the Site Engineer's orders screen, so both read an order the same way.
export function groupOrders(rows) {
  const grouped = new Map()
  rows.forEach((row) => {
    const key = row.request_code || `row-${row.id}`
    const order = grouped.get(key) || {
      code: key,
      supplierId: row.supplier_id,
      supplier: row.supplier_name,
      project: row.project_name,
      placedAt: row.created_at,
      items: [],
      total: 0,
    }
    order.items.push(row)
    order.total += Number(row.price || 0) * Number(row.quantity || 0)
    grouped.set(key, order)
  })
  return [...grouped.values()].sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)))
}

export function orderStatus(items) {
  const states = items.map((item) => item.status)
  if (states.every((state) => state === 'REJECTED')) return 'REJECTED'
  if (states.some((state) => state === 'PENDING')) return 'PENDING'
  if (states.every((state) => state === 'FULFILLED')) return 'FULFILLED'
  return 'ACCEPTED'
}

export default function OrdersPanel({ projectId } = {}) {
  const { t, td } = useLanguage()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openOrder, setOpenOrder] = useState(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('pending')
  const [status, setStatus] = useState('ALL')
  // Orders from different suppliers already carry the supplier's name; this
  // narrows the list to one of them so "my orders from X" is one click.
  const [supplierId, setSupplierId] = useState('ALL')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [sort, setSort] = useState('newest')

  const load = () => {
    setLoading(true)
    fetchMyMaterialRequests(projectId)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { setSupplierId('ALL') }, [projectId])
  useEffect(load, [projectId])

  const orders = useMemo(() => groupOrders(rows), [rows])

  // Built from the orders actually on screen, so it lists this project's
  // suppliers and nobody else's.
  const orderSuppliers = useMemo(() => {
    const seen = new Map()
    orders.forEach((order) => {
      if (order.supplierId != null && !seen.has(order.supplierId)) seen.set(order.supplierId, order.supplier)
    })
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }, [orders])

  const visibleOrders = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null

    const matching = orders.filter((order) => {
      const orderState = orderStatus(order.items)
      if (!TAB_STATUSES[tab].includes(orderState)) return false
      if (status !== 'ALL' && orderState !== status) return false
      if (supplierId !== 'ALL' && order.supplierId !== supplierId) return false
      if (from || to) {
        const placed = order.placedAt ? new Date(order.placedAt) : null
        if (!placed) return false
        if (from && placed < from) return false
        if (to && placed > to) return false
      }
      if (!needle) return true
      const haystack = [order.supplier, order.project, order.code, ...order.items.map((item) => item.material_name)]
      return haystack.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    })

    const byDate = (a, b) => String(b.placedAt).localeCompare(String(a.placedAt))
    if (sort === 'oldest') return [...matching].sort((a, b) => -byDate(a, b))
    if (sort === 'highest') return [...matching].sort((a, b) => b.total - a.total)
    if (sort === 'lowest') return [...matching].sort((a, b) => a.total - b.total)
    return [...matching].sort(byDate)
  }, [orders, tab, search, status, supplierId, fromDate, toDate, sort])

  const statusFilters = ['ALL', ...TAB_STATUSES[tab]]
  const countFor = (tabId) => orders.filter((order) => TAB_STATUSES[tabId].includes(orderStatus(order.items))).length
  const switchTab = (tabId) => { setTab(tabId); setStatus('ALL'); setSupplierId('ALL') }
  const chipClass = (active) => `h-9 shrink-0 rounded-full px-3.5 text-xs font-extrabold transition ${
    active ? 'bg-brand-700 text-white' : 'border border-slate-200 bg-white text-graphite/60 hover:border-brand-300'
  }`
  const controlClass = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-graphite outline-none transition focus:border-brand-500'

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="font-display text-lg font-extrabold text-graphite">{t('shop.orders')}</p>
          <p className="text-xs font-semibold text-graphite/50">{t('shop.ordersSubtitle')}</p>
        </div>
        <button type="button" onClick={load} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite/60 transition hover:bg-slate-50">
          <RefreshCw className="h-3.5 w-3.5" /> {t('dash.engineer.refresh')}
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {['pending', 'previous'].map((tabId) => (
          <button
            key={tabId}
            type="button"
            onClick={() => switchTab(tabId)}
            aria-pressed={tab === tabId}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${
              tab === tabId ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
            }`}
          >
            {t(tabId === 'pending' ? 'shop.pendingOrdersTab' : 'shop.previousOrdersTab')}
            <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[10px] font-extrabold ${
              tab === tabId ? 'bg-white/20 text-white' : 'bg-slate-100 text-graphite/60'
            }`}>
              {countFor(tabId)}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <label className="relative block">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-graphite/35" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('shop.searchOrders')}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white ps-10 pe-3 text-sm font-semibold text-graphite outline-none transition focus:border-brand-500"
          />
        </label>

        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
          {statusFilters.map((item) => (
            <button key={item} type="button" onClick={() => setStatus(item)} className={chipClass(status === item)}>
              {item === 'ALL' ? t('shop.allOrders') : t(`shop.status.${item.toLowerCase()}`)}
            </button>
          ))}
        </div>

        {orderSuppliers.length > 1 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
            <button type="button" onClick={() => setSupplierId('ALL')} className={chipClass(supplierId === 'ALL')}>
              {t('shop.allOrders')}
            </button>
            {orderSuppliers.map((item) => (
              <button key={item.id} type="button" onClick={() => setSupplierId(item.id)} className={chipClass(supplierId === item.id)}>
                {/* A supplier's own name or store name. */}
                {td(item.name)}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-graphite/40">
            {t('shop.from')}
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className={controlClass} />
          </label>
          <label className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide text-graphite/40">
            {t('shop.to')}
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className={controlClass} />
          </label>
          <select value={sort} onChange={(event) => setSort(event.target.value)} className={`${controlClass} ms-auto`}>
            <option value="newest">{t('shop.sortNewest')}</option>
            <option value="oldest">{t('shop.sortOldest')}</option>
            <option value="highest">{t('shop.sortHighest')}</option>
            <option value="lowest">{t('shop.sortLowest')}</option>
          </select>
          {(search || status !== 'ALL' || supplierId !== 'ALL' || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setSearch(''); setStatus('ALL'); setSupplierId('ALL'); setFromDate(''); setToDate('') }}
              className="h-10 rounded-xl border border-slate-200 px-3 text-xs font-extrabold text-graphite/60 transition hover:bg-slate-50"
            >
              {t('shop.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-graphite/50">{t('shop.loading')}</p>
      ) : !visibleOrders.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-700">
            <PackageSearch className="h-5 w-5" />
          </span>
          <p className="mt-3 font-display text-lg font-extrabold text-graphite">{orders.length ? t('shop.noMatchingOrders') : t('shop.noOrders')}</p>
          <p className="mt-1 text-sm font-medium text-graphite/55">{orders.length ? t('shop.clearFilters') : t('shop.noOrdersHint')}</p>
        </div>
      ) : (
        // The same table the Supplier's Orders screen uses, so a buyer and a
        // seller read their order history the same way. A row opens the order
        // already grouped above; nothing new is fetched or created.
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">
                <th className="px-4 py-3">{t('dash.common.date')}</th>
                <th className="px-4 py-3">{t('shop.soldBy')}</th>
                <th className="px-4 py-3">{t('dash.common.project')}</th>
                <th className="px-4 py-3">{t('dash.common.status')}</th>
                <th className="px-4 py-3 text-right">{t('shop.itemMany')}</th>
                <th className="px-4 py-3 text-right">{t('shop.estimatedTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleOrders.map((order) => {
                const status = orderStatus(order.items)
                const StatusIcon = STATUS_ICONS[status] || Clock
                return (
                  <tr
                    key={order.code}
                    onClick={() => setOpenOrder({ ...order, status })}
                    title={t('shop.orderDetails')}
                    className="cursor-pointer text-sm transition hover:bg-slate-50"
                  >
                    {/* `toLocaleDateString()` with no locale dated every order
                        in the BROWSER's language rather than the reader's. */}
                    <td className="px-4 py-3 font-extrabold text-graphite">
                      {formatDate(order.placedAt)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-graphite/60">{td(order.supplier)}</td>
                    <td className="px-4 py-3 font-semibold text-graphite/60">{td(order.project)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${STATUS_TONES[status]}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {t(`shop.status.${status.toLowerCase()}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-graphite/60">{order.items.length}</td>
                    <td className="px-4 py-3 text-right font-extrabold text-graphite">{countryFormatMoney(order.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {openOrder && (
        <OrderDetailCard
          order={openOrder}
          counterpartyLabel={t('shop.soldBy')}
          counterparty={openOrder.supplier}
          onClose={() => setOpenOrder(null)}
        />
      )}
    </section>
  )
}
