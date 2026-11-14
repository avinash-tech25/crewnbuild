/**
 * The public Builder plans section (landing page #plans): four cards from the server's
 * plans (GET /subscriptions/plans), each with its price, its limit lines and its button;
 * Plus marked as the recommended plan; the sign-in link under every button.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AppProviders from '../../../app/AppProviders.jsx'
import { createAppStore } from '../../../app/store.js'
import { installFakeServer } from '../../../test/fakeServer.js'
import PlansSection from './PlansSection.jsx'

const FIND = { timeout: 15000 }

// The server's answer, with the real plan limits; prices in paise, as the server sends them.
const PLANS = {
  currency: 'INR',
  durations: [{ code: 'MONTHLY', months: 1 }, { code: 'ANNUAL', months: 12 }],
  grace_days: 3,
  unpriced: [],
  test_mode: true,
  plans: [
    { code: 'FREE', rank: 0, purchasable: false, features: [], badge: null, limits: { max_locations: 1, max_leads_per_location: 5 }, prices: {} },
    {
      code: 'PROFESSIONAL', rank: 1, purchasable: true, badge: 'PRO',
      features: ['bill_adjustments', 'builder_billing', 'builder_calendar', 'builder_photos', 'premium_badge', 'project_summary_export'],
      limits: { max_locations: 3, max_leads_per_location: 10 }, prices: { MONTHLY: 89900, ANNUAL: null },
    },
    {
      code: 'BUSINESS', rank: 2, purchasable: true, badge: 'PREMIUM',
      features: ['advanced_cost_summary', 'bill_adjustments', 'builder_billing', 'builder_calendar', 'builder_photos', 'consolidated_export', 'hd_video', 'premium_badge', 'project_summary_export'],
      limits: { max_locations: null, max_leads_per_location: null }, prices: { MONTHLY: 199900, ANNUAL: 1999000 },
    },
  ],
}

// The section on its own, as the landing page renders it (the rest of the landing page
// is not needed here).
function openPlans() {
  installFakeServer({ 'GET /subscriptions/plans': { data: PLANS } })
  render(
    <AppProviders store={createAppStore()}>
      <MemoryRouter>
        <PlansSection />
      </MemoryRouter>
    </AppProviders>,
  )
}

const lineTexts = (card) => within(card).getAllByRole('listitem').map((item) => item.textContent)

describe('Builder plans: the cards', () => {
  it('shows every card with its price, features and button, in order', async () => {
    openPlans()
    const cards = await screen.findAllByTestId('plan-card', {}, FIND)
    expect(cards.map((card) => card.dataset.plan)).toEqual(['FREE', 'PRO_MONTHLY', 'PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'])
    const [free, pro, plus, premium] = cards

    expect(within(free).getByText('₹0')).toBeInTheDocument()
    expect(lineTexts(free)).toHaveLength(3)
    expect(within(free).getByRole('link', { name: 'Start as a builder' })).toBeInTheDocument()

    expect(within(pro).getByText('₹899')).toBeInTheDocument()
    expect(within(pro).getByText('/month')).toBeInTheDocument()
    expect(within(pro).getByRole('button', { name: 'Choose Pro' })).toBeInTheDocument()

    expect(within(plus).getByText('₹1,999')).toBeInTheDocument()
    expect(within(plus).getByRole('button', { name: 'Choose Plus' })).toBeInTheDocument()

    expect(within(premium).getByText('₹19,990')).toBeInTheDocument()
    expect(within(premium).getByText('/year')).toBeInTheDocument()
    expect(within(premium).getByRole('button', { name: 'Choose Premium' })).toBeInTheDocument()
    // Twelve monthly Plus payments against the annual price, from the server's prices.
    expect(within(premium).getByText(/Save ₹3,998/)).toBeInTheDocument()

    for (const card of cards) {
      expect(lineTexts(card)).toHaveLength(3)
      // "Already a builder? Sign in" under every button.
      expect(within(card).getByRole('button', { name: 'Already a builder? Sign in' })).toBeInTheDocument()
    }
    // Test mode: the small tag beside each paid price.
    for (const card of [pro, plus, premium]) expect(within(card).getByText('Test price')).toBeInTheDocument()
  })

  it('marks Plus as the recommended plan, first in reading order on a phone', async () => {
    openPlans()
    const cards = await screen.findAllByTestId('plan-card', {}, FIND)
    const recommended = cards.filter((card) => card.dataset.recommended === 'true')
    expect(recommended.map((card) => card.dataset.plan)).toEqual(['PREMIUM_MONTHLY'])
    const [plus] = recommended
    expect(within(plus).getByText('Most popular')).toBeInTheDocument()
    expect(plus).toHaveAccessibleName('Plus — Most popular')
    expect(plus.className).toMatch(/order-first/)
    expect(within(plus).getByRole('button', { name: 'Choose Plus' }).className).toMatch(/bg-oc-deep/)
    expect(within(cards[1]).getByRole('button', { name: 'Choose Pro' }).className).not.toMatch(/bg-oc-deep/)
  })

  it('makes bold only the lines that improve on the card before', async () => {
    openPlans()
    const cards = await screen.findAllByTestId('plan-card', {}, FIND)
    const bold = (card) => within(card).getAllByRole('listitem').filter((item) => item.className.includes('font-extrabold')).length
    expect(bold(cards[0])).toBe(0) // Free: nothing before it
    expect(bold(cards[1])).toBe(2) // Pro: more locations and leads (same camera)
    expect(bold(cards[2])).toBe(3) // Plus: unlimited locations and leads, HD camera
    expect(bold(cards[3])).toBe(0) // Premium: Plus's limits, paid yearly
  })
})
