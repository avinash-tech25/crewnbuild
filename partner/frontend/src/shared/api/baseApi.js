import { createApi } from '@reduxjs/toolkit/query/react'
import { apiClient, bookingClient } from './apiClient.js'

/**
 * RTK Query's base query over the two session clients (apiClient.js). Every endpoint says
 * whose request it is with `principal`:
 *
 *   'technician'  (default) the technician's client and cookies
 *   'requester'   the booking session's client and cookies
 *
 * so a technician's call can never go out on the booking session or the other way round.
 * An endpoint describes a request as { url, method, data, params, timeout, principal,
 * skipRefresh, onUploadProgress }. A failure is { status, data, code }: status is the HTTP
 * status (or 'FETCH_ERROR' when no answer came back).
 */
const CLIENTS = { technician: apiClient, requester: bookingClient }

export async function clientBaseQuery({ url, method = 'GET', data, params, timeout, principal = 'technician', skipRefresh, onUploadProgress }) {
  const client = CLIENTS[principal]
  if (!client) throw new Error(`Unknown principal: ${principal}`)
  try {
    const response = await client({ url, method, data, params, timeout, skipRefresh, onUploadProgress })
    return { data: response.data }
  } catch (error) {
    return {
      error: {
        status: error.response?.status ?? 'FETCH_ERROR',
        data: error.response?.data,
        code: error.code,
        message: error.message,
      },
    }
  }
}

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: clientBaseQuery,
  endpoints: () => ({}),
})
