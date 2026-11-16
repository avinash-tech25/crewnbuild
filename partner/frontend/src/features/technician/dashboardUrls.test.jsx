/**
 * The technician dashboard's section is in the address (/dashboard/accepted, ...), so a
 * refresh, Back / Forward and a bookmark keep it; the guard is the dashboard's own.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { aTechnician, installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedOut, technicianSignedIn } from '../../test/renderApp.jsx'
import { FIND, dashboardRoutes } from '../../test/technicianDashboard.js'

const TECHNICIAN = aTechnician()

function open(path) {
  installFakeServer(dashboardRoutes(TECHNICIAN))
  renderApp(path, { auth: technicianSignedIn(TECHNICIAN) })
}

describe('technician dashboard sections in the address', () => {
  it.each([
    ['/dashboard', /New Requests/],
    ['/dashboard/accepted', /Accepted Jobs/],
    ['/dashboard/completed', /Completed Jobs/],
    ['/dashboard/cancelled', /Cancelled Jobs/],
  ])('%s opens on its section (a refresh or bookmark)', async (path, label) => {
    open(path)
    const nav = await screen.findByRole('navigation', { name: 'Dashboard sections' }, FIND)
    expect(nav.querySelector('[aria-pressed="true"]')).toHaveTextContent(label)
  })

  it('records each section, and Back returns to the one before', async () => {
    const user = userEvent.setup()
    open('/dashboard')
    await user.click(await screen.findByRole('button', { name: /Accepted Jobs/ }, FIND))
    expect(location.current.pathname).toBe('/dashboard/accepted')
    await user.click(screen.getByRole('button', { name: /Completed Jobs/ }))
    expect(location.current.pathname).toBe('/dashboard/completed')
    act(() => history.back())
    await waitFor(() => expect(location.current.pathname).toBe('/dashboard/accepted'))
    expect(screen.getByRole('button', { name: /Accepted Jobs/, pressed: true })).toBeInTheDocument()
    act(() => history.back())
    await waitFor(() => expect(location.current.pathname).toBe('/dashboard'))
  })

  it('sends a section word that does not exist back to the dashboard', async () => {
    open('/dashboard/somewhere')
    await waitFor(() => expect(location.current.pathname).toBe('/dashboard'))
  })

  it('keeps a signed-out visitor out of a section address, as before', async () => {
    installFakeServer({})
    renderApp('/dashboard/earnings', { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ from: '/dashboard/earnings' })
  })
})
