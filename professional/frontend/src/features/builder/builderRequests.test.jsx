/**
 * Builder > Requests: every request type, on its card and in View details.
 *
 * A supplier's request with no project is shown by the supplier (a deliberate change
 * from the old app's generic project layout): headed by its store name, with its name,
 * category, location, logo, verification, membership and what it offers -- never the
 * House Owner's project rows, never a "Not set" row. Phone and e-mail stay hidden until
 * the request is accepted (the server sends them only then). A House Owner's project
 * request keeps its layout (budget, area, building type, construction).
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, anOwnerRequest, builderDashboardServer } from './builderTestData.js'

const FIND = { timeout: 15000 }
const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'
const LOGO = '/files/0190a8b2-4c1e-7aa0-9f00-00000000f1a0'
const PHONE = '9876522222'
const EMAIL = 'indra@example.in'

// SUPPLIER_TO_CONTRACTOR as the server sends it to the builder (no project), with the
// supplier's public business details.
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
  profile_address: '12 Market Road',
  profile_pincode: '560002',
  profile_phone: '',
  profile_email: '',
  can_view_contact: false,
  profile_location: 'Bengaluru',
  profile_verified: true,
  profile_member_since: '2026-03-10T10:00:00+05:30',
  profile_supplier_category: 'Material Supplier',
  profile_offer: { active_listings: 12, categories: ['Cement', 'Steel', 'Sand'] },
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

async function openDetails(user) {
  await user.click((await screen.findAllByRole('button', { name: /View details/ }, FIND))[0])
  return screen.findByRole('dialog', {}, FIND)
}

// The rows of View details as { label: value }.
function rowsOf(dialog) {
  const list = within(dialog).getByTestId('party-details')
  return Object.fromEntries([...list.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling.textContent]))
}

const avatarOf = (name) => screen.getAllByAltText(name)[0]

describe('Builder > Supplier Requests: the card', () => {
  it('is headed by the store name, with the supplier, its category, what it offers and its logo', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest()])
    await openTab(user, 'Supplier Requests')
    expect(await screen.findByText('Indra Steel & Cement', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText('Indra · Material Supplier')).toBeInTheDocument()
    expect(screen.getByText('12 active listings · Cement, Steel, Sand')).toBeInTheDocument()
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0)
    expect(screen.queryByText('General')).not.toBeInTheDocument()
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

  it("shows the request this builder sent to a supplier as sent (CONTRACTOR_TO_SUPPLIER)", async () => {
    const user = userEvent.setup()
    openRequests([
      aSupplierRequest({ request_type: 'CONTRACTOR_TO_SUPPLIER', is_sender: true, is_receiver: false, sender_id: BUILDER.id, receiver_id: SUPPLIER_ID }),
    ])
    await openTab(user, 'Supplier Requests')
    expect(await screen.findByText('Indra Steel & Cement', {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('Request sent').length).toBeGreaterThan(0)
  })
})

describe('Builder > Supplier Requests: View details', () => {
  it("a Material Supplier: the supplier's own details, no project rows and no Not set", async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest()])
    await openTab(user, 'Supplier Requests')
    const dialog = await openDetails(user)
    expect(within(dialog).getAllByText('Indra Steel & Cement').length).toBeGreaterThan(0)
    expect(within(dialog).queryByText('General')).not.toBeInTheDocument()
    expect(rowsOf(dialog)).toEqual({
      'Supplier name': 'Indra',
      'Supplier category': 'Material Supplier',
      Location: 'Bengaluru 560002',
      Offers: '12 active listings · Cement, Steel, Sand',
      Verified: 'Verified',
      'Member since': 'Mar 2026',
    })
    expect(within(dialog).getByAltText('Indra').getAttribute('src')).toContain(LOGO)
    for (const absent of ['Not set', 'Budget', 'Area', 'Building Type', 'Construction']) {
      expect(within(dialog).queryByText(absent)).not.toBeInTheDocument()
    }
  })

  it('a Labour Supplier: its trades', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ profile_supplier_category: 'Labor Supplier', profile_offer: { trades: ['Carpenter', 'Mason'] }, profile_verified: false })])
    await openTab(user, 'Supplier Requests')
    const rows = rowsOf(await openDetails(user))
    expect(rows['Supplier category']).toBe('Labor Supplier')
    expect(rows.Trades).toBe('Carpenter, Mason')
    expect(rows.Verified).toBe('Not verified yet')
  })

  it('an Equipment Supplier: its equipment types', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ profile_supplier_category: 'Equipment Supplier', profile_offer: { equipment_types: ['Concrete Mixer', 'Excavator'] } })])
    await openTab(user, 'Supplier Requests')
    const rows = rowsOf(await openDetails(user))
    expect(rows['Supplier category']).toBe('Equipment Supplier')
    expect(rows['Equipment types']).toBe('Concrete Mixer, Excavator')
  })

  it('leaves out a row with nothing to show instead of saying Not set', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ profile_offer: { active_listings: 0, categories: [] }, profile_location: '', profile_member_since: null })])
    await openTab(user, 'Supplier Requests')
    const dialog = await openDetails(user)
    const rows = rowsOf(dialog)
    expect(rows.Offers).toBe('0 active listings')
    expect(rows.Location).toBe('12 Market Road, 560002')
    expect(rows).not.toHaveProperty('Member since')
    expect(within(dialog).queryByText('Not set')).not.toBeInTheDocument()
  })

  it('keeps phone and e-mail hidden before the request is accepted, and says when they are shared', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest()])
    await openTab(user, 'Supplier Requests')
    const dialog = await openDetails(user)
    expect(rowsOf(dialog)).not.toHaveProperty('Phone')
    expect(rowsOf(dialog)).not.toHaveProperty('Email')
    expect(within(dialog).getByText('Phone and email are shared once the request is accepted.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(PHONE)
    expect(document.body.textContent).not.toContain(EMAIL)
  })

  it('shows phone and e-mail once the request is accepted (the server sends them then)', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ status: 'accepted', profile_phone: PHONE, profile_email: EMAIL, can_view_contact: true })])
    await openTab(user, 'Supplier Requests')
    const dialog = await openDetails(user)
    expect(rowsOf(dialog)).toMatchObject({ Phone: PHONE, Email: EMAIL })
    expect(within(dialog).queryByText('Phone and email are shared once the request is accepted.')).not.toBeInTheDocument()
  })
})

describe('Builder > House Owner Requests (unchanged layout)', () => {
  it("shows a House Owner's request (OWNER_TO_CONTRACTOR) with the project's title and the owner's picture", async () => {
    openRequests([anOwnerRequest({ sender_role: 'OWNER', profile_role: 'OWNER', profile_image_url: null })])
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    expect(avatarOf('Asha Rao').getAttribute('src')).toMatch(/owner\.webp$/)
  })

  it('keeps the project rows in View details: budget, area, building type and construction', async () => {
    const user = userEvent.setup()
    openRequests([anOwnerRequest({ land_area: 1200, building_type: 'RESIDENTIAL', construction_type: 'FULL_CONTRACT' })])
    const dialog = await openDetails(user)
    expect(within(dialog).getByText(/1200/)).toBeInTheDocument()
    for (const label of ['Homeowner', 'Building Type', 'Construction']) expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0)
    expect(within(dialog).queryByTestId('party-details')).not.toBeInTheDocument()
  })

  it('shows a request this builder sent to a House Owner (CONTRACTOR_TO_OWNER) under House Owner Requests', async () => {
    const user = userEvent.setup()
    openRequests([anOwnerRequest({ request_type: 'CONTRACTOR_TO_OWNER', is_sender: true, sender_id: BUILDER.id })])
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    await openTab(user, 'Supplier Requests')
    await waitFor(() => expect(screen.queryByText('Rao Family Home')).not.toBeInTheDocument())
  })
})
