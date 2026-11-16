/**
 * Supplier, labour, equipment, shop and storefront lists: every card list renders the
 * shared CardGrid of ListCards, and every card in a list has the same anatomy.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import AppProviders from '../../app/AppProviders.jsx'
import { createAppStore } from '../../app/store.js'
import { initialAuthState } from '../../shared/auth/authSlice.js'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import SupplierBrowser from '../shop/components/SupplierBrowser.jsx'
import OwnerMarketplace from '../shop/components/OwnerMarketplace.jsx'
import {
  EQUIPMENT, LABOUR, MATERIAL, SUPPLIER, SUPPLIER_ID, aBuilderClient, aListing, supplierDashboardServer,
} from './supplierTestData.js'

const FIND = { timeout: 15000 }
const uuid = (n) => `0190a8b2-4c1e-7aa0-9f00-${String(n).padStart(12, '0')}`

function openSupplier(path, category, routes = {}) {
  const server = installFakeServer(supplierDashboardServer(category, routes))
  renderApp(path, { auth: signedInAs(SUPPLIER) })
  return server
}

/** One component on its own, inside the app's providers, signed in as the supplier. */
function renderAlone(element) {
  const store = createAppStore({ auth: { ...initialAuthState, ...signedInAs(SUPPLIER) } })
  return render(
    <AppProviders store={store}>
      <MemoryRouter>{element}</MemoryRouter>
    </AppProviders>,
  )
}

const aClientRequest = (n, overrides = {}) => ({
  id: uuid(0xc100 + n),
  is_sender: false,
  is_receiver: true,
  sender_id: uuid(0xb100 + n),
  receiver_id: SUPPLIER_ID,
  sender_name: `Builder ${n}`,
  sender_role: 'BUILDER',
  profile_role: 'BUILDER',
  profile_name: `Builder ${n}`,
  profile_title: `Builder ${n} Constructions`,
  profile_image_url: null,
  profile_location: 'Bengaluru',
  profile_pincode: '560001',
  profile_verified: true,
  profile_member_since: '2025-08-01T10:00:00+05:30',
  project_id: null,
  project_title: 'General',
  project_pincode: '560001',
  request_type: 'CONTRACTOR_TO_SUPPLIER',
  status: 'pending',
  created_at: '2026-11-14T16:00:00+05:30',
  ...overrides,
})

const aLaborRequest = (n, overrides = {}) => ({
  id: uuid(0x1a00 + n),
  trade: 'Mason',
  workers_required: 4,
  workers_allocated: null,
  start_date: '2026-11-20',
  end_date: '2026-11-30',
  status: 'PENDING',
  project_title: `Project ${n}`,
  engineer_name: 'Meena Iyer',
  contractor_name: 'Ravi Builders',
  work_description: '',
  decision_note: null,
  supplier_assignment_active: true,
  created_at: '2026-11-13T10:00:00+05:30',
  ...overrides,
})

const anEquipmentItem = (n, overrides = {}) => ({
  id: uuid(0xe100 + n),
  name: `Concrete Mixer ${n}`,
  category: 'Mixers',
  brand: '',
  model: '',
  specifications: '',
  mode: 'RENT',
  condition: 'USED',
  daily_rate: 1500,
  hourly_rate: null,
  weekly_rate: null,
  monthly_rate: null,
  sale_price: null,
  quantity_total: 2,
  available_to_rent: 2,
  available_to_buy: 0,
  is_active: true,
  image_url: null,
  created_at: '2026-11-01T10:00:00+05:30',
  ...overrides,
})

const anEquipmentRequest = (n, overrides = {}) => ({
  id: uuid(0xe200 + n),
  request_kind: 'RENT',
  status: 'PENDING',
  item_name: `Concrete Mixer ${n}`,
  quantity: 1,
  unit_price: 1500,
  rate_unit: 'DAY',
  start_date: '2026-11-20',
  end_date: '2026-11-25',
  project_title: `Project ${n}`,
  engineer_name: 'Meena Iyer',
  contractor_name: '',
  notes: '',
  decision_note: null,
  supplier_assignment_active: true,
  created_at: '2026-11-13T10:00:00+05:30',
  ...overrides,
})

describe('Supplier lists are uniform cards', () => {
  it('Requests > Client Requests, cards view', async () => {
    openSupplier('/supplier/requests', MATERIAL, {
      'GET /project-requests/incoming': { data: [
        aClientRequest(1),
        aClientRequest(2, { profile_name: 'A builder with a very long name that would otherwise widen the card', sender_name: 'A builder with a very long name that would otherwise widen the card' }),
        aClientRequest(3, { status: 'accepted', project_id: uuid(0xa1), project_title: 'Rao Family Home' }),
        aClientRequest(4, { is_sender: true, is_receiver: false, request_type: 'SUPPLIER_TO_CONTRACTOR' }),
      ] },
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Client Requests/ }, FIND))
    await user.click(await screen.findByRole('button', { name: 'Cards' }, FIND))
    const cards = expectUniformCards(await screen.findByTestId('supplier-request-cards', {}, FIND))
    expect(cards).toHaveLength(4)
    expect(within(cards[0]).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(cards[0]).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(within(cards[3]).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })

  it('Find Clients: incoming builder requests and nearby builders', async () => {
    openSupplier('/supplier/find-clients', MATERIAL, {
      'GET /project-requests/incoming': { data: [aClientRequest(1), aClientRequest(2)] },
      'GET /suppliers/find-clients': { data: [
        aBuilderClient(),
        aBuilderClient({ user_id: uuid(0xb9), name: 'Kiran Builders', company_name: 'Kiran Infra' }),
      ] },
    })
    const requests = expectUniformCards(await screen.findByTestId('supplier-builder-request-cards', {}, FIND))
    expect(requests).toHaveLength(2)
    const clients = expectUniformCards(await screen.findByTestId('supplier-builder-client-cards', {}, FIND))
    expect(clients).toHaveLength(2)
    expect(within(clients[0]).getByRole('button', { name: 'Send Request' })).toBeInTheDocument()
    expect(clients.map((card) => card.getAttribute('aria-label'))).toEqual(['Ravi Builders', 'Kiran Builders'])
  })

  it('My Projects, cards view', async () => {
    const project = (n, extra = {}) => ({
      project_id: uuid(0xa00 + n), title: `Project ${n}`, status: 'active', created_at: '2026-11-10T10:00:00+05:30',
      requester: { id: uuid(0xb00 + n), name: `Owner ${n}`, role: 'OWNER' }, ...extra,
    })
    openSupplier('/supplier/my-projects?view=cards', MATERIAL, {
      'GET /suppliers/my-projects': { data: [project(1), project(2, { requester: { id: uuid(0xb22), name: 'Ravi', role: 'BUILDER', company_name: 'Ravi Constructions' } })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('supplier-my-project-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })

  it('Products: the storefront listing cards', async () => {
    openSupplier('/supplier/products', MATERIAL, {
      'GET /supplier-products': { data: [aListing(), aListing({ id: uuid(0xf9), name: 'ACC Cement', is_published: false })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('storefront-product-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByRole('button', { name: 'Edit listing' })).toBeInTheDocument()
  })
})

describe('Labour supplier lists are uniform cards', () => {
  it('Labor Services', async () => {
    openSupplier('/supplier/labor-services', LABOUR, {
      'GET /labor/services': { data: [
        { id: uuid(0x5e1), trade: 'Mason', skill_level: 'Skilled', worker_capacity: 12, available_workers: 8, allocated_workers: 4, is_active: true, notes: '' },
        { id: uuid(0x5e2), trade: 'Carpenter', skill_level: '', worker_capacity: 6, available_workers: 6, allocated_workers: 0, is_active: false, notes: 'Weekends only' },
      ] },
    })
    const cards = expectUniformCards(await screen.findByTestId('labor-service-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByRole('button', { name: /Deactivate/ })).toBeInTheDocument()
    expect(within(cards[1]).getByRole('button', { name: /Activate/ })).toBeInTheDocument()
  })

  it('pending labor requests on the dashboard', async () => {
    openSupplier('/supplier', LABOUR, { 'GET /labor/requests': { data: [aLaborRequest(1), aLaborRequest(2)] } })
    const cards = expectUniformCards(await screen.findByTestId('labor-request-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByRole('button', { name: /Accept/ })).toBeInTheDocument()
  })

  it('Assignments', async () => {
    openSupplier('/supplier/assignments', LABOUR, {
      'GET /labor/requests': { data: [aLaborRequest(1, { status: 'ACCEPTED', workers_allocated: 4 }), aLaborRequest(2, { status: 'ACCEPTED', workers_allocated: 2 })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('labor-assignment-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })
})

describe('Equipment supplier lists are uniform cards', () => {
  it('Equipment Inventory', async () => {
    openSupplier('/supplier/equipment', EQUIPMENT, {
      'GET /equipment/items': { data: [anEquipmentItem(1), anEquipmentItem(2, { mode: 'BOTH', sale_price: 90000, available_to_buy: 1, is_active: false })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('equipment-item-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })

  it('pending equipment requests on the dashboard', async () => {
    openSupplier('/supplier', EQUIPMENT, {
      'GET /equipment/requests': { data: [anEquipmentRequest(1), anEquipmentRequest(2, { request_kind: 'BUY', rate_unit: null, unit_price: 90000 })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('equipment-request-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })

  it('Assignments: active rentals', async () => {
    openSupplier('/supplier/equipment-assignments', EQUIPMENT, {
      'GET /equipment/requests': { data: [anEquipmentRequest(1, { status: 'ACCEPTED' }), anEquipmentRequest(2, { status: 'ACCEPTED' })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('equipment-assignment-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })
})

describe('Shop lists are uniform cards', () => {
  // Opening a supplier scrolls its catalogue into view; jsdom has no scrolling.
  beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn() })

  const product = (n, extra = {}) => ({
    ...aListing({ id: uuid(0xf10 + n), name: `Product ${n}`, category: 'Cement' }), ...extra,
  })
  const supplier = (n, extra = {}) => ({
    user_id: uuid(0xf50 + n), name: `Supplier ${n}`, store_name: `Store ${n}`, pincode: '560001', rating: 4.5,
    supplier_category: 'Material Supplier', products: [product(n)], ...extra,
  })

  it("the supplier browser's supplier cards, then a supplier's product cards", async () => {
    installFakeServer({
      'GET /cart': { data: { groups: [], item_count: 0 } },
      [`GET /suppliers/${uuid(0xf51)}/profile`]: { data: { user_id: uuid(0xf51), profile_products: [product(1), product(2, { name: 'A product with a very long name for one card' })] } },
      'GET /catalog/categories': { data: [] },
    })
    renderAlone(
      <SupplierBrowser
        projects={[]}
        loadSuppliers={async () => [supplier(1), supplier(2, { store_name: 'Supplier 2', products: [] })]}
        activeProjectId={null}
      />,
    )
    const suppliers = expectUniformCards(await screen.findByTestId('supplier-browser-cards', {}, FIND))
    expect(suppliers).toHaveLength(2)
    await userEvent.setup().click(within(suppliers[0]).getByText('Supplier 1'))
    const products = expectUniformCards(await screen.findByTestId('supplier-product-cards', {}, FIND))
    expect(products).toHaveLength(2)
    expect(within(products[0]).getByRole('button', { name: 'Add to Cart' })).toBeInTheDocument()
  })

  it("a Self Construction project's marketplace listing cards", async () => {
    installFakeServer({
      'GET /cart': { data: { groups: [], item_count: 0 } },
      'GET /catalog/categories': { data: [] },
      'GET /suppliers/nearby': { data: [
        supplier(1, { products: [product(1, { master_product_id: uuid(0x9001) })] }),
        supplier(2, { products: [product(2, { master_product_id: uuid(0x9002), discount_percentage: 10, quantity: 3 })] }),
      ] },
    })
    renderAlone(<OwnerMarketplace projectId={uuid(0xa1)} pincode="560001" />)
    const cards = expectUniformCards(await screen.findByTestId('marketplace-listing-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })
})
