/**
 * Supplier and Admin addresses: list tabs, filters and the open record live
 * in the URL, so a refresh, Back and a bookmark restore the same view; an id that is not
 * this account's shows the not-found panel; the guards are unchanged.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { MATERIAL, SUPPLIER, supplierDashboardServer } from '../../features/supplier/supplierTestData.js'
import { USER_ID, aUserRow, adminServer, anAdminAccount, anIdentity } from '../../features/admin/adminTestData.js'

const FIND = { timeout: 15000 }
const OTHER_ID = '0190a8b2-4c1e-7aa0-9f00-00000000dead'

describe('Supplier addresses', () => {
  function openSupplier(path, overrides = {}) {
    const server = installFakeServer(supplierDashboardServer(MATERIAL, overrides))
    renderApp(path, { auth: signedInAs(SUPPLIER) })
    return server
  }

  it("shows the not-found panel for a project that is not one of the supplier's", async () => {
    openSupplier(`/supplier/my-projects?project=${OTHER_ID}`)
    expect(await screen.findByTestId('not-found-panel', {}, FIND)).toBeInTheDocument()
  })

  it('keeps a House Owner out of a supplier address, as before', async () => {
    installFakeServer({})
    renderApp('/supplier/my-projects?view=cards', { auth: signedInAs(anAccount({ role: 'OWNER' })) })
    await waitFor(() => expect(location.current.pathname).toBe('/owner'))
  })
})

describe('Admin addresses', () => {
  function openAdmin(path, routes = {}) {
    const server = installFakeServer(adminServer(anIdentity('global'), {
      'GET /admin/users': { data: { users: [aUserRow()], total: 1 } },
      ...routes,
    }))
    renderApp(path, { auth: signedInAs(anAdminAccount('global')) })
    return server
  }

  it('opens an account from /admin/users/:userId, and closing it returns to the list', async () => {
    const user = userEvent.setup()
    const server = openAdmin(`/admin/users/${USER_ID}?status=ACTIVE`, {
      [`GET /admin/users/${USER_ID}`]: { data: { ...aUserRow(), verification: null } },
    })
    await waitFor(() => expect(server.calls(`GET /admin/users/${USER_ID}`).length).toBeGreaterThan(0), FIND)
    await user.click((await screen.findAllByRole('button', { name: 'Close' }, FIND))[0])
    await waitFor(() => expect(location.current.pathname).toBe('/admin/users'))
    // The list keeps its filter.
    expect(location.current.search).toBe('?status=ACTIVE')
  })

  it('shows the not-found panel for an account the server refuses or does not know', async () => {
    openAdmin(`/admin/users/${OTHER_ID}`, {
      [`GET /admin/users/${OTHER_ID}`]: { status: 404, data: { detail: 'Not found' } },
    })
    expect(await screen.findByTestId('not-found-panel', {}, FIND)).toBeInTheDocument()
  })

  it('keeps ?role= when the status filter is cleared', async () => {
    const user = userEvent.setup()
    openAdmin('/admin/users?role=SUPPLIER&status=ACTIVE&country=India')
    await user.click(await screen.findByRole('button', { name: /active only/ }, FIND))
    await waitFor(() => expect(location.current.search).toBe('?role=SUPPLIER&country=India'))
  })

  it('keeps a builder out of an admin record address, as before', async () => {
    installFakeServer({})
    renderApp(`/admin/users/${USER_ID}`, { auth: signedInAs(anAccount({ role: 'BUILDER' })) })
    await waitFor(() => expect(location.current.pathname).toBe('/contractor'))
  })
})
