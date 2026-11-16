/**
 * Buy & Sell listings (the market feed and the seller's own) render the shared
 * CardGrid of ListCards: one anatomy and one size for every card.
 */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { OWNER, ownerDashboardServer } from '../owner/ownerTestData.js'

const FIND = { timeout: 15000 }

const listing = (n, extra = {}) => ({
  id: `0190a8b2-4c1e-7aa0-9f00-0000000000f${n}`,
  title: `Listing ${n}`,
  property_type: 'APARTMENT',
  listing_type: 'SALE',
  status: 'LISTED',
  price: 9500000 + n,
  city: 'Bengaluru',
  pincode: '560038',
  bedrooms: 2,
  area_sqft: 1100,
  image_urls: [],
  is_mine: false,
  created_at: '2026-11-03T10:00:00+05:30',
  ...extra,
})

describe('Buy & Sell cards', () => {
  it('lists the published properties as uniform cards', async () => {
    installFakeServer(ownerDashboardServer({
      'GET /property-listings': { data: { property_types: [], cities: [], listings: [
        listing(1),
        listing(2, { title: 'A very long listing title that would otherwise push the card wider than the others', is_negotiable: true }),
      ] } },
    }))
    renderApp('/owner/buy-sell', { auth: signedInAs(OWNER) })
    const cards = expectUniformCards(await screen.findByTestId('property-feed-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    cards.forEach((card) => expect(within(card).getByRole('button', { name: /View Details/ })).toBeInTheDocument())
  })

  it("lists the seller's own properties as uniform cards with their status", async () => {
    installFakeServer(ownerDashboardServer({
      'GET /property-listings': { data: { property_types: [], cities: [], listings: [] } },
      'GET /property-listings/mine': { data: [
        listing(1, { is_mine: true, seller_id: OWNER.id }),
        listing(2, { is_mine: true, seller_id: OWNER.id, status: 'DRAFT' }),
      ] },
    }))
    renderApp('/owner/buy-sell?tab=sell', { auth: signedInAs(OWNER) })
    const cards = expectUniformCards(await screen.findByTestId('property-my-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    cards.forEach((card) => expect(within(card).getByRole('button', { name: /View & Manage/ })).toBeInTheDocument())
    expect(within(cards[1]).getByText('Draft')).toBeInTheDocument()
  })
})
