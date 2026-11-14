import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createAppStore } from '../../app/store.js'
import { currentCsrfToken } from '../../shared/api/apiClient.js'
import { signupWithProfile } from '../../shared/auth/authSlice.js'
import { signupRoleFromLink } from '../billing/subscription/signupPlanFlow.js'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { ownerDashboardServer } from '../owner/ownerTestData.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'

const PASSWORD_LOGIN = { 'GET /auth/phone/config': { data: { enabled: false, login: false, dial_code: '+91', digits: 10 } } }

async function signInWithPassword(user, email, password) {
  await user.type(await screen.findByPlaceholderText('you@example.com', {}, { timeout: 8000 }), email)
  await user.type(screen.getByPlaceholderText('Enter your password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('the session on load', () => {
  it('asks the server, then opens the dashboard of the account it names', async () => {
    const server = installFakeServer(ownerDashboardServer({ 'GET /auth/session': { data: { user: anAccount(), csrf_token: 'csrf-s' } } }))
    renderApp('/owner', { session: 'live' })
    expect(await screen.findByText('Welcome, Asha Rao!', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(server.calls('GET /auth/session')).toHaveLength(1)
    expect(currentCsrfToken()).toBe('csrf-s')
  })

  it('a visitor with no session is signed out without a sign-out round trip', async () => {
    const server = installFakeServer({
      'GET /auth/session': { status: 401, data: { detail: 'Not signed in' } },
      'POST /auth/refresh': { status: 401, data: { detail: 'Session expired. Please sign in again.' } },
    })
    // A public page: opening Login itself signs out on the server (as in the old app).
    const { store } = renderApp('/about', { session: 'live' })
    await waitFor(() => expect(store.getState().auth.sessionStatus).toBe('anonymous'))
    expect(server.calls('POST /auth/refresh')).toHaveLength(1)
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/auth/logout'), expect.anything())
  })

  it('a protected page sends a visitor with no session to sign in', async () => {
    installFakeServer({
      ...PASSWORD_LOGIN,
      'GET /auth/session': { status: 401, data: {} },
      'POST /auth/refresh': { status: 401, data: {} },
    })
    renderApp('/owner', { session: 'live' })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
  })

  it('an expired access cookie is refreshed once and the session kept', async () => {
    let refreshed = false
    installFakeServer(ownerDashboardServer({
      'GET /auth/session': () => (refreshed ? { data: { user: anAccount(), csrf_token: 'c' } } : { status: 401, data: {} }),
      'POST /auth/refresh': () => {
        refreshed = true
        return { data: { user: anAccount(), csrf_token: 'c' } }
      },
    }))
    renderApp('/owner', { session: 'live' })
    expect(await screen.findByText('Welcome, Asha Rao!', {}, { timeout: 8000 })).toBeInTheDocument()
  })
})

describe('password sign-in', () => {
  it('signs in and lands on the dashboard (postAuthPath)', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      ...PASSWORD_LOGIN,
      'POST /auth/login': { data: { user: anAccount(), csrf_token: 'csrf-login' } },
    })
    const { store } = renderApp('/login', { auth: signedOut })
    await signInWithPassword(user, '  Asha@Example.IN ', 'Secret#Pass123')
    await waitFor(() => expect(location.current.pathname).toBe('/owner'))
    expect(server.calls('POST /auth/login')[0].data).toBe(JSON.stringify({ email: 'asha@example.in', password: 'Secret#Pass123' }))
    expect(store.getState().auth.user.role).toBe('OWNER')
    expect(currentCsrfToken()).toBe('csrf-login')
  })

  it("shows the server's reason when the sign-in is refused", async () => {
    const user = userEvent.setup()
    installFakeServer({
      ...PASSWORD_LOGIN,
      'POST /auth/login': { status: 401, data: { detail: 'Invalid username/email or password' } },
    })
    renderApp('/login', { auth: signedOut })
    await signInWithPassword(user, 'asha@example.in', 'wrong')
    expect(await screen.findByText('Invalid username/email or password')).toBeInTheDocument()
    expect(location.current.pathname).toBe('/login')
  })

  it('goes back to the page that asked for sign-in', async () => {
    const user = userEvent.setup()
    installFakeServer({
      ...PASSWORD_LOGIN,
      'GET /auth/session': { status: 401, data: {} },
      'POST /auth/refresh': { status: 401, data: {} },
      'POST /auth/login': { data: { user: anAccount(), csrf_token: 'c' } },
    })
    renderApp('/owner/projects', { session: 'live' })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    await signInWithPassword(user, 'asha@example.in', 'Secret#Pass123')
    await waitFor(() => expect(location.current.pathname).toBe('/owner/projects'))
  })

  it('a step that comes first (the pincode) wins over the way back', async () => {
    const user = userEvent.setup()
    installFakeServer({
      ...PASSWORD_LOGIN,
      'GET /auth/session': { status: 401, data: {} },
      'POST /auth/refresh': { status: 401, data: {} },
      'POST /auth/login': { data: { user: anAccount({ pincode: '' }), csrf_token: 'c' } },
    })
    renderApp('/owner/projects', { session: 'live' })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    await signInWithPassword(user, 'asha@example.in', 'Secret#Pass123')
    await waitFor(() => expect(location.current.pathname).toBe('/pincode'))
  })

  it('opening Login signs the current account out, on the server too (as before)', async () => {
    installFakeServer(PASSWORD_LOGIN)
    const { store } = renderApp('/login', { auth: signedInAs(anAccount()) })
    await waitFor(() => expect(store.getState().auth.user).toBeNull())
    expect(globalThis.fetch).toHaveBeenCalledWith('http://api.test/api/v1/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'include' }))
  })
})

describe('WhatsApp sign-in', () => {
  it('sends a code to the number and signs in with it', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      'GET /auth/phone/config': { data: { enabled: true, login: true, dial_code: '+91', digits: 10 } },
      'POST /auth/phone/login/send-code': { data: { sent: true, expires_in_minutes: 5, resend_after_seconds: 30 } },
      'POST /auth/phone/login/verify-code': { data: { user: anAccount(), csrf_token: 'csrf-wa' } },
    })
    renderApp('/login', { auth: signedOut })
    await user.type(await screen.findByPlaceholderText('10 digit mobile number', {}, { timeout: 8000 }), '9876543210')
    await user.click(screen.getByRole('button', { name: /Send OTP on WhatsApp/ }))
    const digits = await screen.findAllByLabelText(/ \d$/)
    '482913'.split('').forEach((digit, index) => fireEvent.change(digits[index], { target: { value: digit } }))
    await user.click(screen.getByRole('button', { name: /Verify & sign in/ }))
    await waitFor(() => expect(location.current.pathname).toBe('/owner'))
    expect(JSON.parse(server.calls('POST /auth/phone/login/send-code')[0].data)).toEqual({ phone: '9876543210' })
    expect(JSON.parse(server.calls('POST /auth/phone/login/verify-code')[0].data)).toEqual({ phone: '9876543210', code: '482913' })
  })
})

describe('forgot password', () => {
  it('asks the server to e-mail a reset code', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      'POST /auth/password/forgot': { data: { sent: true, expires_in_minutes: 10, resend_after_seconds: 30 } },
    })
    renderApp('/forgot-password', { auth: signedOut })
    await user.type(await screen.findByPlaceholderText('you@example.com'), 'Asha@Example.in')
    await user.click(screen.getByRole('button', { name: /Send reset code/ }))
    await waitFor(() => expect(server.calls('POST /auth/password/forgot')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /auth/password/forgot')[0].data)).toEqual({ email: 'asha@example.in' })
  })
})

describe('OAuth callback', () => {
  it('reads the session the provider callback set, then lands as a sign-in does', async () => {
    installFakeServer({ 'GET /auth/session': { data: { user: anAccount({ role: 'SUPPLIER' }), csrf_token: 'c' } } })
    renderApp('/oauth/callback', { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/supplier'))
  })

  it('goes to sign-in when there is no session', async () => {
    installFakeServer({ ...PASSWORD_LOGIN, 'GET /auth/session': { status: 401, data: {} }, 'POST /auth/refresh': { status: 401, data: {} } })
    renderApp('/oauth/callback', { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
  })
})

describe('sign-up', () => {
  it('creates the account and signs it in', async () => {
    const store = createAppStore()
    const server = installFakeServer({ 'POST /auth/signup': { data: { user: anAccount({ role: 'BUILDER' }), csrf_token: 'csrf-new' } } })
    await store.dispatch(signupWithProfile({ name: 'Ravi', email: 'ravi@example.in', role: 'BUILDER' }))
    expect(store.getState().auth.user.role).toBe('BUILDER')
    expect(server.calls('POST /auth/signup')).toHaveLength(1)
    expect(currentCsrfToken()).toBe('csrf-new')
  })

  it('old links that name the Builder role CONTRACTOR still pick Builder', () => {
    expect(signupRoleFromLink('CONTRACTOR')).toBe('BUILDER')
    expect(signupRoleFromLink('builder')).toBe('BUILDER')
    expect(signupRoleFromLink('nonsense')).toBe('OWNER')
  })
})
