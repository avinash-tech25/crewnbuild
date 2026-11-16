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

function openEngineer(path) {
  const server = installFakeServer(engineerDashboardServer({ 'GET /engineers/my-projects': { data: [anAssignedProject()] } }))
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
