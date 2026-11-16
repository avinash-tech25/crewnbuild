/**
 * The admin console's card lists (adverts, catalog products, brands,
 * categories, subcategories) are the shared CardGrid of ListCards, every card
 * with the same anatomy.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { expectUniformCards } from '../../test/cards.js'
import { adminServer, anAdminAccount, anIdentity } from './adminTestData.js'

const FIND = { timeout: 15000 }
const id = (n) => `0190a8b2-4c1e-7aa0-9f00-0000000c${String(n).padStart(4, '0')}`

function openConsole(path, routes = {}) {
  installFakeServer(adminServer(anIdentity('global'), routes))
  return renderApp(path, { auth: signedInAs(anAdminAccount('global')) })
}

const category = (n, extra = {}) => ({ id: n, name: `Category ${n}`, is_active: true, image_url: null, ...extra })
const subcategory = (n, categoryId, extra = {}) => ({ id: 100 + n, category_id: categoryId, name: `Subcategory ${n}`, is_active: true, image_url: null, ...extra })
const product = (n, extra = {}) => ({
  id: id(n), name: `Product ${n}`, brand_name: 'UltraTech', brand_logo_url: null, subcategory_name: 'Cement', image_url: null,
  is_active: true, variants: [{ name: '50 kg' }], unit: { name: 'bag' }, media: { image_count: n, images_required: 5 }, ...extra,
})
const catalogServer = (extra = {}) => ({
  'GET /admin/catalog/categories': { data: [category(1), category(2, { name: 'A very long category name that would otherwise push the card wider' })] },
  'GET /admin/catalog/subcategories': { data: [subcategory(1, 1), subcategory(2, 1, { is_active: false }), subcategory(3, 2)] },
  'GET /admin/catalog/brands': {
    data: [
      { id: 1, name: 'UltraTech', manufacturer: 'UltraTech Cement Ltd', logo_url: null, is_active: true },
      { id: 2, name: 'ACC', manufacturer: null, logo_url: null, is_active: false },
    ],
  },
  'GET /admin/catalog/units': { data: [] },
  'GET /admin/catalog/products': { data: [product(1), product(5, { is_active: false, variants: [] })] },
  ...extra,
})

describe('admin card lists', () => {
  it('adverts', async () => {
    const advert = (n, extra = {}) => ({
      id: id(n), title: `Advert ${n}`, status: 'ACTIVE', scope: 'IN', placements: ['home'], image_url: `/files/${id(n)}`,
      starts_on: null, ends_on: null, views: 10, clicks: 2, earned: null, currency: 'INR', pricing_model: null, ...extra,
    })
    openConsole('/admin/ads', {
      'GET /admin/ads': { data: { items: [advert(1), advert(2, { status: 'PAUSED', starts_on: '2026-11-01', earned: 500, pricing_model: 'CPM' })], revenue: [] } },
      'GET /admin/ads/placements': { data: [{ key: 'home', label: 'Home' }] },
    })
    expectUniformCards(await screen.findByTestId('admin-advert-cards', {}, FIND))
  })

  it('catalog products', async () => {
    openConsole('/admin/catalog', catalogServer())
    expectUniformCards(await screen.findByTestId('admin-catalog-product-cards', {}, FIND))
  })

  it('catalog brands', async () => {
    openConsole('/admin/catalog?tab=brands', catalogServer())
    expectUniformCards(await screen.findByTestId('admin-brand-cards', {}, FIND))
  })

  it('catalog subcategories tab', async () => {
    openConsole('/admin/catalog?tab=subcategories', catalogServer({
      'GET /admin/catalog/subcategories': { data: [subcategory(1, 1), subcategory(3, 2)] },
    }))
    expectUniformCards(await screen.findByTestId('admin-subcategory-cards', {}, FIND))
  })

  it("catalog categories, a category's subcategories and a subcategory's products", async () => {
    const user = userEvent.setup()
    openConsole('/admin/catalog?tab=categories', catalogServer())
    expectUniformCards(await screen.findByTestId('admin-category-cards', {}, FIND))
    await user.click(screen.getAllByRole('button', { name: /Manage Subcategories/ })[0])
    expectUniformCards(await screen.findByTestId('admin-category-subcategory-cards', {}, FIND))
    await user.click(screen.getAllByRole('button', { name: 'View products' })[0])
    expectUniformCards(await screen.findByTestId('admin-subcategory-product-cards', {}, FIND))
  })
})
