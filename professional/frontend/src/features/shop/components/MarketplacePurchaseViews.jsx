import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { apiErrorMessage } from '../../../shared/auth/accountPaths.js'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import OrderList from '../../../shared/ui/OrderList.jsx'
import useUrlDialog from '../../../shared/hooks/useUrlDialog.js'
import OrderDetailCard from './OrderDetailCard.jsx'
import {
  receivePurchaseItem, useEngineerPurchaseQuery, useEngineerPurchasesQuery,
} from '../purchaseApi.js'

const button = 'inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-graphite hover:bg-slate-200 disabled:opacity-50'
const reference = (order) => `#${order.order_number.slice(0, 8).toUpperCase()}`

function Notice({ children, error = false }) {
  return <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-rose-700' : 'text-slate-600'}`}>{children}</p>
}

const statusTone = (value) => (['SUCCESSFUL', 'ACCEPTED', 'COMPLETED', 'FULFILLED'].includes(value) ? 'bg-emerald-50 text-emerald-800'
  : ['FAILED', 'REJECTED'].includes(value) ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700')

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
