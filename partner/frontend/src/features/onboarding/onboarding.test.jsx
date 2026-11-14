import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store.js'
import { aSession, aTechnician, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut, technicianSignedIn } from '../../test/renderApp.jsx'
import { submitFaceCapture } from '../technician/technicianApi.js'

const FIND = { timeout: 8000 }
const AADHAAR = '234123412346'
const onboardingAt = (step, extra = {}) =>
  aTechnician({
    status: 'PENDING',
    onboarding: { step, face_status: step === 'FACE' ? 'PENDING' : 'SUBMITTED', aadhaar_status: 'PENDING', aadhaar_masked: null, can_receive_jobs: false, pending_requirements: [step], ...extra },
  })

function openOnboarding(user, routes = {}) {
  const server = installFakeServer({ 'GET /auth/me': { data: aSession(user, 'onboarding') }, ...routes })
  renderApp('/onboarding', { auth: technicianSignedIn(user, 'onboarding') })
  return server
}

afterEach(() => {
  vi.restoreAllMocks()
  delete navigator.mediaDevices
  delete window.isSecureContext
})

describe('face verification', () => {
  it('asks for the camera only when the technician starts it, after agreeing', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
    // A camera needs a secure context; jsdom's page is not one.
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    openOnboarding(onboardingAt('FACE'))
    const start = await screen.findByRole('button', { name: /Start camera/ }, FIND)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(start).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(start)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: { facingMode: 'user' }, audio: false })
  })

  it('sends the capture once in the request body, with consent, and keeps no copy in browser storage', async () => {
    createAppStore()
    const server = installFakeServer({ 'POST /onboarding/face': { data: onboardingAt('AADHAAR') } })
    const capture = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
    await submitFaceCapture(capture)
    const form = server.calls('POST /onboarding/face')[0].data
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('consent')).toBe('true')
    expect(form.get('capture')).toBeInstanceOf(Blob)
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})

describe('Aadhaar', () => {
  it('sends the number once in the body, then clears it and moves on to the details', async () => {
    const user = userEvent.setup()
    const server = openOnboarding(onboardingAt('AADHAAR'), {
      'POST /onboarding/aadhaar': { data: onboardingAt('PROFILE', { aadhaar_status: 'PENDING_VERIFICATION', aadhaar_masked: 'XXXX XXXX 2346' }) },
      'GET /technicians/me/catalog': { data: [] },
      'GET /locations/pincode/560001': { data: { pincode: '560001', district: 'Bengaluru Urban', state: 'Karnataka', areas: [{ name: 'MG Road', block: null }] } },
    })
    await user.type(await screen.findByPlaceholderText('0000 0000 0000', {}, FIND), AADHAAR)
    const save = screen.getByRole('button', { name: /Save Aadhaar details/ })
    expect(save).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(save)
    await waitFor(() => expect(server.calls('POST /onboarding/aadhaar')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /onboarding/aadhaar')[0].data)).toEqual({ aadhaar_number: AADHAAR, consent: true })
    expect(server.calls('POST /onboarding/aadhaar')[0].params).toBeUndefined()
    expect(await screen.findByText('Full name', {}, FIND)).toBeInTheDocument()
    expect(document.body.textContent.replace(/\s/g, '')).not.toContain(AADHAAR)
    for (const input of document.querySelectorAll('input')) expect(input.value.replace(/\s/g, '')).not.toBe(AADHAAR)
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('refuses a number that fails the checksum before sending it', async () => {
    const user = userEvent.setup()
    const server = openOnboarding(onboardingAt('AADHAAR'))
    await user.type(await screen.findByPlaceholderText('0000 0000 0000', {}, FIND), '234123412345')
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/does not look like a valid Aadhaar number/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save Aadhaar details/ })).toBeDisabled()
    expect(server.calls('POST /onboarding/aadhaar')).toHaveLength(0)
  })
})

describe('password reset', () => {
  it('sends a code, exchanges it for a reset token, and sets the new password', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      'POST /auth/password-reset/send-code': { data: { message: 'If an account exists, a code has been sent.', expires_in_minutes: 10, resend_after_seconds: 30 } },
      'POST /auth/password-reset/verify-code': { data: { reset_token: 'reset-token-1', expires_in_minutes: 10 } },
      'POST /auth/password-reset/reset': { data: { message: 'Your password has been reset. Sign in with your new password.' } },
    })
    renderApp('/forgot-password', { auth: signedOut })
    await user.type(await screen.findByLabelText('Email', {}, FIND), 'ramesh@example.in')
    await user.click(screen.getByTestId('reset-send'))
    await user.type(await screen.findByLabelText('6-digit code'), '482913')
    await user.click(screen.getByTestId('reset-verify'))
    await user.type(await screen.findByLabelText('New password'), 'N3w!Password1')
    await user.type(screen.getByLabelText('Confirm new password'), 'N3w!Password1')
    await user.click(screen.getByTestId('reset-submit'))
    await waitFor(() => expect(server.calls('POST /auth/password-reset/reset')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /auth/password-reset/verify-code')[0].data)).toEqual({ email: 'ramesh@example.in', code: '482913' })
    expect(JSON.parse(server.calls('POST /auth/password-reset/reset')[0].data)).toEqual({
      reset_token: 'reset-token-1',
      new_password: 'N3w!Password1',
      confirm_new_password: 'N3w!Password1',
    })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})
