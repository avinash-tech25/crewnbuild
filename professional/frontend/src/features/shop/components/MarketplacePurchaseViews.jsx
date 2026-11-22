import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { apiErrorMessage } from '../../../shared/auth/accountPaths.js'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import OrderList from '../../../shared/ui/OrderList.jsx'
import useUrlDialog from '../../../shared/hooks/useUrlDialog.js'
import OrderDetailCard from './OrderDetailCard.jsx'
import { formatDate, formatNumber } from '../../../shared/utils/formatters.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import {
  receivePurchaseItem, useEngineerPurchaseQuery, useEngineerPurchasesQuery, useEngineerStoreQuery,
} from '../purchaseApi.js'

const card = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5'
const button = 'inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-graphite hover:bg-slate-200 disabled:opacity-50'
const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-graphite'
const reference = (order) => `#${order.order_number.slice(0, 8).toUpperCase()}`
const orderLink = (order) => `/engineer/orders?order=${encodeURIComponent(order.id)}`

function Image({ item }) {
  return item.image_url
    ? <SmartImage src={imageUrl(item.image_url)} alt={item.name} className="h-14 w-14 shrink-0 rounded-lg object-cover" />
    : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><Package className="h-5 w-5" /></span>
}

function Notice({ children, error = false }) {
  return <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-rose-700' : 'text-slate-600'}`}>{children}</p>
}

const statusTone = (value) => (['SUCCESSFUL', 'ACCEPTED', 'COMPLETED', 'FULFILLED'].includes(value) ? 'bg-emerald-50 text-emerald-800'
  : ['FAILED', 'REJECTED'].includes(value) ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700')

function Status({ value }) {
  const { t } = useLanguage()
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-bold ${statusTone(value)}`}>
      {t(`shop.purchase.state.${value}`)}
    </span>
  )
}

function Statuses({ order }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Status value={order.status} />
    </div>
  )
}

function ItemRows({ order, actions }) {
  return (
    <ul className="divide-y divide-slate-100">
      {order.items.map((item) => (
        <li key={item.line_id || item.product_id} className="flex flex-wrap items-center gap-3 py-2">
          <Image item={item} />
          <div className="min-w-0 flex-1 text-sm">
            <h4 className="font-bold text-graphite">{item.name}</h4>
            {(item.brand || item.size) && <div className="text-slate-500">{[item.brand, item.size].filter(Boolean).join(' · ')}</div>}
            <div className="text-slate-600">{formatNumber(Number(item.quantity))} {item.unit} × {formatMoney(item.price)}</div>
          </div>
          <strong className="text-sm">{formatMoney(item.line_total)}</strong>
          {actions?.(item)}
        </li>
      ))}
    </ul>
  )
}

function PurchaseSummary({ order }) {
  const { t } = useLanguage()
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display font-extrabold text-graphite">{reference(order)} · {order.supplier_name}</h3>
          <p className="text-sm text-slate-600">{order.project_name} · {formatDate(order.created_at)}</p>
        </div>
        <p className="text-sm font-extrabold">{t('shop.estimatedAmount')}: {formatMoney(order.estimated_amount)}</p>
      </div>
      <Statuses order={order} />
    </>
  )
}

function useReceive(order, onReceived) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function receive(lineId) {
    setBusy(true)
    setError('')
    try {
      await receivePurchaseItem(order.id, lineId)
      await onReceived()
    } catch (failure) {
      setError(apiErrorMessage(failure, t('shop.purchase.loadError')))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, receive }
}

function EngineerOrder({ order, onReceived }) {
  const { t, td } = useLanguage()
  const { busy, error, receive } = useReceive(order, onReceived)
  return (
    <article className={card}>
      <PurchaseSummary order={order} />
      <ItemRows order={order} actions={(item) => (
        <div className="flex flex-wrap items-center gap-2">
          <Status value={item.status} />
          {item.received_at && <span className="text-sm">{t('shop.received')}: {formatDate(item.received_at)}</span>}
          {item.status === 'FULFILLED' && !item.received_at && (
            <button type="button" className={button} disabled={busy} onClick={() => receive(item.line_id)}>
              {t('shop.markReceived')}
            </button>
          )}
        </div>
      )} />
      {error && <Notice error>{td(error)}</Notice>}
      {/* Inside the card it belongs to (it used to float between two cards). */}
      <Link className={button} to={orderLink(order)}>{t('shop.orderDetails')}</Link>
    </article>
  )
}

/** A marketplace order in the shape the shared details dialog reads. */
const dialogOrder = (order) => ({
  code: order.order_number,
  placedAt: order.created_at,
  project: order.project_name,
  status: order.status,
  items: order.items.map((item) => ({ ...item, id: item.line_id || item.product_id, material_name: item.name })),
})

/** The open order's dialog: every line, its status history, and Mark as Received. */
function EngineerOrderDialog({ order, onReceived, onClose }) {
  const { t, td } = useLanguage()
  const { busy, error, receive } = useReceive(order, onReceived)
  const receivable = order.items.filter((item) => item.status === 'FULFILLED' && !item.received_at)
  return (
    <OrderDetailCard
      order={dialogOrder(order)}
      counterpartyLabel={t('shop.soldBy')}
      counterparty={order.supplier_name}
      onClose={onClose}
      actions={(receivable.length > 0 || error) ? (
        <div className="space-y-2">
          {receivable.map((item) => (
            <div key={item.line_id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-graphite">{td(item.name)}</span>
              <button type="button" className={button} disabled={busy} onClick={() => receive(item.line_id)}>
                {t('shop.markReceived')}
              </button>
            </div>
          ))}
          {error && <Notice error>{td(error)}</Notice>}
        </div>
      ) : null}
    />
  )
}

/**
 * The Site Engineer's orders (/engineer/orders): the shared compact list, one row per order.
 * A row (or View) opens the order in the details dialog, with the order's id in the
 * address (?order=<uuid>), so Back closes it and a link opens it again.
 */
export function EngineerPurchaseOrders() {
  const { t } = useLanguage()
  const [orderId, openOrder, closeOrder] = useUrlDialog('order')
  const list = useEngineerPurchasesQuery(undefined, { refetchOnMountOrArgChange: true })
  const detail = useEngineerPurchaseQuery(orderId, { skip: !orderId, refetchOnMountOrArgChange: true })
  useLiveRefresh(list.refetch)
  const refresh = async () => { await Promise.all([list.refetch(), orderId ? detail.refetch() : null]) }
  const orders = list.data || []
  const open = orderId ? (detail.currentData || orders.find((order) => order.id === orderId) || null) : null
  const rows = orders.map((order) => ({
    key: order.id,
    id: order.id,
    number: reference(order),
    party: order.supplier_name,
    project: order.project_name,
    date: order.created_at,
    amount: order.estimated_amount,
    status: order.status,
    searchText: [order.order_number, order.supplier_name].filter(Boolean).join(' '),
    items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit })),
  }))
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-extrabold">{t('shop.orders')}</h2>
      <OrderList
        label={t('shop.orders')}
        orders={rows}
        partyLabel={t('shop.eo.supplier')}
        loading={list.isLoading}
        error={list.isError ? t('shop.purchase.loadError') : ''}
        onOpen={(row) => openOrder(row.id)}
        statusPill={statusTone}
        statusLabel={(value) => t(`shop.purchase.state.${value}`)}
        emptyTitle={t('shop.noOrders')}
        emptyHint={t('shop.noOrdersHint')}
        searchPlaceholder={t('shop.eo.searchPlaceholder')}
      />
      {open && <EngineerOrderDialog order={open} onReceived={refresh} onClose={() => closeOrder()} />}
      {orderId && !open && detail.isError && <Notice error>{t('shop.purchase.loadError')}</Notice>}
    </section>
  )
}

export function EngineerStore() {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const query = useEngineerStoreQuery(undefined, { refetchOnMountOrArgChange: true })
  const needle = search.trim().toLowerCase()
  const orders = (query.data || []).map((order) => ({
    ...order,
    items: order.items.filter((item) => [item.name, item.brand, item.size, order.supplier_name]
      .some((value) => value?.toLowerCase().includes(needle))),
  })).filter((order) => order.items.length)
  return (
    <div className="space-y-3">
      <input type="search" className={input} aria-label={t('shop.purchase.search')}
        placeholder={t('shop.purchase.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
      <EngineerStoreList query={query} orders={orders} />
    </div>
  )
}

function EngineerStoreList({ query, orders }) {
  const { t } = useLanguage()
  useLiveRefresh(query.refetch)
  if (query.isLoading) return <Notice>{t('shop.purchase.loading')}</Notice>
  if (query.isError) return <Notice error>{t('shop.purchase.loadError')}</Notice>
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-extrabold">{t('shop.store')}</h2>
      {!orders.length && <Notice>{t('shop.noOrders')}</Notice>}
      {orders.map((order) => <EngineerOrder key={order.id} order={order} onReceived={query.refetch} />)}
    </section>
  )
}
