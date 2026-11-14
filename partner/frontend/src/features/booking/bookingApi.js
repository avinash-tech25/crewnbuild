import { bookingClient, storeRequesterSession } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The Professional origins allowed to hand a requester over; anything else is ignored.
export const PROFESSIONAL_ORIGINS = String(import.meta.env.VITE_PROFESSIONAL_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)

// The two messages of the hand-off, unchanged: the Professional side
// (features/partner-booking/partnerBooking.js) uses the same names.
export const HANDOFF_READY = 'PARTNER_BOOKING_READY'
export const HANDOFF_TOKEN = 'OCTABUILD_HOUSE_OWNER_HANDOFF'

const HANDOFF_TIMEOUT_MS = 10000

const bookingEndpoints = baseApi.injectEndpoints({
  endpoints: (build) => ({
    requesterStartSession: build.mutation({
      query: (handoffToken) => ({ url: '/requester/session', method: 'POST', data: { handoff_token: handoffToken }, principal: 'requester' }),
    }),
    requesterCurrentSession: build.query({
      query: () => ({ url: '/requester/session', principal: 'requester', skipRefresh: true }),
      keepUnusedDataFor: 0,
    }),
    requesterMe: build.query({ query: () => ({ url: '/requester/me', principal: 'requester' }) }),
    requesterRegisteredLocation: build.query({ query: () => ({ url: '/requester/me/registered-location', principal: 'requester' }) }),
    requesterServices: build.query({ query: (trade) => ({ url: '/requester/services', params: { trade }, principal: 'requester' }) }),
    requesterService: build.query({ query: ({ trade, slug }) => ({ url: `/requester/services/${trade}/${slug}`, principal: 'requester' }) }),
    requesterCreateBooking: build.mutation({ query: (body) => ({ url: '/requester/bookings', method: 'POST', data: body, principal: 'requester' }) }),
    requesterBooking: build.query({ query: (bookingId) => ({ url: `/requester/bookings/${bookingId}`, principal: 'requester' }) }),
    requesterBookings: build.query({ query: () => ({ url: '/requester/bookings', principal: 'requester' }) }),
    requesterCancelBooking: build.mutation({ query: (bookingId) => ({ url: `/requester/bookings/${bookingId}/cancel`, method: 'POST', principal: 'requester' }) }),
    requesterExecution: build.query({
      query: (bookingId) => ({ url: `/requester/bookings/${encodeURIComponent(bookingId)}/execution`, principal: 'requester' }),
    }),
    requesterStartOtp: build.query({
      query: (bookingId) => ({ url: `/requester/bookings/${encodeURIComponent(bookingId)}/start-otp`, principal: 'requester' }),
      keepUnusedDataFor: 0,
    }),
    requesterRegenerateStartOtp: build.mutation({
      query: (bookingId) => ({ url: `/requester/bookings/${encodeURIComponent(bookingId)}/start-otp/regenerate`, method: 'POST', principal: 'requester' }),
    }),
    requesterRating: build.query({ query: (bookingId) => ({ url: `/requester/bookings/${encodeURIComponent(bookingId)}/rating`, principal: 'requester' }) }),
    requesterSubmitRating: build.mutation({
      query: ({ bookingId, body }) => ({ url: `/requester/bookings/${encodeURIComponent(bookingId)}/rating`, method: 'POST', data: body, principal: 'requester' }),
    }),
    requesterRetryBooking: build.mutation({ query: (bookingId) => ({ url: `/requester/bookings/${bookingId}/retry`, method: 'POST', principal: 'requester' }) }),
  }),
})

const { endpoints } = bookingEndpoints

// The hand-shake in progress, if any. A hand-off token can be spent only once, so two
// callers at the same moment must share one hand-shake.
let handshakeInProgress = null

/**
 * Ask the Professional window that opened this one for a one-time hand-off token for the
 * signed-in House Owner or Site Engineer, and trade it for a Partner booking session
 * (HttpOnly cookies set by the Partner backend).
 *
 * The token crosses between the two windows with postMessage only: it is never put in a
 * URL or storage, lives about a minute and is spent the moment the Partner backend has
 * verified it. Both directions are pinned to an exact origin, and the answer is accepted
 * only from the very window that opened this one.
 */
export function startRequesterSessionFromProfessional() {
  if (!handshakeInProgress) {
    handshakeInProgress = handshakeWithProfessional().finally(() => {
      handshakeInProgress = null
    })
  }
  return handshakeInProgress
}

function handshakeWithProfessional() {
  return new Promise((resolve, reject) => {
    const opener = window.opener
    if (!opener || opener.closed || PROFESSIONAL_ORIGINS.length === 0) {
      reject(Object.assign(new Error('no-opener'), { code: 'NO_OPENER' }))
      return
    }

    let settled = false
    const finish = (callback) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      callback()
    }

    function onMessage(event) {
      if (!PROFESSIONAL_ORIGINS.includes(event.origin)) return
      if (event.source !== opener) return
      if (event.data?.type !== HANDOFF_TOKEN || typeof event.data.handoffToken !== 'string') return
      const handoffToken = event.data.handoffToken
      finish(async () => {
        try {
          resolve(storeRequesterSession(await runMutation(endpoints.requesterStartSession, handoffToken)))
        } catch (error) {
          reject(error)
        }
      })
    }

    const timer = window.setTimeout(
      () => finish(() => reject(Object.assign(new Error('handoff-timeout'), { code: 'TIMEOUT' }))),
      HANDOFF_TIMEOUT_MS,
    )
    window.addEventListener('message', onMessage)
    PROFESSIONAL_ORIGINS.forEach((origin) => {
      try {
        opener.postMessage({ type: HANDOFF_READY }, origin)
      } catch {
        /* a malformed origin in configuration */
      }
    })
  })
}

/**
 * The booking session the server holds for this tab (after a reload), or null when there
 * is none. Nothing about it was kept in the browser: the cookies decide.
 */
export async function resumeRequesterSession() {
  try {
    return storeRequesterSession(await runQuery(endpoints.requesterCurrentSession))
  } catch (error) {
    if (error?.response?.status === 401) return null
    throw error
  }
}

// `bookingClient` is used directly only for a photo (a file for the screen, not data).
export const fetchRequester = () => runQuery(endpoints.requesterMe)

/**
 * Where this account's registered address is, resolved to a point by the backend: the
 * booking map's fallback when the device cannot fix a precise position. Null when the
 * address could not be placed; the map then asks the requester to search.
 */
export async function fetchRegisteredLocation() {
  return (await runQuery(endpoints.requesterRegisteredLocation)) || null
}

/** A trade's bookable services, in the order the catalog publishes them. */
export const fetchServices = (trade) => runQuery(endpoints.requesterServices, trade)
/** One service, so a link straight to it survives a reload. */
export const fetchService = (trade, slug) => runQuery(endpoints.requesterService, { trade, slug })

// `serviceId` is the only thing the booking says about price: the amount is read from the
// catalog on the server, so there is deliberately no price or currency in this payload.
export const createBooking = ({ technicianType, serviceId, description, serviceLatitude, serviceLongitude, serviceAccuracy }) =>
  runMutation(endpoints.requesterCreateBooking, {
    service_id: serviceId ?? null,
    technician_type: technicianType,
    description: description || null,
    // Where the work is, as placed on the booking map: the nearest technicians to this
    // point are the ones asked.
    service_latitude: serviceLatitude,
    service_longitude: serviceLongitude,
    // Present only for a point the device produced, so the backend can refuse a city-sized
    // guess. A pin placed by hand has no accuracy to state.
    service_accuracy: serviceAccuracy ?? null,
  })

export const fetchBooking = (bookingId) => runQuery(endpoints.requesterBooking, bookingId)
export const fetchMyBookings = () => runQuery(endpoints.requesterBookings)
export const cancelBooking = (bookingId) => runMutation(endpoints.requesterCancelBooking, bookingId)
/** The job's progress as the requester may see it (read only): checklist steps and photos. */
export const fetchBookingExecution = (bookingId) => runQuery(endpoints.requesterExecution, bookingId)

/** One job photo, fetched with the booking session as a blob (memory only, never a URL token). */
export async function fetchBookingPhoto(bookingId, mediaId, signal) {
  const response = await bookingClient.get(
    `/requester/bookings/${encodeURIComponent(bookingId)}/media/${encodeURIComponent(mediaId)}/content`,
    { responseType: 'blob', signal },
  )
  return response.data
}

/** The customer's Start Work code for their own booking (present once the technician has arrived). */
export const fetchStartOtp = (bookingId) => runQuery(endpoints.requesterStartOtp, bookingId)
/** A new Start Work code; the previous one stops working. */
export const regenerateStartOtp = (bookingId) => runMutation(endpoints.requesterRegenerateStartOtp, bookingId)
/** This customer's rating state for their own booking, with the backend's tag vocabulary. */
export const fetchRating = (bookingId) => runQuery(endpoints.requesterRating, bookingId)
/** Whole stars and optional predefined tags; once per completed booking. */
export const submitRating = (bookingId, { stars, tags }) => runMutation(endpoints.requesterSubmitRating, { bookingId, body: { stars, tags } })
export const retryBooking = (bookingId) => runMutation(endpoints.requesterRetryBooking, bookingId)
