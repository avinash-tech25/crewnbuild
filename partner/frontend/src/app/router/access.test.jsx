import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { storeRequesterSession, technicianSession } from '../../shared/api/apiClient.js'
import { aRequesterSession, aSession, aTechnician, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut, technicianSignedIn } from '../../test/renderApp.jsx'

const FIND = { timeout: 8000 }
const INVALID_CREDENTIALS = 'Invalid email or password.'
const ONBOARDING_USER = aTechnician({
  status: 'PENDING',
  onboarding: { step: 'FACE', face_status: 'PENDING', aadhaar_status: 'PENDING', aadhaar_masked: null, can_receive_jobs: false, pending_requirements: ['FACE'] },
})
// What the dashboard asks for on load, answered empty.
const DASHBOARD = {
  'GET /technicians/me/dashboard': { data: { new_requests: 0, accepted_jobs: 0, active_jobs: 0, completed_jobs: 0, cancelled_jobs: 0, work_status: 'OFFLINE', is_available: false, can_receive_jobs: true, pending_requirements: [] } },
  'GET /technicians/me/earnings/summary': { data: { currency: 'INR', today_net: '0.00', week_net: '0.00', month_net: '0.00', total_net: '0.00', total_gross: '0.00', total_commission: '0.00', earnings_count: 0 } },
  'GET /technicians/me/weather': { data: { location_required: true, status: { available: false }, hourly: [], daily: [], alerts: [] } },
  'GET /technicians/me/jobs': { data: [] },
  'GET /technicians/me/offers': { data: [] },
}

describe('technician pages', () => {
  it.each(['/dashboard', '/weather'])('%s sends a visitor with no technician session to sign in', async (path) => {
    installFakeServer({})
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ from: path })
  })

  it('sends a registration (onboarding) session to finish onboarding, never to the dashboard', async () => {
    installFakeServer({ 'GET /auth/me': { data: aSession(ONBOARDING_USER, 'onboarding') } })
    renderApp('/dashboard', { auth: technicianSignedIn(ONBOARDING_USER, 'onboarding') })
    await waitFor(() => expect(location.current.pathname).toBe('/onboarding'))
  })

  it('opens the dashboard only after the server confirms the session', async () => {
    const server = installFakeServer({ 'GET /auth/me': { data: aSession() }, ...DASHBOARD })
    renderApp('/dashboard', { auth: technicianSignedIn(aTechnician()) })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(await screen.findByText('Welcome, Ramesh', {}, FIND)).toBeInTheDocument()
    expect(server.calls('GET /auth/me').length).toBeGreaterThan(0)
  })

  it('never lets a booking (requester) session open a technician page', async () => {
    installFakeServer({})
    storeRequesterSession(aRequesterSession())
    renderApp('/dashboard', { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
  })

  it('sends a signed-in technician away from sign-in to the dashboard', async () => {
    installFakeServer({ 'GET /auth/me': { data: aSession() }, ...DASHBOARD })
    renderApp('/login', { auth: technicianSignedIn(aTechnician()) })
    await waitFor(() => expect(location.current.pathname).toBe('/dashboard'))
  })
})

describe('the technician session on load', () => {
  it('asks the server and opens the dashboard', async () => {
    const server = installFakeServer({ 'GET /auth/me': { data: aSession() }, ...DASHBOARD })
    renderApp('/dashboard', { session: 'live' })
    expect(await screen.findByText('Welcome, Ramesh', {}, FIND)).toBeInTheDocument()
    expect(server.calls('GET /auth/me')[0].headers['X-CSRF-Token']).toBeUndefined()
    expect(technicianSession.currentCsrf()).toBe('csrf-technician')
  })

  it('renews an expired access cookie once and keeps the session', async () => {
    let refreshed = false
    const server = installFakeServer({
      'GET /auth/me': () => (refreshed ? { data: aSession() } : { status: 401, data: {} }),
      'POST /auth/refresh': () => {
        refreshed = true
        return { data: { csrf_token: 'csrf-refreshed', session_type: 'partner' } }
      },
      ...DASHBOARD,
    })
    renderApp('/dashboard', { session: 'live' })
    expect(await screen.findByText('Welcome, Ramesh', {}, FIND)).toBeInTheDocument()
    expect(server.calls('POST /auth/refresh')).toHaveLength(1)
  })

  it('treats a refused session as signed out', async () => {
    installFakeServer({ 'GET /auth/me': { status: 401, data: {} }, 'POST /auth/refresh': { status: 401, data: {} } })
    renderApp('/dashboard', { session: 'live' })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(technicianSession.isActive()).toBe(false)
  })
})

describe('booking pages (the requester)', () => {
  it('without the Professional hand-off, says to start from the CREWNBUILD dashboard, even for a signed-in technician', async () => {
    installFakeServer({ 'GET /requester/session': { status: 401, data: {} } })
    renderApp('/book-technician', { auth: technicianSignedIn(aTechnician()) })
    expect(await screen.findByText('Start from your CREWNBUILD dashboard', {}, FIND)).toBeInTheDocument()
  })

  it('a booking session already held by the server opens the booking pages after a reload', async () => {
    installFakeServer({ 'GET /requester/session': { data: aRequesterSession() }, 'GET /requester/bookings': { data: [] } })
    renderApp('/book-technician', { auth: signedOut })
    expect(await screen.findByRole('link', { name: /Book Plumber/ }, FIND)).toBeInTheDocument()
    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
  })
})

describe('sign-in, registration and password reset', () => {
  it('signs a technician in with email and password and opens the dashboard', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      'POST /auth/login': { data: { session_type: 'partner', user: aTechnician(), csrf_token: 'csrf-login' } },
      // The same session's token, as the server answers it.
      'GET /auth/me': { data: { ...aSession(), csrf_token: 'csrf-login' } },
      ...DASHBOARD,
    })
    renderApp('/login', { auth: signedOut })
    await user.type(await screen.findByLabelText('Email', {}, FIND), 'ramesh@example.in')
    await user.type(screen.getByLabelText('Password'), 'Str0ng!Pass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(location.current.pathname).toBe('/dashboard'))
    expect(JSON.parse(server.calls('POST /auth/login')[0].data)).toEqual({ email: 'ramesh@example.in', password: 'Str0ng!Pass' })
    expect(technicianSession.currentCsrf()).toBe('csrf-login')
  })

  it('says the email or password is wrong when sign-in is refused', async () => {
    const user = userEvent.setup()
    installFakeServer({ 'POST /auth/login': { status: 401, data: { detail: 'Incorrect email or password.' } } })
    renderApp('/login', { auth: signedOut })
    await user.type(await screen.findByLabelText('Email', {}, FIND), 'ramesh@example.in')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText(INVALID_CREDENTIALS)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/login')
  })

  it('registers: email, mobile, the emailed code, then onboarding on a registration session', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      'POST /auth/signup/send-code': { data: { sent: true, expires_in_minutes: 10, resend_after_seconds: 30 } },
      'POST /auth/signup/verify-code': { data: { session_type: 'onboarding', user: ONBOARDING_USER, csrf_token: 'csrf-onboarding' } },
      'GET /auth/me': { data: { ...aSession(ONBOARDING_USER, 'onboarding'), csrf_token: 'csrf-onboarding' } },
    })
    renderApp('/register', { auth: signedOut })
    await user.type(await screen.findByLabelText('Email', {}, FIND), 'new.tech@example.in')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByPlaceholderText('10 digit mobile'), '9876500022')
    await user.click(screen.getByRole('button', { name: /Send email code/ }))
    await waitFor(() => expect(server.calls('POST /auth/signup/send-code')).toHaveLength(1))
    const digits = await screen.findAllByRole('textbox')
    await user.click(digits[0])
    await user.paste('482913')
    await user.click(screen.getByRole('button', { name: /Verify email/ }))
    await waitFor(() => expect(location.current.pathname).toBe('/onboarding'))
    expect(JSON.parse(server.calls('POST /auth/signup/verify-code')[0].data)).toEqual({ email: 'new.tech@example.in', phone: '9876500022', code: '482913' })
    expect(technicianSession.currentCsrf()).toBe('csrf-onboarding')
  })

})

it('answers an unknown address with the not-found page', async () => {
  installFakeServer({})
  renderApp('/no/such/page', { auth: signedOut })
  expect(await screen.findByText('This page does not exist.', {}, FIND)).toBeInTheDocument()
})
