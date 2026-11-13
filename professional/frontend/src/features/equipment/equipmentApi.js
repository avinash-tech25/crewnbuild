import { baseApi } from '../../shared/api/baseApi.js'
import { runQuery } from '../../shared/api/callEndpoint.js'

export const equipmentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    equipmentItems: build.query({ query: () => ({ url: '/equipment/items' }) }),
  }),
})

// An Equipment Supplier's own items (the supplier profile step counts them).
export const fetchEquipmentItems = () => runQuery(equipmentApi.endpoints.equipmentItems)
