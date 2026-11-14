import { apiClient } from '../../shared/api/apiClient.js'
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
    builderPortfolio: build.query({ query: () => ({ url: '/builder/portfolio' }) }),
    builderBadges: build.query({ query: (builderIds) => ({ url: '/subscriptions/badges', params: { builder_ids: builderIds.join(',') } }) }),
    costAdjustments: build.query({ query: (registerId) => ({ url: `/cost-tool/registers/${registerId}/builder-adjustments` }) }),
    saveCostAdjustment: build.mutation({
      query: ({ registerId, body }) => ({ url: `/cost-tool/registers/${registerId}/builder-adjustments`, method: 'POST', data: body }),
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

// A builder's plan badge on cards and lists. Many cards ask at once, so the ids are
// gathered for one tick and fetched together (50 per request), and each answer is kept
// for a minute.
const BADGE_TTL_MS = 60 * 1000
const BADGE_BATCH = 50
const badgeCache = new Map() // id -> {tier, at}
let badgeQueue = new Map() // id -> [resolve, reject][]
let badgeTimer = null

async function flushBadgeQueue() {
  const queue = badgeQueue
  badgeQueue = new Map()
  badgeTimer = null
  const ids = [...queue.keys()]
  for (let start = 0; start < ids.length; start += BADGE_BATCH) {
    const chunk = ids.slice(start, start + BADGE_BATCH)
    try {
      const badges = (await runQuery(subscriptionApi.endpoints.builderBadges, chunk))?.badges || {}
      for (const id of chunk) {
        const tier = badges[id] || null
        badgeCache.set(id, { tier, at: Date.now() })
        queue.get(id).forEach(([resolve]) => resolve(tier))
      }
    } catch (error) {
      chunk.forEach((id) => queue.get(id).forEach(([, reject]) => reject(error)))
    }
  }
}

export function fetchBuilderBadge(builderId) {
  const cached = badgeCache.get(builderId)
  if (cached && Date.now() - cached.at < BADGE_TTL_MS) return Promise.resolve(cached.tier)
  return new Promise((resolve, reject) => {
    if (!badgeQueue.has(builderId)) badgeQueue.set(builderId, [])
    badgeQueue.get(builderId).push([resolve, reject])
    if (!badgeTimer) badgeTimer = window.setTimeout(flushBadgeQueue, 0)
  })
}

// A builder's own corrections to a day's cost register (Professional plan).
export const fetchCostAdjustments = (registerId) => runQuery(subscriptionApi.endpoints.costAdjustments, registerId)
export const saveCostAdjustment = (registerId, { fieldName, adjustedValue, reason }) =>
  runMutation(subscriptionApi.endpoints.saveCostAdjustment, {
    registerId,
    body: { field_name: fieldName, adjusted_value: Number(adjustedValue), reason },
  })

export const fetchBuilderPortfolio = () => runQuery(subscriptionApi.endpoints.builderPortfolio)

/**
 * Downloads a CSV as a file. It needs the session, so it goes through the API client (a
 * file for the browser, not data for the store).
 */
async function downloadCsv(path, fallbackName) {
  let response
  try {
    response = await apiClient.get(path, { responseType: 'blob' })
  } catch (error) {
    // A refusal arrives as a Blob here; read its JSON so the caller can tell an expired
    // or missing plan (detail.code) from any other failure.
    const data = error?.response?.data
    if (data && typeof data.text === 'function') {
      try {
        error.response.data = JSON.parse(await data.text())
      } catch {
        /* not JSON: keep as is */
      }
    }
    throw error
  }
  const disposition = response.headers?.['content-disposition'] || ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = match ? match[1] : fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadProjectSummary = (projectId) => downloadCsv(`/projects/${projectId}/summary.csv`, `project-${projectId}-summary.csv`)
export const downloadPortfolioExport = () => downloadCsv('/builder/portfolio/export.csv', 'builder-portfolio.csv')
