import { baseApi } from '../../shared/api/baseApi.js'
import { runQuery } from '../../shared/api/callEndpoint.js'

export const publicProfileApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // `projectId` (optional): an owner viewing a builder for one project sees the builder's
    // contact only when that project's request is accepted.
    builderProfile: build.query({
      query: ({ builderId, projectId }) => ({
        url: `/contractors/${builderId}/profile`,
        params: projectId ? { project_id: projectId } : {},
      }),
    }),
    supplierProfile: build.query({ query: (supplierId) => ({ url: `/suppliers/${supplierId}/profile` }) }),
  }),
})

export const fetchContractorProfile = (builderId, projectId = null) =>
  runQuery(publicProfileApi.endpoints.builderProfile, { builderId, projectId })
export const fetchSupplierProfile = (supplierId) => runQuery(publicProfileApi.endpoints.supplierProfile, supplierId)
