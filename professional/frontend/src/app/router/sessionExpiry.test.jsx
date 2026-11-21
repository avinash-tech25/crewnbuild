import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp } from '../../test/renderApp.jsx'

const SLOW = { timeout: 15000 }
// What the server answers once the session is over (SESSION_IDLE_HOURS / SESSION_MAX_HOURS).
const EXPIRED = {
  'GET /auth/session': { status: 401, data: { detail: 'Session expired. Please sign in again.' } },
  'POST /auth/refresh': { status: 401, data: { detail: 'Session expired. Please sign in again.' } },
  'POST /auth/logout': { data: { signed_out: true } },
}
const BUILDER = anAccount({ role: 'BUILDER', name: 'Ravi Kumar' })

function header() {
  return screen.getAllByRole('banner')[0]
}

function expectSignedOutHeader() {
  const bar = header()
  expect(within(bar).getAllByRole('link', { name: /^Sign in$/ }).length).toBeGreaterThan(0)
  expect(within(bar).getAllByRole('link', { name: /Get started/ }).length).toBeGreaterThan(0)
  expect(within(bar).queryByRole('link', { name: /Dashboard/ })).not.toBeInTheDocument()
  expect(within(bar).queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument()
  expect(within(bar).queryByText(BUILDER.name)).not.toBeInTheDocument()
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

describe('an expired session', () => {
  it('on the landing page: the server is asked first, and the header is the signed-out one', async () => {
    const server = installFakeServer({ ...EXPIRED })
    const { store } = renderApp('/', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.sessionStatus).toBe('anonymous'), SLOW)
    expect(server.calls('GET /auth/session')).toHaveLength(1)
    await screen.findAllByRole('banner', {}, SLOW)
    expectSignedOutHeader()
    expect(store.getState().auth.user).toBeNull()
  })

  it('on a dashboard address: sent to sign in, the dashboard never shown', async () => {
    installFakeServer({
      ...EXPIRED,
      'GET /auth/phone/config': { data: { enabled: false, login: false, dial_code: '+91', digits: 10 } },
    })
    renderApp('/contractor', { session: 'live' })
    await waitFor(() => expect(location.current.pathname).toBe('/login'), SLOW)
    expect(screen.queryByText(BUILDER.name)).not.toBeInTheDocument()
  })

  it('in a tab left open: coming back to it asks the server again and signs the page out', async () => {
    let expired = false
    const live = { data: { user: BUILDER, csrf_token: 'csrf-live' } }
    const server = installFakeServer({
      'GET /auth/session': () => (expired ? EXPIRED['GET /auth/session'] : live),
      'POST /auth/refresh': () => (expired ? EXPIRED['POST /auth/refresh'] : live),
      'POST /auth/logout': EXPIRED['POST /auth/logout'],
    })
    const { store } = renderApp('/', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.sessionStatus).toBe('verified'), SLOW)
    expect(await within((await screen.findAllByRole('banner', {}, SLOW))[0]).findAllByRole('link', { name: /Dashboard/ }, SLOW)).not.toHaveLength(0)

    // Hours later the server has ended the session (idle or total limit).
    expired = true
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(store.getState().auth.sessionStatus).toBe('anonymous'), SLOW)
    expect(server.calls('GET /auth/session').length).toBeGreaterThanOrEqual(2)
    await waitFor(expectSignedOutHeader, SLOW)
  })

  it('a server that does not answer leaves the signed-in page as it is', async () => {
    let offline = false
    const live = { data: { user: BUILDER, csrf_token: 'csrf-live' } }
    const server = installFakeServer({
      'GET /auth/session': () => {
        if (offline) throw new AxiosError('Network Error', 'ERR_NETWORK')
        return live
      },
    })
    const { store } = renderApp('/', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.sessionStatus).toBe('verified'), SLOW)
    offline = true
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(server.calls('GET /auth/session')).toHaveLength(2), SLOW)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getState().auth.sessionStatus).toBe('verified')
    expect(store.getState().auth.user?.name).toBe(BUILDER.name)
  })
})
