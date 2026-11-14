/**
 * Orders the supplier has received.
 *
 * One checkout arrives as several rows sharing a request code, so they are
 * grouped back into a single order here. Clicking an order opens everything
 * about it; accept, reject and fulfil still act on the individual lines,
 * because a supplier may be able to serve part of an order and not the rest.
 *
 * Each order is shown in the same compact table, split by source into the
 * All, House Owner and Builder tabs (All is the default view). Every cell
 * reads an existing value from the order payload; "Required By" and
 * "Priority" have no source in the current order data, so those columns
 * render "—" rather than inventing values.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { ChevronRight } from 'lucide-react'
import OrderDetailCard from '../../shop/components/OrderDetailCard.jsx'
import { fetchSupplierMaterialRequests, respondMaterialRequest } from '../../shop/materialRequestsApi.js'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { UNIT_LABEL_KEYS } from '../supplierConstants.js'
import { optionLabel } from '../../../i18n/optionKeys.js'

const statusPill = (status) => ({
  FULFILLED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED: 'bg-sky-100 text-sky-800',
  REJECTED: 'bg-rose-100 text-rose-700',
  PENDING: 'bg-brand-100 text-brand-800',
}[status] || 'bg-slate-100 text-slate-600')

// The stored status is unchanged; this only reads it back in the words a
// supplier uses. Every key already exists, so nothing new is translated.
const STATUS_LABEL_KEYS = {
  PENDING: 'ui.status.pending',
  ACCEPTED: 'ui.requests.accepted',
  FULFILLED: 'ui.status.completed',
  REJECTED: 'ui.requests.rejected',
}
const statusLabel = (status, t) => (STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status)

function orderStatus(items) {
  const states = items.map((item) => item.status)
  if (states.every((state) => state === 'REJECTED')) return 'REJECTED'
  if (states.some((state) => state === 'PENDING')) return 'PENDING'
  if (states.every((state) => state === 'FULFILLED')) return 'FULFILLED'
  return 'ACCEPTED'
}

const formatDate = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${String(date.getFullYear()).slice(-2)}`
}

export default function SupplierMaterialRequests({ onInventoryChanged, searchQuery = '' }) {
  const { t, td } = useLanguage()
  // The signed-in supplier's own name, for the invoice header.
  const supplierName = useSelector((state) => state.auth.user?.name) || ''
  const [rows, setRows] = useState([])
  const [message, setMessage] = useState('')
  const [openOrder, setOpenOrder] = useState(null)

  const refresh = () => fetchSupplierMaterialRequests().then(setRows).catch(() => setRows([]))
  useEffect(() => { refresh() }, [])

  const { requireCompleteProfile } = useProfileGate()

  // Accepting or fulfilling an order needs a complete profile; rejecting does not.
  const respond = async (id, action) => {
    if (action !== 'REJECT' && requireCompleteProfile('respondMaterialRequest', { id, action })) return
    try {
      await respondMaterialRequest(id, action)
      setMessage(action === 'FULFILL' ? t('dash.supplier.material.fulfilled') : action === 'ACCEPT' ? t('dash.supplier.material.accepted') : t('dash.supplier.material.rejected'))
      refresh()
      setOpenOrder(null)
      if (action === 'FULFILL') onInventoryChanged?.()
    } catch (error) {
      setMessage(error.response?.data?.detail || t('dash.supplier.material.unable'))
    }
  }

  useResumeGatedAction({
    respondMaterialRequest: ({ id, action }) => id && respond(id, action),
  })

  const orders = useMemo(() => {
    const grouped = new Map()
    rows.forEach((row) => {
      const key = row.request_code || `row-${row.id}`
      const order = grouped.get(key) || {
        code: key,
        buyer: row.engineer_name,
        // Which side of the business the order came from. A House Owner buys
        // for their own project; every other buyer is a Site Engineer ordering
        // for the builder's project they are assigned to.
        buyerRole: row.engineer_role || '',
        project: row.project_name,
        projectId: row.project_id,
        owner: row.owner_name || '',
        placedAt: row.created_at,
        items: [],
      }
      order.items.push(row)
      grouped.set(key, order)
    })
    return [...grouped.values()].sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)))
  }, [rows])

  // Two customer types, counted from the orders themselves so the supplier can
  // see at a glance where their business is. Newest-first ordering and the
  // one-order-per-checkout grouping above are untouched. The topbar search
  // narrows both lists against the buyer, project and materials an order shows.
  const orderMatchesSearch = (order) => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return true
    return [order.buyer, order.project, order.owner, ...order.items.map((item) => item.material_name)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query))
  }
  // All is the default view — every order, from both House Owner and Builder
  // customers — and the user can switch between All, House Owner or Builder
  // at any time.
  const allOrders = useMemo(() => orders.filter(orderMatchesSearch), [orders, searchQuery])
  const ownerOrders = useMemo(() => orders.filter((order) => order.buyerRole === 'OWNER' && orderMatchesSearch(order)), [orders, searchQuery])
  const builderOrders = useMemo(() => orders.filter((order) => order.buyerRole !== 'OWNER' && orderMatchesSearch(order)), [orders, searchQuery])
  const tabs = [
    { id: 'all', label: t('dash.contractor.filter.all'), count: allOrders.length },
    { id: 'owner', label: t('role.owner'), count: ownerOrders.length },
    { id: 'builder', label: t('role.contractor'), count: builderOrders.length },
  ]
  const [activeTab, setActiveTab] = useState('all')
  const visibleOrders = activeTab === 'owner' ? ownerOrders : activeTab === 'builder' ? builderOrders : allOrders

  const orderTotal = (order) => order.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)

  const materialSummary = (order) => {
    const names = [...new Set(order.items.map((item) => item.material_name).filter(Boolean))]
    return names.slice(0, 3).map(td).join(', ') + (names.length > 3 ? '…' : '')
  }

  const lineActions = (order) => (
    <div className="space-y-2">
      {order.items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
          {/* One line per value instead of one concatenated string, so the
              product, how much, at what rate and for how much all read
              separately. Same fields, same order row. */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-extrabold text-graphite">{td(item.material_name)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-semibold text-graphite/50">
              <span>{t('shop.quantity')}: <b className="font-extrabold text-graphite/80">{item.quantity} {optionLabel(t, UNIT_LABEL_KEYS, item.unit)}</b></span>
              <span>{t('se.rate')}: <b className="font-extrabold text-graphite/80">{countryFormatMoney(item.price)}/{optionLabel(t, UNIT_LABEL_KEYS, item.unit)}</b></span>
              <span>{t('dash.contractor.amount')}: <b className="font-extrabold text-graphite/80">{countryFormatMoney(Number(item.price || 0) * Number(item.quantity || 0))}</b></span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusPill(item.status)}`}>{statusLabel(item.status, t)}</span>
            {item.status === 'PENDING' && (
              <>
                <button type="button" onClick={() => respond(item.id, 'REJECT')} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">{t('dash.common.reject')}</button>
                <button type="button" onClick={() => respond(item.id, 'ACCEPT')} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-800">{t('dash.common.accept')}</button>
              </>
            )}
            {item.status === 'ACCEPTED' && (
              <button type="button" onClick={() => respond(item.id, 'FULFILL')} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-600">{t('dash.supplier.material.markFulfilled')}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  const renderTable = () => (visibleOrders.length ? (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1000px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">
            <th className="px-4 py-3">{t('dash.supplier.requester')}</th>
            <th className="px-4 py-3">{t('dash.common.project')}</th>
            <th className="px-4 py-3">{t('dash.supplier.requestedItems')}</th>
            <th className="px-4 py-3">{t('dash.supplier.requestDate')}</th>
            <th className="px-4 py-3">{t('dash.supplier.requiredBy')}</th>
            <th className="px-4 py-3">{t('dash.common.status')}</th>
            <th className="px-4 py-3">{t('dash.supplier.priority')}</th>
            <th className="px-4 py-3 text-right">{t('dash.supplier.estimatedCost')}</th>
            <th className="px-4 py-3 text-right">{t('dash.common.action')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visibleOrders.map((order) => {
            const status = orderStatus(order.items)
            return (
              <tr
                key={order.code}
                title={t('shop.orderDetails')}
                onClick={() => setOpenOrder({ ...order, status })}
                className="cursor-pointer text-sm transition hover:bg-slate-50"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-[10px] font-extrabold text-brand-700">
                      {(order.buyer || 'R').slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-graphite">{td(order.buyer) || '—'}</p>
                      <p className="truncate text-[11px] font-semibold text-graphite/50">
                        {order.buyerRole === 'OWNER' ? t('role.owner') : t('role.builder')}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-semibold text-graphite/70">{td(order.project) || '—'}</td>
                <td className="px-4 py-3">
                  {/* One line is "1 item", not "1 items" — the plural key was
                      used for every count. */}
                  <p className="font-extrabold text-graphite">{order.items.length} {order.items.length === 1 ? t('shop.itemOne') : t('shop.itemMany')}</p>
                  <p className="max-w-[220px] truncate text-[11px] font-semibold text-graphite/50">{materialSummary(order)}</p>
                </td>
                <td className="px-4 py-3 font-semibold text-graphite/60">{formatDate(order.placedAt)}</td>
                {/* No required-by field exists in the order data yet. */}
                <td className="px-4 py-3 font-semibold text-graphite/35">—</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${statusPill(status)}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    {statusLabel(status, t)}
                  </span>
                </td>
                {/* No priority field exists in the order data yet. */}
                <td className="px-4 py-3 font-semibold text-graphite/35">—</td>
                <td className="px-4 py-3 text-right font-extrabold text-graphite">{countryFormatMoney(orderTotal(order))}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenOrder({ ...order, status })}
                    className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-extrabold text-brand-700 transition hover:border-brand-300 hover:bg-brand-50"
                  >
                    {t('dash.supplier.viewDetails')}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-medium text-graphite/55">
      {t('dash.supplier.material.none')}
    </p>
  ))

  return (
    <section className="space-y-3">
      {message && <p className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs font-bold text-brand-900">{message}</p>}

      {/* Customer type tabs — same strip the Find Clients section already uses. */}
      <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${
                isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              {tab.label}
              {tab.count > 0 && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{tab.count}</span>}
            </button>
          )
        })}
      </div>

      {renderTable()}

      {openOrder && (
        <OrderDetailCard
          order={openOrder}
          counterpartyLabel={t('shop.orderedBy')}
          // Not passed through `td`: OrderDetailCard writes both of these into
          // the downloadable invoice, where the two parties' names identify who
          // is billing whom. A name on an invoice is not interface copy.
          counterparty={openOrder.buyer}
          invoiceFrom={supplierName}
          onClose={() => setOpenOrder(null)}
          actions={lineActions(openOrder)}
        />
      )}
    </section>
  )
}
