import { baseApi } from '../../shared/api/baseApi.js'
import { runQuery } from '../../shared/api/callEndpoint.js'

// The signed-in technician's earnings, read only: the server records them when a priced
// job is completed.
const earningsEndpoints = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techEarningsSummary: build.query({ query: () => ({ url: '/technicians/me/earnings/summary' }) }),
    techEarningsHistory: build.query({ query: (params) => ({ url: '/technicians/me/earnings', params }) }),
  }),
})

export const earningsApi = {
  summary: () => runQuery(earningsEndpoints.endpoints.techEarningsSummary),
  /** Newest first; the server caps a page at 100. */
  history: ({ limit = 50, offset = 0 } = {}) => runQuery(earningsEndpoints.endpoints.techEarningsHistory, { limit, offset }),
}
