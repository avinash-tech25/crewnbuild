/**
 * Orders the supplier has received.
 *
 * One checkout arrives as several rows sharing a request code, so they are
 * grouped back into a single order here. Clicking an order opens everything
 * about it; accept, reject and fulfil still act on the individual lines,
 * because a supplier may be able to serve part of an order and not the rest.
 *
 * The orders are shown in the shared compact order list (one row per order,
 * status tabs, sort, search, Load more). Which customers to show (All, House
 * Owner, Builder) is a select beside the search, still in the address
 * (?from=owner). The open order is in the address too (?order=<code>), so
 * Back closes its dialog. An order of a single line keeps that line's
 * Accept / Reject / Fulfil on its row; a longer one is decided line by line
 * in its dialog, as before.
 */
import useUrlState from '../../../shared/hooks/useUrlState.js'
import useUrlDialog from '../../../shared/hooks/useUrlDialog.js'
import { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import OrderDetailCard from '../../shop/components/OrderDetailCard.jsx'
import OrderList from '../../../shared/ui/OrderList.jsx'
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

// An order's code (a random hex value, or row-<uuid> for a line without one): never a name.
export const isOrderCode = (value) => /^[0-9a-z-]{8,64}$/i.test(String(value ?? ''))

export default function SupplierMaterialRequests({ onInventoryChanged, searchQuery = '' }) {
  const { t, td } = useLanguage()
  // The signed-in supplier's own name, for the invoice header.
  const supplierName = useSelector((state) => state.auth.user?.name) || ''
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [openCode, showOrder, closeOrder] = useUrlDialog('order', isOrderCode)

  const refresh = () => fetchSupplierMaterialRequests().then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  useEffect(() => { refresh() }, [])

  const { requireCompleteProfile } = useProfileGate()

  // Accepting or fulfilling an order needs a complete profile; rejecting does not.
  const respond = async (id, action) => {
    if (action !== 'REJECT' && requireCompleteProfile('respondMaterialRequest', { id, action })) return
    try {
      await respondMaterialRequest(id, action)
      setMessage(action === 'FULFILL' ? t('dash.supplier.material.fulfilled') : action === 'ACCEPT' ? t('dash.supplier.material.accepted') : t('dash.supplier.material.rejected'))
      refresh()
      if (openCode) closeOrder()
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
  // All / House Owner / Builder, in the address (?from=owner).
  const [activeTab, setActiveTab] = useUrlState('from', 'all', ['all', 'owner', 'builder'])
  const visibleOrders = activeTab === 'owner' ? ownerOrders : activeTab === 'builder' ? builderOrders : allOrders

  const orderTotal = (order) => order.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)

  const lineButtons = (item) => (
    <>
      {item.status === 'PENDING' && (
        <>
          <button type="button" onClick={() => respond(item.id, 'REJECT')} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">{t('dash.common.reject')}</button>
          <button type="button" onClick={() => respond(item.id, 'ACCEPT')} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-800">{t('dash.common.accept')}</button>
        </>
      )}
      {item.status === 'ACCEPTED' && (
        <button type="button" onClick={() => respond(item.id, 'FULFILL')} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-600">{t('dash.supplier.material.markFulfilled')}</button>
      )}
    </>
  )

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
            {lineButtons(item)}
          </div>
        </div>
      ))}
    </div>
  )

  const listRows = visibleOrders.map((order) => {
    const status = orderStatus(order.items)
    return {
      key: order.code,
      order: { ...order, status },
      number: `#${String(order.code).replace(/^row-/, '').slice(0, 8).toUpperCase()}`,
      party: order.buyer,
      project: order.project,
      date: order.placedAt,
      amount: orderTotal(order),
      status,
      searchText: [order.code, order.buyer, order.owner].filter(Boolean).join(' '),
      items: order.items.map((item) => ({ name: item.material_name, quantity: item.quantity, unit: optionLabel(t, UNIT_LABEL_KEYS, item.unit) })),
    }
  })
  const openOrder = (() => {
    const order = openCode ? orders.find((candidate) => candidate.code === openCode) : null
    return order ? { ...order, status: orderStatus(order.items) } : null
  })()

  return (
    <section className="space-y-3">
      {message && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2 text-xs font-bold text-brand-900">{message}</p>}

      <OrderList
        label={t('shop.orders')}
        orders={listRows}
        partyLabel={t('dash.supplier.requester')}
        loading={loading}
        onOpen={(row) => showOrder(row.key)}
        // A one-line order is answered right on its row; a longer one line by line in its dialog.
        actions={(row) => (row.order.items.length === 1 ? lineButtons(row.order.items[0]) : null)}
        statusPill={statusPill}
        statusLabel={(status) => statusLabel(status, t)}
        emptyTitle={t('dash.supplier.material.none')}
        searchPlaceholder={t('shop.searchOrders')}
        toolbar={(
          <label className="flex items-center gap-2 text-xs font-bold text-graphite/70">
            <span className="whitespace-nowrap">{t('shop.from')}</span>
            <select value={activeTab} onChange={(event) => setActiveTab(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-graphite focus:border-brand-400 focus:outline-none">
              <option value="all">{t('dash.contractor.filter.all')} ({allOrders.length})</option>
              <option value="owner">{t('role.owner')} ({ownerOrders.length})</option>
              <option value="builder">{t('role.contractor')} ({builderOrders.length})</option>
            </select>
          </label>
        )}
      />

      {openOrder && (
        <OrderDetailCard
          order={openOrder}
          counterpartyLabel={t('shop.orderedBy')}
          // Not passed through `td`: OrderDetailCard writes both of these into
          // the downloadable invoice, where the two parties' names identify who
          // is billing whom. A name on an invoice is not interface copy.
          counterparty={openOrder.buyer}
          invoiceFrom={supplierName}
          onClose={() => closeOrder()}
          actions={lineActions(openOrder)}
        />
      )}
    </section>
  )
}
