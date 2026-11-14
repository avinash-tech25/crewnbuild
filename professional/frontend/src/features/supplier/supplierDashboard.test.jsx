import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import {
  BUILDER_ID,
  EQUIPMENT,
  LABOUR,
  MATERIAL,
  PRODUCT_ID,
  SUPPLIER,
  aBuilderClient,
  aListing,
  anOrderLine,
  supplierDashboardServer,
} from './supplierTestData.js'

const FIND = { timeout: 8000 }
const SECTIONS = ['/supplier', '/supplier/my-projects', '/supplier/find-clients', '/supplier/requests', '/supplier/products', '/supplier/orders',
  '/supplier/messages', '/supplier/profile', '/supplier/labor-services', '/supplier/assignments', '/supplier/equipment', '/supplier/equipment-assignments']

function openSupplier(path, category = MATERIAL, routes = {}) {
  const server = installFakeServer(supplierDashboardServer(category, routes))
  const view = renderApp(path, { auth: signedInAs(SUPPLIER) })
  return { server, ...view }
}

describe('Supplier dashboard: access', () => {
  it.each(SECTIONS)('%s asks a signed-out visitor to sign in first', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: path })
  })

  it.each([
    ['OWNER', {}, '/owner'],
    ['BUILDER', {}, '/contractor'],
    ['ENGINEER', { engineer_profile: { specialization: 'Site Engineer' } }, '/engineer'],
    ['LOCATION_SUPER_ADMIN', {}, '/admin'],
  ])('is closed to a %s, who goes to their own home', async (role, extra, home) => {
    installFakeServer({})
    renderApp('/supplier/products', { auth: signedInAs(anAccount({ role, ...extra })) })
    await waitFor(() => expect(location.current.pathname).toBe(home))
  })
})

describe('Supplier dashboard: sections by supplier category', () => {
  it.each([
    [MATERIAL, ['Products', 'Orders'], ['Labor Services', 'Equipment Inventory']],
    [LABOUR, ['Labor Services', 'Assignments'], ['Products', 'Orders', 'Equipment Inventory']],
    [EQUIPMENT, ['Equipment Inventory', 'Assignments'], ['Products', 'Orders', 'Labor Services']],
  ])('a %s sees only its own sections', async (category, shown, hidden) => {
    openSupplier('/supplier', category)
    expect(await screen.findByText('Welcome, Lakshmi Traders', {}, FIND)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: shown[0] })).toBeInTheDocument(), FIND)
    for (const name of shown) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    for (const name of hidden) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it("sends a Labour Supplier who opens Products back to the dashboard, as before", async () => {
    openSupplier('/supplier/products', LABOUR)
    await waitFor(() => expect(location.current.pathname).toBe('/supplier'), FIND)
  })
})

describe('Supplier dashboard: own listings', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lists only the supplier\'s own listings and unpublishes one', async () => {
    const user = userEvent.setup()
    const { server } = openSupplier('/supplier/products', MATERIAL, {
      'GET /supplier-products': { data: [aListing()] },
      [`PATCH /supplier-products/${PRODUCT_ID}`]: { data: aListing({ is_published: false }) },
    })
    expect((await screen.findAllByText('UltraTech Cement', {}, FIND)).length).toBeGreaterThan(0)
    expect(server.calls('GET /supplier-products').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Unpublish listing' }))
    await waitFor(() => expect(server.calls(`PATCH /supplier-products/${PRODUCT_ID}`)).toHaveLength(1))
    const sent = JSON.parse(server.calls(`PATCH /supplier-products/${PRODUCT_ID}`)[0].data)
    expect(sent).toEqual({ is_published: false })
    expect(sent).not.toHaveProperty('supplier_id')
  })

  it('deletes a listing only after the supplier confirms', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { server } = openSupplier('/supplier/products', MATERIAL, {
      'GET /supplier-products': { data: [aListing()] },
      [`DELETE /supplier-products/${PRODUCT_ID}`]: { data: { message: 'Deleted' } },
    })
    const remove = await screen.findByRole('button', { name: 'Delete UltraTech Cement' }, FIND)
    await user.click(remove)
    expect(server.calls(`DELETE /supplier-products/${PRODUCT_ID}`)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Delete UltraTech Cement' }))
    await waitFor(() => expect(server.calls(`DELETE /supplier-products/${PRODUCT_ID}`)).toHaveLength(1))
    expect(confirm).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete UltraTech Cement' })).not.toBeInTheDocument())
  })

  it('sets bulk pricing on a listing', async () => {
    const user = userEvent.setup()
    const { server } = openSupplier('/supplier/products', MATERIAL, {
      'GET /supplier-products': { data: [aListing()] },
      [`GET /supplier-products/${PRODUCT_ID}/bulk-pricing`]: { data: { tiers: [] } },
      [`PUT /supplier-products/${PRODUCT_ID}/bulk-pricing`]: { data: { tiers: [{ min_quantity: 50, max_quantity: null, unit_price: 400 }] } },
    })
    await user.click(await screen.findByRole('button', { name: 'Edit listing' }, FIND))
    const panel = await screen.findByRole('region', { name: 'Bulk pricing' }, FIND)
    await user.click(within(panel).getByRole('checkbox', { name: /Offer bulk pricing/ }))
    await user.type(within(panel).getByLabelText('Tier 1 minimum quantity'), '50')
    await user.type(within(panel).getByLabelText('Tier 1 price per unit'), '400')
    await user.click(within(panel).getByRole('button', { name: /Save bulk pricing/ }))
    await waitFor(() => expect(server.calls(`PUT /supplier-products/${PRODUCT_ID}/bulk-pricing`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`PUT /supplier-products/${PRODUCT_ID}/bulk-pricing`)[0].data).tiers[0]).toMatchObject({ min_quantity: 50, unit_price: 400 })
  })
})

describe('Supplier dashboard: orders, clients and requests', () => {
  it("shows a Site Engineer's order with its cost", async () => {
    openSupplier('/supplier/orders', MATERIAL, { 'GET /supplier/material-requests': { data: [anOrderLine()] } })
    expect(await screen.findByText('Meena Iyer', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText(/8,400/)).toBeInTheDocument()
  })

  it('lists a nearby builder as a builder and sends them a request', async () => {
    const user = userEvent.setup()
    const { server } = openSupplier('/supplier/find-clients', MATERIAL, {
      'GET /suppliers/find-clients': { data: [aBuilderClient()] },
      'POST /project-requests/send': { data: { id: '0190a8b2-4c1e-7aa0-9f00-0000000000c9', status: 'pending' } },
    })
    expect(await screen.findByText('Ravi Builders', {}, FIND)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Builder\s*1/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send Request' }))
    await waitFor(() => expect(server.calls('POST /project-requests/send')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /project-requests/send')[0].data)).toMatchObject({
      receiver_id: BUILDER_ID,
      request_type: 'SUPPLIER_TO_CONTRACTOR',
    })
  })

  it("hides a builder already asked, matching the server's BUILDER role", async () => {
    openSupplier('/supplier/find-clients', MATERIAL, {
      'GET /suppliers/find-clients': { data: [aBuilderClient()] },
      'GET /project-requests/incoming': {
        data: [{
          id: '0190a8b2-4c1e-7aa0-9f00-0000000000c9', sender_id: SUPPLIER.id, receiver_id: BUILDER_ID, sender_role: 'SUPPLIER', receiver_role: 'BUILDER',
          request_type: 'SUPPLIER_TO_CONTRACTOR', status: 'pending', is_sender: true, created_at: '2026-11-13T10:00:00+05:30',
        }],
      },
    })
    expect(await screen.findByText('Leads for 560001', { exact: false }, FIND)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send Request' })).not.toBeInTheDocument())
  })
})

describe('Supplier dashboard: labour and equipment supply', () => {
  it('adds a labour service with its worker capacity', async () => {
    const user = userEvent.setup()
    const { server } = openSupplier('/supplier/labor-services', LABOUR, {
      'POST /labor/services': { data: { id: '0190a8b2-4c1e-7aa0-9f00-0000000000l1', trade: 'Mason', skill_level: 'Skilled', worker_capacity: 12, notes: '' } },
    })
    await user.click(await screen.findByRole('button', { name: 'Add Service' }, FIND))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByRole('combobox'), 'Mason')
    await user.type(within(dialog).getByLabelText('Skill Level'), 'Skilled')
    await user.type(within(dialog).getByLabelText('Worker Capacity'), '12')
    await user.click(within(dialog).getByRole('button', { name: /Add Service/ }))
    await waitFor(() => expect(server.calls('POST /labor/services')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /labor/services')[0].data)).toMatchObject({ trade: 'Mason', skill_level: 'Skilled', worker_capacity: 12 })
  })

  it("lists an Equipment Supplier's machines", async () => {
    openSupplier('/supplier/equipment', EQUIPMENT, {
      'GET /equipment/items': {
        data: [{
          id: '0190a8b2-4c1e-7aa0-9f00-0000000000q1', name: 'Concrete Mixer', category: 'Mixers', mode: 'RENT', condition: 'USED',
          daily_rate: 1500, hourly_rate: null, weekly_rate: null, monthly_rate: null, sale_price: null, quantity: 2, available_quantity: 2,
          is_active: true, description: '', image_url: null, created_at: '2026-11-01T10:00:00+05:30',
        }],
      },
    })
    expect(await screen.findByText('Concrete Mixer', {}, FIND)).toBeInTheDocument()
  })
})
