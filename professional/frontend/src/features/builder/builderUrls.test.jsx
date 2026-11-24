/**
 * Builder addresses: the open project, its tab and the list tabs live in the URL, so a
 * refresh (opening the address afresh), Back / Forward and a bookmark show the same view.
 * Another account's project id shows the not-found panel without asking for its data,
 * and the guard keeps another role out exactly as before.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, builderDashboardServer } from './builderTestData.js'

const FIND = { timeout: 15000 }
const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-00000000a001'
const OTHER_ID = '0190a8b2-4c1e-7aa0-9f00-00000000dead'
const PROJECT = { id: PROJECT_ID, title: 'Vasudeva Sarvam Idam', status: 'active', pincode: '560001', budget: 0, owner_id: 'o', owner_name: 'Asha' }

function routes(extra = {}) {
  return builderDashboardServer({
    'GET /owners/projects': { data: [PROJECT] },
    [`GET /projects/${PROJECT_ID}/engineer`]: { data: { engineer: null } },
    [`GET /projects/${PROJECT_ID}/suppliers`]: { data: [] },
    ...extra,
  })
}

function open(path, account = BUILDER, extra = {}) {
  const server = installFakeServer(routes(extra))
  renderApp(path, { auth: signedInAs(account) })
  return server
}

const tab = (name) => screen.getByRole('button', { name, pressed: true })

describe('Builder projects in the address', () => {
  it('opens a project straight from its address, on Site Activity', async () => {
    open(`/contractor/projects/${PROJECT_ID}`)
    expect(await screen.findByRole('button', { name: 'Site Activity', pressed: true }, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('Vasudeva Sarvam Idam').length).toBeGreaterThan(0)
  })

  it.each([
    ['site-activity', 'Site Activity'],
    ['project-analysis', 'Project Analysis'],
    ['team', 'Team'],
    ['overview', 'Overview'],
  ])('opens /:projectId/%s on its tab (a refresh or bookmark)', async (slug, label) => {
    open(`/contractor/projects/${PROJECT_ID}/${slug}`)
    expect(await screen.findByRole('button', { name: label, pressed: true }, FIND)).toBeInTheDocument()
  })

  it("opens a Team sub-tab from the address (?team=suppliers)", async () => {
    open(`/contractor/projects/${PROJECT_ID}/team?team=suppliers`)
    expect(await screen.findByRole('button', { name: /^Suppliers/, pressed: true }, FIND)).toBeInTheDocument()
  })

  it('records each tab in the address, and Back returns to the one before', async () => {
    const user = userEvent.setup()
    open(`/contractor/projects/${PROJECT_ID}`)
    await user.click(await screen.findByRole('button', { name: 'Overview' }, FIND))
    expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}/overview`)
    expect(tab('Overview')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Team' }))
    expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}/team`)

    act(() => history.back())
    await waitFor(() => expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}/overview`))
    expect(tab('Overview')).toBeInTheDocument()
    act(() => history.back())
    await waitFor(() => expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}`))
    expect(tab('Site Activity')).toBeInTheDocument()
    act(() => history.forward())
    await waitFor(() => expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}/overview`))
  })

  it('opens a project from the list by its id and goes back to the list', async () => {
    const user = userEvent.setup()
    // A project with no Site Engineer yet is listed under Upcoming.
    open('/contractor/projects?tab=upcoming')
    await user.click(await screen.findByText('Vasudeva Sarvam Idam', {}, FIND))
    await waitFor(() => expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}`))
    // Ids only: never a name or a number from the project in the address.
    expect(location.current.pathname + location.current.search).not.toMatch(/Vasudeva|560001/)
    await user.click(screen.getByRole('button', { name: 'Back to Projects' }))
    await waitFor(() => expect(location.current.pathname).toBe('/contractor/projects'))
    // Back from the list returns to the project.
    act(() => history.back())
    await waitFor(() => expect(location.current.pathname).toBe(`/contractor/projects/${PROJECT_ID}`))
  })

  it('keeps the list tab in the address (?tab=previous)', async () => {
    const user = userEvent.setup()
    open('/contractor/projects?tab=previous')
    expect(await screen.findByRole('button', { name: /^Previous projects/, pressed: true }, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Current projects/ }))
    expect(location.current.search).toBe('')
    act(() => history.back())
    await waitFor(() => expect(location.current.search).toBe('?tab=previous'))
  })

  it("shows the not-found panel for a project that is not this builder's, without asking for it", async () => {
    const user = userEvent.setup()
    const server = open(`/contractor/projects/${OTHER_ID}/team`)
    expect(await screen.findByTestId('not-found-panel', {}, FIND)).toBeInTheDocument()
    expect(server.requests.some((request) => request.path.includes(OTHER_ID))).toBe(false)
    await user.click(within(screen.getByTestId('not-found-panel')).getByRole('button', { name: 'Back to Projects' }))
    await waitFor(() => expect(location.current.pathname).toBe('/contractor/projects'))
  })

  it('keeps another role out of a builder project address, as before', async () => {
    installFakeServer({})
    renderApp(`/contractor/projects/${PROJECT_ID}/overview`, { auth: signedInAs(anAccount({ role: 'OWNER' })) })
    await waitFor(() => expect(location.current.pathname).toBe('/owner'))
  })
})

describe('Builder section tabs in the address', () => {
  it.each([
    ['/contractor/requests?tab=supplier', /^Supplier Requests/],
    ['/contractor/my-site-engineers?tab=suppliers', /^My Suppliers/],
    ['/contractor/find-clients?tab=suppliers', /^Suppliers/],
  ])('%s opens on its tab', async (path, label) => {
    open(path)
    const button = await screen.findByRole('button', { name: label }, FIND)
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Builder projects when they cannot be loaded', () => {
  it('shows an error for a deep-linked project, not endless loading or not-found', async () => {
    open(`/contractor/projects/${PROJECT_ID}`, BUILDER, { 'GET /owners/projects': { status: 500, data: { detail: 'down' } } })
    expect(await screen.findByText('Your projects could not be loaded. Refresh the page to try again.', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByText('Loading your projects…')).toBeNull()
    expect(screen.queryByTestId('not-found-panel')).toBeNull()
  })
})

describe('Builder location prompt hand-off', () => {
  it('opens the house-owner leads after a pincode is saved, in one history entry', async () => {
    const user = userEvent.setup()
    open('/contractor/find-clients?tab=suppliers', BUILDER, {
      'GET /locations/pincode/560001': { data: { pincode: '560001', display: 'Bengaluru, Karnataka', post_offices: [{ name: 'MG Road' }] } },
      'PATCH /auth/location': { data: { ...BUILDER, pincode: '560001' } },
    })
    await user.click(await screen.findByRole('button', { name: /^Leads for 560001/ }, FIND))
    const save = await screen.findByRole('button', { name: 'Show my leads' }, FIND)
    await waitFor(() => expect(save).toBeEnabled(), FIND)
    await user.click(save)
    await waitFor(() => expect(location.current.search).toBe(''), FIND)
    expect(location.current.pathname).toBe('/contractor/find-clients')
    expect(await screen.findByRole('button', { name: /^House Owners/, pressed: true }, FIND)).toBeInTheDocument()
    act(() => history.back())
    await waitFor(() => expect(location.current.search).toBe('?tab=suppliers'))
  })
})
