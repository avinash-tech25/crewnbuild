import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// A supplier's own product listings, and the published products a buyer may order.
export const supplierProductsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    supplierProducts: build.query({ query: () => ({ url: '/supplier-products' }) }),
    shopProducts: build.query({ query: () => ({ url: '/shop/products' }) }),
    createSupplierProduct: build.mutation({ query: (payload) => ({ url: '/supplier-products', method: 'POST', data: payload }) }),
    updateSupplierProduct: build.mutation({
      query: ({ id, payload }) => ({ url: `/supplier-products/${id}`, method: 'PATCH', data: payload }),
    }),
    deleteSupplierProduct: build.mutation({ query: (id) => ({ url: `/supplier-products/${id}`, method: 'DELETE' }) }),
    bulkPricing: build.query({ query: (id) => ({ url: `/supplier-products/${id}/bulk-pricing` }) }),
    saveBulkPricing: build.mutation({
      query: ({ id, tiers }) => ({ url: `/supplier-products/${id}/bulk-pricing`, method: 'PUT', data: { tiers } }),
    }),
  }),
})

const { endpoints } = supplierProductsApi

export const fetchSupplierProducts = () => runQuery(endpoints.supplierProducts)
// Published products this buyer may order, with the seller attached.
export const fetchShopProducts = () => runQuery(endpoints.shopProducts)
export const createSupplierProduct = (payload) => runMutation(endpoints.createSupplierProduct, payload)
export const updateSupplierProduct = (id, payload) => runMutation(endpoints.updateSupplierProduct, { id, payload })
export const deleteSupplierProduct = (id) => runMutation(endpoints.deleteSupplierProduct, id)
// Optional bulk pricing of one of the supplier's own listings.
export const fetchBulkPricing = (id) => runQuery(endpoints.bulkPricing, id)
export const saveBulkPricing = (id, tiers) => runMutation(endpoints.saveBulkPricing, { id, tiers })
