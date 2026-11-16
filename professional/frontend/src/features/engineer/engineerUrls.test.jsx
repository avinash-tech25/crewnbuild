/**
 * Site Engineer addresses: section tabs, the Suppliers hub tab and the site log's project
 * live in the URL, so a refresh, Back / Forward and a bookmark restore the same view.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { PROJECT_ID, SITE_ENGINEER, anAssignedProject, engineerDashboardServer } from './engineerTestData.js'

const FIND = { timeout: 15000 }
const OTHER_ID = '0190a8b2-4c1e-7aa0-9f00-00000000dead'

function openEngineer(path, extra = {}) {
  const server = installFakeServer(engineerDashboardServer({ 'GET /engineers/my-projects': { data: [anAssignedProject()] }, ...extra }))
  renderApp(path, { auth: signedInAs(SITE_ENGINEER) })
  return server
}

describe('Site Engineer tabs in the address', () => {
  it('opens Find Opportunities on the tab its address names, and Back returns to the one before', async () => {
    const user = userEvent.setup()
    openEngineer('/engineer/find-opportunities?tab=contractors')
    expect(await screen.findByRole('button', { name: /^Discover Builders/, pressed: true }, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Join a Builder Team/ }))
    expect(location.current.search).toBe('')
    act(() => history.back())
    expect(await screen.findByRole('button', { name: /^Discover Builders/, pressed: true }, FIND)).toBeInTheDocument()
    expect(location.current.search).toBe('?tab=contractors')
  })

  it('opens the Suppliers hub on Orders from ?tab=orders (where a notification links)', async () => {
    openEngineer('/engineer/my-supplies?tab=orders')
    expect(await screen.findByRole('button', { name: /^Orders/, pressed: true }, FIND)).toBeInTheDocument()
  })
})

describe('Site Engineer site log in the address', () => {
  it("opens a project's site calendar by its id from My Projects", async () => {
    const user = userEvent.setup()
    openEngineer('/engineer/my-projects')
    await user.click((await screen.findAllByText('Rao Family Home', {}, FIND))[0])
    await waitFor(() => expect(location.current.pathname).toBe('/engineer/calendar'))
    expect(location.current.search).toBe(`?project=${PROJECT_ID}`)
    expect(location.current.search).not.toMatch(/Rao|560001/)
  })

  it('shows the not-found panel for a project this engineer is not on, and asks nothing about it', async () => {
    const user = userEvent.setup()
    const server = openEngineer(`/engineer/calendar?project=${OTHER_ID}`)
    expect(await screen.findByTestId('not-found-panel', {}, FIND)).toBeInTheDocument()
    expect(server.requests.some((request) => request.path.includes(OTHER_ID))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'My Projects' }))
    await waitFor(() => expect(location.current.pathname).toBe('/engineer/my-projects'))
  })

  it('keeps a House Owner out of an engineer address, as before', async () => {
    installFakeServer({})
    renderApp(`/engineer/calendar?project=${PROJECT_ID}`, { auth: signedInAs(anAccount({ role: 'OWNER' })) })
    await waitFor(() => expect(location.current.pathname).toBe('/owner'))
  })
})

describe('Site Engineer hand-offs land on the tab they name, in one move', () => {
  it("opens the Material Product Catalog from the dashboard's Order Product quick action", async () => {
    const user = userEvent.setup()
    openEngineer('/engineer')
    await user.click(await screen.findByRole('button', { name: /Order Product/ }, FIND))
    await waitFor(() => expect(location.current.pathname).toBe('/engineer/my-supplies'))
    expect(location.current.search).toBe('?tab=catalog')
    act(() => history.back())
    await waitFor(() => expect(location.current.pathname).toBe('/engineer'))
  })

  it('opens Requests from the new-request popup', async () => {
    const user = userEvent.setup()
    const server = openEngineer('/engineer')
    await screen.findByRole('button', { name: /Order Product/ }, FIND)
    await waitFor(() => expect(server.calls('GET /project-requests/incoming').length).toBeGreaterThan(0))
    server.route('GET /project-requests/incoming', {
      data: [{
        id: '0190a8b2-4c1e-7aa0-9f00-0000000000c9',
        request_type: 'OWNER_TO_ENGINEER',
        status: 'pending',
        is_receiver: true,
        is_sender: false,
        project_id: PROJECT_ID,
        project_title: 'Rao Family Home',
        sender_name: 'Asha Rao',
        created_at: '2026-11-15T10:00:00+05:30',
      }],
    })
    act(() => { window.dispatchEvent(new Event('focus')) })
    await user.click(await screen.findByRole('button', { name: /View requests/ }, FIND))
    await waitFor(() => expect(location.current.pathname).toBe('/engineer/find-opportunities'))
    expect(location.current.search).toBe('?tab=requests')
    expect(await screen.findByRole('button', { name: /^Requests/, pressed: true }, FIND)).toBeInTheDocument()
  })

  it('opens the opportunities after the location prompt saves a pincode', async () => {
    const user = userEvent.setup()
    openEngineer('/engineer/find-opportunities?tab=contractors', {
      'GET /locations/pincode/560001': { data: { pincode: '560001', display: 'Bengaluru, Karnataka', post_offices: [{ name: 'MG Road' }] } },
      'PATCH /auth/location': { data: { ...SITE_ENGINEER, pincode: '560001' } },
    })
    await user.click(await screen.findByRole('button', { name: /^Leads for 560001/ }, FIND))
    const save = await screen.findByRole('button', { name: 'Show my leads' }, FIND)
    await waitFor(() => expect(save).toBeEnabled(), FIND)
    await user.click(save)
    await waitFor(() => expect(location.current.search).toBe('?tab=opportunities'), FIND)
    expect(location.current.pathname).toBe('/engineer/find-opportunities')
    expect(await screen.findByRole('button', { name: /^Find Opportunities$/, pressed: true }, FIND)).toBeInTheDocument()
  })
})

describe('Suppliers hub tabs keep their own list choice', () => {
  it("drops Labor's ?list= when the engineer moves on to Equipment", async () => {
    const user = userEvent.setup()
    openEngineer('/engineer/my-supplies?tab=labor&list=pending')
    await user.click(await screen.findByRole('button', { name: /All supplier types/ }, FIND))
    await waitFor(() => expect(location.current.search).toBe(''))
    await user.click(await screen.findByRole('button', { name: /Equipment Suppliers/ }, FIND))
    await waitFor(() => expect(location.current.search).toBe('?tab=equipment'))
  })

  it("drops Orders' ?list= when another Material tab opens", async () => {
    const user = userEvent.setup()
    openEngineer('/engineer/my-supplies?tab=orders&list=previous')
    await screen.findByRole('button', { name: /^Orders/, pressed: true }, FIND)
    await user.click(screen.getByRole('button', { name: /^Suppliers/, pressed: false }))
    await waitFor(() => expect(location.current.search).toBe('?tab=suppliers'))
  })
})

describe('Site Engineer: the addresses of the removed Store', () => {
  it('opens the supplier type choice for an old ?tab=store address', async () => {
    openEngineer('/engineer/my-supplies?tab=store')
    expect(await screen.findByRole('button', { name: /Material Suppliers/ }, FIND)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /All supplier types/ })).not.toBeInTheDocument()
  })

  it('sends the old Store Requests address to the dashboard', async () => {
    openEngineer('/engineer/store-requests')
    await waitFor(() => expect(location.current.pathname).toBe('/engineer'))
    expect(await screen.findByText('Welcome, Meena Iyer', {}, FIND)).toBeInTheDocument()
  })
})

describe('Site Engineer site log when the projects cannot be loaded', () => {
  it('shows an error and asks nothing about the named project', async () => {
    const server = installFakeServer(engineerDashboardServer({ 'GET /engineers/my-projects': { status: 500, data: { detail: 'down' } } }))
    renderApp(`/engineer/calendar?project=${OTHER_ID}`, { auth: signedInAs(SITE_ENGINEER) })
    expect(await screen.findByText('Your projects could not be loaded. Refresh the page to try again.', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByTestId('not-found-panel')).toBeNull()
    expect(server.requests.some((request) => request.path.includes(OTHER_ID))).toBe(false)
  })
})
