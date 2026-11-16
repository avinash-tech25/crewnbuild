import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { aRequesterSession, installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedOut } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'

vi.mock('../tracking/components/LazyTrackingMap.jsx', () => ({ default: () => null }))

const FIND = { timeout: 8000 }
const REQUESTER = aRequesterSession({
  requester: { id: '0190a8b2-4c1e-7aa0-9f00-000000000001', name: 'Asha Rao', role: 'OWNER', role_label: 'House Owner', pincode: '560001', has_service_location: true },
})
const aBooking = (id, status, overrides = {}) => ({
  id, status, status_label: status.replace('_', ' '), technician_type: 'PLUMBER', service_address: '1 Test Road', pincode: '560001',
  description: 'Kitchen', service_name: 'Pipe Leakage Repair', service_kind: 'SERVICE', quoted_amount: '499.00', currency: 'INR',
  technician: { name: 'Ramesh Kumar', experience_years: 6, area: 'MG Road', phone: '9876500011', match_label: '1 km away', average_rating: null, rating_count: 0 },
  can_cancel: false, can_retry: false, can_rate: status === 'COMPLETED', created_at: '2026-11-14T09:00:00+05:30', updated_at: '2026-11-14T09:00:00+05:30',
  ...overrides,
})

describe('my bookings', () => {
  it('draws every booking as the same card: trade, time, status, technician, actions in the footer', async () => {
    installFakeServer({
      'GET /requester/session': { data: REQUESTER },
      'GET /requester/me': { data: REQUESTER.requester },
      'GET /requester/bookings': {
        data: [
          aBooking('0190a8b2-4c1e-7aa0-9f00-00000000b011', 'COMPLETED'),
          aBooking('0190a8b2-4c1e-7aa0-9f00-00000000b012', 'SEARCHING', { technician: null }),
        ],
      },
    })
    renderApp('/book-technician', { auth: signedOut })
    const grid = await screen.findByTestId('booking-list', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)

    const [completed, searching] = cards
    expect(completed).toHaveAttribute('data-status', 'COMPLETED')
    expect(completed.querySelector('[data-card-part="status"]')).toHaveTextContent('Completed')
    expect(within(completed).getByText('Ramesh Kumar')).toBeInTheDocument()
    expect(within(completed).getByRole('link', { name: /9876500011/ })).toHaveAttribute('href', 'tel:9876500011')
    expect(within(completed).getByTestId('rate-technician-badge')).toBeInTheDocument()
    expect(within(completed).getByRole('link', { name: /Track booking/ })).toHaveAttribute('href', '/book-technician/bookings/0190a8b2-4c1e-7aa0-9f00-00000000b011')

    expect(searching.querySelector('[data-card-part="status"]')).toHaveTextContent('Searching')
    expect(within(searching).queryByTestId('rate-technician-badge')).not.toBeInTheDocument()
    expect(within(searching).getByRole('link', { name: /Track booking/ })).toBeInTheDocument()
  })
})
