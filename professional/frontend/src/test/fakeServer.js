import axios, { AxiosError } from 'axios'
import { apiClient } from '../shared/api/apiClient.js'

/**
 * A stand-in for the API at axios's adapter, so the real client (CSRF header, single-flight
 * refresh, retry) runs in the tests. `routes` maps 'METHOD /path' (without /api/v1) to a
 * reply { status, data } or a function of the request returning one. Every request is
 * recorded with its headers.
 */
export function installFakeServer(routes = {}) {
  const requests = []
  const adapter = async (config) => {
    const raw = String(config.url || '')
    const address = new URL(raw.startsWith('http') ? raw : `${config.baseURL || ''}${raw}`)
    const path = address.pathname.replace(/^\/api\/v1/, '')
    const method = String(config.method || 'get').toUpperCase()
    const headers = typeof config.headers?.toJSON === 'function' ? config.headers.toJSON() : { ...config.headers }
    const request = { method, path, headers, data: config.data, params: config.params }
    requests.push(request)
    const handler = routes[`${method} ${path}`]
    const reply = (typeof handler === 'function' ? await handler(request, requests) : handler) || {
      status: 404,
      data: { detail: 'Not Found' },
    }
    const response = { data: reply.data, status: reply.status ?? 200, statusText: '', headers: {}, config, request: {} }
    if (response.status >= 400) {
      throw new AxiosError(`Request failed with status code ${response.status}`, 'ERR_BAD_RESPONSE', config, {}, response)
    }
    return response
  }
  apiClient.defaults.adapter = adapter
  axios.defaults.adapter = adapter
  return {
    requests,
    route(key, reply) {
      routes[key] = reply
    },
    calls(key) {
      const [method, path] = key.split(' ')
      return requests.filter((request) => request.method === method && request.path === path)
    },
  }
}

export const anAccount = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-000000000001',
  name: 'Asha Rao',
  email: 'asha@example.in',
  email_verified: true,
  phone: '9876543210',
  role: 'OWNER',
  address: '12 MG Road',
  pincode: '560001',
  location: 'Bengaluru',
  country_of_residence: 'India',
  rating: 0,
  profile_complete: true,
  engineer_profile: null,
  subscription_checkout: null,
  ...overrides,
})
