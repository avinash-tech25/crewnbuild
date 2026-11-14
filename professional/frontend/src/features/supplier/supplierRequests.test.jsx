/**
 * Supplier > Requests: the builder requests on the supplier's side, as the old app
 * (Octabuild frontend 7, supplierSections.jsx) showed them from /project-requests/incoming:
 * the counterparty's name and picture, the project title (the server's "General" when the
 * request has no project), the status, and the actions the direction allows.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER_ID, MATERIAL, SUPPLIER, SUPPLIER_ID, supplierDashboardServer } from './supplierTestData.js'

const FIND = { timeout: 8000 }

// A builder's request as the server sends it to the supplier (no project).
const aBuilderRequest = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-00000000c0e1',
  is_sender: false,
  is_receiver: true,
  sender_id: BUILDER_ID,
  receiver_id: SUPPLIER_ID,
  sender_name: 'Ravi Builders',
  sender_role: 'BUILDER',
  profile_role: 'BUILDER',
  profile_name: 'Ravi Builders',
  profile_title: 'Ravi Constructions',
  profile_subtitle: 'Contractor',
  profile_image_url: null,
  profile_phone: '',
  profile_email: '',
  can_view_contact: false,
  project_id: null,
  project_title: 'General',
  project_address: '7 Lake Road',
  project_pincode: '560001',
  request_type: 'CONTRACTOR_TO_SUPPLIER',
  status: 'pending',
  created_at: '2026-11-14T16:00:00+05:30',
  ...overrides,
})

// Requests > Client Requests (the page opens on Purchase Requests).
async function openRequests(requests) {
  installFakeServer(supplierDashboardServer(MATERIAL, { 'GET /project-requests/incoming': { data: requests } }))
  renderApp('/supplier/requests', { auth: signedInAs(SUPPLIER) })
  await userEvent.setup().click(await screen.findByRole('tab', { name: /Client Requests/ }, FIND))
}

// The request's card (or its table row, in the table view).
async function cardOf(name) {
  const found = await screen.findAllByText(name, {}, FIND)
  const card = found.map((element) => element.closest('article, tr')).find(Boolean)
  if (!card) throw new Error(`no request card or row names ${name}`)
  return card
}

describe("Supplier > Requests: a builder's request (CONTRACTOR_TO_SUPPLIER)", () => {
  it("shows the builder's name, the General title, the builder picture, and Accept / Reject", async () => {
    await openRequests([aBuilderRequest()])
    const card = await cardOf('Ravi Builders')
    expect(within(card).getByText('General')).toBeInTheDocument()
    expect(within(card).getByAltText('Ravi Builders').getAttribute('src')).toMatch(/contractor\.webp$/)
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    // No phone or e-mail before the request is accepted.
    expect(card.textContent).not.toMatch(/@|\d{10}/)
  })
})

describe("Supplier > Requests: the supplier's own request to a builder (SUPPLIER_TO_CONTRACTOR)", () => {
  it('shows it as sent, with Withdraw and no Accept / Reject', async () => {
    await openRequests([aBuilderRequest({ request_type: 'SUPPLIER_TO_CONTRACTOR', is_sender: true, is_receiver: false, sender_id: SUPPLIER_ID, receiver_id: BUILDER_ID })])
    const card = await cardOf('Ravi Builders')
    expect(card.textContent).toMatch(/Sent/)
    expect(within(card).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })
})
