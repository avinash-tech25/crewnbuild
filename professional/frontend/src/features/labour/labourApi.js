import { baseApi } from '../../shared/api/baseApi.js'
import { runQuery } from '../../shared/api/callEndpoint.js'

export const labourApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    labourTrades: build.query({ query: () => ({ url: '/labor/trades' }) }),
  }),
})

// The trades a Labour Supplier can offer (the supplier profile step lists them).
export const fetchLaborTrades = () => runQuery(labourApi.endpoints.labourTrades)
