import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Project requests (quotations, supplier and engineer requests) and the builder award:
// the assignment, its negotiation and the contract confirmation.
const post = (url, data) => ({ url, method: 'POST', data })

export const requestsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    incomingRequests: build.query({ query: () => ({ url: '/project-requests/incoming' }) }),
    sendRequest: build.mutation({ query: (details) => post('/project-requests/send', details) }),
    acceptRequest: build.mutation({ query: (payload) => post('/project-requests/accept', payload) }),
    rejectRequest: build.mutation({ query: (requestId) => post('/project-requests/reject', { request_id: requestId }) }),
    withdrawRequest: build.mutation({ query: (requestId) => post('/project-requests/withdraw', { request_id: requestId }) }),
    assignRequest: build.mutation({ query: (payload) => post('/project-requests/assign', payload) }),
    confirmAssignment: build.mutation({
      query: (requestId) => post('/project-requests/confirm-assignment', { request_id: requestId }),
    }),
    projectAward: build.query({
      query: ({ projectId, requestId }) => ({ url: `/projects/${projectId}/award`, params: requestId ? { request_id: requestId } : {} }),
    }),
    confirmAward: build.mutation({ query: ({ awardId, amount }) => post(`/awards/${awardId}/confirm`, { amount }) }),
    declineAward: build.mutation({ query: (awardId) => post(`/awards/${awardId}/decline`) }),
    cancelAward: build.mutation({ query: (awardId) => post(`/awards/${awardId}/cancel`) }),
    submitOffer: build.mutation({ query: ({ awardId, amount, note }) => post(`/awards/${awardId}/offers`, { amount, note: note || null }) }),
    acceptOffer: build.mutation({ query: ({ offerId, amount }) => post(`/award-offers/${offerId}/accept`, { amount }) }),
    rejectOffer: build.mutation({ query: (offerId) => post(`/award-offers/${offerId}/reject`) }),
  }),
})

const { endpoints } = requestsApi

export const fetchIncomingRequests = () => runQuery(endpoints.incomingRequests)
export const sendProjectRequest = (requestDetails) => runMutation(endpoints.sendRequest, requestDetails)

export function acceptProjectRequest(requestId, quotationAmount = null) {
  const payload = { request_id: requestId }
  if (quotationAmount !== null && quotationAmount !== '') payload.quotation_amount = Number(quotationAmount)
  return runMutation(endpoints.acceptRequest, payload)
}

export const rejectProjectRequest = (requestId) => runMutation(endpoints.rejectRequest, requestId)
// The sender takes back their own pending request; it stays as history, as `withdrawn`.
export const withdrawProjectRequest = (requestId) => runMutation(endpoints.withdrawRequest, requestId)
export const assignProjectToContractor = (requestId) => runMutation(endpoints.assignRequest, { request_id: requestId })
// "Negotiate" on a quotation: the assignment and the owner's opening counter-offer in
// one request, so neither is kept without the other.
export const negotiateQuotation = (requestId, amount, note) =>
  runMutation(endpoints.assignRequest, { request_id: requestId, offer_amount: amount, offer_note: note || null })
export const confirmProjectAssignment = (requestId) => runMutation(endpoints.confirmAssignment, requestId)
// `requestId` narrows the lookup to the award made on that quotation.
export const fetchProjectAward = (projectId, requestId = null) => runQuery(endpoints.projectAward, { projectId, requestId })
// `amount` is the amount the user saw; the server answers 409 if it changed.
export const confirmAwardContract = (awardId, amount) => runMutation(endpoints.confirmAward, { awardId, amount })
export const declineAward = (awardId) => runMutation(endpoints.declineAward, awardId)
export const cancelAward = (awardId) => runMutation(endpoints.cancelAward, awardId)
export const submitAwardOffer = (awardId, amount, note) => runMutation(endpoints.submitOffer, { awardId, amount, note })
export const acceptAwardOffer = (offerId, amount) => runMutation(endpoints.acceptOffer, { offerId, amount })
export const rejectAwardOffer = (offerId) => runMutation(endpoints.rejectOffer, offerId)
