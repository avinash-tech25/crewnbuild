import { apiClient } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// A builder's portfolio, its CSV exports and the builder's own corrections to a
// closed day's cost register. Every builder has them; the server checks the role.
export const builderReportsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    builderPortfolio: build.query({ query: () => ({ url: '/builder/portfolio' }) }),
    costAdjustments: build.query({ query: (registerId) => ({ url: `/cost-tool/registers/${registerId}/builder-adjustments` }) }),
    saveCostAdjustment: build.mutation({
      query: ({ registerId, body }) => ({ url: `/cost-tool/registers/${registerId}/builder-adjustments`, method: 'POST', data: body }),
    }),
  }),
})

export const fetchCostAdjustments = (registerId) => runQuery(builderReportsApi.endpoints.costAdjustments, registerId)
export const saveCostAdjustment = (registerId, { fieldName, adjustedValue, reason }) =>
  runMutation(builderReportsApi.endpoints.saveCostAdjustment, {
    registerId,
    body: { field_name: fieldName, adjusted_value: Number(adjustedValue), reason },
  })

export const fetchBuilderPortfolio = () => runQuery(builderReportsApi.endpoints.builderPortfolio)

/**
 * Downloads a CSV as a file. It needs the session, so it goes through the API client (a
 * file for the browser, not data for the store).
 */
async function downloadCsv(path, fallbackName) {
  let response
  try {
    response = await apiClient.get(path, { responseType: 'blob' })
  } catch (error) {
    // A refusal arrives as a Blob here; read its JSON so the caller sees the detail.
    const data = error?.response?.data
    if (data && typeof data.text === 'function') {
      try {
        error.response.data = JSON.parse(await data.text())
      } catch {
        /* not JSON: keep as is */
      }
    }
    throw error
  }
  const disposition = response.headers?.['content-disposition'] || ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = match ? match[1] : fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadProjectSummary = (projectId) => downloadCsv(`/projects/${projectId}/summary.csv`, `project-${projectId}-summary.csv`)
export const downloadPortfolioExport = () => downloadCsv('/builder/portfolio/export.csv', 'builder-portfolio.csv')

/** A date for display, in the viewer's own locale. */
export function formatReportDate(isoUtc, locale) {
  if (!isoUtc) return '—'
  const value = new Date(isoUtc)
  if (Number.isNaN(value.getTime())) return '—'
  return value.toLocaleDateString(locale || undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** The backend's `{detail: {code, message}}`, or a plain fallback. */
export function reportErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  if (detail && typeof detail === 'object' && detail.message) return detail.message
  if (typeof detail === 'string') return detail
  return fallback
}
