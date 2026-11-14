import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Material requests: a buyer's Buy requests and a supplier's answers to them.
export const materialRequestsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    myMaterialRequests: build.query({
      query: (projectId) => ({ url: '/material-requests/mine', params: projectId ? { project_id: projectId } : {} }),
    }),
    supplierMaterialRequests: build.query({ query: () => ({ url: '/supplier/material-requests' }) }),
    createMaterialRequest: build.mutation({ query: (payload) => ({ url: '/material-requests', method: 'POST', data: payload }) }),
    respondMaterialRequest: build.mutation({
      query: ({ id, action }) => ({ url: `/supplier/material-requests/${id}/respond`, method: 'POST', data: { action } }),
    }),
    respondPurchaseRequest: build.mutation({
      query: ({ requestCode, action }) => ({ url: `/supplier/purchase-requests/${requestCode}/respond`, method: 'POST', data: { action } }),
    }),
  }),
})

const { endpoints } = materialRequestsApi

export const fetchMyMaterialRequests = (projectId) => runQuery(endpoints.myMaterialRequests, projectId)
export const fetchSupplierMaterialRequests = () => runQuery(endpoints.supplierMaterialRequests)
export const createMaterialRequest = (payload) => runMutation(endpoints.createMaterialRequest, payload)
export const respondMaterialRequest = (id, action) => runMutation(endpoints.respondMaterialRequest, { id, action })
// Accept or reject a whole purchase request (one Buy) at once.
export const respondPurchaseRequest = (requestCode, action) => runMutation(endpoints.respondPurchaseRequest, { requestCode, action })
