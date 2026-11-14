import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRequesterSession } from '../../shared/api/apiClient.js'
import { aRequesterSession, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut } from '../../test/renderApp.jsx'
import { HANDOFF_READY, HANDOFF_TOKEN } from './bookingApi.js'

// The map is Leaflet, which jsdom cannot draw. The stand-in places the pin when asked.
vi.mock('./components/LazyServiceLocationPicker.jsx', () => ({
  default: ({ onChoose }) => (
    <button type="button" onClick={() => onChoose([12.9716, 77.5946], 'MG Road')}>Place the pin</button>
  ),
}))
vi.mock('../tracking/components/LazyTrackingMap.jsx', () => ({ default: () => null }))

const FIND = { timeout: 8000 }
const PROFESSIONAL = 'http://professional.test'
const BOOKING_ID = '0190a8b2-4c1e-7aa0-9f00-00000000b002'
const REQUESTER = aRequesterSession({
  requester: { id: '0190a8b2-4c1e-7aa0-9f00-000000000001', name: 'Asha Rao', role: 'OWNER', role_label: 'House Owner', pincode: '560001', has_service_location: true },
})
const SERVICE = { id: '0190a8b2-4c1e-7aa0-9f00-0000000000a1', trade: 'PLUMBER', slug: 'pipe-leakage-repair', name: 'Pipe Leakage Repair', price: '499.00', currency: 'INR', kind: 'SERVICE', description: 'Fix a leaking pipe.' }
const aBooking = (status, overrides = {}) => ({
  id: BOOKING_ID, status, status_label: status.replace('_', ' '), technician_type: 'PLUMBER', service_address: '1 Test Road', pincode: '560001',
  description: 'Kitchen', service_name: 'Pipe Leakage Repair', service_kind: 'SERVICE', quoted_amount: '499.00', currency: 'INR',
  technician: { name: 'Ramesh Kumar', experience_years: 6, area: 'MG Road', phone: '9876500011', match_label: '1 km away', average_rating: null, rating_count: 0 },
  can_cancel: false, can_retry: false, can_rate: status === 'COMPLETED', created_at: '2026-11-14T09:00:00+05:30', updated_at: '2026-11-14T09:00:00+05:30',
  accepted_at: '2026-11-14T09:01:00+05:30', en_route_at: null, arrived_at: null, started_at: null, completed_at: null, ...overrides,
})
const signedInRequester = { 'GET /requester/session': { data: REQUESTER }, 'GET /requester/me': { data: REQUESTER.requester } }
const RATING_VOCABULARY = {
  tag_options: { positive: [{ key: 'on_time', label: 'Arrived on time' }], mixed: [], negative: [] },
  star_groups: { 1: 'negative', 2: 'negative', 3: 'mixed', 4: 'positive', 5: 'positive' },
}

afterEach(() => {
  delete window.opener
  delete navigator.geolocation
  delete window.isSecureContext
  vi.restoreAllMocks()
})

describe('the hand-off from the Professional app', () => {
  it('asks the opening window for a token by postMessage, trades it for a booking session, and stores nothing', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    Object.defineProperty(window, 'opener', { value: opener, configurable: true })
    const server = installFakeServer({
      'GET /requester/session': { status: 401, data: {} },
      'POST /requester/session': { data: REQUESTER },
      'GET /requester/bookings': { data: [] },
    })
    renderApp('/book-technician', { auth: signedOut })
    await waitFor(() => expect(opener.postMessage).toHaveBeenCalledWith({ type: HANDOFF_READY }, PROFESSIONAL), FIND)

    // A message from any other window or origin is ignored.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'http://evil.test', source: opener, data: { type: HANDOFF_TOKEN, handoffToken: 'stolen' } }))
      window.dispatchEvent(new MessageEvent('message', { origin: PROFESSIONAL, source: window, data: { type: HANDOFF_TOKEN, handoffToken: 'other-window' } }))
      window.dispatchEvent(new MessageEvent('message', { origin: PROFESSIONAL, source: opener, data: { type: HANDOFF_TOKEN, handoffToken: 'handoff-1' } }))
    })
    expect(await screen.findByText('Asha Rao', {}, FIND)).toBeInTheDocument()
    const calls = server.calls('POST /requester/session')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].data)).toEqual({ handoff_token: 'handoff-1' })
    expect(calls[0].params).toBeUndefined()
    expect(calls[0].principal).toBe('requester')
    expect(readRequesterSession()).not.toBeNull()
    expect(location.current.search).toBe('')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('says why when the server refuses the hand-off', async () => {
    const opener = { closed: false, postMessage: vi.fn() }
    Object.defineProperty(window, 'opener', { value: opener, configurable: true })
    installFakeServer({
      'GET /requester/session': { status: 401, data: {} },
      'POST /requester/session': { status: 403, data: { detail: 'Booking is only for House Owners and Site Engineers.' } },
    })
    renderApp('/book-technician', { auth: signedOut })
    await waitFor(() => expect(opener.postMessage).toHaveBeenCalled(), FIND)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: PROFESSIONAL, source: opener, data: { type: HANDOFF_TOKEN, handoffToken: 'handoff-2' } }))
    })
    expect(await screen.findByText('Booking is only for House Owners and Site Engineers.', {}, FIND)).toBeInTheDocument()
    expect(readRequesterSession()).toBeNull()
  })
})

describe('booking a technician', () => {
  it('books the service at the pin with the service id only, never a price, then opens the tracker', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      ...signedInRequester,
      'GET /requester/me/registered-location': { data: null },
      [`GET /requester/services/PLUMBER/${SERVICE.slug}`]: { data: SERVICE },
      'POST /requester/bookings': { status: 201, data: aBooking('SEARCHING', { technician: null }) },
      [`GET /requester/bookings/${BOOKING_ID}`]: { data: aBooking('SEARCHING', { technician: null }) },
    })
    renderApp(`/book-technician/plumber/${SERVICE.slug}`, { auth: signedOut })
    await user.click(await screen.findByRole('button', { name: 'Place the pin' }, FIND))
    await user.selectOptions(screen.getByRole('combobox'), screen.getAllByRole('option')[1])
    const book = screen.getByRole('button', { name: /Find nearby/ })
    await waitFor(() => expect(book).toBeEnabled())
    await user.click(book)
    await waitFor(() => expect(location.current.pathname).toBe(`/book-technician/bookings/${BOOKING_ID}`), { timeout: 5000 })
    const call = server.calls('POST /requester/bookings')[0]
    const body = JSON.parse(call.data)
    expect(body).toMatchObject({ service_id: SERVICE.id, technician_type: 'PLUMBER', service_latitude: 12.9716, service_longitude: 77.5946, service_accuracy: null })
    expect(body).not.toHaveProperty('price')
    expect(body).not.toHaveProperty('quoted_amount')
    expect(call.headers['X-CSRF-Token']).toBe('csrf-requester')
    expect(call.principal).toBe('requester')
  })
})

describe('following a booking', () => {
  it("shows the customer's Start Work code once the technician has arrived, and can get a new one", async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      ...signedInRequester,
      [`GET /requester/bookings/${BOOKING_ID}`]: { data: aBooking('ARRIVED', { en_route_at: '2026-11-14T09:05:00+05:30', arrived_at: '2026-11-14T09:20:00+05:30' }) },
      [`GET /requester/bookings/${BOOKING_ID}/start-otp`]: { data: { state: 'READY', code: '482913', expires_at: '2026-11-14T10:00:00+05:30', can_regenerate: true } },
      [`POST /requester/bookings/${BOOKING_ID}/start-otp/regenerate`]: { data: { state: 'READY', code: '593024', expires_at: '2026-11-14T10:30:00+05:30', can_regenerate: true } },
      [`GET /requester/bookings/${BOOKING_ID}/execution`]: { data: { booking_id: BOOKING_ID, status: 'ARRIVED', steps: [], steps_total: 0, steps_completed: 0, service_notes: null, media: [] } },
    })
    renderApp(`/book-technician/bookings/${BOOKING_ID}`, { auth: signedOut })
    const card = await screen.findByTestId('start-otp-card', {}, FIND)
    expect(await within(card).findByTestId('start-otp-code')).toHaveTextContent('482 913')
    await user.click(within(card).getByTestId('start-otp-regenerate'))
    expect(await within(card).findByTestId('start-otp-code')).toHaveTextContent('593 024')
    expect(server.calls(`POST /requester/bookings/${BOOKING_ID}/start-otp/regenerate`)[0].headers['X-CSRF-Token']).toBe('csrf-requester')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('rates a completed job once, with stars and tags', async () => {
    const user = userEvent.setup()
    let rated = null
    const view = () => ({
      state: rated ? 'RATED' : 'CAN_RATE', technician_name: 'Ramesh Kumar', stars: rated?.stars ?? null,
      tags: (rated?.tags || []).map((key) => ({ key, label: 'Arrived on time' })), ...RATING_VOCABULARY,
    })
    const server = installFakeServer({
      ...signedInRequester,
      [`GET /requester/bookings/${BOOKING_ID}`]: { data: aBooking('COMPLETED', { completed_at: '2026-11-14T11:00:00+05:30' }) },
      [`GET /requester/bookings/${BOOKING_ID}/rating`]: () => ({ data: view() }),
      [`POST /requester/bookings/${BOOKING_ID}/rating`]: (request) => {
        rated = JSON.parse(request.data)
        return { status: 201, data: view() }
      },
      [`GET /requester/bookings/${BOOKING_ID}/execution`]: { data: { booking_id: BOOKING_ID, status: 'COMPLETED', steps: [], steps_total: 0, steps_completed: 0, service_notes: null, media: [] } },
      [`GET /requester/bookings/${BOOKING_ID}/bill`]: { status: 404, data: { detail: 'No bill' } },
    })
    renderApp(`/book-technician/bookings/${BOOKING_ID}`, { auth: signedOut })
    const card = await screen.findByTestId('rating-card', {}, FIND)
    await user.click(within(card).getAllByTestId('rating-star')[4])
    await user.click(within(card).getByRole('button', { name: /Arrived on time/ }))
    await user.click(within(card).getByRole('button', { name: /Submit/ }))
    expect(await screen.findByTestId('rating-thanks', {}, FIND)).toBeInTheDocument()
    expect(JSON.parse(server.calls(`POST /requester/bookings/${BOOKING_ID}/rating`)[0].data)).toEqual({ stars: 5, tags: ['on_time'] })
  })

  it('without a booking session, says to start from the CREWNBUILD dashboard and asks for nothing else', async () => {
    const server = installFakeServer({ 'GET /requester/session': { status: 401, data: {} } })
    renderApp(`/book-technician/bookings/${BOOKING_ID}`, { auth: signedOut })
    expect(await screen.findByText('Start from your CREWNBUILD dashboard', {}, FIND)).toBeInTheDocument()
    expect(server.calls(`GET /requester/bookings/${BOOKING_ID}`)).toHaveLength(0)
    expect(server.requests.every((request) => request.principal !== 'technician')).toBe(true)
  })
})
