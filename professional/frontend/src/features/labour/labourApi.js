import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Labour supply. The server is the authority for every rule: the trade list, capacity,
// who may request from whom.
export const LABOR_SUPPLIER_CATEGORY = 'Labor Supplier'

const send = (method, url, data, params) => ({ url, method, data, params })

export const labourApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    labourTrades: build.query({ query: () => ({ url: '/labor/trades' }) }),
    labourRead: build.query({ query: ({ url, params }) => ({ url, params }) }),
    labourWrite: build.mutation({ query: ({ method, url, data }) => send(method, url, data) }),
  }),
})

const { endpoints } = labourApi
const read = (url, params) => runQuery(endpoints.labourRead, { url, params })
const write = (method, url, data) => runMutation(endpoints.labourWrite, { method, url, data })

// The trades the server accepts; never duplicated here.
export const fetchLaborTrades = () => runQuery(endpoints.labourTrades)

// ---- Labour Supplier ----
export const fetchLaborServices = () => read('/labor/services')
export const createLaborService = (payload) => write('POST', '/labor/services', payload)
export const updateLaborService = (id, payload) => write('PATCH', `/labor/services/${id}`, payload)
export const deleteLaborService = (id) => write('DELETE', `/labor/services/${id}`)
export const fetchSupplierLaborRequests = (status) => read('/labor/requests', status ? { status } : {})
export const acceptLaborRequest = (id, payload) => write('POST', `/labor/requests/${id}/accept`, payload)
export const rejectLaborRequest = (id, decisionNote) => write('POST', `/labor/requests/${id}/reject`, { decision_note: decisionNote || null })
export const fetchSupplierLaborDailyRecords = (id) => read(`/labor/requests/${id}/daily-records`)

// ---- Site Engineer ----
export const fetchProjectLaborSupplierServices = (projectId, supplierId) => read(`/projects/${projectId}/labor-suppliers/${supplierId}/services`)
export const fetchProjectLaborRequests = (projectId) => read(`/projects/${projectId}/labor-requests`)
export const createLaborRequest = (projectId, payload) => write('POST', `/projects/${projectId}/labor-requests`, payload)
export const cancelLaborRequest = (id) => write('POST', `/labor-requests/${id}/cancel`)
export const completeLaborRequest = (id) => write('POST', `/labor-requests/${id}/complete`)
export const updateLaborRequest = (id, payload) => write('PATCH', `/labor-requests/${id}`, payload)
export const fetchLaborDailyRecords = (id) => read(`/labor-requests/${id}/daily-records`)
export const saveLaborDailyRecord = (id, workDate, payload) => write('PUT', `/labor-requests/${id}/daily-records/${workDate}`, payload)

// The server's own message, readable: a string detail, or the first 422 field error.
export function laborErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0]
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : ''
    return field ? `${String(field).replace(/_/g, ' ')}: ${first.msg}` : first.msg
  }
  return fallback
}

// Today in the browser's own calendar, as the YYYY-MM-DD the API takes.
export function localIsoDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
