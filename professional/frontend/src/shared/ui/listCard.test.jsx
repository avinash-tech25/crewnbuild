/**
 * Cards in one list share one anatomy and one size: every list renders the shared
 * CardGrid of ListCards.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { BUILDER, builderDashboardServer } from '../../features/builder/builderTestData.js'

const FIND = { timeout: 15000 }
const project = (n, extra = {}) => ({
  id: `0190a8b2-4c1e-7aa0-9f00-00000000a00${n}`, title: `Project ${n}`, status: 'active', pincode: '560001', budget: 100, owner_id: 'o', owner_name: 'Asha', ...extra,
})

describe('list cards', () => {
  it("the Builder's project cards share one structure, whatever their text", async () => {
    installFakeServer(builderDashboardServer({
      'GET /owners/projects': { data: [
        project(1),
        project(2, { title: 'A very long project name that would otherwise push the card wider than its neighbours in the row', address: 'x'.repeat(200) }),
        project(3, { status: 'completed' }),
      ] },
    }))
    renderApp('/contractor/projects?tab=upcoming', { auth: signedInAs(BUILDER) })
    const grid = await screen.findByTestId('builder-project-cards', {}, FIND)
    const cards = expectUniformCards(grid)
    // A long title is cut with an ellipsis and kept whole as its tooltip.
    const long = cards.find((card) => card.textContent.includes('A very long project'))
    const title = long.querySelector('[data-card-part="header"] p')
    expect(title).toHaveClass('truncate')
    expect(title).toHaveAttribute('title', expect.stringContaining('A very long project'))
  })
})

describe('list card keyboard', () => {
  it('a card that opens is focusable and opens with Enter, as a click does', async () => {
    const { render, fireEvent } = await import('@testing-library/react')
    const { ListCard } = await import('./ListCard.jsx')
    let opened = 0
    const view = render(<ListCard title="Card" onClick={() => { opened += 1 }} primary={<button type="button">Act</button>} />)
    const card = view.container.querySelector('[data-card="list"]')
    expect(card).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(opened).toBe(1)
    // Enter on the button inside stays the button's.
    fireEvent.keyDown(view.getByRole('button', { name: 'Act' }), { key: 'Enter' })
    expect(opened).toBe(1)
  })
})
