/**
 * Paying for a supplier purchase: the existing checkout, shared by Buy and by
 * Catalog's Update stock -> Purchase from Supplier, so there is one payment path.
 *
 * The server prices the order and creates a Razorpay TEST order (or, with no
 * keys, the gateway's local mock); Checkout opens; the payment is verified on the
 * server, and only then does the purchase exist for the supplier. A failure is
 * reported as FAILED; a closed window leaves the checkout open, checked later
 * under Payments. Stock enters the store only when the goods are received.
 */
import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { loadRazorpayCheckout, openRazorpayCheckout } from '../../billing/razorpayCheckout.js'
import { checkoutStorePurchase, mockStorePurchaseCheckout, reportStorePurchaseFailure, verifyStorePurchase } from '../storeManagerApi.js'
import { formatQty, money } from '../../site-work/components/EngineerAnalyticsSection.jsx'
import { refusalText } from './StoreUi.jsx'

/**
 * notify(message)  shows a notice ({ text, error }) on the calling screen
 * onChanged()      reloads the dashboard's data
 * Returns { start, dialog }: start(payload, { onPaid(result) }) runs a checkout and
 * throws the server's refusal (stock, project, supplier) for the caller to show;
 * `dialog` is the local mock's window, rendered by the caller.
 */
export function useStorePurchaseCheckout({ country, notify, onChanged }) {
  const { t, td } = useLanguage()
  const [mockOrder, setMockOrder] = useState(null)

  const verify = async (order, response, handlers) => {
    try {
      const result = await verifyStorePurchase({ payment_id: order.payment_id, ...response })
      handlers.onPaid(result)
    } catch (error) {
      notify({ text: refusalText(error, td, t('store.buy.verifyFailed')), error: true })
      onChanged()
    }
  }

  const failed = async (order, { code, description } = {}) => {
    try {
      await reportStorePurchaseFailure({ payment_id: order.payment_id, code: code || null, description: description || null })
    } catch {
      /* the server still shows the payment as not paid */
    }
    notify({ text: t('store.buy.payFailed'), error: true })
    onChanged()
  }

  const start = async (payload, handlers) => {
    const order = await checkoutStorePurchase(payload)
    if (order.gateway_mode === 'mock') {
      setMockOrder({ order, handlers })
      return order
    }
    if (!(await loadRazorpayCheckout())) {
      notify({ text: t('store.buy.checkoutUnavailable'), error: true })
      return order
    }
    openRazorpayCheckout(order, {
      onSuccess: (response) => verify(order, response, handlers),
      onFailure: (failure) => failed(order, failure),
      onDismiss: () => {
        notify({ text: t('store.buy.payPending', { reference: order.reference_code }) })
        onChanged()
      },
    })
    return order
  }

  // The gateway's local stand-in for Razorpay Checkout (no TEST keys on the server).
  const simulate = async (outcome) => {
    const { order, handlers } = mockOrder
    setMockOrder(null)
    if (outcome === 'cancel') {
      notify({ text: t('store.buy.payPending', { reference: order.reference_code }) })
      onChanged()
      return
    }
    try {
      const result = await mockStorePurchaseCheckout({ payment_id: order.payment_id, outcome })
      if (result.succeeded) {
        await verify(order, { razorpay_order_id: result.razorpay_order_id, razorpay_payment_id: result.razorpay_payment_id, razorpay_signature: result.razorpay_signature }, handlers)
      } else {
        await failed(order, { code: result.error_code, description: result.error_description })
      }
    } catch (error) {
      notify({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    }
  }

  const dialog = mockOrder && (
    <div className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">{t('payments.mockTitle')}</p>
        <p className="mt-2 text-sm text-slate-700">{t('payments.mockExplain')}</p>
        <p className="mt-3 text-lg font-extrabold">{money(mockOrder.order.amount, country)}</p>
        <p className="text-xs text-slate-500">#{mockOrder.order.reference_code} · {td(mockOrder.order.supplier_name)}</p>
        <ul className="mt-2 text-xs text-slate-600">
          {mockOrder.order.lines.map((line) => <li key={line.product_id}>{td(line.name)} × {formatQty(line.quantity)} {td(line.unit)} · {money(line.unit_price, country)} · {money(line.line_total, country)}</li>)}
        </ul>
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={() => simulate('success')} className="h-9 rounded-lg bg-emerald-600 text-sm font-extrabold text-white">{t('payments.mockSuccess')}</button>
          <button type="button" onClick={() => simulate('failure')} className="h-9 rounded-lg border border-red-300 text-sm font-bold text-red-700">{t('payments.mockFailure')}</button>
          <button type="button" onClick={() => simulate('cancel')} className="h-9 rounded-lg text-sm font-bold text-slate-500">{t('payments.mockCancel')}</button>
        </div>
      </div>
    </div>
  )

  return { start, dialog }
}
