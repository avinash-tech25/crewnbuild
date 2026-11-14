import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'

const FIND = { timeout: 8000 }
const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000a1'
const BENGALURU = { latitude: 12.97, longitude: 77.59, location_name: 'Bengaluru', country_code: 'IN', timezone: 'Asia/Kolkata', source: 'MANUAL', approximate: false }

const catalog = (projects = []) => ({
  projects,
  personal: { location: BENGALURU, active_alerts: 0, highest_severity: null },
  severities: ['LOW', 'MEDIUM', 'HIGH', 'SEVERE'],
  alert_types: [],
  message: null,
  provider: 'open-meteo',
})

const siteView = (overrides = {}) => ({
  site: 'personal',
  access: 'personal',
  project_id: null,
  project_title: null,
  location: BENGALURU,
  can_edit_location: true,
  can_acknowledge: true,
  status: { available: true, stale: false },
  timezone: 'Asia/Kolkata',
  current: { observed_at: '2026-11-14T09:00:00+05:30', temperature_c: 24, condition: 'Clear', humidity: 60, wind_kph: 8 },
  ...overrides,
})

describe('Site Weather', () => {
  it("shows a supplier the weather of their own place", async () => {
    const server = installFakeServer({
      'GET /weather/projects': { data: catalog() },
      'GET /weather/me/current': { data: siteView() },
      'GET /weather/me/forecast/hourly': { data: { hours: [] } },
      'GET /weather/me/forecast/daily': { data: { days: [] } },
      'GET /weather/me/alerts': { data: { alerts: [] } },
    })
    renderApp('/weather', { auth: signedInAs(anAccount({ role: 'SUPPLIER' })) })
    expect(await screen.findByText('Site Weather', {}, FIND)).toBeInTheDocument()
    await waitFor(() => expect(server.calls('GET /weather/me/current')).toHaveLength(1))
    expect(server.calls('GET /weather/projects')).toHaveLength(1)
  })

  it("opens an owner's first project site", async () => {
    const server = installFakeServer({
      'GET /weather/projects': {
        data: catalog([{
          id: PROJECT_ID, title: 'Rao Family Home', city: 'Bengaluru', state: 'Karnataka', country: 'India', status: 'planning',
          access: 'member', location: BENGALURU, can_edit_location: true, can_acknowledge: true, active_alerts: 0, highest_severity: null,
        }]),
      },
      [`GET /weather/projects/${PROJECT_ID}/current`]: { data: siteView({ site: 'project', access: 'member', project_id: PROJECT_ID, project_title: 'Rao Family Home' }) },
    })
    renderApp('/weather', { auth: signedInAs(anAccount({ role: 'OWNER' })) })
    await waitFor(() => expect(server.calls(`GET /weather/projects/${PROJECT_ID}/current`)).toHaveLength(1))
    expect((await screen.findAllByText(/Rao Family Home/, {}, FIND)).length).toBeGreaterThan(0)
  })

  it('says so when weather is not set up on the server', async () => {
    installFakeServer({ 'GET /weather/projects': { status: 503, data: { detail: 'Weather is not configured' } } })
    renderApp('/weather', { auth: signedInAs(anAccount({ role: 'OWNER' })) })
    expect(await screen.findByText('Weather is not available yet.', {}, FIND)).toBeInTheDocument()
  })

  it('asks a signed-out visitor to sign in first', async () => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp('/weather', { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: '/weather' })
  })
})
