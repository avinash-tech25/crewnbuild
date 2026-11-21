/**
 * The shop in the address (a Site Engineer's Suppliers area, the same components every
 * buyer uses):
 *   - Product Catalog: the chosen category (?category=<uuid>) is replaced in place, the
 *     open product (?item=<uuid>) is a history entry, and a link restores both;
 *   - a supplier's catalogue: the product open over it (?product=<uuid>) closes with Back
 *     and opens again from the address, with its supplier's catalogue under it.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import {
  PROJECT_ID, SITE_ENGINEER, SUPPLIER_ID, aSupplierProduct, anAssignedProject, engineerDashboardServer,
} from '../engineer/engineerTestData.js'

const FIND = { timeout: 15000 }
const STEEL = { id: '0190a8b2-4c1e-7aa0-9f00-0000000c0001', name: 'Steel', image_url: null }
const TMT_BAR = { id: '0190a8b2-4c1e-7aa0-9f00-0000000a0001', name: 'TMT Bar 12mm', category_id: STEEL.id, subcategory_id: null, image_url: null, variants: [] }
const OFFER = aSupplierProduct({ name: 'TMT Bar 12mm', master_product_id: TMT_BAR.id, price: 72, discounted_price: 72, unit: 'rod' })
const CEMENT = aSupplierProduct()
const SUPPLIER = {
  id: SUPPLIER_ID, user_id: SUPPLIER_ID, name: 'Lakshmi', store_name: 'Lakshmi Traders', supplier_category: 'Material Supplier',
  categories: ['Cement'], pincode: '560001', rating: 4, products: [CEMENT],
}

function openShop(path) {
  const server = installFakeServer(engineerDashboardServer({
    'GET /engineers/my-projects': { data: [anAssignedProject()] },
    'GET /catalog/categories': { data: [STEEL] },
    'GET /catalog/products': { data: [TMT_BAR] },
    [`GET /catalog/products/${TMT_BAR.id}`]: { data: TMT_BAR },
    [`GET /catalog/products/${TMT_BAR.id}/variants`]: { data: [] },
    'GET /shop/products': { data: { products: [OFFER], categories: ['Steel'], restricted: true } },
    [`GET /projects/${PROJECT_ID}/team-suppliers`]: { data: [SUPPLIER] },
    [`GET /suppliers/${SUPPLIER_ID}/profile`]: { data: { ...SUPPLIER, profile_products: [CEMENT] } },
  }))
  renderApp(path, { auth: signedInAs(SITE_ENGINEER) })
  return server
}

const param = (name) => new URLSearchParams(location.current.search).get(name)

describe('Product Catalog in the address', () => {
  it('keeps the category in place and the product as a history entry', async () => {
    const user = userEvent.setup()
    openShop('/engineer/my-supplies?tab=catalog')
    const strip = await screen.findByRole('list', { name: 'Categories' }, FIND)
    await user.click(within(strip).getByText('Steel'))
    await waitFor(() => expect(param('category')).toBe(STEEL.id))
    await user.click(await screen.findByRole('button', { name: 'View TMT Bar 12mm' }, FIND))
    await waitFor(() => expect(param('item')).toBe(TMT_BAR.id))

    act(() => history.back())
    await waitFor(() => expect(param('item')).toBeNull())
    // The category was a replacement, so Back left it in place.
    expect(param('category')).toBe(STEEL.id)
    expect(await screen.findByRole('button', { name: 'View TMT Bar 12mm' }, FIND)).toBeInTheDocument()
  })

  it('restores the category and the open product from the address', async () => {
    const server = openShop(`/engineer/my-supplies?tab=catalog&category=${STEEL.id}&item=${TMT_BAR.id}`)
    await waitFor(() => expect(server.calls(`GET /catalog/products/${TMT_BAR.id}`).length).toBeGreaterThan(0), FIND)
    expect(screen.queryByRole('button', { name: 'View TMT Bar 12mm' })).toBeNull()
  })

  it('restores a category alone from the address', async () => {
    openShop(`/engineer/my-supplies?tab=catalog&category=${STEEL.id}`)
    expect(await screen.findByRole('button', { name: 'View TMT Bar 12mm' }, FIND)).toBeInTheDocument()
  })
})

describe("A supplier's product in the address", () => {
  it('opens with ?product=<uuid>, closes with Back, and reopens from the link', async () => {
    const user = userEvent.setup()
    openShop('/engineer/my-supplies?tab=suppliers')
    await user.click((await screen.findAllByText('Lakshmi Traders', {}, FIND))[0])
    const cards = await screen.findByTestId('supplier-product-cards', {}, FIND)
    await user.click(within(cards).getAllByText('UltraTech Cement')[0])
    await waitFor(() => expect(param('product')).toBe(CEMENT.id))
    expect(await screen.findByRole('dialog', {}, FIND)).toBeInTheDocument()

    act(() => history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(param('product')).toBeNull()
  })

  it("opens the product, over its supplier's catalogue, from the address alone", async () => {
    const server = openShop(`/engineer/my-supplies?tab=suppliers&product=${CEMENT.id}`)
    expect(await screen.findByRole('dialog', {}, FIND)).toBeInTheDocument()
    expect(server.calls(`GET /suppliers/${SUPPLIER_ID}/profile`)).toHaveLength(1)
  })
})
