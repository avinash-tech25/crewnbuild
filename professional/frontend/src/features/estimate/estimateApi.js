import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

export const estimateApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // The public Get Estimate page: state, city and PIN are verified against India Post by
    // the server before anything is calculated.
    verifiedEstimate: build.mutation({
      query: (body) => ({ url: '/estimates/public-calculate', method: 'POST', data: body }),
    }),
  }),
})

export const calculateVerifiedEstimate = (payload) => runMutation(estimateApi.endpoints.verifiedEstimate, payload)
