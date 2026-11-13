import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

export const contactApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    contactEnquiry: build.mutation({ query: (body) => ({ url: '/contact', method: 'POST', data: body }) }),
  }),
})

/**
 * Send a public enquiry (the marketing Contact section and the /contact-us page). Resolves
 * only when the server confirms the enquiry was handed to the mail service; anything else
 * throws, and the caller keeps the form with the visitor's answers in it.
 */
export function submitContactEnquiry({ name, email, phone = '', message, interest = '', city = '' }) {
  return runMutation(contactApi.endpoints.contactEnquiry, {
    name: String(name || '').trim(),
    email: String(email || '').trim(),
    phone: String(phone || '').trim(),
    message: String(message || '').trim(),
    interest: String(interest || '').trim(),
    city: String(city || '').trim(),
  })
}

/**
 * Which message to show when an enquiry could not be sent: 503 means the site cannot take
 * enquiries right now (no point retrying), 429 too many; anything else is worth retrying.
 */
export function contactErrorKey(error) {
  const status = error?.response?.status
  if (status === 503) return 'site.contact.unavailable'
  if (status === 429) return 'site.contact.tooMany'
  return 'site.contact.failed'
}
