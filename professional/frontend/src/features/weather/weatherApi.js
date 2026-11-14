import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'
import { weatherSiteBase } from './weatherHelpers.js'

// Weather for a site: a project's id, or MY_SITE for the signed-in account's own place.
// Every call is answered only for sites the account may read; the server holds the
// provider key and every threshold. The public pages' weather needs no sign-in.
export const weatherApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    weatherProjects: build.query({ query: () => ({ url: '/weather/projects' }) }),
    siteWeather: build.query({ query: ({ site, part, params }) => ({ url: `${weatherSiteBase(site)}/${part}`, params }) }),
    alertHistory: build.query({ query: (params) => ({ url: '/weather/alerts/history', params }) }),
    acknowledgeAlert: build.mutation({ query: (alertId) => ({ url: `/weather/alerts/${alertId}/acknowledge`, method: 'POST' }) }),
    saveSiteLocation: build.mutation({
      query: ({ site, payload }) => ({ url: `${weatherSiteBase(site)}/location`, method: 'PUT', data: payload }),
    }),
    weatherSummary: build.query({ query: (site) => ({ url: '/weather/summary', params: site ? { site } : {} }) }),
    publicWeather: build.query({
      query: ({ latitude, longitude }) => ({ url: '/weather/public', params: { latitude, longitude } }),
    }),
    publicPlaces: build.query({ query: (q) => ({ url: '/weather/public/places', params: { q } }) }),
    describePublicPlace: build.query({
      query: ({ latitude, longitude }) => ({ url: '/weather/public/describe', params: { latitude, longitude } }),
    }),
  }),
})

const { endpoints } = weatherApi
const siteWeather = (site, part, params) => runQuery(endpoints.siteWeather, { site, part, params })

export const fetchWeatherProjects = () => runQuery(endpoints.weatherProjects)
export const fetchCurrentWeather = (site) => siteWeather(site, 'current')
export const fetchHourlyForecast = (site) => siteWeather(site, 'forecast/hourly')
export const fetchDailyForecast = (site) => siteWeather(site, 'forecast/daily')
export const fetchWeatherAlerts = (site) => siteWeather(site, 'alerts')
export const fetchWeatherAlertHistory = (params) => runQuery(endpoints.alertHistory, params)
export const acknowledgeWeatherAlert = (alertId) => runMutation(endpoints.acknowledgeAlert, alertId)
export const fetchSiteLocation = (site) => siteWeather(site, 'location')
export const saveSiteLocation = (site, payload) => runMutation(endpoints.saveSiteLocation, { site, payload })
export const searchSiteLocation = (site, q) => siteWeather(site, 'location/search', q ? { q } : {})

// The header weather indicator: one place's weather ('me', a project id, or the server's
// default when none) and the most serious active alerts across the account's sites.
export const fetchWeatherSummary = (site = null) => runQuery(endpoints.weatherSummary, site)

export const fetchPublicWeather = (place) => runQuery(endpoints.publicWeather, place)
export const searchPublicPlaces = (q) => runQuery(endpoints.publicPlaces, q)
export const describePublicPlace = (place) => runQuery(endpoints.describePublicPlace, place)
