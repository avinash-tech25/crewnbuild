import { baseApi } from '../../shared/api/baseApi.js'
import { runQuery } from '../../shared/api/callEndpoint.js'

// The public pages' weather (no sign-in): general weather for coordinates the browser sends.
export const weatherApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    publicWeather: build.query({
      query: ({ latitude, longitude }) => ({ url: '/weather/public', params: { latitude, longitude } }),
    }),
    publicPlaces: build.query({ query: (q) => ({ url: '/weather/public/places', params: { q } }) }),
    describePublicPlace: build.query({
      query: ({ latitude, longitude }) => ({ url: '/weather/public/describe', params: { latitude, longitude } }),
    }),
  }),
})

export const fetchPublicWeather = (place) => runQuery(weatherApi.endpoints.publicWeather, place)
export const searchPublicPlaces = (q) => runQuery(weatherApi.endpoints.publicPlaces, q)
export const describePublicPlace = (place) => runQuery(weatherApi.endpoints.describePublicPlace, place)
