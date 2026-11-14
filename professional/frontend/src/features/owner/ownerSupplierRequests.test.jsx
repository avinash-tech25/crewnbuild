/**
 * House Owner > project > Requests: a supplier's request (SUPPLIER_TO_OWNER, or the
 * owner's own OWNER_TO_SUPPLIER) shown by the supplier, as on the builder's side: headed
 * by the store name, with the supplier's name, category, location, logo, verification,
 * membership, what it offers and the owner's project -- and phone and e-mail only once
 * the request is accepted. A builder's request keeps its layout.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { OWNER, PROJECT_ID, aProject, aQuotation, ownerDashboardServer } from './ownerTestData.js'

const FIND = { timeout: 15000 }
const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'
const LOGO = '/files/0190a8b2-4c1e-7aa0-9f00-00000000f1a0'
const PHONE = '9876522222'
const EMAIL = 'indra@example.in'

const aSupplierRequest = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-00000000c0f1',
  project_id: PROJECT_ID,
  project_title: 'Rao Family Home',
  sender_id: SUPPLIER_ID,
  receiver_id: OWNER.id,
  sender_name: 'Indra',
  sender_role: 'SUPPLIER',
  sender_pincode: '560002',
  profile_role: 'SUPPLIER',
  profile_name: 'Indra',
  profile_title: 'Indra Steel & Cement',
  profile_image_url: LOGO,
  profile_logo_url: LOGO,
  profile_address: '12 Market Road',
  profile_pincode: '560002',
  profile_rating: 0,
  profile_phone: '',
  profile_email: '',
  can_view_contact: false,
  profile_location: 'Bengaluru',
  profile_verified: true,
  profile_member_since: '2026-03-10T10:00:00+05:30',
  profile_supplier_category: 'Material Supplier',
  profile_offer: { active_listings: 12, categories: ['Cement', 'Steel', 'Sand'] },
  request_type: 'SUPPLIER_TO_OWNER',
  status: 'pending',
  is_sender: false,
  created_at: '2026-11-14T16:00:00+05:30',
  ...overrides,
})

// A pending request that has View: the owner's own to the supplier (a pending incoming
// one has Accept / Reject only, as before).
const ownPending = { request_type: 'OWNER_TO_SUPPLIER', is_sender: true, sender_id: OWNER.id, receiver_id: SUPPLIER_ID }

function openRequests(requests) {
  installFakeServer(
    ownerDashboardServer({
      'GET /owners/projects': { data: [aProject()] },
      'GET /project-requests/incoming': { data: requests },
      [`GET /projects/${PROJECT_ID}/award`]: { data: { award: null } },
      [`GET /projects/${PROJECT_ID}/photos`]: { data: [] },
      'GET /contractors/nearby': { data: [] },
    }),
  )
  renderApp(`/owner/projects/${PROJECT_ID}/requests`, { auth: signedInAs(OWNER) })
}

async function openPopup(user) {
  await screen.findByText('Indra Steel & Cement', {}, FIND)
  await user.click(screen.getByRole('button', { name: /View/ }))
  return screen.findByRole('dialog', {}, FIND)
}

function rowsOf(dialog) {
  const list = within(dialog).getByTestId('party-details')
  return Object.fromEntries([...list.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling.textContent]))
}

describe("House Owner > Requests: a supplier's request", () => {
  it('lists the supplier by its store name, with its name and category under it', async () => {
    openRequests([aSupplierRequest()])
    expect(await screen.findByText('Indra Steel & Cement', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText('Indra · Material Supplier')).toBeInTheDocument()
  })

  it("opens the supplier's own details with the owner's project, and no project or Not set rows", async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest(ownPending)])
    const dialog = await openPopup(user)
    expect(within(dialog).getByRole('heading', { name: 'Indra Steel & Cement' })).toBeInTheDocument()
    expect(rowsOf(dialog)).toEqual({
      'Supplier name': 'Indra',
      'Supplier category': 'Material Supplier',
      Location: 'Bengaluru 560002',
      Offers: '12 active listings · Cement, Steel, Sand',
      Verified: 'Verified',
      'Member since': 'Mar 2026',
      Project: 'Rao Family Home',
    })
    expect(within(dialog).getByAltText('Indra').getAttribute('src')).toContain(LOGO)
    expect(within(dialog).queryByText('Not set')).not.toBeInTheDocument()
  })

  it.each([
    ['Labor Supplier', { trades: ['Carpenter', 'Mason'] }, 'Trades', 'Carpenter, Mason'],
    ['Equipment Supplier', { equipment_types: ['Concrete Mixer', 'Excavator'] }, 'Equipment types', 'Concrete Mixer, Excavator'],
  ])('a %s shows what it offers', async (category, offer, label, value) => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ ...ownPending, profile_supplier_category: category, profile_offer: offer })])
    const rows = rowsOf(await openPopup(user))
    expect(rows['Supplier category']).toBe(category)
    expect(rows[label]).toBe(value)
  })

  it('keeps phone and e-mail hidden before the request is accepted', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest(ownPending)])
    const dialog = await openPopup(user)
    expect(rowsOf(dialog)).not.toHaveProperty('Phone')
    expect(rowsOf(dialog)).not.toHaveProperty('Email')
    expect(within(dialog).getByText('Phone and email are shared once the request is accepted.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(PHONE)
    expect(document.body.textContent).not.toContain(EMAIL)
  })

  it('shows phone and e-mail once the request is accepted (the server sends them then)', async () => {
    const user = userEvent.setup()
    openRequests([aSupplierRequest({ status: 'accepted', profile_phone: PHONE, profile_email: EMAIL, can_view_contact: true })])
    const dialog = await openPopup(user)
    expect(rowsOf(dialog)).toMatchObject({ Phone: PHONE, Email: EMAIL })
  })

  it("offers Accept / Reject on a supplier's pending request (SUPPLIER_TO_OWNER), as before", async () => {
    openRequests([aSupplierRequest()])
    await screen.findByText('Indra Steel & Cement', {}, FIND)
    expect(screen.getByRole('button', { name: /Accept/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reject/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(PHONE)
  })
})

describe("House Owner > Requests: a builder's request keeps its layout", () => {
  it('lists the builder by its own name, without the supplier details', async () => {
    openRequests([aQuotation()])
    expect(await screen.findByText('Ravi Builders', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByTestId('party-details')).not.toBeInTheDocument()
    expect(screen.queryByText(/Material Supplier/)).not.toBeInTheDocument()
  })
})
