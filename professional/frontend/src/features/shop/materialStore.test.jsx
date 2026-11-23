/**
 * The Site Engineer's Store (/engineer/store): one card per product and variant for the
 * selected project, Record usage (10 - 8 = 2), the movements History in a dialog with its id
 * in the address, Reorder into the supplier catalog, filters, search, sort, skeletons and the
 * empty state. The rules themselves (no more than in stock, the unit, who may record) are the
 * server's; this checks the screen sends the right request and shows the answer.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { PROJECT_ID, SITE_ENGINEER, anAssignedProject, engineerDashboardServer } from '../engineer/engineerTestData.js'

const FIND = { timeout: 15000 }
const OTHER_PROJECT = '0190a8b2-4c1e-7aa0-9f00-0000000000a2'
const STOCK = '0190a8b2-4c1e-7aa0-9f00-000000000501'
const LISTING = '0190a8b2-4c1e-7aa0-9f00-000000000601'
const store = (projectId = PROJECT_ID) => `/projects/${projectId}/material-store`

const aStockItem = (overrides = {}) => ({
  id: STOCK,
  material: 'OPC 53 Grade Cement · 50 kg',
  name: 'OPC 53 Grade Cement',
  brand: 'Dalmia',
  size: '50 kg',
  image_url: null,
  unit: 'Bag',
  in_stock: 10,
  received_total: 10,
  used_total: 0,
  minimum_stock: 0,
  low_stock: false,
  stock_status: 'IN_STOCK',
  updated_at: '2026-11-20T10:00:00+05:30',
  listing_id: LISTING,
  catalog_product_id: null,
  ...overrides,
})

function openStore(items, { canRecord = true, canSetThreshold = canRecord, routes = {}, path = '/engineer/store' } = {}) {
  let current = items
  const server = installFakeServer(engineerDashboardServer({
    'GET /engineers/my-projects': { data: [anAssignedProject(), anAssignedProject({ id: OTHER_PROJECT, title: 'Lake View Villa' })] },
    [`GET ${store()}`]: () => ({ data: { project_id: PROJECT_ID, can_record_usage: canRecord, can_set_threshold: canSetThreshold, items: current } }),
    [`GET ${store(OTHER_PROJECT)}`]: { data: { project_id: OTHER_PROJECT, can_record_usage: canRecord, items: [] } },
    ...routes,
  }))
  renderApp(path, { auth: signedInAs(SITE_ENGINEER) })
  return { server, setItems: (next) => { current = next } }
}

const cards = () => screen.getAllByTestId('store-card')
const inStock = (card) => within(card).getByTestId('store-in-stock').textContent

describe('the Site Engineer Store', () => {
  it('shows one card per material with in stock, received, used and last updated', async () => {
    openStore([aStockItem({ in_stock: 2, received_total: 10, used_total: 8 })])
    const card = await screen.findByTestId('store-card', {}, FIND)
    expect(within(card).getByRole('heading', { name: /OPC 53 Grade Cement/ })).toBeInTheDocument()
    expect(within(card).getByText('Dalmia · 50 kg')).toBeInTheDocument()
    expect(inStock(card)).toMatch(/^2\s*Bag/)
    expect(within(card).getByText('10 Bag')).toBeInTheDocument() // received
    expect(within(card).getByText('8 Bag')).toBeInTheDocument() // used
    expect(within(card).getByText('Last updated')).toBeInTheDocument()
    expect(within(card).getAllByText('In stock')).toHaveLength(2) // the status pill and the big number's label
    // Reorder opens the supplier catalog on this product.
    expect(within(card).getByRole('link', { name: /Reorder/ })).toHaveAttribute('href', `/engineer/my-supplies?tab=suppliers&product=${LISTING}`)
    // Orders stay on the Orders tab: the Store shows no order rows.
    expect(screen.queryByTestId('order-row')).not.toBeInTheDocument()
  })

  it('records usage: 10 in stock, 8 used, 2 left', async () => {
    const user = userEvent.setup()
    const { server, setItems } = openStore([aStockItem()], {
      routes: {
        [`POST ${store()}/${STOCK}/usage`]: () => {
          setItems([aStockItem({ in_stock: 2, used_total: 8 })])
          return { data: { usage_id: '0190a8b2-4c1e-7aa0-9f00-000000000701', item: aStockItem({ in_stock: 2, used_total: 8 }) } }
        },
      },
    })
    await user.click(within(await screen.findByTestId('store-card', {}, FIND)).getByRole('button', { name: /Record usage/ }))
    const dialog = await screen.findByTestId('store-usage-dialog')
    await user.type(within(dialog).getByLabelText(/Quantity used/), '8')
    await user.type(within(dialog).getByLabelText(/Note/), 'Footing pour')
    await user.click(within(dialog).getByRole('button', { name: 'Save usage' }))
    await waitFor(() => expect(server.calls(`POST ${store()}/${STOCK}/usage`)).toHaveLength(1))
    const body = JSON.parse(server.calls(`POST ${store()}/${STOCK}/usage`)[0].data)
    expect(body).toMatchObject({ quantity: 8, unit: 'Bag', note: 'Footing pour' })
    expect(body.used_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(inStock(cards()[0])).toMatch(/^2\s*Bag/))
    expect(screen.getByText('Usage of OPC 53 Grade Cement recorded.')).toBeInTheDocument()
  })

  it('does not send more than is in stock, or zero, and shows the server refusal', async () => {
    const user = userEvent.setup()
    const { server } = openStore([aStockItem()], {
      routes: { [`POST ${store()}/${STOCK}/usage`]: { status: 409, data: { detail: 'Only 10 Bag OPC 53 Grade Cement · 50 kg in stock.' } } },
    })
    await user.click(within(await screen.findByTestId('store-card', {}, FIND)).getByRole('button', { name: /Record usage/ }))
    const dialog = await screen.findByTestId('store-usage-dialog')
    const amount = within(dialog).getByLabelText(/Quantity used/)
    await user.type(amount, '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save usage' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Only 10 Bag in stock.')
    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(within(dialog).getByRole('button', { name: 'Save usage' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('greater than zero')
    expect(server.calls(`POST ${store()}/${STOCK}/usage`)).toHaveLength(0)
    // The server has the last word (another usage may have been recorded meanwhile).
    await user.clear(amount)
    await user.type(amount, '9')
    await user.click(within(dialog).getByRole('button', { name: 'Save usage' }))
    expect(await within(dialog).findByText(/Only 10 Bag OPC 53 Grade Cement/)).toBeInTheDocument()
  })

  it('offers no Record usage to someone who may only look', async () => {
    openStore([aStockItem()], { canRecord: false })
    const card = await screen.findByTestId('store-card', {}, FIND)
    expect(within(card).queryByRole('button', { name: /Record usage/ })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /Set low-stock level/ })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /History/ })).toBeInTheDocument()
  })

  it('sets the low-stock level in the stock unit, and the card then shows Low stock', async () => {
    const user = userEvent.setup()
    const { server, setItems } = openStore([aStockItem({ in_stock: 3 })], {
      routes: {
        [`PUT ${store()}/${STOCK}/threshold`]: () => {
          const item = aStockItem({ in_stock: 3, minimum_stock: 5, low_stock: true, stock_status: 'LOW_STOCK' })
          setItems([item])
          return { data: { item } }
        },
      },
    })
    const card = await screen.findByTestId('store-card', {}, FIND)
    expect(within(card).getByText('Not set')).toBeInTheDocument()
    expect(within(card).queryByText(/Low stock/)).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /Set low-stock level/ }))
    const dialog = await screen.findByTestId('store-threshold-dialog')
    const level = within(dialog).getByLabelText(/Low-stock level \(Bag\)/)
    await user.type(level, '-1')
    await user.click(within(dialog).getByRole('button', { name: 'Save level' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('cannot be negative')
    expect(server.calls(`PUT ${store()}/${STOCK}/threshold`)).toHaveLength(0)
    await user.clear(level)
    await user.type(level, '5')
    await user.click(within(dialog).getByRole('button', { name: 'Save level' }))
    await waitFor(() => expect(server.calls(`PUT ${store()}/${STOCK}/threshold`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`PUT ${store()}/${STOCK}/threshold`)[0].data)).toEqual({ minimum_stock: 5, unit: 'Bag' })
    await waitFor(() => expect(within(cards()[0]).getAllByText(/Low stock/).length).toBeGreaterThan(0))
    expect(within(cards()[0]).getByText('5 Bag')).toBeInTheDocument()
  })

  it('shows the server refusal when the level may not be set', async () => {
    const user = userEvent.setup()
    openStore([aStockItem()], {
      routes: { [`PUT ${store()}/${STOCK}/threshold`]: { status: 403, data: { detail: "Only the assigned Site Engineer or the project's builder can set the low-stock level" } } },
    })
    await user.click(within(await screen.findByTestId('store-card', {}, FIND)).getByRole('button', { name: /Set low-stock level/ }))
    const dialog = await screen.findByTestId('store-threshold-dialog')
    await user.type(within(dialog).getByLabelText(/Low-stock level/), '2')
    await user.click(within(dialog).getByRole('button', { name: 'Save level' }))
    expect(await within(dialog).findByText(/Only the assigned Site Engineer or the project's builder/)).toBeInTheDocument()
  })

  it('opens the History in a dialog with its id in the address; Back closes it', async () => {
    const user = userEvent.setup()
    openStore([aStockItem({ in_stock: 12, received_total: 20, used_total: 8 })], {
      routes: {
        [`GET ${store()}/${STOCK}/movements`]: { data: {
          item: aStockItem({ in_stock: 12, received_total: 20, used_total: 8 }),
          movements: [
            { id: 'order-line-2', kind: 'RECEIVED', quantity: 10, unit: 'Bag', at: '2026-11-21T10:00:00+05:30', by: 'Lakshmi Traders', source: { kind: 'ORDER', number: 'AB12CD34' }, note: null },
            { id: 'usage-1', kind: 'USED', quantity: 8, unit: 'Bag', at: '2026-11-20', by: 'Meena Iyer', source: { kind: 'STORE_USAGE' }, note: 'Footing pour' },
            { id: 'usage-2', kind: 'USED', quantity: 0.5, unit: 'Bag', at: '2026-11-19', by: 'Meena Iyer', source: { kind: 'DAILY_RECORD', date: '2026-11-19' }, note: null },
            { id: 'order-line-1', kind: 'RECEIVED', quantity: 10, unit: 'Bag', at: '2026-11-18T10:00:00+05:30', by: 'Lakshmi Traders', source: { kind: 'ORDER', number: 'EF56GH78' }, note: null },
          ],
        } },
      },
    })
    await user.click(within(await screen.findByTestId('store-card', {}, FIND)).getByRole('button', { name: /History/ }))
    const dialog = await screen.findByTestId('store-history-dialog')
    expect(new URLSearchParams(location.current.search).get('movements')).toBe(STOCK)
    const rows = await within(dialog).findAllByTestId('store-movement')
    expect(rows.map((row) => row.lastChild.textContent)).toEqual(['+10 Bag', '−8 Bag', '−0.5 Bag', '+10 Bag'])
    expect(within(rows[0]).getByText(/Order #AB12CD34 · Lakshmi Traders/)).toBeInTheDocument()
    expect(within(rows[1]).getByText(/Recorded in Store/)).toBeInTheDocument()
    expect(within(rows[1]).getByText('Footing pour')).toBeInTheDocument()
    expect(within(rows[2]).getByText(/Daily record/)).toBeInTheDocument()
    act(() => history.back())
    await waitFor(() => expect(screen.queryByTestId('store-history-dialog')).not.toBeInTheDocument())
  })

  it('filters by stock state, searches and sorts', async () => {
    const user = userEvent.setup()
    openStore([
      aStockItem(),
      aStockItem({ id: '0190a8b2-4c1e-7aa0-9f00-000000000502', name: 'TMT Bar 12mm', material: 'TMT Bar 12mm', brand: 'Tata', size: '12 mm', unit: 'rod', in_stock: 3, minimum_stock: 5 }),
      aStockItem({ id: '0190a8b2-4c1e-7aa0-9f00-000000000503', name: 'River Sand', material: 'River Sand', brand: null, size: null, unit: 'ton', in_stock: 0 }),
    ])
    await screen.findAllByTestId('store-card', {}, FIND)
    const names = () => cards().map((card) => card.getAttribute('aria-label'))
    expect(names()).toEqual(['OPC 53 Grade Cement', 'River Sand', 'TMT Bar 12mm'])
    // A material at or below its threshold carries the low-stock badge.
    expect(within(cards()[2]).getAllByText(/Low stock/).length).toBeGreaterThan(0)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'low')
    expect(names()).toEqual(['TMT Bar 12mm'])
    expect(new URLSearchParams(location.current.search).get('stock')).toBe('low')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'out')
    expect(names()).toEqual(['River Sand'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'in')
    expect(names()).toEqual(['OPC 53 Grade Cement'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'all')

    await user.type(screen.getByRole('searchbox', { name: 'Search materials' }), 'tata')
    expect(names()).toEqual(['TMT Bar 12mm'])
    await user.clear(screen.getByRole('searchbox', { name: 'Search materials' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'most')
    expect(names()).toEqual(['OPC 53 Grade Cement', 'TMT Bar 12mm', 'River Sand'])
  })

  it('switches project with the selector and shows the empty state', async () => {
    const user = userEvent.setup()
    const { server } = openStore([aStockItem()])
    await screen.findByTestId('store-card', {}, FIND)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Lake View Villa')
    expect(await screen.findByText('No materials in store yet', {}, FIND)).toBeInTheDocument()
    expect(new URLSearchParams(location.current.search).get('project')).toBe(OTHER_PROJECT)
    expect(server.calls(`GET ${store(OTHER_PROJECT)}`).length).toBeGreaterThan(0)
  })

  it('shows skeleton cards while loading', async () => {
    let answer
    const gate = new Promise((resolve) => { answer = resolve })
    openStore([], { routes: { [`GET ${store()}`]: () => gate.then(() => ({ data: { project_id: PROJECT_ID, can_record_usage: true, items: [] } })) } })
    const region = await screen.findByRole('region', { name: 'Store' }, FIND)
    expect(await within(region).findByRole('status', {}, FIND)).toHaveAttribute('aria-busy', 'true')
    answer()
    expect(await screen.findByText('No materials in store yet', {}, FIND)).toBeInTheDocument()
  })
})
