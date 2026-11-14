import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The site store: the Store Manager's own screens, requests between a Builder and a
// Store Manager on their team, and the Site Engineer's site requests. Purchases are
// priced and verified by the server.
export const storeManagerApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    storeRead: build.query({ query: ({ url, params }) => ({ url, params }) }),
    storeWrite: build.mutation({ query: ({ method = 'POST', url, data }) => ({ url, method, data }) }),
  }),
})

const { endpoints } = storeManagerApi
const read = (url, params) => runQuery(endpoints.storeRead, { url, params })
const write = (url, data, method = 'POST') => runMutation(endpoints.storeWrite, { method, url, data })

// ---- Store Manager ----
export const fetchStoreOverview = () => read('/store-manager/overview')
export const fetchStoreProjects = () => read('/store-manager/projects')
export const fetchStoreItems = () => read('/store-manager/items')
export const createStoreItem = (payload) => write('/store-manager/items', payload)
export const updateStoreItem = (id, payload) => write(`/store-manager/items/${id}`, payload, 'PATCH')
export const updateStoreStock = (id, payload) => write(`/store-manager/items/${id}/stock`, payload)
export const fetchStoreMovements = (id) => read(`/store-manager/items/${id}/movements`)
export const fetchStoreRequests = () => read('/store-manager/requests')
export const approveStoreRequest = (id, note) => write(`/store-manager/requests/${id}/approve`, { note })
export const rejectStoreRequest = (id, note) => write(`/store-manager/requests/${id}/reject`, { note })
// Issue: per request line the quantity to hand over ([{ line_id, quantity }]); none given,
// everything still owed that the store holds.
export const issueStoreRequest = (id, lines) => write(`/store-manager/requests/${id}/issue`, lines ? { lines } : undefined)
// What a request is short of, and the builder's suppliers selling it.
export const fetchStoreRequestPurchaseOptions = (id) => read(`/store-manager/requests/${id}/purchase-options`)
export const fetchStorePurchases = () => read('/store-manager/purchases')
// The quantity that actually arrived; none given, all that is still pending. The receipt
// key makes a retried Mark received the same receipt (never added twice).
export function receiveStorePurchaseLine(lineId, quantity, receiptKey) {
  const body = { ...(quantity ? { quantity } : {}), ...(receiptKey ? { receipt_key: receiptKey } : {}) }
  return write(`/store-manager/purchases/lines/${lineId}/receive`, Object.keys(body).length ? body : undefined)
}
export const fetchStorePayments = () => read('/store-manager/payments')

// Buying from the project builder's suppliers (Razorpay). itemId: only the offers that
// replenish that catalog product (its size and unit).
export const fetchStoreBuyProducts = (projectId, itemId) =>
  read('/store-manager/buy/products', { project_id: projectId, ...(itemId ? { item_id: itemId } : {}) })
export const checkoutStorePurchase = (payload) => write('/store-manager/purchases/checkout', payload)
export const verifyStorePurchase = (payload) => write('/store-manager/purchases/verify', payload)
export const reportStorePurchaseFailure = (payload) => write('/store-manager/purchases/failure', payload)
export const checkStorePurchasePayment = (paymentId) => write(`/store-manager/purchases/payments/${paymentId}/check`)
export const mockStorePurchaseCheckout = (payload) => write('/store-manager/purchases/mock-checkout', payload)
export const recordStorePayment = (payload) => write('/store-manager/payments', payload)

// ---- Builder <-> Store Manager requests: both sides call the same endpoints ----
export const fetchStoreBuilderRequests = () => read('/store-builder-requests')
export const createStoreBuilderRequest = (payload) => write('/store-builder-requests', payload)
export const respondStoreBuilderRequest = (id, decision, response) =>
  write(`/store-builder-requests/${id}/respond`, { decision, response: response || null })
export const withdrawStoreBuilderRequest = (id) => write(`/store-builder-requests/${id}/withdraw`)

// ---- Site Engineer ----
export const fetchSiteStores = () => read('/store/site-stores')
export const createSiteRequest = (payload) => write('/store/site-requests', payload)
export const cancelSiteRequest = (id) => write(`/store/site-requests/${id}/cancel`)
export const fetchMySiteRequests = (projectId) => read('/store/site-requests/mine', projectId ? { project_id: projectId } : {})
