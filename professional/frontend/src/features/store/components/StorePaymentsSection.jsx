import { useState } from 'react'
import { Package, Wallet } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { checkStorePurchasePayment, recordStorePayment } from '../storeManagerApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { formatQty, money } from '../../site-work/components/EngineerAnalyticsSection.jsx'
import { PAYMENT_METHODS, purchaseLineRemaining, purchaseLineTotal, purchaseRef, transactionRef, validAmount } from '../storeHelpers.js'
import { DataTable, DetailModal, Notice, Panel, RequestId, Stat, inputClass, labelClass, pinnedEnd, primaryButton, refusalText, secondaryButton, tdClass, thClass } from './StoreUi.jsx'

// A ledger of what was paid to suppliers: payments recorded by hand (made outside
// the application), and Buy's Razorpay TEST payments, which the server verified.
function PaymentForm({ order, country, guard, onDone, onCancel }) {
  const { t, td } = useLanguage()
  const [form, setForm] = useState({ amount: String(order.balance), method: PAYMENT_METHODS[0], reference: '' })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    if (guard()) return
    if (!validAmount(form.amount)) {
      setNotice({ text: t('store.payments.amountInvalid'), error: true })
      return
    }
    setSaving(true)
    try {
      await recordStorePayment({ request_code: order.request_code, amount: form.amount, method: form.method, reference: form.reference.trim() || null })
      onDone()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <Notice message={notice} />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block"><span className={labelClass}>{t('store.payments.amount')}</span><input className={`mt-1 ${inputClass}`} inputMode="decimal" value={form.amount} onChange={update('amount')} /></label>
        <label className="block">
          <span className={labelClass}>{t('store.payments.method')}</span>
          <select className={`mt-1 ${inputClass}`} value={form.method} onChange={update('method')}>
            {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{t(`store.payments.method.${method}`)}</option>)}
          </select>
        </label>
        <label className="block"><span className={labelClass}>{t('store.payments.reference')}</span><input className={`mt-1 ${inputClass}`} maxLength={120} value={form.reference} onChange={update('reference')} /></label>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-graphite/55">{t('store.payments.balance')}: {money(order.balance, country)}</span>
        <span className="flex gap-2">
          <button type="button" onClick={onCancel} className={secondaryButton}>{t('store.cancel')}</button>
          <button type="submit" disabled={saving} className={primaryButton}>{saving ? t('dash.common.saving') : t('store.payments.record')}</button>
        </span>
      </div>
    </form>
  )
}

function PaymentStatusPill({ status }) {
  const { t } = useLanguage()
  if (!status) return null
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${status === 'FAILED' ? 'bg-rose-50 text-rose-700 ring-rose-200' : status === 'PAID' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>
      {t(`store.payments.status.${status}`)}
    </span>
  )
}

// A purchase's own state, as the server worked it out (payment_status / receipt_status).
export function OrderPill({ kind, status }) {
  const { t } = useLanguage()
  const good = status === 'PAID' || status === 'RECEIVED'
  const part = status === 'PARTLY_PAID' || status === 'PARTLY_RECEIVED'
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${good ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : part ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
      {t(`store.buy.${kind}.${status}`)}
    </span>
  )
}

// Every payment record against one purchase, with the gateway's own identifiers
// exactly as the server stored them; nothing is made up for a payment recorded by hand.
function PaymentRecords({ payments, country, highlightId, checking, onCheck }) {
  const { t, td } = useLanguage()
  if (!payments.length) return <p className="text-xs font-semibold text-graphite/55">{t('store.payments.noRecords')}</p>
  return (
    <DataTable
      minWidth="min-w-[860px]"
      head={['store.col.transactionId', 'store.payments.gatewayOrder', 'store.payments.gatewayPayment', 'store.payments.method', 'store.col.status', 'store.col.paymentDate', 'store.payments.amount'].map((key) => <th key={key} className={thClass}>{t(key)}</th>)}
    >
      {payments.map((payment) => (
        <tr key={payment.id} className={payment.id === highlightId ? 'bg-brand-50/60' : ''}>
          <td className={`${tdClass} w-[150px] min-w-[150px] text-graphite`}><RequestId value={transactionRef(payment)} /></td>
          <td className={`${tdClass} font-mono text-[11px]`}>{payment.razorpay_order_id || '—'}</td>
          <td className={`${tdClass} font-mono text-[11px]`}>{payment.razorpay_payment_id || '—'}</td>
          <td className={tdClass}>
            {t(`store.payments.method.${payment.method}`)}{payment.gateway_mode ? ` · ${payment.gateway_mode}` : ''}
            {payment.reference && <span className="block text-[11px] text-graphite/55">{t('store.payments.reference')}: {payment.reference}</span>}
          </td>
          <td className={tdClass}>
            <PaymentStatusPill status={payment.status} />
            {payment.status === 'FAILED' && payment.failure_reason && <span className="mt-0.5 block text-[11px] text-rose-700">{td(payment.failure_reason)}</span>}
            {payment.status === 'CREATED' && onCheck && (
              <button type="button" onClick={() => onCheck(payment)} disabled={checking === payment.id} className={`${secondaryButton} mt-1 !h-7 !px-2 !text-[11px]`}>{t('store.payments.check')}</button>
            )}
          </td>
          <td className={`${tdClass} min-w-[96px]`}>{formatDateTime(payment.paid_at || payment.created_at)}</td>
          <td className={`${tdClass} whitespace-nowrap font-extrabold text-graphite`}>{money(payment.amount, country)}</td>
        </tr>
      ))}
    </DataTable>
  )
}

// The supplier's side of a purchase: one status, or each one when its lines differ.
export function SupplierOrderStatus({ order }) {
  const statuses = [...new Set(order.lines.map((line) => line.status))]
  return <span className="flex flex-wrap gap-1 whitespace-nowrap">{statuses.map((status) => <StatusPill key={status} status={status} soft />)}</span>
}

// What happened to a purchase, from what was recorded: the payment (started,
// verified, failed), the order sent to the supplier, its acceptance, the supplier's
// delivery and each receipt. A step with no recorded time says so; nothing is made up.
function PurchaseTimeline({ order }) {
  const { t, td } = useLanguage()
  const events = []
  for (const payment of order.payments || []) {
    if (payment.method === 'RAZORPAY') {
      events.push({ at: payment.created_at, text: t('store.timeline2.paymentStarted', { id: transactionRef(payment) }) })
      if (payment.status === 'PAID') events.push({ at: payment.paid_at, text: t('store.timeline2.paymentVerified', { id: transactionRef(payment) }) })
      if (payment.status === 'FAILED') events.push({ at: null, text: t('store.timeline2.paymentFailed', { id: transactionRef(payment) }), tone: 'text-rose-700' })
      if (payment.status === 'CREATED') events.push({ at: null, text: t('store.timeline2.paymentOpen', { id: transactionRef(payment) }), tone: 'text-amber-700' })
    } else {
      events.push({ at: payment.created_at, text: t('store.timeline2.paymentRecorded', { id: transactionRef(payment), method: t(`store.payments.method.${payment.method}`) }) })
    }
  }
  events.push({ at: order.created_at, text: t('store.timeline2.orderSent') })
  const live = order.lines.filter((line) => line.status !== 'REJECTED')
  if (order.lines.some((line) => line.status === 'REJECTED')) events.push({ at: null, text: t('store.timeline2.rejected'), tone: 'text-rose-700' })
  if (live.some((line) => ['ACCEPTED', 'FULFILLED'].includes(line.status))) events.push({ at: null, text: t('store.timeline2.accepted'), note: t('store.timeline2.timeNotRecorded') })
  else if (live.length) events.push({ at: null, text: t('store.timeline2.awaitingAcceptance'), tone: 'text-amber-700' })
  for (const line of order.lines) {
    if (line.delivered_at) events.push({ at: line.delivered_at, text: t('store.timeline2.delivered', { name: td(line.material_name) }) })
    for (const receipt of line.receipts || []) {
      events.push({ at: receipt.received_at, text: t('store.timeline2.received', { quantity: formatQty(receipt.quantity), unit: td(line.unit), name: td(line.material_name) }) })
    }
    if (line.status !== 'REJECTED' && line.pending_quantity > 0) {
      events.push({ at: null, text: t('store.timeline2.stillToReceive', { quantity: formatQty(line.pending_quantity), unit: td(line.unit), name: td(line.material_name) }), tone: 'text-amber-700' })
    }
  }
  const timed = events.filter((event) => event.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const open = events.filter((event) => !event.at)
  return (
    <ol className="space-y-1 border-s-2 border-slate-200 ps-3 text-xs font-semibold text-graphite/75">
      {[...timed, ...open].map((event, index) => (
        <li key={index} className={event.tone || ''}>
          {event.text}
          {event.at ? ` · ${formatDateTime(event.at)}` : event.note ? ` · ${event.note}` : ''}
        </li>
      ))}
    </ol>
  )
}

// A purchase's Purchase ID (its stored code, whole) and, when opened from one, the
// application's Transaction ID: never the gateway's reference, which is shown apart.
function IdFacts({ purchase, transactionId }) {
  const { t } = useLanguage()
  return (
    <dl className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t('store.col.purchaseId')}</dt>
        <dd className="text-graphite"><RequestId value={purchaseRef(purchase)} className="!text-xs" /></dd>
      </div>
      {transactionId && (
        <div className="min-w-0">
          <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t('store.col.transactionId')}</dt>
          <dd className="text-graphite"><RequestId value={transactionId} className="!text-xs" /></dd>
        </div>
      )}
    </dl>
  )
}

// One purchase in full: every product ordered, what arrived and when, and every
// payment against it. Also opened from Buy → Purchase History.
export function PurchaseDetail({ order, country, guard, highlightId, checking, onCheck, onRecorded }) {
  const { t, td } = useLanguage()
  const [recording, setRecording] = useState(false)
  return (
    <div className="space-y-3 pb-1">
      <IdFacts purchase={order} transactionId={transactionRef((order.payments || []).find((payment) => payment.id === highlightId))} />
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-4">
        {[
          ['store.col.supplier', td(order.supplier_name)],
          ['store.col.supplierId', String(order.supplier_id || '')],
          ['store.requests.builder', td(order.builder_name)],
          ['store.col.project', td(order.project_name)],
          ['store.col.purchaseDate', formatDateTime(order.created_at)],
          ['store.payments.total', money(order.total, country)],
          ['store.payments.paid', money(order.paid, country)],
          ['store.col.outstanding', money(order.balance, country)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t(label)}</dt>
            <dd title={label === 'store.col.supplierId' ? value : undefined} className={`truncate text-xs font-bold ${label === 'store.col.supplierId' ? 'font-mono text-[11px]' : ''} ${label === 'store.col.outstanding' && order.balance > 0 ? 'text-rose-700' : 'text-graphite'}`}>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <OrderPill kind="paymentStatus" status={order.payment_status} />
        <SupplierOrderStatus order={order} />
        <OrderPill kind="receiptStatus" status={order.receipt_status} />
      </div>

      <h4 className="text-sm font-extrabold text-graphite">{t('store.payments.productsPurchased')}</h4>
      <DataTable
        minWidth="min-w-[1060px]"
        head={[
          'store.col.product', 'store.col.category', 'store.col.brand', 'store.col.variant', 'store.col.quantityOrdered', 'store.col.unit',
          'store.col.unitPrice', 'store.col.lineTotal', 'store.col.quantityReceived', 'store.col.receiptDate', 'store.col.remaining',
        ].map((key) => <th key={key} className={thClass}>{t(key)}</th>)}
      >
        {order.lines.map((line) => {
          const lineTotal = purchaseLineTotal(line)
          const remaining = purchaseLineRemaining(line)
          return (
            <tr key={line.id}>
              <td className={`${tdClass} min-w-[210px]`}>
                <div className="flex items-center gap-2">
                  {line.image_url
                    ? <img src={line.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover" loading="lazy" />
                    : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400"><Package className="h-4 w-4" /></span>}
                  <span className="min-w-0">
                    <span className="block font-extrabold text-graphite">{td(line.material_name)}</span>
                    <span className="block text-[11px] text-graphite/50">{t('store.buy.orderLineId', { id: line.id })} · {td(line.status)}</span>
                  </span>
                </div>
              </td>
              <td className={tdClass}>{line.category ? td(line.category) : '—'}</td>
              <td className={tdClass}>{line.brand ? td(line.brand) : '—'}</td>
              <td className={tdClass}>{line.size ? td(line.size) : '—'}</td>
              <td className={tdClass}>{formatQty(line.quantity)}</td>
              <td className={tdClass}>{td(line.unit)}</td>
              <td className={`${tdClass} whitespace-nowrap`}>{line.price != null ? money(line.price, country) : '—'}</td>
              <td className={`${tdClass} whitespace-nowrap font-extrabold text-graphite`}>{lineTotal != null ? money(lineTotal, country) : '—'}</td>
              <td className={`${tdClass} ${line.received ? 'text-emerald-700' : ''}`}>{line.received ? formatQty(line.received_quantity) : '0'}</td>
              <td className={`${tdClass} min-w-[96px]`}>{line.received_at ? formatDateTime(line.received_at) : t('store.buy.notInStockYet')}</td>
              <td className={`${tdClass} ${remaining > 0 ? 'font-extrabold text-amber-700' : ''}`}>{formatQty(remaining)}</td>
            </tr>
          )
        })}
      </DataTable>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold text-graphite">{t('store.payments.paymentInformation')}</h4>
        {order.balance > 0 && !recording && <button type="button" onClick={() => setRecording(true)} className={primaryButton}>{t('store.payments.record')}</button>}
      </div>
      {recording && (
        <PaymentForm order={order} country={country} guard={guard} onCancel={() => setRecording(false)} onDone={() => { setRecording(false); onRecorded() }} />
      )}
      <PaymentRecords payments={order.payments || []} country={country} highlightId={highlightId} checking={checking} onCheck={onCheck} />

      <h4 className="text-sm font-extrabold text-graphite">{t('store.timeline2.title')}</h4>
      <PurchaseTimeline order={order} />
    </div>
  )
}

// A checkout with no purchase lines yet (awaiting payment, or failed): only the
// priced cart the server kept on the payment record exists.
function CheckoutDetail({ payment, country, checking, onCheck }) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-3 pb-1">
      <IdFacts purchase={payment} transactionId={transactionRef(payment)} />
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-4">
        {[
          ['store.col.supplier', td(payment.supplier_name || '')],
          ['store.col.project', td(payment.project_name || '')],
          ['store.requests.builder', td(payment.builder_name || '')],
          ['store.payments.total', money(payment.amount, country)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t(label)}</dt>
            <dd className="truncate text-xs font-bold text-graphite">{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStatusPill status={payment.status} />
        <OrderPill kind="receiptStatus" status="NOT_RECEIVED" />
      </div>
      {payment.items?.length > 0 && (
        <DataTable
          minWidth="min-w-[640px]"
          head={['store.col.product', 'store.col.category', 'store.col.quantityOrdered', 'store.col.unit', 'store.col.unitPrice', 'store.col.lineTotal'].map((key) => <th key={key} className={thClass}>{t(key)}</th>)}
        >
          {payment.items.map((item, index) => (
            <tr key={`${item.product_id}-${index}`}>
              <td className={`${tdClass} font-extrabold text-graphite`}>{td(item.name)}</td>
              <td className={tdClass}>{item.category ? td(item.category) : '—'}</td>
              <td className={tdClass}>{formatQty(item.quantity)}</td>
              <td className={tdClass}>{td(item.unit)}</td>
              <td className={tdClass}>{money(item.unit_price, country)}</td>
              <td className={`${tdClass} font-extrabold text-graphite`}>{money(item.line_total, country)}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <PaymentRecords payments={[payment]} country={country} highlightId={payment.id} checking={checking} onCheck={onCheck} />
    </div>
  )
}

export default function StorePaymentsSection({ overview, purchases, payments, country, guard, onChanged, loadFailed = {} }) {
  const { t, td } = useLanguage()
  const [notice, setNotice] = useState(null)
  const [checking, setChecking] = useState(null)
  // What the details window shows: a purchase (by request_code), optionally with
  // the transaction it was opened from highlighted; or a checkout with no lines.
  const [opened, setOpened] = useState(null)
  const openOrder = opened ? purchases.find((order) => order.request_code === opened.code) : null
  const openPayment = opened?.paymentId ? payments.find((payment) => payment.id === opened.paymentId) : null

  // A Razorpay checkout left open (window closed, connection lost): ask Razorpay.
  const checkPayment = async (payment) => {
    setChecking(payment.id)
    setNotice(null)
    try {
      const result = await checkStorePurchasePayment(payment.id)
      setNotice(result.status === 'PAID'
        ? { text: t('store.buy.paid', { reference: payment.reference_code, amount: money(payment.amount, country) }) }
        : { text: t(`store.payments.checked.${result.status}`), error: result.status === 'FAILED' })
      onChanged()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setChecking(null)
    }
  }

  const supplierOf = (payment) => payment.supplier_name || purchases.find((order) => order.request_code === payment.request_code)?.supplier_name || ''

  return (
    <div className="space-y-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t('store.payments.totalPaid')} value={money(overview?.total_paid ?? 0, country)} tone="text-emerald-700" />
      </div>
      {/* The purchases themselves are listed under Buy → Purchase History; here, the money. */}
      <Panel title={t('store.payments.transactions')}>
        {loadFailed.payments ? (
          <Notice message={{ text: t('store.loadFailed'), error: true }} />
        ) : payments.length ? (
          <DataTable
            minWidth="min-w-[1040px]"
            head={['store.col.transactionId', 'store.col.purchaseId', 'store.col.supplier', 'store.col.project', 'store.payments.amount', 'store.col.paymentStatus', 'store.col.gatewayReference', 'store.col.transactionDate', 'store.col.action'].map((key) => <th key={key} className={key === 'store.col.action' ? `${thClass} ${pinnedEnd} bg-slate-50` : thClass}>{t(key)}</th>)}
          >
            {payments.map((payment) => (
              <tr key={payment.id} onClick={() => setOpened({ code: payment.request_code, paymentId: payment.id })} className="group cursor-pointer transition hover:bg-brand-50/40">
                <td className={`${tdClass} w-[150px] min-w-[150px] text-graphite`}>
                  <RequestId value={transactionRef(payment)} />
                  <span className="block text-[11px] font-semibold text-graphite/50">{t(`store.payments.method.${payment.method}`)}</span>
                </td>
                <td className={`${tdClass} w-[150px] min-w-[150px] text-graphite`}>
                  <RequestId value={purchaseRef(payment)} />
                  {payment.site_request_id && <span dir="ltr" className="block break-all text-[11px] text-graphite/50">{t('store.payments.forRequest', { id: payment.site_request_public_id || '' })}</span>}
                </td>
                <td className={tdClass}>{td(supplierOf(payment)) || '—'}</td>
                <td className={tdClass}>{td(payment.project_name) || '—'}</td>
                <td className={`${tdClass} whitespace-nowrap font-extrabold text-graphite`}>{money(payment.amount, country)}</td>
                <td className={tdClass}><PaymentStatusPill status={payment.status} /></td>
                {/* The gateway's own payment id; a payment recorded by hand shows its reference. */}
                <td className={`${tdClass} font-mono text-[11px]`}>{payment.razorpay_payment_id || payment.reference || '—'}</td>
                <td className={`${tdClass} min-w-[96px]`}>{formatDateTime(payment.paid_at || payment.created_at)}</td>
                <td className={`${tdClass} ${pinnedEnd} bg-white group-hover:bg-[#f5faf7]`} onClick={(event) => event.stopPropagation()}>
                  <span className="flex flex-col items-stretch gap-1">
                    <button type="button" onClick={() => setOpened({ code: payment.request_code, paymentId: payment.id })} className={`${secondaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>{t('store.viewDetails')}</button>
                    {payment.status === 'CREATED' && <button type="button" onClick={() => checkPayment(payment)} disabled={checking === payment.id} className={`${secondaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>{t('store.payments.check')}</button>}
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState icon={Wallet} title={t('store.payments.none')} message={t('store.payments.noneSub')} />
        )}
      </Panel>
      {opened && (openOrder || openPayment) && (
        <DetailModal
          placement="right"
          width="max-w-4xl"
          badge={t('store.payments.purchaseBadge')}
          title={t('store.col.purchaseId')}
          subtitle={openPayment ? t('store.payments.openedFrom', { id: transactionRef(openPayment) }) : td(openOrder.supplier_name)}
          onClose={() => setOpened(null)}
        >
          {notice && <div className="mb-2"><Notice message={notice} onClose={() => setNotice(null)} /></div>}
          {openOrder
            ? <PurchaseDetail order={openOrder} country={country} guard={guard} highlightId={opened.paymentId} checking={checking} onCheck={checkPayment} onRecorded={() => { setNotice({ text: t('store.payments.recorded') }); onChanged() }} />
            : <CheckoutDetail payment={openPayment} country={country} checking={checking} onCheck={checkPayment} />}
        </DetailModal>
      )}
    </div>
  )
}
