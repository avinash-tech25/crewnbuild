import { afterEach, beforeEach, vi } from 'vitest'
import { aSession, aTechnician, installFakeServer } from './fakeServer.js'
import { renderApp, technicianSignedIn } from './renderApp.jsx'
import { __resetNotificationSoundForTests } from '../features/technician/notificationSound.js'

/** Fixtures for the technician dashboard tests, shaped as the Partner backend answers. */

export const FIND = { timeout: 8000 }
export const JOB_ID = '0190a8b2-4c1e-7aa0-9f00-00000000b001'
export const AVAILABLE = aTechnician({ work_status: 'AVAILABLE', is_available: true })

export const summary = (overrides = {}) => ({
  new_requests: 0, accepted_jobs: 0, active_jobs: 0, completed_jobs: 0, cancelled_jobs: 0,
  work_status: 'AVAILABLE', is_available: true, can_receive_jobs: true, pending_requirements: [], ...overrides,
})
export const soon = (seconds) => new Date(Date.now() + seconds * 1000).toISOString()
export const anOffer = (overrides = {}) => ({
  booking_id: JOB_ID, technician_type: 'PLUMBER', work_area: 'Kitchen', distance_meters: 1200, service_name: 'Pipe Leakage Repair',
  quoted_amount: '499.00', estimated_net_amount: '449.10', offered_at: soon(-5), expires_at: soon(60), ...overrides,
})
export const aJob = (status, overrides = {}) => ({
  id: JOB_ID, status, technician_type: 'PLUMBER', requester_type: 'OWNER', requester_type_label: 'House Owner', service_area: null, pincode: '560001',
  service_address: '1 Test Road', service_latitude: 12.97, service_longitude: 77.59, description: 'Kitchen', service_name: 'Pipe Leakage Repair',
  service_kind: 'SERVICE', quoted_amount: '499.00', currency: 'INR', requested_at: soon(-900), offer_expires_at: null, match_label: '1 km away',
  requester_name: 'Asha Rao', requester_phone: '9000000001',
  next_actions: { ACCEPTED: ['en-route'], ARRIVED: ['start'], IN_PROGRESS: ['complete'] }[status] || [],
  accepted_at: soon(-800), en_route_at: soon(-700), arrived_at: status === 'ARRIVED' || status === 'IN_PROGRESS' ? soon(-600) : null,
  started_at: status === 'IN_PROGRESS' ? soon(-300) : null, completed_at: null, cancelled_at: null, ...overrides,
})
export const execution = (status, media = []) => ({
  booking_id: JOB_ID, status, steps: [], steps_total: 0, steps_completed: 0, service_notes: null, service_notes_updated_at: null,
  media, can_edit_steps: status === 'IN_PROGRESS', can_edit_notes: status === 'IN_PROGRESS',
  can_upload: status === 'ARRIVED' ? ['BEFORE'] : ['BEFORE', 'AFTER'], media_limits: { CUSTOMER: 5, BEFORE: 6, AFTER: 6 },
})

/** Answers for everything the dashboard asks for on load; tests override what they look at. */
export function dashboardRoutes(user, overrides = {}) {
  return {
    'GET /auth/me': { data: aSession(user) },
    'GET /technicians/me/dashboard': { data: summary({ work_status: user.work_status }) },
    'GET /technicians/me/earnings/summary': { data: { currency: 'INR', today_net: '0.00', week_net: '0.00', month_net: '0.00', total_net: '0.00', total_gross: '0.00', total_commission: '0.00', earnings_count: 0 } },
    'GET /technicians/me/weather': { data: { location_required: true, status: { available: false }, hourly: [], daily: [], alerts: [] } },
    'GET /technicians/me/jobs': { data: [] },
    'GET /technicians/me/offers': { data: [] },
    'GET /technicians/me/presence': { data: { ready_for_nearby_jobs: true, update_interval_seconds: 3 } },
    'POST /technicians/me/location': { data: { ready_for_nearby_jobs: true, update_interval_seconds: 3, active_job: null } },
    'DELETE /technicians/me/location': { data: { ready_for_nearby_jobs: false } },
    ...overrides,
  }
}

export function openDashboard(user, overrides) {
  const server = installFakeServer(dashboardRoutes(user, overrides))
  const view = renderApp('/dashboard', { auth: technicianSignedIn(user) })
  return { server, ...view }
}

/**
 * A device that knows where it is, on a secure page, for every test of the calling file;
 * and no Web Audio unless a test installs it. Returns the geolocation stand-in, refreshed
 * before each test.
 */
export function withDeviceStandIns() {
  const device = { geolocation: null }
  beforeEach(() => {
    device.geolocation = {
      getCurrentPosition: vi.fn((ok) => ok({ coords: { latitude: 12.97, longitude: 77.59, accuracy: 10 }, timestamp: Date.now() })),
      watchPosition: vi.fn(() => 7),
      clearWatch: vi.fn(),
    }
    Object.defineProperty(navigator, 'geolocation', { value: device.geolocation, configurable: true })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  })
  afterEach(() => {
    __resetNotificationSoundForTests()
    delete window.AudioContext
    delete navigator.geolocation
    delete window.isSecureContext
    vi.restoreAllMocks()
  })
  return device
}
