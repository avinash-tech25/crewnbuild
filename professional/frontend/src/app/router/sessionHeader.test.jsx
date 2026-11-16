/**
 * The header logo always leads to the public landing page (/) and never signs out. On
 * the public pages a signed-in visitor sees the avatar menu where Sign in sits and a
 * Dashboard button where Get started sits; only the menu's Sign out ends the session.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { accountLinks } from '../../shared/auth/sessionLinks.js'
import { STORE_MANAGER, engineerDashboardServer, storeDashboardServer } from '../../features/engineer/engineerTestData.js'
import { adminServer, anAdminAccount, anIdentity } from '../../features/admin/adminTestData.js'
import { BUILDER, builderDashboardServer } from '../../features/builder/builderTestData.js'
import { OWNER, ownerDashboardServer } from '../../features/owner/ownerTestData.js'
import { MATERIAL, SUPPLIER, supplierDashboardServer } from '../../features/supplier/supplierTestData.js'

const FIND = { timeout: 15000 }
const SITE_ENGINEER = anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer', category: 'SITE_ENGINEER' } })
const signOutCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/auth/logout'))
const inHeaders = (role, options) => screen.getAllByRole('banner').flatMap((header) => within(header).queryAllByRole(role, options))

describe('the public header', () => {
  it('shows Sign in and Get started to a signed-out visitor, and no Dashboard or avatar', async () => {
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    expect((await screen.findAllByRole('link', { name: 'Sign in' }, FIND)).length).toBeGreaterThan(0)
    expect(inHeaders('link', { name: /Get started/ }).length).toBeGreaterThan(0)
    expect(inHeaders('link', { name: /^Dashboard/ })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('shows the avatar menu and Dashboard to a signed-in Builder, and visiting / ends nothing', async () => {
    installFakeServer({})
    const { store } = renderApp('/', { auth: signedInAs(BUILDER) })
    expect((await screen.findAllByRole('button', { name: 'Account menu' }, FIND)).length).toBeGreaterThan(0)
    const dashboards = inHeaders('link', { name: /^Dashboard/ })
    expect(dashboards.length).toBeGreaterThan(0)
    dashboards.forEach((link) => expect(link).toHaveAttribute('href', '/contractor'))
    // Sign in and Get started are gone from the header (the hero's own call to action in
    // the page body is content, not navigation).
    expect(inHeaders('link', { name: 'Sign in' })).toHaveLength(0)
    expect(inHeaders('link', { name: /Get started/ })).toHaveLength(0)
    expect(store.getState().auth.user?.id).toBe(BUILDER.id)
    expect(signOutCalls()).toHaveLength(0)
  })

  it('keeps the session on the other public pages too', async () => {
    installFakeServer({})
    const { store } = renderApp('/about', { auth: signedInAs(OWNER) })
    const dashboards = await screen.findAllByRole('link', { name: /^Dashboard/ }, FIND)
    dashboards.forEach((link) => expect(link).toHaveAttribute('href', '/owner'))
    expect(screen.getAllByRole('button', { name: 'Account menu' }).length).toBeGreaterThan(0)
    expect(store.getState().auth.user?.id).toBe(OWNER.id)
    expect(signOutCalls()).toHaveLength(0)
  })

  it('the avatar menu offers Dashboard and Profile, and only its Sign out ends the session', async () => {
    const user = userEvent.setup()
    installFakeServer({})
    const { store } = renderApp('/', { auth: signedInAs(BUILDER) })
    await user.click((await screen.findAllByRole('button', { name: 'Account menu' }, FIND))[0])
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Dashboard/ })).toHaveAttribute('href', '/contractor')
    expect(within(menu).getByRole('menuitem', { name: /Profile/ })).toHaveAttribute('href', '/contractor/profile-settings')
    expect(signOutCalls()).toHaveLength(0)
    await user.click(within(menu).getByRole('menuitem', { name: /Sign out/ }))
    await waitFor(() => expect(store.getState().auth.user).toBeNull())
    expect(signOutCalls()).toHaveLength(1)
    expect((await screen.findAllByRole('link', { name: 'Sign in' }, FIND)).length).toBeGreaterThan(0)
  })

  it('Dashboard takes the Builder to their home, still signed in', async () => {
    const user = userEvent.setup()
    installFakeServer(builderDashboardServer())
    const { store } = renderApp('/', { auth: signedInAs(BUILDER) })
    await screen.findAllByRole('button', { name: 'Account menu' }, FIND)
    await user.click(inHeaders('link', { name: /^Dashboard/ })[0])
    await waitFor(() => expect(location.current.pathname).toBe('/contractor'))
    expect(store.getState().auth.user?.id).toBe(BUILDER.id)
    expect(signOutCalls()).toHaveLength(0)
  })
})

describe('where Dashboard leads, per role', () => {
  it.each([
    ['a House Owner', OWNER, '/owner', '/owner/profile'],
    ['a Builder', BUILDER, '/contractor', '/contractor/profile-settings'],
    ['a Site Engineer', SITE_ENGINEER, '/engineer', '/engineer/profile'],
    ['a Store Manager', STORE_MANAGER, '/store-manager', '/store-manager/profile'],
    ['a Supplier', SUPPLIER, '/supplier', '/supplier/profile'],
    ['an administrator', anAdminAccount('global'), '/admin', null],
  ])('%s', (_, account, home, profile) => {
    expect(accountLinks(account)).toEqual({ home, dashboard: home, profile })
  })

  it('an unfinished step comes first: PIN code, then builder checkout', () => {
    expect(accountLinks(anAccount({ role: 'OWNER', pincode: '' })).home).toBe('/pincode')
    expect(accountLinks(anAccount({ role: 'BUILDER', subscription_checkout: { plan_code: 'PRO' } })).home).toBe('/subscription-checkout')
  })

  it('a signed-out visitor has no account links', () => {
    expect(accountLinks(null)).toBeNull()
  })
})

describe('the header logo leads to / for every role', () => {
  it.each([
    ['a House Owner', OWNER, '/owner', () => ownerDashboardServer()],
    ['a Builder', BUILDER, '/contractor', () => builderDashboardServer()],
    ['a Site Engineer', SITE_ENGINEER, '/engineer', () => engineerDashboardServer()],
    ['a Store Manager', STORE_MANAGER, '/store-manager', () => storeDashboardServer()],
    ['a Supplier', SUPPLIER, '/supplier', () => supplierDashboardServer(MATERIAL)],
    ['an administrator', anAdminAccount('global'), '/admin', () => adminServer(anIdentity('global'))],
  ])('%s, from their dashboard', async (_, account, home, routes) => {
    installFakeServer(routes())
    renderApp(home, { auth: signedInAs(account) })
    const logos = await screen.findAllByRole('link', { name: 'CREWNBUILD home' }, FIND)
    logos.forEach((logo) => expect(logo).toHaveAttribute('href', '/'))
  })

  it('on another public page', async () => {
    installFakeServer({})
    renderApp('/about', { auth: signedInAs(BUILDER) })
    await screen.findAllByRole('button', { name: 'Account menu' }, FIND)
    screen.getAllByRole('banner').forEach((header) => {
      within(header).queryAllByRole('link').filter((link) => /CREWNBUILD/i.test(link.getAttribute('aria-label') || link.getAttribute('title') || ''))
        .forEach((logo) => expect(logo).toHaveAttribute('href', '/'))
    })
  })
})
