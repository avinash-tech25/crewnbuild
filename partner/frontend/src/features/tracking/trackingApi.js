import { requesterSession, websocketUrl } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

/**
 * Live tracking. The requester watches their own booking (booking session); the technician
 * reads their navigation view of a job they hold (technician session). Positions
 * themselves are only ever sent by publishTechnicianLocation (dispatchApi), and only while
 * a booking is active: the server stops sharing when it ends.
 */
export const trackingApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techSharingStatus: build.query({ query: (bookingId) => ({ url: `/tracking/bookings/${bookingId}/sharing` }) }),
    requesterTracking: build.query({ query: (bookingId) => ({ url: `/tracking/bookings/${bookingId}`, principal: 'requester' }) }),
    requesterSaveDestination: build.mutation({
      query: ({ bookingId, body }) => ({ url: `/tracking/bookings/${bookingId}/destination`, method: 'PUT', data: body, principal: 'requester' }),
    }),
  }),
})

const { endpoints } = trackingApi

/** The technician's navigation view of a job they hold, and whether the customer can see them. */
export const fetchSharingStatus = (bookingId) => runQuery(endpoints.techSharingStatus, bookingId)
export const fetchTracking = (bookingId) => runQuery(endpoints.requesterTracking, bookingId)
/** The requester's confirmed pin for the service address. */
export const saveDestination = (bookingId, { latitude, longitude, accuracy = null }) =>
  runMutation(endpoints.requesterSaveDestination, { bookingId, body: { latitude, longitude, accuracy } })

/** The tracking websocket address, on the API's own origin. */
export const trackingSocketUrl = (bookingId) => websocketUrl(`/tracking/ws/bookings/${bookingId}`)

/** Whether this tab holds a booking session to open the socket with (cookie on the handshake). */
export const hasRequesterSession = () => requesterSession.isActive()
