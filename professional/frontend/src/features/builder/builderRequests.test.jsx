/**
 * Builder > Requests: every request type, on its card and in View details, as the old app
 * (Octabuild frontend 7, contractorRequestViews.jsx) showed it from the same payload
 * (/project-requests/incoming). The card names the counterparty (a supplier's name and
 * store name). A request with no project -- a supplier's -- carries the server's "General"
 * stand-in, the heading of View details, and no budget, area, building type or
 * construction, so those read "Not set", exactly as before. The avatar is the counterparty's own picture
 * (a supplier's store logo), else the default for the role the request records.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, anOwnerRequest, builderDashboardServer } from './builderTestData.js'

const FIND = { timeout: 8000 }
const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'
const LOGO = '/files/0190a8b2-4c1e-7aa0-9f00-00000000f1a0'

// SUPPLIER_TO_CONTRACTOR as the server sends it to the builder (no project).
const aSupplierRequest = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-00000000c0d1',
  is_sender: false,
  is_receiver: true,
  sender_id: SUPPLIER_ID,
  receiver_id: BUILDER.id,
  sender_name: 'Indra',
  sender_role: 'SUPPLIER',
  sender_address: '12 Market Road',
  sender_pincode: '560002',
  profile_user_id: SUPPLIER_ID,
  profile_role: 'SUPPLIER',
  profile_name: 'Indra',
  profile_title: 'Indra Steel & Cement',
  profile_subtitle: 'Supplier',
  profile_image_url: LOGO,
  profile_logo_url: LOGO,
  profile_phone: '',
  profile_email: '',
  can_view_contact: false,
  project_id: null,
  project_title: 'General',
  project_description: '',
  project_address: '12 Market Road',
  project_pincode: '560002',
  building_type: '',
  construction_type: '',
  budget: 0,
  land_area: 0,
  floors: 0,
  request_type: 'SUPPLIER_TO_CONTRACTOR',
  status: 'pending',
  quotation_amount: 0,
  created_at: '2026-11-14T16:00:00+05:30',
  ...overrides,
})

function openRequests(requests) {
  installFakeServer(builderDashboardServer({ 'GET /project-requests/incoming': { data: requests } }))
  renderApp('/contractor/requests', { auth: signedInAs(BUILDER) })
}

async function openTab(user, name) {
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${name} \\(`) }, FIND))
}

const avatarOf = (name) => screen.getAllByAltText(name)[0]

describe('Builder > Requests > Supplier Requests (SUPPLIER_TO_CONTRACTOR)', () => {
  it("shows the supplier's card with its name, store name and the supplier's own logo", async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest()])
    await openTab(user, 'Supplier Requests')
    expect(await screen.findByText('Indra Steel & Cement', {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('Indra').length).toBeGreaterThan(0)
    expect(avatarOf('Indra').getAttribute('src')).toContain(LOGO)
    // Not in the House Owner tab.
    await openTab(user, 'House Owner Requests')
    expect(screen.queryByText('Indra Steel & Cement')).not.toBeInTheDocument()
  })

  it('falls back to the supplier default picture, never the House Owner one, when there is no logo', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ profile_image_url: null, profile_logo_url: null })])
    await openTab(user, 'Supplier Requests')
    await screen.findByText('Indra Steel & Cement', {}, FIND)
    const src = avatarOf('Indra').getAttribute('src')
    expect(src).toMatch(/supplier\.webp$/)
    expect(src).not.toMatch(/owner\.webp$/)
  })

  it('opens View details with the supplier as the counterparty and the project fields not set', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest()])
    await openTab(user, 'Supplier Requests')
    await user.click((await screen.findAllByRole('button', { name: /View details/ }, FIND))[0])
    const panel = await screen.findByText('Request Details', {}, FIND)
    const details = panel.closest('div').parentElement.parentElement
    expect(within(details).getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(within(details).getByText('Supplier')).toBeInTheDocument()
    expect(within(details).getAllByText('Indra').length).toBeGreaterThan(0)
    expect(within(details).getAllByText('Not set').length).toBeGreaterThanOrEqual(4)
    // Contact stays private until the request is accepted.
    expect(document.body.textContent).not.toContain('98765')
  })
})

describe('Builder > Requests > Supplier Requests (CONTRACTOR_TO_SUPPLIER)', () => {
  it('shows the request this builder sent to a supplier as sent, under Supplier Requests', async () => {
    const user = userEvent.setup()
    openRequests([
      aSupplierRequest({ request_type: 'CONTRACTOR_TO_SUPPLIER', is_sender: true, is_receiver: false, sender_id: BUILDER.id, receiver_id: SUPPLIER_ID }),
    ])
    await openTab(user, 'Supplier Requests')
    expect(await screen.findByText('Indra Steel & Cement', {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('Request sent').length).toBeGreaterThan(0)
  })
})

describe('Builder > Requests > House Owner Requests', () => {
  it("shows a House Owner's request (OWNER_TO_CONTRACTOR) with the project's title and the owner's picture", async () => {
    openRequests([anOwnerRequest({ sender_role: 'OWNER', profile_role: 'OWNER', profile_image_url: null })])
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    expect(avatarOf('Asha Rao').getAttribute('src')).toMatch(/owner\.webp$/)
  })

  it("shows the project's own details in View details (OWNER_TO_CONTRACTOR)", async () => {
    const user = userEvent.setup()
    openRequests([anOwnerRequest({ land_area: 1200, building_type: 'RESIDENTIAL', construction_type: 'FULL_CONTRACT' })])
    await user.click((await screen.findAllByRole('button', { name: /View details/ }, FIND))[0])
    await screen.findByText('Request Details', {}, FIND)
    expect(screen.getByText(/1200/)).toBeInTheDocument()
    expect(screen.getAllByText('Homeowner').length).toBeGreaterThan(0)
  })

  it('shows a request this builder sent to a House Owner (CONTRACTOR_TO_OWNER) under House Owner Requests', async () => {
    const user = userEvent.setup()
    openRequests([anOwnerRequest({ request_type: 'CONTRACTOR_TO_OWNER', is_sender: true, sender_id: BUILDER.id })])
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    await openTab(user, 'Supplier Requests')
    await waitFor(() => expect(screen.queryByText('Rao Family Home')).not.toBeInTheDocument())
  })
})
