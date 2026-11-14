import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { routes } from './routes.jsx'

// Every top-level address of the old app (its AppRouter), which must all still answer.
const OLD_ROUTES = [
  '/', '/about', '/services', '/projects', '/why-us', '/process', '/testimonials', '/contact', '/contact-us',
  '/contact-us/tickets', '/contact-us/tickets/:reference', '/delete-account', '/owner/profile/delete', '/estimate',
  '/login', '/signup', '/forgot-password', '/account-recovery', '/invite/:code', '/oauth/callback',
  '/supplier-category', '/engineer-category', '/pincode', '/complete-profile', '/owner/*', '/contractors/:contractorId',
  '/subscription-checkout', '/contractor/*', '/supplier/*', '/engineer/live-camera', '/engineer/*', '/store-manager/*',
  '/weather', '/admin/*', '/coming-soon', '/404', '*',
]

const OWNER = anAccount({ role: 'OWNER' })
const BUILDER = anAccount({ role: 'BUILDER', id: '0190a8b2-4c1e-7aa0-9f00-000000000002' })
const SUPPLIER = anAccount({ role: 'SUPPLIER' })
const SITE_ENGINEER = anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer' } })
const STORE_MANAGER = anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Store Manager' } })
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

// [address, the role allowed, its home, a role refused and where that one goes]
// Dashboards still to come show the placeholder; the ported ones have their own tests
// (features/owner, features/builder, features/engineer).
const DASHBOARDS = [
  ['/supplier/products', SUPPLIER, OWNER, '/owner'],
  ['/admin/users', ADMIN, OWNER, '/owner'],
]

describe('RequireAccess', () => {
  it.each(DASHBOARDS)('%s opens for its role', async (path, allowed) => {
    renderApp(path, { auth: signedInAs(allowed) })
    expect(await screen.findByTestId('planned-page')).toBeInTheDocument()
    expect(location.current.pathname).toBe(path)
  })

  it.each(DASHBOARDS)('%s sends another role to its own home', async (path, _allowed, other, otherHome) => {
    renderApp(path, { auth: signedInAs(other) })
    await waitFor(() => expect(location.current.pathname).toBe(otherHome))
  })

  it.each(DASHBOARDS)('%s sends a signed-out visitor to sign in, and remembers the way back', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(`${path}?tab=1`, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: `${path}?tab=1` })
  })

  it('shows only a loader while the server is still confirming the session', async () => {
    renderApp('/owner', { auth: { user: null, sessionStatus: 'verifying' } })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByTestId('planned-page')).not.toBeInTheDocument()
    expect(location.current.pathname).toBe('/owner')
  })

  it('sends a builder whose paid sign-up is unpaid to the checkout first', async () => {
    installFakeServer({ 'GET /subscriptions/plans': { data: { plans: [] } } })
    const unpaid = { ...BUILDER, subscription_checkout: { plan_code: 'PROFESSIONAL', duration_code: 'MONTHLY' } }
    renderApp('/contractor', { auth: signedInAs(unpaid) })
    await waitFor(() => expect(location.current.pathname).toBe('/subscription-checkout'))
  })

  it.each([OWNER, BUILDER, SUPPLIER, SITE_ENGINEER, STORE_MANAGER, ADMIN])('opens weather for every signed-in role (%#)', async (account) => {
    installFakeServer({ 'GET /weather/projects': { status: 503, data: {} }, 'GET /subscriptions/me': { data: {} } })
    renderApp('/weather', { auth: signedInAs(account) })
    expect(await screen.findByText('Site Weather', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(location.current.pathname).toBe('/weather')
  })

  it('answers an unknown address with the not-found page', async () => {
    renderApp('/no/such/page', { auth: signedOut })
    expect((await screen.findAllByText('Error 404')).length).toBeGreaterThan(0)
    expect(location.current.pathname).toBe('/no/such/page')
  })
})
