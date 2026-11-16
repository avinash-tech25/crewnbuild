/**
 * The other party on a request is never named by a phone number: a store title or a
 * person's name saved as one (before saves refused it) is skipped in View details, for
 * the next real name or for nothing at all (displayName).
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, builderDashboardServer } from '../builder/builderTestData.js'

const FIND = { timeout: 15000 }
const SUPPLIER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000f5'

// SUPPLIER_TO_CONTRACTOR as the server sends it to the builder (no project).
const aSupplierRequest = (overrides = {}) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-00000000c0d2',
  is_sender: false,
  is_receiver: true,
  sender_id: SUPPLIER_ID,
  receiver_id: BUILDER.id,
  sender_name: 'Indra',
  sender_role: 'SUPPLIER',
  sender_pincode: '560002',
  profile_user_id: SUPPLIER_ID,
  profile_role: 'SUPPLIER',
  profile_name: 'Indra',
  profile_title: 'Indra Steel & Cement',
  profile_pincode: '560002',
  profile_phone: '',
  profile_email: '',
  can_view_contact: false,
  profile_location: 'Bengaluru',
  profile_supplier_category: 'Material Supplier',
  project_id: null,
  project_title: 'General',
  request_type: 'SUPPLIER_TO_CONTRACTOR',
  status: 'pending',
  created_at: '2026-11-14T16:00:00+05:30',
  ...overrides,
})

async function openDetails(request) {
  const user = userEvent.setup()
  installFakeServer(builderDashboardServer({ 'GET /project-requests/incoming': { data: [request] } }))
  renderApp('/contractor/requests', { auth: signedInAs(BUILDER) })
  await user.click(await screen.findByRole('button', { name: /^Supplier Requests \(/ }, FIND))
  await user.click((await screen.findAllByRole('button', { name: /View details/ }, FIND))[0])
  return screen.findByRole('dialog', {}, FIND)
}

describe('Request party names', () => {
  it('does not show a store title saved as a phone number; the person is named instead', async () => {
    const dialog = await openDetails(aSupplierRequest({ profile_title: '+91 96406 77606' }))
    const identity = within(dialog).getByTestId('party-identity')
    expect(identity.textContent).toContain('Indra')
    expect(dialog.textContent).not.toContain('96406 77606')
  })

  it('does not show a person name saved as a phone number anywhere in View details', async () => {
    const dialog = await openDetails(
      aSupplierRequest({ sender_name: '9640677606', profile_name: '9640677606', profile_title: '96406-77606' }),
    )
    expect(dialog.textContent).not.toContain('9640677606')
    expect(dialog.textContent).not.toContain('96406-77606')
    expect(within(dialog).getByTestId('party-details').textContent).not.toContain('Supplier name')
    expect(within(dialog).getByTestId('party-identity').querySelector('img').getAttribute('alt')).toBe('')
  })
})
