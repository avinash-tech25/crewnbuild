import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Paying for completed technician bookings (Razorpay). No amount is ever sent: the
// server reads it from the booking.
export const technicianPaymentsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    bookingPayments: build.query({ query: () => ({ url: '/payments/technician-bookings' }) }),
    bookingPaymentOrder: build.mutation({ query: (bookingId) => ({ url: '/payments/orders', method: 'POST', data: { booking_id: bookingId } }) }),
    verifyBookingPayment: build.mutation({ query: (body) => ({ url: '/payments/verify', method: 'POST', data: body }) }),
    reportBookingPaymentFailure: build.mutation({ query: (body) => ({ url: '/payments/failures', method: 'POST', data: body }) }),
    receipt: build.query({ query: (receiptNumber) => ({ url: `/payments/receipts/${encodeURIComponent(receiptNumber)}` }) }),
    mockBookingCheckout: build.mutation({ query: (body) => ({ url: '/payments/mock/checkout', method: 'POST', data: body }) }),
  }),
})

const { endpoints } = technicianPaymentsApi

export const fetchTechnicianBookingPayments = () => runQuery(endpoints.bookingPayments)
export const createPaymentOrder = (bookingId) => runMutation(endpoints.bookingPaymentOrder, bookingId)

export const verifyPayment = ({ paymentOrderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) =>
  runMutation(endpoints.verifyBookingPayment, {
    payment_order_id: paymentOrderId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
  })

export const reportPaymentFailure = ({ paymentOrderId, razorpayPaymentId, code, description }) =>
  runMutation(endpoints.reportBookingPaymentFailure, {
    payment_order_id: paymentOrderId,
    razorpay_payment_id: razorpayPaymentId || null,
    code: code || null,
    description: description ? String(description).slice(0, 255) : null,
  })

export const fetchPaymentReceipt = (receiptNumber) => runQuery(endpoints.receipt, receiptNumber)
// Answers only while the server has no Razorpay keys (local mock).
export const simulateMockCheckout = (paymentOrderId, outcome) =>
  runMutation(endpoints.mockBookingCheckout, { payment_order_id: paymentOrderId, outcome })

/** The server's `{detail: {code, message}}`, or a plain fallback. */
export function paymentErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  if (detail && typeof detail === 'object' && detail.message) return detail.message
  if (typeof detail === 'string') return detail
  return fallback
}

export function paymentErrorCode(error) {
  const detail = error?.response?.data?.detail
  return detail && typeof detail === 'object' ? detail.code : null
}
