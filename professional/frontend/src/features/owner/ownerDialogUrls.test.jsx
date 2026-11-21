/**
 * House Owner dialogs in the address: a builder's profile opened from Find Builders is
 * ?profile=<uuid>, so Back closes it and a refresh or a link opens it again. The message
 * count poll rests while the tab is hidden and catches up once it is visible again.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER_ID, OWNER, PROJECT_ID, aProject, ownerDashboardServer } from './ownerTestData.js'

// The profile window is drawn twice (loading, then loaded): wait on it, never hold it.
const FIND = { timeout: 15000 }
const BUILDER = { id: BUILDER_ID, user_id: BUILDER_ID, name: 'Ravi', company_name: 'Ravi Builders', pincode: '560001', rating: 4, services_offered: [] }

function openOwner(path) {
  const server = installFakeServer(ownerDashboardServer({
    'GET /owners/projects': { data: [aProject()] },
    'GET /contractors/nearby': { data: [BUILDER] },
    [`GET /contractors/${BUILDER_ID}/profile`]: { data: { ...BUILDER, completed_project_details: [] } },
  }))
  renderApp(path, { auth: signedInAs(OWNER) })
  return server
}

describe("House Owner builder profile in the address", () => {
  it('opens with ?profile=<uuid>, closes with Back, and reopens from the link', async () => {
    const user = userEvent.setup()
    openOwner(`/owner/projects/${PROJECT_ID}/builders`)
    const [card] = await screen.findAllByText('Ravi Builders', {}, FIND)
    await user.click(card)
    await waitFor(() => expect(new URLSearchParams(location.current.search).get('profile')).toBe(BUILDER_ID))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument(), FIND)

    act(() => history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(location.current.search).toBe('')
  })

  it('opens the profile straight from the address (a refresh or a link)', async () => {
    const server = openOwner(`/owner/projects/${PROJECT_ID}/builders?profile=${BUILDER_ID}`)
    await screen.findAllByText('Ravi Builders', {}, FIND)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument(), FIND)
    await waitFor(() => expect(server.calls(`GET /contractors/${BUILDER_ID}/profile`).length).toBeGreaterThan(0))
  })

  it('ignores a profile word that is not an id', async () => {
    openOwner(`/owner/projects/${PROJECT_ID}/builders?profile=Ravi`)
    await screen.findAllByText('Ravi Builders', {}, FIND)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('House Owner polling in a hidden tab', () => {
  let visibility = 'visible'
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    visibility = 'visible'
  })

  it('does not ask for the message count while hidden, and asks once on coming back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const server = openOwner('/owner')
    await waitFor(() => expect(server.calls('GET /messages/conversations').length).toBeGreaterThan(0))
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    const visibleCount = server.calls('GET /messages/conversations').length

    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(35000) })
    const hiddenCount = server.calls('GET /messages/conversations').length
    expect(hiddenCount).toBe(visibleCount)

    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(server.calls('GET /messages/conversations').length).toBe(hiddenCount + 1))
  })
})
