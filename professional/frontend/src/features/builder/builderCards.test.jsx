/**
 * Builder card lists: every list renders the shared CardGrid of ListCards, and the
 * cards in one list share one anatomy, whatever their data.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { BUILDER, anOwnerLead, anOwnerRequest, builderDashboardServer } from './builderTestData.js'

const FIND = { timeout: 15000 }
const PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-00000000a001'
const PROJECT = { id: PROJECT_ID, title: 'Vasudeva Sarvam Idam', status: 'active', pincode: '560001', budget: 0, owner_id: 'o', owner_name: 'Asha' }
const id = (n) => `0190a8b2-4c1e-7aa0-9f00-0000000000${String(n).padStart(2, '0')}`

const anEngineer = (n, extra = {}) => ({
  user_id: id(n), name: `Engineer ${n}`, pincode: '560001', address: '1 MG Road, Bengaluru', experience_years: n,
  project_count: 0, assigned_projects: [], specialization: 'Site Engineer', created_at: '2026-11-01T10:00:00+05:30', ...extra,
})
const aSupplier = (n, extra = {}) => ({
  id: id(50 + n), user_id: id(50 + n), name: `Supplier ${n}`, store_name: `Store ${n}`, supplier_category: 'Material Supplier',
  categories: ['Cement'], pincode: '560002', address: '12 Market Road, Bengaluru', rating: 4, assigned_projects: [], ...extra,
})

function open(path, routes = {}) {
  installFakeServer(builderDashboardServer({
    'GET /owners/projects': { data: [PROJECT] },
    [`GET /projects/${PROJECT_ID}/engineer`]: { data: { engineer: null } },
    [`GET /projects/${PROJECT_ID}/suppliers`]: { data: [] },
    ...routes,
  }))
  renderApp(path, { auth: signedInAs(BUILDER) })
}

describe('Builder card lists share one structure', () => {
  it('My Projects: the amount is labelled by what it is (contract, quotation or budget)', async () => {
    open('/contractor/projects?tab=upcoming', {
      'GET /owners/projects': { data: [
        { ...PROJECT, contract_amount: 2500000, awarded_amount: 2400000, budget: 2000000 },
        { ...PROJECT, id: id(98), title: 'Quoted House', awarded_amount: 2400000, budget: 2000000 },
        { ...PROJECT, id: id(99), title: 'Budget House', budget: 2000000 },
      ] },
    })
    const cards = expectUniformCards(await screen.findByTestId('builder-project-cards', {}, FIND))
    expect(within(cards[0]).getByText('Contract value')).toBeInTheDocument()
    expect(within(cards[0]).queryByText('Budget')).not.toBeInTheDocument()
    expect(within(cards[1]).getByText('Builder quotation')).toBeInTheDocument()
    expect(within(cards[2]).getByText('Budget')).toBeInTheDocument()
  })

  it('My Site Engineers', async () => {
    open('/contractor/my-site-engineers', {
      'GET /engineers/my-team': { data: {
        active: [
          anEngineer(1),
          anEngineer(2, { project_count: 1, working_on_project: true, assigned_projects: [{ project_id: PROJECT_ID, title: 'Vasudeva Sarvam Idam' }] }),
          anEngineer(3, { working_on_other_project: true, working_on_project: true }),
        ],
        pending_requests: [], outgoing_requests: [], invitations: [],
      } },
    })
    const cards = expectUniformCards(await screen.findByTestId('builder-team-engineer-cards', {}, FIND))
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByRole('button', { name: /Assign Project/ })).toBeEnabled()
    expect(within(cards[1]).getByRole('button', { name: /Unassign/ })).toBeEnabled()
  })

  it('Find Site Engineers', async () => {
    open('/contractor/my-site-engineers?tab=find', {
      'GET /engineers/find': { data: [anEngineer(1), anEngineer(2, { request_status: 'SENT' }), anEngineer(3, { request_status: 'INCOMING', relationship_id: id(90) })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('builder-find-engineer-cards', {}, FIND))
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByRole('button', { name: /Send Request/ })).toBeEnabled()
    expect(within(cards[2]).getByRole('button', { name: /Accept/ })).toBeEnabled()
  })

  it('My Suppliers', async () => {
    open('/contractor/my-site-engineers?tab=suppliers', {
      'GET /contractors/my-suppliers': { data: [aSupplier(1), aSupplier(2, { supplier_category: 'Labor Supplier', assigned_projects: [{ project_id: PROJECT_ID, project_title: 'Vasudeva Sarvam Idam' }] })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('builder-supplier-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })

  it('Pending requests: join requests, invitations and sent requests', async () => {
    open('/contractor/my-site-engineers?tab=pending', {
      'GET /engineers/my-team': { data: {
        active: [],
        pending_requests: [anEngineer(1, { relationship_id: id(91) }), anEngineer(2, { relationship_id: id(92) })],
        outgoing_requests: [anEngineer(3), anEngineer(4)],
        invitations: [
          { id: id(70), phone: '9876500001', invite_code: 'AB12CD', invite_link: 'https://example.in/join/AB12CD' },
          { id: id(71), email: 'new@example.in', invite_code: 'EF34GH', invite_link: 'https://example.in/join/EF34GH' },
        ],
      } },
    })
    expect(expectUniformCards(await screen.findByTestId('builder-pending-join-cards', {}, FIND))).toHaveLength(2)
    expect(expectUniformCards(screen.getByTestId('builder-pending-invite-cards'))).toHaveLength(2)
    expect(expectUniformCards(screen.getByTestId('builder-pending-sent-cards'))).toHaveLength(2)
  })

  it('Find Clients: house owner leads and supplier leads', async () => {
    const user = userEvent.setup()
    open('/contractor/find-clients', {
      'GET /contractors/find-clients': { data: [
        anOwnerLead(),
        anOwnerLead({ id: id(81), project_id: id(81), owner_id: id(82), title: 'Lake View Villa', project_title: 'Lake View Villa', building_type: '' }),
        { id: id(60), client_type: 'SUPPLIER', owner_id: id(61), name: 'Indra', store_name: 'Indra Steel', supplier_category: 'Material Supplier', categories: ['Cement'], pincode: '560002' },
        { id: id(62), client_type: 'SUPPLIER', owner_id: id(63), name: 'Ravi', supplier_category: 'Labor Supplier', categories: [], pincode: '560003' },
      ] },
    })
    const leads = expectUniformCards(await screen.findByTestId('builder-owner-lead-cards', {}, FIND))
    expect(leads).toHaveLength(2)
    expect(within(leads[0]).getByRole('button', { name: 'Send Request' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /^Supplier Requests/ }))
    expect(expectUniformCards(await screen.findByTestId('builder-supplier-lead-cards', {}, FIND))).toHaveLength(2)
  })

  it('Requests board (cards view)', async () => {
    open('/contractor/requests', {
      'GET /project-requests/incoming': { data: [
        anOwnerRequest(),
        anOwnerRequest({ id: id(83), project_title: 'Lake View Villa', status: 'accepted', quotation_amount: 4200000 }),
        anOwnerRequest({ id: id(84), request_type: 'CONTRACTOR_TO_OWNER', is_sender: true, sender_id: BUILDER.id }),
      ] },
    })
    const cards = expectUniformCards(await screen.findByTestId('builder-request-cards', {}, FIND))
    expect(cards).toHaveLength(3)
    expect(within(cards[0]).getByRole('button', { name: /Accept with Quote/ })).toBeInTheDocument()
  })

  it('Project Team: the suppliers to assign', async () => {
    open(`/contractor/projects/${PROJECT_ID}/team?team=suppliers`, {
      'GET /contractors/my-suppliers': { data: [aSupplier(1), aSupplier(2)] },
      [`GET /projects/${PROJECT_ID}/suppliers`]: { data: [{ user_id: id(51), name: 'Supplier 1' }] },
    })
    const cards = expectUniformCards(await screen.findByTestId('team-supplier-cards-Material Supplier', {}, FIND))
    expect(cards).toHaveLength(2)
  })

  it('Project Team: specialist candidates', async () => {
    const user = userEvent.setup()
    open(`/contractor/projects/${PROJECT_ID}/team?team=specialists`, {
      [`GET /projects/${PROJECT_ID}/specialist-team`]: { data: [{ category: 'Structural Engineer', status: 'open', engineer: null }] },
      [`GET /projects/${PROJECT_ID}/specialist-candidates`]: { data: [
        anEngineer(5, { specialization: 'Structural Engineer' }),
        anEngineer(6, { specialization: 'Structural Engineer', request_status: 'pending' }),
        anEngineer(7, { specialization: 'Structural Engineer', can_request: false }),
      ] },
    })
    await user.click(await screen.findByRole('button', { name: 'View Engineers' }, FIND))
    const cards = expectUniformCards(await screen.findByTestId('specialist-candidate-cards', {}, FIND))
    expect(cards).toHaveLength(3)
  })
})
