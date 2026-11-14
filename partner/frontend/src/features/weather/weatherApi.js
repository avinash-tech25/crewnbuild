import { baseApi } from '../../shared/api/baseApi.js'
import { runQuery } from '../../shared/api/callEndpoint.js'

// The technician's weather (technician session), and the public pages' general weather
// (no session needed; sent on the technician client as before).
export const weatherApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techWeather: build.query({ query: (params) => ({ url: '/technicians/me/weather', params }) }),
    techWeatherPlaces: build.query({ query: (q) => ({ url: '/technicians/me/weather/places', params: { q } }) }),
    techWeatherDescribe: build.query({ query: ({ lat, lng }) => ({ url: '/technicians/me/weather/describe', params: { lat, lng } }) }),
    publicWeather: build.query({ query: ({ latitude, longitude }) => ({ url: '/weather/public', params: { latitude, longitude } }) }),
    publicWeatherPlaces: build.query({ query: (q) => ({ url: '/weather/public/places', params: { q } }) }),
    publicWeatherDescribe: build.query({
      query: ({ latitude, longitude }) => ({ url: '/weather/public/describe', params: { latitude, longitude } }),
    }),
  }),
})

const { endpoints } = weatherApi

// Without a place: the current job's. With one: a place chosen ({ latitude, longitude,
// name, source: 'CHOSEN' }) or the device's position (source 'DEVICE'), which the page
// asks the browser for only on request.
export const fetchTechnicianWeather = (place = null) =>
  runQuery(
    endpoints.techWeather,
    place ? { latitude: place.latitude, longitude: place.longitude, source: place.source || 'CHOSEN', name: place.name || undefined } : {},
  )
export const searchWeatherPlaces = (q) => runQuery(endpoints.techWeatherPlaces, q)
export const describeWeatherPlace = (lat, lng) => runQuery(endpoints.techWeatherDescribe, { lat, lng })

export const fetchPublicWeather = (place) => runQuery(endpoints.publicWeather, place)
export const searchPublicPlaces = (q) => runQuery(endpoints.publicWeatherPlaces, q)
export const describePublicPlace = (place) => runQuery(endpoints.publicWeatherDescribe, place)
