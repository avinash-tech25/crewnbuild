import { translate } from '../../i18n/translate.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Equipment supply. The server is the authority for availability, stock, prices and who
// may request from whom.
export const EQUIPMENT_SUPPLIER_CATEGORY = 'Equipment Supplier'

// Labels are getters so they follow the language selected at render time.
export const EQUIPMENT_MODES = [
  { value: 'RENT', get label() { return translate('equipment.mode.rent') } },
  { value: 'BUY', get label() { return translate('equipment.mode.buy') } },
  { value: 'RENT_BUY', get label() { return translate('equipment.mode.rentBuy') } },
]
export const EQUIPMENT_CONDITIONS = [
  { value: 'NEW', get label() { return translate('equipment.condition.new') } },
  { value: 'USED', get label() { return translate('equipment.condition.used') } },
]
// rate_unit -> the item field holding that rate (mirrors the server's rate columns).
export const RATE_UNITS = [
  { unit: 'HOUR', field: 'hourly_rate', get label() { return translate('equipment.unit.hour') }, get rateLabel() { return translate('equipment.rate.hourly') }, get per() { return translate('equipment.per.hour') } },
  { unit: 'DAY', field: 'daily_rate', get label() { return translate('equipment.unit.day') }, get rateLabel() { return translate('equipment.rate.daily') }, get per() { return translate('equipment.per.day') } },
  { unit: 'WEEK', field: 'weekly_rate', get label() { return translate('equipment.unit.week') }, get rateLabel() { return translate('equipment.rate.weekly') }, get per() { return translate('equipment.per.week') } },
  { unit: 'MONTH', field: 'monthly_rate', get label() { return translate('equipment.unit.month') }, get rateLabel() { return translate('equipment.rate.monthly') }, get per() { return translate('equipment.per.month') } },
]

export const modeLabel = (mode) => EQUIPMENT_MODES.find((item) => item.value === mode)?.label || mode
export const allowsRent = (item) => item?.mode === 'RENT' || item?.mode === 'RENT_BUY'
export const allowsBuy = (item) => item?.mode === 'BUY' || item?.mode === 'RENT_BUY'
export const ratePer = (unit) => RATE_UNITS.find((item) => item.unit === unit)?.per || String(unit || '').toLowerCase()
// Units this item can actually be rented by: only those with a rate.
export const rentableUnits = (item) => RATE_UNITS.filter((rate) => item?.[rate.field] != null)

export const equipmentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    equipmentItems: build.query({ query: () => ({ url: '/equipment/items' }) }),
    equipmentRead: build.query({ query: ({ url, params }) => ({ url, params }) }),
    equipmentWrite: build.mutation({ query: ({ method, url, data }) => ({ url, method, data }) }),
  }),
})

const { endpoints } = equipmentApi
const read = (url, params) => runQuery(endpoints.equipmentRead, { url, params })
const write = (method, url, data) => runMutation(endpoints.equipmentWrite, { method, url, data })

// ---- Equipment Supplier ----
export const fetchEquipmentItems = () => runQuery(endpoints.equipmentItems)
export const createEquipmentItem = (payload) => write('POST', '/equipment/items', payload)
export const updateEquipmentItem = (id, payload) => write('PATCH', `/equipment/items/${id}`, payload)
export const deactivateEquipmentItem = (id) => write('DELETE', `/equipment/items/${id}`)
export const fetchSupplierEquipmentRequests = (status) => read('/equipment/requests', status ? { status } : {})
export const acceptEquipmentRequest = (id) => write('POST', `/equipment/requests/${id}/accept`)
export const rejectEquipmentRequest = (id, decisionNote) => write('POST', `/equipment/requests/${id}/reject`, { decision_note: decisionNote || null })
export const completeEquipmentRequest = (id) => write('POST', `/equipment/requests/${id}/complete`)

// ---- Site Engineer ----
export const fetchProjectEquipmentItems = (projectId, supplierId, range) =>
  read(
    `/projects/${projectId}/equipment-suppliers/${supplierId}/items`,
    range?.start && range?.end ? { start_date: range.start, end_date: range.end } : {},
  )
export const fetchProjectEquipmentRequests = (projectId) => read(`/projects/${projectId}/equipment-requests`)
export const createEquipmentRequest = (projectId, payload) => write('POST', `/projects/${projectId}/equipment-requests`, payload)
export const cancelEquipmentRequest = (id) => write('POST', `/equipment-requests/${id}/cancel`)
export const fetchEquipmentUsage = (id) => read(`/equipment-requests/${id}/usage`)
export const saveEquipmentUsage = (id, usageDate, payload) => write('PUT', `/equipment-requests/${id}/usage/${usageDate}`, payload)

// The server's own message: a string detail, or the first 422 error made readable.
export function equipmentErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0]
    const message = String(first?.msg || '').replace(/^Value error, /, '')
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : ''
    return field && field !== 'body' ? `${String(field).replace(/_/g, ' ')}: ${message}` : message
  }
  return fallback
}
