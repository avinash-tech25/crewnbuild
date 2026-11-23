import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

// The Site Engineer's Store: a project's materials (one card per product and variant), the
// usage recorded there, and each material's movements (received / used).
const storeUrl = (projectId) => `/projects/${encodeURIComponent(projectId)}/material-store`

const materialStoreApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    materialStore: build.query({ query: (projectId) => ({ url: storeUrl(projectId) }) }),
    materialMovements: build.query({
      query: ({ projectId, stockId }) => ({ url: `${storeUrl(projectId)}/${encodeURIComponent(stockId)}/movements` }),
    }),
    recordMaterialUsage: build.mutation({
      query: ({ projectId, stockId, ...body }) => ({
        url: `${storeUrl(projectId)}/${encodeURIComponent(stockId)}/usage`,
        method: 'POST',
        data: body,
      }),
    }),
    setMaterialThreshold: build.mutation({
      query: ({ projectId, stockId, ...body }) => ({
        url: `${storeUrl(projectId)}/${encodeURIComponent(stockId)}/threshold`,
        method: 'PUT',
        data: body,
      }),
    }),
  }),
})

const { endpoints } = materialStoreApi
export const recordMaterialUsage = (payload) => runMutation(endpoints.recordMaterialUsage, payload)
// A material's low-stock level (the assigned Site Engineer or the builder; 0 turns it off).
export const setMaterialThreshold = (payload) => runMutation(endpoints.setMaterialThreshold, payload)
export const { useMaterialStoreQuery, useMaterialMovementsQuery } = materialStoreApi
