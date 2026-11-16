/**
 * Request cards (the Requests panel) and a supplier's products on the request
 * profile render the shared CardGrid of ListCards: one anatomy and one size.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import AppProviders from '../../app/AppProviders.jsx'
import { createAppStore } from '../../app/store.js'
import { SITE_ENGINEER, engineerDashboardServer } from '../engineer/engineerTestData.js'
import { RequestProfileDashboard } from './components/RequestProfileDashboard.jsx'

const FIND = { timeout: 15000 }

const aRequest = (n, extra = {}) => ({
  id: `0190a8b2-4c1e-7aa0-9f00-0000000000c${n}`,
  project_id: `0190a8b2-4c1e-7aa0-9f00-0000000000a${n}`,
  project_title: `Project ${n}`,
  project_address: '12 MG Road',
  sender_id: '0190a8b2-4c1e-7aa0-9f00-000000000001',
  receiver_id: SITE_ENGINEER.id,
  sender_name: 'Asha Rao',
  sender_role: 'OWNER',
  request_type: 'OWNER_TO_ENGINEER',
  status: 'pending',
  budget: 4500000,
  land_area: 1200,
  is_sender: false,
  is_receiver: true,
  created_at: '2026-11-02T10:00:00+05:30',
  created_at_iso: '2026-11-02T10:00:00+05:30',
  ...extra,
})

describe('request cards', () => {
  it('lists the requests as uniform cards, and View Details opens the details', async () => {
    const user = userEvent.setup()
    installFakeServer(engineerDashboardServer({
      'GET /project-requests/incoming': { data: [
        aRequest(1),
        aRequest(2, { status: 'accepted', project_title: 'A very long project name that would otherwise push the card wider than the others' }),
      ] },
    }))
    renderApp('/engineer/find-opportunities?tab=requests', { auth: signedInAs(SITE_ENGINEER) })
    const cards = expectUniformCards(await screen.findByTestId('request-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    // The pending request can be answered; the accepted one says so.
    expect(within(cards[0]).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(cards[0]).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(within(cards[1]).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(within(cards[1]).getByText('Accepted')).toBeInTheDocument()
    await user.click(within(cards[0]).getByRole('button', { name: 'View Details' }))
    expect(screen.getByRole('region', { name: 'Request Details' })).toBeInTheDocument()
  })

  it("lists a supplier's products on the request profile as uniform cards", () => {
    render(
      <AppProviders store={createAppStore()}>
        <MemoryRouter>
          <RequestProfileDashboard
            details={{
              profile_role: 'SUPPLIER',
              profile_title: 'Ravi Cements',
              profile_products: [
                { id: 'p1', name: 'Cement', category: 'Cement', price: 400, unit: 'bag', quantity: 20, features: ['OPC 53'] },
                { id: 'p2', name: 'A product with a very long name that would not fit on one line', price: 90, unit: 'kg', quantity: 5 },
              ],
            }}
            participant={null}
            canViewContact={false}
            onClose={vi.fn()}
          />
        </MemoryRouter>
      </AppProviders>,
    )
    const cards = expectUniformCards(screen.getByTestId('profile-product-cards'))
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('OPC 53')).toBeInTheDocument()
  })
})
