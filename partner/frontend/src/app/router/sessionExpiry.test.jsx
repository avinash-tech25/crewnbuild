import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AxiosError } from 'axios'
import { describe, expect, it } from 'vitest'
import { aSession, aTechnician, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp } from '../../test/renderApp.jsx'

const FIND = { timeout: 8000 }
// What the server answers once the technician session is over (idle or total limit).
const EXPIRED = {
  'GET /auth/me': { status: 401, data: { detail: 'Session expired. Please sign in again.' } },
  'POST /auth/refresh': { status: 401, data: { detail: 'Session expired. Please sign in again.' } },
  'POST /auth/logout': { data: { message: 'Signed out.' } },
}

async function header() {
  return (await screen.findAllByRole('banner', {}, FIND))[0]
}

async function expectSignedOutHeader() {
  const bar = await header()
  expect(within(bar).getAllByRole('link', { name: 'Technician login' }).length).toBeGreaterThan(0)
  expect(within(bar).getAllByRole('link', { name: /Join as technician/ }).length).toBeGreaterThan(0)
  expect(within(bar).queryByRole('link', { name: /My dashboard/ })).not.toBeInTheDocument()
}

describe('an expired technician session', () => {
  it('on the landing page: the server is asked first, and the header is the signed-out one', async () => {
    const server = installFakeServer({ ...EXPIRED })
    const { store } = renderApp('/', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.status).toBe('signed-out'), FIND)
    expect(server.calls('GET /auth/me').length).toBeGreaterThan(0)
    await expectSignedOutHeader()
    expect(store.getState().auth.user).toBeNull()
  })

  it('on the dashboard address: sent to sign in', async () => {
    installFakeServer({ ...EXPIRED })
    renderApp('/dashboard', { session: 'live' })
    await waitFor(() => expect(location.current.pathname).toBe('/login'), FIND)
    expect(screen.queryByText(/Welcome, Ramesh/)).not.toBeInTheDocument()
  })

  it('in a tab left open: coming back to it asks the server again and signs the page out', async () => {
    let expired = false
    const server = installFakeServer({
      'GET /auth/me': () => (expired ? EXPIRED['GET /auth/me'] : { data: aSession(aTechnician()) }),
      'POST /auth/refresh': () => (expired ? EXPIRED['POST /auth/refresh'] : { data: {} }),
      'POST /auth/logout': EXPIRED['POST /auth/logout'],
    })
    const { store } = renderApp('/', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.status).toBe('signed-in'), FIND)
    expect(await within(await header()).findByRole('link', { name: /My dashboard/ }, FIND)).toBeInTheDocument()

    expired = true
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(store.getState().auth.status).toBe('signed-out'), FIND)
    expect(server.calls('GET /auth/me').length).toBeGreaterThanOrEqual(2)
    await expectSignedOutHeader()
  })

  it('a server that does not answer leaves the signed-in page as it is', async () => {
    let offline = false
    const server = installFakeServer({
      'GET /auth/me': () => {
        if (offline) throw new AxiosError('Network Error', 'ERR_NETWORK')
        return { data: aSession(aTechnician()) }
      },
    })
    const { store } = renderApp('/', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.status).toBe('signed-in'), FIND)
    const before = server.calls('GET /auth/me').length
    offline = true
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(server.calls('GET /auth/me').length).toBeGreaterThan(before), FIND)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getState().auth.status).toBe('signed-in')
  })
})
