/**
 * The supplier's Complete Profile, for each Supplier Category, as the old app
 * (Octabuild frontend 7: CompleteProfilePage, supplierProfileSteps, supplierProfileKinds)
 * showed it: one form whose wording, "what you supply" list and verification documents
 * follow the saved category, and which refuses a save with the required fields empty,
 * in that category's own words, before anything is sent.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { EQUIPMENT, LABOUR, MATERIAL, SUPPLIER_ID, aSupplierProfile } from '../supplier/supplierTestData.js'

const FIND = { timeout: 15000 }

// A supplier who chose a category but has not completed the profile yet.
const newSupplier = (category) =>
  anAccount({
    role: 'SUPPLIER',
    id: SUPPLIER_ID,
    name: 'Indra',
    email: 'indra@example.in',
    phone: '9876522222',
    pincode: '560002',
    profile_complete: false,
    supplier_profile: { store_name: '', supplier_category: category },
  })

function openCompleteProfile(category) {
  const server = installFakeServer({
    [`GET /suppliers/${SUPPLIER_ID}/profile`]: { data: { ...aSupplierProfile(category), store_name: '', about: '', categories: [], delivery_locations: [] } },
    'GET /locations/pincode/560002': { data: { pincode: '560002', district: 'Bengaluru Urban', state: 'Karnataka', areas: [{ name: 'Market Road' }] } },
    'GET /auth/phone/config': { data: { enabled: false, login: false } },
    'GET /notifications': { data: [] },
  })
  renderApp('/complete-profile', { auth: signedInAs(newSupplier(category)) })
  return server
}

const CASES = [
  {
    category: MATERIAL,
    details: 'Store / Profile Details',
    name: 'Store Name',
    supply: 'Product Categories',
    supplyChoice: 'Cement',
    document: 'Shop License',
    notDocument: 'Labour Licence',
    nameRequired: 'Store name is required.',
  },
  {
    category: LABOUR,
    details: 'Labour Supplier Details',
    name: 'Company / Agency Name',
    supply: 'Trades Offered',
    supplyChoice: null,
    document: 'Labour Licence',
    notDocument: 'Equipment Fitness Certificate',
    nameRequired: 'Company or agency name is required.',
  },
  {
    category: EQUIPMENT,
    details: 'Equipment Supplier Details',
    name: 'Business Name',
    supply: 'Equipment Categories',
    supplyChoice: null,
    document: 'Equipment Fitness Certificate',
    notDocument: 'Labour Licence',
    nameRequired: 'Business name is required.',
  },
]

describe.each(CASES)('Supplier Complete Profile: $category', (expected) => {
  it("asks in the category's own words, with its own list and documents", async () => {
    openCompleteProfile(expected.category)
    expect(await screen.findByText(expected.details, {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(`^${expected.name.replace(/[/]/g, '\\/')}`)).length).toBeGreaterThan(0)
    // The section that follows the saved category appears once the saved profile is read.
    expect((await screen.findAllByText(new RegExp(`^${expected.supply}`), {}, FIND)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(new RegExp(`^${expected.name}`)).length).toBeGreaterThan(0)
    if (expected.supplyChoice) expect(screen.getByText(expected.supplyChoice)).toBeInTheDocument()
    expect(screen.getAllByText(expected.document).length).toBeGreaterThan(0)
    expect(screen.queryByText(expected.notDocument)).not.toBeInTheDocument()
  })

  it("refuses to save with the required fields empty, in the category's words, before sending anything", async () => {
    const user = userEvent.setup()
    const server = openCompleteProfile(expected.category)
    await screen.findAllByText(new RegExp(`^${expected.supply}`), {}, FIND)
    await user.click(screen.getByRole('button', { name: /Complete profile/ }))
    expect(await screen.findByText(expected.nameRequired, {}, FIND)).toBeInTheDocument()
    await waitFor(() => expect(server.calls('PATCH /auth/complete-profile')).toHaveLength(0))
  })
})
