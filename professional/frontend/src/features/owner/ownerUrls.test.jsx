/**
 * House Owner addresses: a project's views and pages, and the list tabs, live in the URL,
 * so a refresh, Back / Forward and a bookmark restore the same view. Another account's
 * project shows the not-found panel; the guard keeps other roles out as before.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { OWNER, PROJECT_ID, aProject, ownerDashboardServer } from './ownerTestData.js'

const FIND = { timeout: 15000 }
const OTHER_ID = '0190a8b2-4c1e-7aa0-9f00-00000000dead'

function openOwner(path) {
  const server = installFakeServer(ownerDashboardServer({ 'GET /owners/projects': { data: [aProject()] } }))
  renderApp(path, { auth: signedInAs(OWNER) })
  return server
}

const selectedTab = (name) => screen.findByRole('tab', { name, selected: true }, FIND)

describe('House Owner project addresses', () => {
  it.each([
    ['', 'Overview'],
    ['/site-activity', 'Site Activity'],
    ['/project-analysis', 'Project Analysis'],
    ['/payments', 'Payments'],
    ['/assign-builder', /Assign Builder/],
  ])('/owner/projects/:id%s opens on its view (a refresh or bookmark)', async (suffix, label) => {
    openOwner(`/owner/projects/${PROJECT_ID}${suffix}`)
    expect(await selectedTab(label)).toBeInTheDocument()
  })

  it('records each view in the address, and Back / Forward move between them', async () => {
    const user = userEvent.setup()
    openOwner(`/owner/projects/${PROJECT_ID}`)
    await user.click(await screen.findByRole('tab', { name: 'Site Activity' }, FIND))
    expect(location.current.pathname).toBe(`/owner/projects/${PROJECT_ID}/site-activity`)
    await user.click(screen.getByRole('tab', { name: 'Payments' }))
    expect(location.current.pathname).toBe(`/owner/projects/${PROJECT_ID}/payments`)

    act(() => history.back())
    expect(await selectedTab('Site Activity')).toBeInTheDocument()
    act(() => history.back())
    expect(await selectedTab('Overview')).toBeInTheDocument()
    expect(location.current.pathname).toBe(`/owner/projects/${PROJECT_ID}`)
    act(() => history.forward())
    await waitFor(() => expect(location.current.pathname).toBe(`/owner/projects/${PROJECT_ID}/site-activity`))
  })

  it("shows the not-found panel for a project that is not this owner's", async () => {
    const user = userEvent.setup()
    const server = openOwner(`/owner/projects/${OTHER_ID}/payments`)
    const panel = await screen.findByTestId('not-found-panel', {}, FIND)
    // The address is kept (no silent redirect) and nothing about that project is asked for.
    expect(location.current.pathname).toBe(`/owner/projects/${OTHER_ID}/payments`)
    expect(server.requests.some((request) => request.path.includes(OTHER_ID))).toBe(false)
    await user.click(within(panel).getByRole('button', { name: 'Back to Projects' }))
    await waitFor(() => expect(location.current.pathname).toBe('/owner/projects'))
  })

  it('keeps a builder out of an owner project address, as before', async () => {
    installFakeServer({})
    renderApp(`/owner/projects/${PROJECT_ID}/payments`, { auth: signedInAs(anAccount({ role: 'BUILDER' })) })
    await waitFor(() => expect(location.current.pathname).toBe('/contractor'))
  })
})

describe('House Owner list tabs in the address', () => {
  it('opens Buy & Sell on Sell from ?tab=sell, and Back returns to Buy', async () => {
    const user = userEvent.setup()
    openOwner('/owner/buy-sell?tab=sell')
    const sell = await screen.findByRole('button', { name: /Sell/, pressed: true }, FIND)
    expect(sell).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Buy/, pressed: false }))
    expect(location.current.search).toBe('')
    act(() => history.back())
    await waitFor(() => expect(location.current.search).toBe('?tab=sell'))
  })
})
