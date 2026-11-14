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

const FIND = { timeout: 15000 }

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
  profile_address: '7 Lake Road',
  profile_pincode: '560001',
  profile_phone: '',
  profile_email: '',
  can_view_contact: false,
  profile_location: 'Bengaluru',
  profile_verified: true,
  profile_member_since: '2025-08-01T10:00:00+05:30',
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
// The table is the default view; `cards` switches to the cards.
async function openRequests(requests, { cards = true } = {}) {
  installFakeServer(supplierDashboardServer(MATERIAL, { 'GET /project-requests/incoming': { data: requests } }))
  renderApp('/supplier/requests', { auth: signedInAs(SUPPLIER) })
  const user = userEvent.setup()
  await user.click(await screen.findByRole('tab', { name: /Client Requests/ }, FIND))
  if (cards) await user.click(await screen.findByRole('button', { name: 'Cards' }, FIND))
}

// The request's card (or its table row, in the table view).
async function cardOf(name) {
  const found = await screen.findAllByText(name, {}, FIND)
  const card = found.map((element) => element.closest('article, tr')).find(Boolean)
  if (!card) throw new Error(`no request card or row names ${name}`)
  return card
}

describe("Supplier > Requests: a builder's request (CONTRACTOR_TO_SUPPLIER)", () => {
  it("shows the builder's name and company, its details, the builder picture, and Accept / Reject", async () => {
    await openRequests([aBuilderRequest()])
    const card = await cardOf('Ravi Builders')
    expect(within(card).getByText('Ravi Constructions')).toBeInTheDocument()
    expect(within(card).queryByText('General')).not.toBeInTheDocument()
    const rows = within(card).getByTestId('party-details')
    const values = Object.fromEntries([...rows.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling.textContent]))
    expect(values).toEqual({ Location: 'Bengaluru 560001', Verified: 'Verified', 'Member since': 'Aug 2025' })
    expect(within(card).getByAltText('Ravi Builders').getAttribute('src')).toMatch(/contractor\.webp$/)
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    // No phone or e-mail before the request is accepted.
    expect(card.textContent).not.toMatch(/@|\d{10}/)
  })

  it("shows the builder's company, verification and membership in the table, without General", async () => {
    await openRequests([aBuilderRequest()], { cards: false })
    const row = await cardOf('Ravi Builders')
    expect(row.tagName).toBe('TR')
    expect(within(row).getByText('Ravi Constructions · Verified · Member since Aug 2025')).toBeInTheDocument()
    expect(within(row).getByText('Bengaluru 560001')).toBeInTheDocument()
    expect(within(row).queryByText('General')).not.toBeInTheDocument()
    expect(row.textContent).not.toMatch(/@|\d{10}/)
  })

  it("names the builder's project when the request has one", async () => {
    await openRequests([aBuilderRequest({ project_id: '0190a8b2-4c1e-7aa0-9f00-0000000000a1', project_title: 'Rao Family Home' })])
    const card = await cardOf('Ravi Builders')
    expect(within(card).getAllByText('Rao Family Home').length).toBeGreaterThan(0)
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
