/**
 * The Site Engineer's card lists all render the shared CardGrid of ListCards, so every
 * card in a list has the same anatomy and size, whatever its text or its actions.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { BUILDER_ID, PROJECT_ID, SITE_ENGINEER, anAssignedProject, engineerDashboardServer } from './engineerTestData.js'

const FIND = { timeout: 15000 }
const id = (n) => `0190a8b2-4c1e-7aa0-9f00-0000000a${String(n).padStart(4, '0')}`

function open(path, routes) {
  const server = installFakeServer(engineerDashboardServer({ 'GET /engineers/my-projects': { data: [anAssignedProject()] }, ...routes }))
  renderApp(path, { auth: signedInAs(SITE_ENGINEER) })
  return server
}

const aTeam = (n, status, extra = {}) => ({
  relationship_id: id(n), contractor_id: id(100 + n), company_name: `Builder Co ${n}`, contractor_name: `Builder ${n}`, pincode: '560001', status, ...extra,
})

describe('Site Engineer card lists', () => {
  it('My Projects: one card per project, the same structure whatever the text', async () => {
    open('/engineer/my-projects', {
      'GET /engineers/my-projects': { data: [
        anAssignedProject(),
        anAssignedProject({ id: id(1), title: 'A very long project name that would otherwise push the card wider than the others', company_name: null, end_date: null, building_type: null }),
      ] },
    })
    const grid = await screen.findByTestId('engineer-project-cards', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Rao Family Home')).toBeInTheDocument()
    expect(within(cards[1]).getAllByRole('button', { name: 'Open Project' })).toHaveLength(1)
  })

  it('Find Opportunities: applied and not-yet-applied cards share one structure', async () => {
    const user = userEvent.setup()
    const server = open('/engineer/find-opportunities?tab=opportunities', {
      'GET /engineers/opportunities': { data: [
        { ...anAssignedProject({ title: 'Lake View Villa' }), project_id: PROJECT_ID },
        { ...anAssignedProject({ title: 'Hill Top House', construction_type: null }), project_id: id(2) },
      ] },
      [`POST /engineers/opportunities/${PROJECT_ID}/apply`]: { data: { message: 'Application sent' } },
    })
    const grid = await screen.findByTestId('engineer-opportunity-cards', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    cards.forEach((card) => expect(within(card).getByRole('button', { name: 'View Opportunity' })).toBeInTheDocument())
    await user.click(within(cards[0]).getByRole('button', { name: /^Apply/ }))
    await screen.findByText('Applied', {}, FIND)
    expect(server.calls(`POST /engineers/opportunities/${PROJECT_ID}/apply`)).toHaveLength(1)
    expectUniformCards(screen.getByTestId('engineer-opportunity-cards'))
  })

  it('Discover Builders: a team member and a builder to join share one structure', async () => {
    open('/engineer/find-opportunities?tab=contractors', {
      'GET /engineers/my-team': { data: { teams: [aTeam(1, 'ACTIVE', { contractor_id: BUILDER_ID })], incoming_requests: [] } },
      'GET /contractors/nearby': { data: [
        { user_id: BUILDER_ID, name: 'Ravi Builders', company_name: 'Ravi Constructions', pincode: '560001', experience_years: 12, rating: 4.5, completed_projects: 8 },
        { user_id: id(3), name: 'Kumar', company_name: '', pincode: '560002', experience_years: 3, completed_projects: 1 },
      ] },
    })
    const grid = await screen.findByTestId('engineer-builder-cards', {}, FIND)
    const cards = expectUniformCards(grid)
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('In Your Team')).toBeInTheDocument()
    expect(within(cards[1]).getByRole('button', { name: 'Request to Join' })).toBeInTheDocument()
  })

  it('Join a Builder Team: teams, incoming requests and sent requests are card lists', async () => {
    open('/engineer/find-opportunities?tab=joinTeam', {
      'GET /engineers/my-team': { data: {
        teams: [aTeam(1, 'ACTIVE'), aTeam(2, 'ACTIVE'), aTeam(3, 'PENDING'), aTeam(4, 'REJECTED')],
        incoming_requests: [aTeam(5, 'PENDING'), aTeam(6, 'PENDING', { company_name: null })],
      } },
    })
    const team = expectUniformCards(await screen.findByTestId('engineer-team-cards', {}, FIND))
    expect(team).toHaveLength(2)
    const incoming = expectUniformCards(screen.getByTestId('engineer-incoming-team-requests'))
    expect(incoming).toHaveLength(2)
    incoming.forEach((card) => {
      expect(within(card).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    })
    expect(expectUniformCards(screen.getByTestId('engineer-team-requests'))).toHaveLength(2)
  })

  const supplier = (n, category) => ({ user_id: id(200 + n), name: `Supplier ${n}`, store_name: `Store ${n}`, supplier_category: category })

  it('Labor: supplier cards and request cards (with and without actions) share one structure', async () => {
    const laborRequest = (n, status) => ({
      id: id(300 + n), trade: 'Mason', supplier_name: 'Store 1', status, workers_required: 4, workers_allocated: status === 'COMPLETED' ? 4 : null,
      start_date: '2026-11-01', end_date: '2026-11-10', work_description: 'Brick work', decision_note: null, completed_at: '2026-11-10T10:00:00+05:30',
      supplier_assignment_active: true,
    })
    open('/engineer/my-supplies?tab=labor&list=history', {
      [`GET /projects/${PROJECT_ID}/suppliers`]: { data: [supplier(1, 'Labor Supplier'), supplier(2, 'Labor Supplier')] },
      [`GET /projects/${PROJECT_ID}/labor-requests`]: { data: [laborRequest(1, 'COMPLETED'), laborRequest(2, 'REJECTED')] },
      [`GET /projects/${PROJECT_ID}/labor-suppliers/${id(201)}/services`]: { data: [{ id: id(401), trade: 'Mason', workers_available: 5, is_active: true }] },
      [`GET /projects/${PROJECT_ID}/labor-suppliers/${id(202)}/services`]: { data: [] },
      'GET /labor/trades': { data: [] },
    })
    const suppliers = expectUniformCards(await screen.findByTestId('engineer-labor-supplier-cards', {}, FIND))
    expect(suppliers).toHaveLength(2)
    suppliers.forEach((card) => expect(within(card).getByRole('button', { name: /Request Labor/ })).toBeInTheDocument())
    const requests = expectUniformCards(screen.getByTestId('engineer-labor-request-cards'))
    expect(requests).toHaveLength(2)
    // A rejected request has no action, yet keeps the footer the completed one has.
    requests.forEach((card) => expect(card.querySelector('[data-card-part="footer"]')).not.toBeNull())
  })

  it('Equipment: supplier, item and request cards share one structure', async () => {
    const user = userEvent.setup()
    const item = (n, mode, extra = {}) => ({
      id: id(500 + n), name: `Excavator ${n}`, category: 'Earth moving', brand: 'JCB', model: '3DX', condition: 'NEW', mode,
      daily_rate: 5000, sale_price: 900000, available_to_rent: 1, available_to_buy: 1, quantity_total: 2, image_url: null, ...extra,
    })
    const equipmentRequest = (n, kind, status) => ({
      id: id(600 + n), request_kind: kind, item_name: `Excavator ${n}`, supplier_name: 'Store 1', status, quantity: 1, unit_price: 5000,
      rate_unit: 'DAY', start_date: '2026-11-01', end_date: '2026-11-05', notes: null, decision_note: null, completed_at: '2026-11-05T10:00:00+05:30',
    })
    open('/engineer/my-supplies?tab=equipment&list=history', {
      [`GET /projects/${PROJECT_ID}/suppliers`]: { data: [supplier(1, 'Equipment Supplier'), supplier(2, 'Equipment Supplier')] },
      [`GET /projects/${PROJECT_ID}/equipment-requests`]: { data: [equipmentRequest(1, 'RENT', 'COMPLETED'), equipmentRequest(2, 'BUY', 'REJECTED')] },
      [`GET /projects/${PROJECT_ID}/equipment-suppliers/${id(201)}/items`]: { data: [item(1, 'RENT_BUY'), item(2, 'BUY', { specifications: 'x'.repeat(300) })] },
      [`GET /projects/${PROJECT_ID}/equipment-suppliers/${id(202)}/items`]: { data: [] },
    })
    const suppliers = expectUniformCards(await screen.findByTestId('engineer-equipment-supplier-cards', {}, FIND))
    expect(suppliers).toHaveLength(2)
    const requests = expectUniformCards(screen.getByTestId('engineer-equipment-request-cards'))
    expect(requests).toHaveLength(2)
    await user.click(within(suppliers[0]).getByRole('button', { name: /View/ }))
    const items = expectUniformCards(await screen.findByTestId('engineer-equipment-item-cards', {}, FIND))
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByRole('button', { name: /Rent/ })).toBeInTheDocument()
    expect(within(items[1]).getByRole('button', { name: /Request Purchase/i })).toBeInTheDocument()
  })

  it("Store: the store's product tiles share one structure", async () => {
    const storeItem = (n, extra = {}) => ({
      id: id(700 + n), name: `Cement ${n}`, brand: 'UltraTech', category: 'Cement', variant: '50 kg', unit: 'bag', quantity: 40, stock_state: 'IN_STOCK', image_url: null, ...extra,
    })
    open('/engineer/my-supplies?tab=store', {
      'GET /store/site-stores': { data: [{
        store_manager_id: id(800), store_manager_name: 'Suresh Nair', project_ids: [PROJECT_ID],
        items: [storeItem(1), storeItem(2, { name: 'River sand', brand: null, category: 'Sand', description: 'Washed', stock_state: 'LOW_STOCK' })],
      }] },
    })
    const tiles = expectUniformCards(await screen.findByTestId('engineer-store-product-cards', {}, FIND))
    expect(tiles).toHaveLength(2)
    expect(within(tiles[0]).getByRole('button', { name: 'Add to cart Cement 1' })).toBeInTheDocument()
  })
})
