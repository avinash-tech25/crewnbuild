// Razorpay Standard Checkout, loaded from Razorpay's own CDN on first use.
// Only the PUBLIC test key id (from the backend's order answer) is used here; the
// key secret never exists in this application.

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'
let loading = null

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true)
  if (!loading) {
    loading = new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = CHECKOUT_SCRIPT
      script.async = true
      script.onload = () => resolve(Boolean(window.Razorpay))
      script.onerror = () => {
        loading = null
        resolve(false)
      }
      document.body.appendChild(script)
    })
  }
  return loading
}

/**
 * Opens Checkout for a backend-created TEST order. Exactly one of the callbacks runs:
 *   onSuccess({razorpay_payment_id, razorpay_order_id, razorpay_signature})
 *   onFailure({code, description, paymentId})
 *   onDismiss()
 * Success here is only Checkout's word: the backend verifies before anything is paid.
 */
export function openRazorpayCheckout(order, { onSuccess, onFailure, onDismiss }) {
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
    description: `${order.service_name || 'Technician service'} · ${order.booking_reference} · TEST MODE`,
    prefill: { name: order.customer_name || '', email: order.customer_email || '' },
    notes: { booking_reference: order.booking_reference, mode: 'test' },
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
