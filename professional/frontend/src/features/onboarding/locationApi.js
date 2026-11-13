import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

export const locationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    pincodeArea: build.query({ query: (pincode) => ({ url: `/locations/pincode/${pincode}` }) }),
    updateLocation: build.mutation({ query: (body) => ({ url: '/auth/location', method: 'PATCH', data: body }) }),
  }),
})

export const lookupPincodeArea = (pincode) => runQuery(locationApi.endpoints.pincodeArea, pincode)

// Saves the account's pincode and the post office branch chosen for it. The server checks
// both against India Post before writing, and returns the updated account.
export const updateUserLocation = (pincode, branchName) =>
  runMutation(locationApi.endpoints.updateLocation, { pincode, branch_name: branchName })
