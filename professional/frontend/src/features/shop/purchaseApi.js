import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

const url = '/marketplace'
const orderUrl = (id) => `${url}/orders/${encodeURIComponent(id)}`

const purchaseApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    receivePurchaseItem: build.mutation({
      query: ({ id, lineId }) => ({ url: orderUrl(id) + '/items/' + encodeURIComponent(lineId) + '/receive', method: 'POST' }),
    }),
    engineerPurchases: build.query({ query: () => ({ url: `${url}/orders` }) }),
    engineerPurchase: build.query({ query: (id) => ({ url: orderUrl(id) }) }),
    engineerStore: build.query({ query: () => ({ url: `${url}/store` }) }),
  }),
})

const { endpoints } = purchaseApi
export const receivePurchaseItem = (id, lineId) => runMutation(endpoints.receivePurchaseItem, { id, lineId })

export const { useEngineerPurchasesQuery, useEngineerPurchaseQuery, useEngineerStoreQuery } = purchaseApi
