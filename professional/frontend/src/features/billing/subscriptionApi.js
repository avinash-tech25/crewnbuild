import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'
import { orderRequestBody } from './subscription/subscriptionOffers.js'

// Builder subscriptions (Razorpay TEST mode). No amount is ever sent: the server prices
// the plan itself. Every answer here is the server's verified state.
export const subscriptionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    subscriptionPlans: build.query({ query: () => ({ url: '/subscriptions/plans' }) }),
    mySubscription: build.query({ query: () => ({ url: '/subscriptions/me' }), providesTags: ['Subscription'] }),
    createOrder: build.mutation({ query: (body) => ({ url: '/subscriptions/orders', method: 'POST', data: body }) }),
    validateCoupon: build.mutation({ query: (body) => ({ url: '/subscriptions/coupons/validate', method: 'POST', data: body }) }),
    changeSignupPlan: build.mutation({
      query: (body) => ({ url: '/subscriptions/signup-plan', method: 'PATCH', data: body }),
      invalidatesTags: ['Subscription'],
    }),
    reconcileOrder: build.mutation({
      query: (subscriptionPaymentId) => ({ url: `/subscriptions/orders/${subscriptionPaymentId}/reconcile`, method: 'POST' }),
      invalidatesTags: ['Subscription'],
    }),
    verifyPayment: build.mutation({
      query: (body) => ({ url: '/subscriptions/verify', method: 'POST', data: body }),
      invalidatesTags: ['Subscription'],
    }),
    reportFailure: build.mutation({ query: (body) => ({ url: '/subscriptions/failures', method: 'POST', data: body }) }),
    mockCheckout: build.mutation({
      query: (body) => ({ url: '/subscriptions/mock/checkout', method: 'POST', data: body }),
      invalidatesTags: ['Subscription'],
    }),
  }),
})

export const fetchSubscriptionPlans = () => runQuery(subscriptionApi.endpoints.subscriptionPlans)
export const fetchMySubscription = () => runQuery(subscriptionApi.endpoints.mySubscription)

export const createSubscriptionOrder = (planCode, durationCode, couponCode = null) =>
  runMutation(subscriptionApi.endpoints.createOrder, orderRequestBody(planCode, durationCode, couponCode))

// The server's price with a coupon (original, discount, payable). Reserves nothing.
export function validateSubscriptionCoupon(code, planCode = null, durationCode = null) {
  const body = planCode ? { code, plan_code: planCode, duration_code: durationCode } : { code }
  return runMutation(subscriptionApi.endpoints.validateCoupon, body)
}

// A paid sign-up, before it is paid: switch offers, or plan 'FREE' to sign up free.
export const changeSignupPlan = (planCode, durationCode = null) =>
  runMutation(subscriptionApi.endpoints.changeSignupPlan, { plan_code: planCode, duration_code: durationCode })

// Recover an order paid while the browser was closed; never creates a charge.
export const reconcileSubscriptionOrder = (subscriptionPaymentId) =>
  runMutation(subscriptionApi.endpoints.reconcileOrder, subscriptionPaymentId)

export const verifySubscriptionPayment = ({ subscriptionPaymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) =>
  runMutation(subscriptionApi.endpoints.verifyPayment, {
    subscription_payment_id: subscriptionPaymentId,
    razorpay_order_id: razorpayOrderId,
    razorpay_payment_id: razorpayPaymentId,
    razorpay_signature: razorpaySignature,
  })

export const reportSubscriptionFailure = ({ subscriptionPaymentId, razorpayPaymentId, code, description }) =>
  runMutation(subscriptionApi.endpoints.reportFailure, {
    subscription_payment_id: subscriptionPaymentId,
    razorpay_payment_id: razorpayPaymentId || null,
    code: code || null,
    description: description ? String(description).slice(0, 255) : null,
  })

// Only answers while the server has no Razorpay TEST keys (local mock).
export const simulateSubscriptionCheckout = (subscriptionPaymentId, outcome) =>
  runMutation(subscriptionApi.endpoints.mockCheckout, { subscription_payment_id: subscriptionPaymentId, outcome })

// Other screens listen for this to read the server's status again after a change.
export const SUBSCRIPTION_CHANGED_EVENT = 'crewnbuild:subscription-changed'
export function announceSubscriptionChange() {
  window.dispatchEvent(new Event(SUBSCRIPTION_CHANGED_EVENT))
}
