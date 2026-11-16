/**
 * The House Owner's card lists (projects, Find Builders, Site Engineers) render the
 * shared CardGrid of ListCards: one anatomy and one size for every card in a list.
 */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { OWNER, PROJECT_ID, aProject, ownerDashboardServer } from './ownerTestData.js'

const FIND = { timeout: 15000 }
const id = (n) => `0190a8b2-4c1e-7aa0-9f00-00000000${String(n).padStart(4, '0')}`

function openOwner(path, routes = {}) {
  installFakeServer(ownerDashboardServer(routes))
  renderApp(path, { auth: signedInAs(OWNER) })
}

describe('House Owner card lists', () => {
  it('lists the projects as uniform cards, whatever their text', async () => {
    openOwner('/owner/projects', {
      'GET /owners/projects': { data: [
        aProject(),
        aProject({ id: id(2), title: 'A very long project name that would otherwise push the card wider than its neighbours', address: 'x'.repeat(200) }),
        aProject({ id: id(3), title: 'Lake View Villa', contractor_id: id(9), contractor_name: 'Ravi Builders' }),
      ] },
    })
    const grid = await screen.findByTestId('owner-project-cards', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(3)
    // Every card keeps its own actions.
    cards.forEach((card) => {
      expect(within(card).getByRole('button', { name: /^Delete$/ })).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: /Edit/ })).toBeInTheDocument()
    })
    expect(within(cards[0]).getByText('Rao Family Home')).toBeInTheDocument()
  })

  it('lists the nearby builders as uniform cards', async () => {
    const builder = (n, extra = {}) => ({
      id: id(100 + n),
      user_id: id(200 + n),
      name: `Builder ${n}`,
      company_name: `Company ${n}`,
      experience_years: n,
      completed_projects: n * 2,
      rating: 4,
      review_count: 3,
      services_offered: ['Residential', 'Renovation', 'Interiors'],
      is_verified: n === 1,
      ...extra,
    })
    openOwner(`/owner/projects/${PROJECT_ID}/builders`, {
      'GET /owners/projects': { data: [aProject()] },
      'GET /contractors/nearby': { data: [builder(1), builder(2, { name: 'A builder with a very long name that would not fit on one line of the card', services_offered: [] })] },
      [`GET /projects/${PROJECT_ID}/award`]: { data: { award: null } },
    })
    const grid = await screen.findByTestId('owner-builder-cards', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    cards.forEach((card) => {
      expect(within(card).getByRole('button', { name: /Send Request/ })).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: /View/ })).toBeInTheDocument()
    })
  })

  it('lists the accepted and the nearby Site Engineers as uniform cards', async () => {
    const engineer = (n, extra = {}) => ({
      user_id: id(300 + n),
      name: `Engineer ${n}`,
      specialization: 'Site Engineer',
      pincode: '560001',
      rating: 0,
      ...extra,
    })
    const accepted = (n) => ({
      id: id(400 + n),
      project_id: PROJECT_ID,
      request_type: 'OWNER_TO_ENGINEER',
      status: 'accepted',
      is_sender: true,
      sender_id: OWNER.id,
      receiver_id: id(310 + n),
      sender_name: `Engineer ${10 + n}`,
    })
    openOwner(`/owner/projects/${PROJECT_ID}/siteEngineer`, {
      'GET /owners/projects': { data: [aProject({ construction_type: 'SELF_CONSTRUCTION' })] },
      'GET /engineers/find': { data: [
        engineer(1),
        engineer(2, { working_on_project: true }),
        engineer(11),
        engineer(12),
      ] },
      'GET /project-requests/incoming': { data: [accepted(1), accepted(2)] },
      [`GET /projects/${PROJECT_ID}/engineer`]: { data: { engineer: null } },
    })
    const browse = expectUniformCards(await screen.findByTestId('owner-engineer-cards', {}, FIND))
    expect(browse).toHaveLength(2)
    expect(within(browse[0]).getByRole('button', { name: /Send Request/ })).toBeInTheDocument()
    expect(within(browse[1]).queryByRole('button', { name: /Send Request/ })).not.toBeInTheDocument()
    const chosen = expectUniformCards(screen.getByTestId('owner-accepted-engineers'))
    expect(chosen).toHaveLength(2)
  })
})
