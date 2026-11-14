import { apiClient } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

/**
 * Contact & Support. A ticket exists only once POST /support/tickets answers 201 (or 200
 * for a repeat of the same request); the reference shown is the one in that answer.
 */
export const supportApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    supportConfig: build.query({ query: () => ({ url: '/support/config' }) }),
    submitTicket: build.mutation({
      query: (form) => ({ url: '/support/tickets', method: 'POST', data: form }),
      invalidatesTags: ['SupportTicket'],
    }),
    myTickets: build.query({ query: () => ({ url: '/support/tickets' }), providesTags: ['SupportTicket'] }),
    myTicket: build.query({
      query: (reference) => ({ url: `/support/tickets/${encodeURIComponent(reference)}` }),
      providesTags: ['SupportTicket'],
    }),
    // Staff (admin console, support.view / support.manage). A ticket is personal data:
    // fetched when opened, not kept once closed.
    staffTickets: build.query({ query: (params) => ({ url: '/admin/support/tickets', params }), keepUnusedDataFor: 0 }),
    staffTicket: build.query({ query: (id) => ({ url: `/admin/support/tickets/${id}` }), keepUnusedDataFor: 0 }),
    replyAsStaff: build.mutation({
      query: ({ id, body, status }) => ({ url: `/admin/support/tickets/${id}/reply`, method: 'POST', data: { body: body || null, status: status || null } }),
    }),
    replyToMyTicket: build.mutation({
      query: ({ reference, body }) => ({
        url: `/support/tickets/${encodeURIComponent(reference)}/messages`,
        method: 'POST',
        data: { body },
      }),
      invalidatesTags: ['SupportTicket'],
    }),
  }),
})

export const fetchSupportConfig = () => runQuery(supportApi.endpoints.supportConfig)

export function submitSupportTicket(payload, attachment) {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  if (attachment) form.append('attachment', attachment)
  return runMutation(supportApi.endpoints.submitTicket, form)
}

export const fetchMyTickets = async () => (await runQuery(supportApi.endpoints.myTickets)).tickets
export const fetchMyTicket = (reference) => runQuery(supportApi.endpoints.myTicket, reference)
export const replyToMyTicket = (reference, body) => runMutation(supportApi.endpoints.replyToMyTicket, { reference, body })

/**
 * Open an attachment in a new tab. It needs the session, so it is downloaded with the API
 * client (a file for the browser, not data for the store), not linked.
 */
export async function openAttachment(path) {
  // Opened first, synchronously, so the browser does not treat it as a pop-up.
  const tab = window.open('', '_blank')
  try {
    const response = await apiClient.get(path, { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    if (tab) tab.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (error) {
    if (tab) tab.close()
    throw error
  }
}

export const myAttachmentPath = (reference) => `/support/tickets/${encodeURIComponent(reference)}/attachment`

// --- Staff ---
export async function fetchStaffTickets({ status = '', q = '' } = {}) {
  const params = {}
  if (status) params.status = status
  if (q) params.q = q
  return (await runQuery(supportApi.endpoints.staffTickets, params)).tickets
}
export const fetchStaffTicket = (id) => runQuery(supportApi.endpoints.staffTicket, id)
export const replyAsStaff = (id, { body, status }) => runMutation(supportApi.endpoints.replyAsStaff, { id, body, status })
export const staffAttachmentPath = (id) => `/admin/support/tickets/${id}/attachment`

/** A readable message from any API error shape. */
export function supportErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((item) => item?.msg).filter(Boolean).join('; ') || fallback
  if (detail && typeof detail === 'object' && detail.message) return detail.message
  return fallback
}
