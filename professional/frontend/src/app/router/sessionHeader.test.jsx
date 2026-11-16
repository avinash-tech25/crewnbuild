/**
 * A signed-in visitor on the public site stays signed in: the header offers "Go to
 * dashboard" (the role's own home, or its unfinished step) and an account menu instead
 * of Sign in / Get started, and only the menu's Sign out ends the session. Inside a
 * dashboard the logo leads to that dashboard's home.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { accountLinks } from '../../shared/auth/sessionLinks.js'
import { STORE_MANAGER } from '../../features/engineer/engineerTestData.js'
import { anAdminAccount } from '../../features/admin/adminTestData.js'
import { BUILDER, builderDashboardServer } from '../../features/builder/builderTestData.js'
import { OWNER, ownerDashboardServer } from '../../features/owner/ownerTestData.js'

const FIND = { timeout: 15000 }
const SITE_ENGINEER = anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer', category: 'SITE_ENGINEER' } })
const signOutCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).includes('/auth/logout'))

describe('the public header', () => {
  it('shows Sign in and Get started to a signed-out visitor', async () => {
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    expect((await screen.findAllByRole('link', { name: 'Sign in' }, FIND)).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /Get started/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /Go to dashboard/ })).not.toBeInTheDocument()
  })

  it('shows Go to dashboard and the account menu to a signed-in Builder, and visiting / ends nothing', async () => {
    installFakeServer({})
    const { store } = renderApp('/', { auth: signedInAs(BUILDER) })
    const links = await screen.findAllByRole('link', { name: /Go to dashboard/ }, FIND)
    links.forEach((link) => expect(link).toHaveAttribute('href', '/contractor'))
    // The header and footer no longer offer Sign in / Get started (the hero's own call to
    // action in the page body is content, not navigation).
    screen.getAllByRole('banner').forEach((header) => {
      expect(within(header).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('link', { name: /Get started/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
    // Still signed in, and no sign-out was sent.
    expect(store.getState().auth.user?.id).toBe(BUILDER.id)
    expect(signOutCalls()).toHaveLength(0)
  })

  it('keeps the session on the other public pages too', async () => {
    installFakeServer({})
    const { store } = renderApp('/about', { auth: signedInAs(OWNER) })
    const links = await screen.findAllByRole('link', { name: /Go to dashboard/ }, FIND)
    links.forEach((link) => expect(link).toHaveAttribute('href', '/owner'))
    expect(store.getState().auth.user?.id).toBe(OWNER.id)
    expect(signOutCalls()).toHaveLength(0)
  })

  it('the account menu offers Dashboard and Profile, and only its Sign out ends the session', async () => {
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
    // The header is back to the signed-out buttons.
    expect((await screen.findAllByRole('link', { name: 'Sign in' }, FIND)).length).toBeGreaterThan(0)
  })
})

describe('where Go to dashboard leads, per role', () => {
  it.each([
    ['a House Owner', OWNER, '/owner', '/owner/profile'],
    ['a Builder', BUILDER, '/contractor', '/contractor/profile-settings'],
    ['a Site Engineer', SITE_ENGINEER, '/engineer', '/engineer/profile'],
    ['a Store Manager', STORE_MANAGER, '/store-manager', '/store-manager/profile'],
    ['a Supplier', anAccount({ role: 'SUPPLIER' }), '/supplier', '/supplier/profile'],
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

describe('the logo inside a dashboard', () => {
  it.each([
    ['a Builder', BUILDER, '/contractor', builderDashboardServer()],
    ['a House Owner', OWNER, '/owner', ownerDashboardServer()],
  ])("leads %s to their own dashboard home, not the landing page", async (_, account, home, routes) => {
    installFakeServer(routes)
    renderApp(home, { auth: signedInAs(account) })
    const logo = (await screen.findAllByRole('link', { name: 'CREWNBUILD home' }, FIND))[0]
    expect(logo).toHaveAttribute('href', home)
  })
})
