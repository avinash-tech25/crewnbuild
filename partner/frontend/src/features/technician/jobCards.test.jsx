import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectUniformCards } from '../../test/cards.js'
import { AVAILABLE, FIND, aJob, anOffer, openDashboard, soon, summary, withDeviceStandIns } from '../../test/technicianDashboard.js'

withDeviceStandIns()

const SECOND_ID = '0190a8b2-4c1e-7aa0-9f00-00000000b002'

/** The footer's buttons are real buttons, on the side the anatomy puts them. */
function footerSides(card) {
  const footer = card.querySelector(':scope > [data-card-part="footer"]')
  const [left, right] = footer.children
  return { left: within(left), right: within(right) }
}

describe('job cards share one anatomy', () => {
  it('new requests: every offer has the same header, body and footer, Decline left and Accept right', async () => {
    openDashboard(AVAILABLE, {
      'GET /technicians/me/offers': {
        data: [
          anOffer(),
          anOffer({ booking_id: SECOND_ID, service_name: 'Tap Replacement', work_area: 'Bathroom', expires_at: soon(45) }),
        ],
      },
    })
    const grid = await screen.findByTestId('offer-list', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.getAttribute('data-testid'))).toEqual(['offer-card', 'offer-card'])
    expect(within(cards[0]).getByText('Pipe Leakage Repair')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Tap Replacement')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Bathroom')).toBeInTheDocument()
    for (const card of cards) {
      expect(within(card).getByTestId('offer-countdown')).toHaveAttribute('data-card-part', 'status')
      expect(within(card).getByTestId('offer-estimate')).toHaveTextContent('₹449.1')
      expect(within(card).getByText('Service price')).toBeInTheDocument()
      expect(within(card).getByText('Distance')).toBeInTheDocument()
      const { left, right } = footerSides(card)
      expect(left.getByRole('button', { name: /Decline/ })).toHaveAttribute('type', 'button')
      expect(right.getByRole('button', { name: /Accept Job/ })).toHaveAttribute('type', 'button')
    }
  })

  it('accepted jobs: the same anatomy for every card, status top right, Start journey on the right', async () => {
    const user = userEvent.setup()
    openDashboard(AVAILABLE, {
      'GET /technicians/me/dashboard': { data: summary({ accepted_jobs: 2 }) },
      'GET /technicians/me/jobs': (request) => ({
        data: request.params?.bucket === 'accepted'
          ? [aJob('ACCEPTED'), aJob('ACCEPTED', { id: SECOND_ID, service_name: 'Tap Replacement', requester_name: 'Vikram', requester_phone: '9000000002' })]
          : [],
      }),
    })
    await user.click(await screen.findByRole('button', { name: /Accepted Jobs/ }, FIND))
    const grid = await screen.findByTestId('job-list', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Asha Rao')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Vikram')).toBeInTheDocument()
    for (const card of cards) {
      expect(card).toHaveAttribute('data-testid', 'job-card')
      expect(card).toHaveAttribute('data-status', 'ACCEPTED')
      expect(card.querySelector('[data-card-part="header"] > [data-card-part="status"]')).toHaveTextContent('accepted')
      expect(within(card).getByText('1 Test Road')).toBeInTheDocument()
      expect(within(card).getByText('560001')).toBeInTheDocument()
      const { left, right } = footerSides(card)
      expect(left.getByRole('link', { name: /Call/ })).toHaveAttribute('href', expect.stringMatching(/^tel:9000/))
      expect(right.getByRole('button', { name: /Start journey/ })).toHaveAttribute('type', 'button')
    }
  })

  it('cancelled jobs: the same anatomy, and what is no longer shared is still said', async () => {
    const user = userEvent.setup()
    const cancelled = (overrides) => aJob('CANCELLED', { requester_name: null, requester_phone: null, cancelled_at: soon(-60), ...overrides })
    openDashboard(AVAILABLE, {
      'GET /technicians/me/dashboard': { data: summary({ cancelled_jobs: 2 }) },
      'GET /technicians/me/jobs': (request) => ({
        data: request.params?.bucket === 'cancelled' ? [cancelled(), cancelled({ id: SECOND_ID, service_name: 'Tap Replacement' })] : [],
      }),
    })
    await user.click(await screen.findByRole('button', { name: /Cancelled Jobs/ }, FIND))
    const grid = await screen.findByTestId('job-list', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card).toHaveAttribute('data-status', 'CANCELLED')
      expect(within(card).getByTestId('cancelled-banner')).toBeInTheDocument()
      expect(within(card).getByText(/no longer shared/)).toBeInTheDocument()
    }
  })
})
