/**
 * The Store Manager's card lists (Catalog, Buy, Purchase History, Builders) all render
 * the shared CardGrid of ListCards, so every card in a list has the same anatomy.
 */
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { BUILDER_ID, STORE_MANAGER, SUPPLIER_ID, aSupplierProduct, storeDashboardServer } from '../engineer/engineerTestData.js'

const FIND = { timeout: 15000 }
const id = (n) => `0190a8b2-4c1e-7aa0-9f00-0000000b${String(n).padStart(4, '0')}`

function open(path, routes) {
  installFakeServer(storeDashboardServer(routes))
  renderApp(path, { auth: signedInAs(STORE_MANAGER) })
}

const storeItem = (n, extra = {}) => ({
  id: id(n), name: `Cement ${n}`, brand: 'UltraTech', category: 'Cement', subcategory: 'OPC', variant: '50 kg', unit: 'bag',
  quantity: 40, unit_cost: 400, low_stock_threshold: 10, stock_state: 'IN_STOCK', is_active: true, image_url: null, ...extra,
})

const aPurchase = (n, extra = {}) => ({
  request_code: `PO-000${n}`, reference_code: `PO-000${n}`, supplier_name: 'Lakshmi Traders', project_name: 'Rao Family Home', builder_name: 'Ravi Builders',
  total: 420, payment_status: 'PAID', receipt_status: 'NOT_RECEIVED', created_at: '2026-11-13T10:00:00+05:30', payments: [],
  lines: [{ id: id(100 + n), material_name: 'UltraTech Cement', size: '50 kg', quantity: 1, unit: 'bag', status: 'ACCEPTED', received: false, can_receive: true, pending_quantity: 1 }],
  ...extra,
})

describe('Store Manager card lists', () => {
  it('Catalog: active and archived items share one structure', async () => {
    open('/store-manager/catalog', {
      'GET /store-manager/items': { data: [storeItem(1), storeItem(2, { name: 'River sand with a very long name that would otherwise stretch the tile', is_active: false, stock_state: 'OUT_OF_STOCK', quantity: 0 })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('store-catalog-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    cards.forEach((card) => expect(within(card).getByRole('button', { name: 'Update stock' })).toBeInTheDocument())
    expect(within(cards[1]).getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  })

  it('Buy: supplier product tiles share one structure, in stock or not', async () => {
    open('/store-manager/buy', {
      'GET /store-manager/buy/products': { data: { products: [
        aSupplierProduct(),
        aSupplierProduct({ id: id(3), name: 'River sand', size: null, brand: null, quantity: 0, available_quantity: 0, stock_status: 'OUT_OF_STOCK', stock_state: 'OUT_OF_STOCK' }),
      ], supplier_count: 1 } },
    })
    const tiles = expectUniformCards(await screen.findByTestId('store-buy-product-cards', {}, FIND))
    expect(tiles).toHaveLength(2)
    expect(within(tiles[0]).getByRole('button', { name: 'Add UltraTech Cement 50 kg Lakshmi Traders' })).toBeEnabled()
  })

  it('Purchase History: one card per purchase, the same structure', async () => {
    open('/store-manager/buy/history', {
      'GET /store-manager/purchases': { data: [aPurchase(1), aPurchase(2, { builder_name: null, payment_status: 'PARTLY_PAID' })] },
    })
    const cards = expectUniformCards(await screen.findByTestId('store-purchase-cards', {}, FIND))
    expect(cards).toHaveLength(2)
    cards.forEach((card) => {
      expect(within(card).getByRole('button', { name: 'View details' })).toBeInTheDocument()
      expect(within(card).getByRole('button', { name: /Mark received/ })).toBeInTheDocument()
    })
  })

  it('Builders: my builders and the builders to find are card lists', async () => {
    open('/store-manager/builders?tab=find', {
      'GET /engineers/my-team': { data: { teams: [{ relationship_id: id(20), contractor_id: BUILDER_ID, company_name: 'Ravi Constructions', contractor_name: 'Ravi', pincode: '560001', status: 'ACTIVE' }], incoming_requests: [] } },
      'GET /contractors/nearby': { data: [
        { user_id: BUILDER_ID, name: 'Ravi', company_name: 'Ravi Constructions', pincode: '560001', experience_years: 12, completed_projects: 8 },
        { user_id: SUPPLIER_ID, name: 'Kumar', company_name: 'Kumar Homes', pincode: '560002', experience_years: 2, completed_projects: 1 },
      ] },
    })
    const cards = expectUniformCards(await screen.findByTestId('engineer-builder-cards', {}, FIND))
    expect(cards).toHaveLength(2)
  })
})
