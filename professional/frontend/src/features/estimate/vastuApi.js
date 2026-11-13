import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

// The server allows about 180 s for the vision call (a real plan once took 78 s), so the
// browser waits a little longer than that before giving up.
const ANALYSIS_TIMEOUT_MS = 200_000

export const vastuApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    planAnalysis: build.mutation({
      query: (form) => ({ url: '/vastu/plan-analysis', method: 'POST', data: form, timeout: ANALYSIS_TIMEOUT_MS }),
    }),
  }),
})

/**
 * Send a floor plan for analysis. Always resolves with the server's structured answer,
 * including its refusals (invalid_file, unavailable, rate_limited), because each carries the
 * reason to show. Only a network failure or a timeout become `unavailable` here.
 */
export async function analyseVastuPlan(file) {
  const form = new FormData()
  form.append('plan', file)
  try {
    return await runMutation(vastuApi.endpoints.planAnalysis, form)
  } catch (error) {
    if (error.response?.data?.status) return error.response.data
    return {
      status: 'unavailable',
      reason:
        error.code === 'ECONNABORTED'
          ? 'The analysis took too long and was stopped. Please try again later.'
          : 'Plan analysis is temporarily unavailable.',
      vastuResult: null,
    }
  }
}
