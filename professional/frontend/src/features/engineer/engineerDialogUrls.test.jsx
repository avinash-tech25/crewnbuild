/**
 * Site Engineer dialogs in the address: a builder's profile (?builder=<user uuid>) opened
 * from Discover Builders. Opening adds a history entry, Back closes it, and the address
 * alone (a refresh or a link) opens it again, loading the profile the same way.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER_ID, SITE_ENGINEER, engineerDashboardServer } from './engineerTestData.js'

const FIND = { timeout: 15000 }
const BUILDER = { id: BUILDER_ID, user_id: BUILDER_ID, name: 'Ravi', company_name: 'Ravi Builders', pincode: '560001', rating: 4 }

function open(path) {
  const server = installFakeServer(engineerDashboardServer({
    'GET /contractors/nearby': { data: [BUILDER] },
    [`GET /contractors/${BUILDER_ID}/profile`]: { data: { ...BUILDER, address: '1 MG Road' } },
  }))
  renderApp(path, { auth: signedInAs(SITE_ENGINEER) })
  return server
}

const closeButton = () => screen.queryByRole('button', { name: 'Close' })

describe("Site Engineer builder profile in the address", () => {
  it('opens with ?builder=<uuid>, closes with Back', async () => {
    const user = userEvent.setup()
    open('/engineer/find-opportunities?tab=contractors')
    const [card] = await screen.findAllByText('Ravi Builders', {}, FIND)
    await user.click(card)
    await waitFor(() => expect(new URLSearchParams(location.current.search).get('builder')).toBe(BUILDER_ID))
    await waitFor(() => expect(closeButton()).not.toBeNull(), FIND)

    act(() => history.back())
    await waitFor(() => expect(closeButton()).toBeNull())
    expect(location.current.search).toBe('?tab=contractors')
  })

  it('opens the profile straight from the address and loads it', async () => {
    const server = open(`/engineer/find-opportunities?tab=contractors&builder=${BUILDER_ID}`)
    await waitFor(() => expect(closeButton()).not.toBeNull(), FIND)
    await waitFor(() => expect(server.calls(`GET /contractors/${BUILDER_ID}/profile`)).toHaveLength(1))
  })

  it('closes a deep-linked profile in place (no page to go back to)', async () => {
    const user = userEvent.setup()
    open(`/engineer/find-opportunities?tab=contractors&builder=${BUILDER_ID}`)
    await waitFor(() => expect(closeButton()).not.toBeNull(), FIND)
    await user.click(closeButton())
    await waitFor(() => expect(closeButton()).toBeNull())
    expect(location.current.pathname).toBe('/engineer/find-opportunities')
    expect(location.current.search).toBe('?tab=contractors')
  })
})
