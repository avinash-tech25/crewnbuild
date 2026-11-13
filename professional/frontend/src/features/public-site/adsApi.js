import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The adverts running in one placement, and their view and click counts.
export const adsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    placementAds: build.query({ query: ({ placement, country, position }) => ({ url: '/ads', params: { placement, country, position } }) }),
    adEvent: build.mutation({ query: ({ id, placement, event }) => ({ url: `/ads/${id}/event`, method: 'POST', data: { placement, event } }) }),
  }),
})

export const fetchPlacementAds = (placement, country, position) =>
  runQuery(adsApi.endpoints.placementAds, { placement, country: country || undefined, position })

export const recordAdEvent = (id, placement, event) => runMutation(adsApi.endpoints.adEvent, { id, placement, event })
