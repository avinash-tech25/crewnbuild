import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { routes } from './routes.jsx'
import { builderDashboardServer } from '../../features/builder/builderTestData.js'

// Every top-level address of the old app (its AppRouter), which must all still answer.
const OLD_ROUTES = [
  '/', '/about', '/services', '/projects', '/why-us', '/process', '/testimonials', '/contact', '/contact-us',
  '/contact-us/tickets', '/contact-us/tickets/:reference', '/delete-account', '/owner/profile/delete', '/estimate',
  '/login', '/signup', '/forgot-password', '/account-recovery', '/invite/:code', '/oauth/callback',
  '/supplier-category', '/engineer-category', '/pincode', '/complete-profile', '/owner/*', '/contractors/:contractorId',
  '/contractor/*', '/supplier/*', '/engineer/live-camera', '/engineer/*', '/store-manager/*',
  '/weather', '/admin/*', '/coming-soon', '/404', '*',
]

const OWNER = anAccount({ role: 'OWNER' })
const BUILDER = anAccount({ role: 'BUILDER', id: '0190a8b2-4c1e-7aa0-9f00-000000000002' })
const SUPPLIER = anAccount({ role: 'SUPPLIER' })
const SITE_ENGINEER = anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer' } })
const ADMIN = anAccount({ role: 'GLOBAL_SUPER_ADMIN' })

describe('the route table', () => {
  it('gives every route an access rule (FE-01)', () => {
    for (const route of routes) {
      const valid = route.access === 'public' || route.access === 'guest' || Array.isArray(route.access?.roles)
      expect(valid, route.path).toBe(true)
    }
  })

  it('keeps every address of the old app', () => {
    const paths = routes.map((route) => route.path)
    for (const path of OLD_ROUTES) expect(paths, path).toContain(path)
  })
})

// Each dashboard's own access tests (role, sign-in and the way back) are with it:
// features/owner, builder, engineer, supplier and admin.
describe('RequireAccess', () => {
  it('shows only a loader while the server is still confirming the session', async () => {
    renderApp('/owner', { auth: { user: null, sessionStatus: 'verifying' } })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument()
    expect(location.current.pathname).toBe('/owner')
  })

  it('opens a builder straight into the dashboard, with no checkout step', async () => {
    installFakeServer(builderDashboardServer())
    renderApp('/contractor', { auth: signedInAs(BUILDER) })
    expect(await screen.findByText(/Welcome/, {}, { timeout: 15000 })).toBeInTheDocument()
    expect(location.current.pathname).toBe('/contractor')
  })

  it('sends another role away from the builder dashboard to its own home', async () => {
    installFakeServer({})
    renderApp('/contractor', { auth: signedInAs(OWNER) })
    await waitFor(() => expect(location.current.pathname).toBe('/owner'))
  })

  it('answers the former checkout address with the not-found page', async () => {
    renderApp('/subscription-checkout', { auth: signedInAs(BUILDER) })
    expect((await screen.findAllByText('Error 404')).length).toBeGreaterThan(0)
  })

  it.each([OWNER, BUILDER, SUPPLIER, SITE_ENGINEER, ADMIN])('opens weather for every signed-in role (%#)', async (account) => {
    installFakeServer({ 'GET /weather/projects': { status: 503, data: {} } })
    renderApp('/weather', { auth: signedInAs(account) })
    expect(await screen.findByText('Site Weather', {}, { timeout: 15000 })).toBeInTheDocument()
    expect(location.current.pathname).toBe('/weather')
  })

  it('answers an unknown address with the not-found page', async () => {
    renderApp('/no/such/page', { auth: signedOut })
    expect((await screen.findAllByText('Error 404')).length).toBeGreaterThan(0)
    expect(location.current.pathname).toBe('/no/such/page')
  })
})
