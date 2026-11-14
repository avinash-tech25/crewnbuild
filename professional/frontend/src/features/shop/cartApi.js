import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The cart lives on the server, so the web app and the mobile app read the same basket.
// Every call answers with the whole cart, already grouped by supplier.
const projectParams = (projectId) => (projectId ? { project_id: projectId } : {})

export const cartApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    cart: build.query({ query: (projectId) => ({ url: '/cart', params: projectParams(projectId) }) }),
    addItem: build.mutation({ query: (item) => ({ url: '/cart/items', method: 'POST', data: item }) }),
    updateItem: build.mutation({ query: ({ itemId, quantity }) => ({ url: `/cart/items/${itemId}`, method: 'PATCH', data: { quantity } }) }),
    removeItem: build.mutation({ query: (itemId) => ({ url: `/cart/items/${itemId}`, method: 'DELETE' }) }),
    clearCart: build.mutation({ query: (projectId) => ({ url: '/cart', method: 'DELETE', params: projectParams(projectId) }) }),
    checkout: build.mutation({ query: (payload) => ({ url: '/cart/checkout', method: 'POST', data: payload }) }),
  }),
})

const { endpoints } = cartApi

export const fetchCart = (projectId) => runQuery(endpoints.cart, projectId)
export const addCartItem = (projectId, productId, quantity) =>
  runMutation(endpoints.addItem, { project_id: projectId, product_id: productId, quantity })
export const updateCartItem = (itemId, quantity) => runMutation(endpoints.updateItem, { itemId, quantity })
export const removeCartItem = (itemId) => runMutation(endpoints.removeItem, itemId)
export const clearCart = (projectId) => runMutation(endpoints.clearCart, projectId)
export const checkoutCart = (projectId, supplierId) => runMutation(endpoints.checkout, { project_id: projectId, supplier_id: supplierId })
