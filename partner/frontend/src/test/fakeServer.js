import axios, { AxiosError } from 'axios'
import { apiClient, bookingClient } from '../shared/api/apiClient.js'

/**
 * A stand-in for the Partner API at axios's adapter, so the real clients (CSRF header,
 * single-flight refresh, retry) run in the tests. `routes` maps 'METHOD /path' (without
 * /api/v1) to a reply { status, data } or a function of the request returning one. Every
 * request is recorded with its headers and whose client sent it (`principal`).
 */
export function installFakeServer(routes = {}) {
  const requests = []
  const adapterFor = (principal) => async (config) => {
    const raw = String(config.url || '')
    const address = new URL(raw.startsWith('http') ? raw : `${config.baseURL || ''}${raw}`)
    const path = address.pathname.replace(/^\/api\/v1/, '')
    const method = String(config.method || 'get').toUpperCase()
    const headers = typeof config.headers?.toJSON === 'function' ? config.headers.toJSON() : { ...config.headers }
    const request = { method, path, headers, data: config.data, params: config.params, principal }
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
  apiClient.defaults.adapter = adapterFor('technician')
  bookingClient.defaults.adapter = adapterFor('requester')
  // The bare refresh and CSRF-recovery calls.
  axios.defaults.adapter = adapterFor('bare')
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

const ONBOARDING_COMPLETE = {
  step: 'COMPLETE',
  face_status: 'VERIFIED',
  aadhaar_status: 'VERIFIED',
  aadhaar_masked: 'XXXX XXXX 1234',
  can_receive_jobs: true,
  pending_requirements: [],
}

/** A technician account as the backend sends it (TechnicianResponse). */
export const aTechnician = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-0000000000c7',
  email: 'ramesh@example.in',
  phone: '9876500011',
  status: 'ACTIVE',
  name: 'Ramesh Kumar',
  address: '4 Lake Road',
  pincode: '560001',
  area: 'MG Road',
  block: null,
  district: 'Bengaluru Urban',
  state: 'Karnataka',
  location: 'Bengaluru',
  technician_type: 'PLUMBER',
  experience_years: 6,
  is_available: false,
  work_status: 'OFFLINE',
  profile_image_url: null,
  created_at: '2026-11-01T10:00:00+05:30',
  onboarding: ONBOARDING_COMPLETE,
  ...overrides,
})

/** GET /auth/me: the account, how the session is signed in, and its CSRF token. */
export const aSession = (user = aTechnician(), sessionType = 'partner') => ({ ...user, session_type: sessionType, csrf_token: 'csrf-technician' })

/** The requester the Professional hand-off signs in (POST/GET /requester/session). */
export const aRequesterSession = (overrides = {}) => ({
  expires_in_seconds: 3600,
  csrf_token: 'csrf-requester',
  requester: { id: '0190a8b2-4c1e-7aa0-9f00-000000000001', name: 'Asha Rao', role: 'OWNER', role_label: 'House Owner', pincode: '560001' },
  ...overrides,
})
