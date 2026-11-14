import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

export const estimateApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // The public Get Estimate page: state, city and PIN are verified against India Post by
    // the server before anything is calculated.
    // An estimate from details the account already gave (the owner's project form).
    estimate: build.mutation({ query: (body) => ({ url: '/estimates/calculate', method: 'POST', data: body }) }),
    verifiedEstimate: build.mutation({
      query: (body) => ({ url: '/estimates/public-calculate', method: 'POST', data: body }),
    }),
  }),
})

export const calculatePublicEstimate = (payload) => runMutation(estimateApi.endpoints.estimate, payload)
export const calculateVerifiedEstimate = (payload) => runMutation(estimateApi.endpoints.verifiedEstimate, payload)
