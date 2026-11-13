import { createApi } from '@reduxjs/toolkit/query/react'
import { apiClient } from './apiClient.js'

/**
 * RTK Query's base query over the one HTTP client (apiClient.js), so cookies, the CSRF
 * header and the single-flight refresh apply to every endpoint. Each feature adds its
 * endpoints with baseApi.injectEndpoints in its own <feature>Api.js.
 *
 * An endpoint describes a request as { url, method, data, params, timeout, responseType,
 * skipRefresh } (skipRefresh: a 401 is returned as it is, no refresh attempted).
 * A failure is { status, data, code }: status is the HTTP status (or 'FETCH_ERROR' when
 * no answer came back), data the server's body, code axios's code (ECONNABORTED on a
 * timeout).
 */
export async function clientBaseQuery({ url, method = 'GET', data, params, headers, timeout, responseType, skipRefresh }) {
  try {
    const response = await apiClient({ url, method, data, params, headers, timeout, responseType, skipRefresh })
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
  tagTypes: ['Session', 'SupportTicket', 'Subscription'],
  endpoints: () => ({}),
})
