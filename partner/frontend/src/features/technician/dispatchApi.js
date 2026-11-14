import { technicianSession, websocketUrl } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

/**
 * Nearby dispatch. The technician says where they are and answers job offers (technician
 * session); a requester searches for a place to book (booking session). Neither call
 * carries an identity of its own: the session decides who is asking.
 */
export const dispatchApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techPublishLocation: build.mutation({ query: (body) => ({ url: '/technicians/me/location', method: 'POST', data: body }) }),
    techPresence: build.query({ query: () => ({ url: '/technicians/me/presence' }) }),
    techForgetLocation: build.mutation({ query: () => ({ url: '/technicians/me/location', method: 'DELETE' }) }),
    techOffers: build.query({ query: () => ({ url: '/technicians/me/offers' }) }),
    techAcceptOffer: build.mutation({ query: (bookingId) => ({ url: `/technicians/me/offers/${bookingId}/accept`, method: 'POST' }) }),
    techDeclineOffer: build.mutation({ query: (bookingId) => ({ url: `/technicians/me/offers/${bookingId}/decline`, method: 'POST' }) }),
    requesterPlaceSearch: build.query({ query: (q) => ({ url: '/locations/search', params: { q }, principal: 'requester' }) }),
    requesterPlaceDescribe: build.query({
      query: ({ latitude, longitude }) => ({ url: '/locations/describe', params: { lat: latitude, lng: longitude }, principal: 'requester' }),
    }),
  }),
})

const { endpoints } = dispatchApi

// ---- technician ----

/**
 * The one place a technician position is sent: where they are now, only while they are
 * available for work or on a job. The answer is their presence and, on a job, its
 * navigation view. Who and which job come from the session, never the body.
 */
export const publishTechnicianLocation = ({ latitude, longitude, accuracy, heading, speed, altitude, timestamp }) =>
  runMutation(endpoints.techPublishLocation, {
    latitude,
    longitude,
    accuracy: accuracy ?? null,
    heading: heading ?? null,
    speed: speed ?? null,
    altitude: altitude ?? null,
    // When the device took the fix; the server only uses it to drop out-of-order fixes.
    device_timestamp: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
  })

export const fetchPresence = () => runQuery(endpoints.techPresence)
/** Stop being reachable for nearby work, and have the stored position forgotten. */
export const forgetTechnicianLocation = () => runMutation(endpoints.techForgetLocation)
/** Job requests waiting for an answer. Carries nothing that identifies anyone. */
export const fetchOffers = () => runQuery(endpoints.techOffers)
export const acceptOffer = (bookingId) => runMutation(endpoints.techAcceptOffer, bookingId)
export const declineOffer = (bookingId) => runMutation(endpoints.techDeclineOffer, bookingId)

// ---- requester ----

/**
 * Places matching what the requester typed into the booking map's search box. `matched`
 * is the broader text the places are for when the full text found nothing.
 */
export async function searchPlaces(query) {
  const data = await runQuery(endpoints.requesterPlaceSearch, query)
  return { results: data?.results || [], matched: data?.matched || null }
}

/** What to call a point the requester dropped the pin on. Best effort. */
export async function describePlace(latitude, longitude) {
  const data = await runQuery(endpoints.requesterPlaceDescribe, { latitude, longitude })
  return data?.name || null
}

// ---- websocket ----

// Must match the backend's dispatch subprotocol.
export const DISPATCH_SUBPROTOCOL = 'partner.dispatch.v1'

/** The technician's job-request socket, on the API's own origin (ws:// or wss://). */
export const dispatchSocketUrl = () => websocketUrl('/dispatch/ws/technician')

/** Whether this tab holds a technician session to open the socket with. The browser sends
 * the HttpOnly session cookie on the handshake; no token is handled here. */
export const hasTechnicianSession = () => technicianSession.isActive()
