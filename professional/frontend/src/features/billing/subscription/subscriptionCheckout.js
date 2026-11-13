// Razorpay Standard Checkout for a builder plan. The script loader is the payment
// module's own; only the PUBLIC test key id (from the backend's order answer) is
// used. Checkout's success is only Checkout's word: the backend verifies it.
import { loadRazorpayCheckout } from '../razorpayCheckout.js'

export { loadRazorpayCheckout }

/**
 * Exactly one of the callbacks runs:
 *   onSuccess({razorpay_payment_id, razorpay_order_id, razorpay_signature})
 *   onFailure({code, description, paymentId})
 *   onDismiss()
 */
export function openSubscriptionCheckout(order, { description, onSuccess, onFailure, onDismiss }) {
  let settled = false
  const once = (callback) => (...args) => {
    if (settled) return
    settled = true
    callback(...args)
  }
  const checkout = new window.Razorpay({
    key: order.key_id,
    order_id: order.razorpay_order_id,
    amount: order.amount_paise,
    currency: order.currency,
    name: 'CREWNBUILD',
    description: `${description} · TEST MODE`,
    prefill: { name: order.customer_name || '', email: order.customer_email || '' },
    notes: { purpose: 'builder_subscription', plan: order.plan_code, duration: order.duration_code, mode: 'test' },
    theme: { color: '#0f766e' },
    handler: once(onSuccess),
    modal: { ondismiss: once(onDismiss) },
  })
  checkout.on('payment.failed', (response) => {
    const error = response?.error || {}
    once(onFailure)({ code: error.code, description: error.description, paymentId: error.metadata?.payment_id })
    try { checkout.close() } catch { /* already closed */ }
  })
  checkout.open()
}
