/**
 * The compact order lists: the Site Engineer's /engineer/orders and the Supplier's Orders and
 * Purchase Requests. One row per order (Order # | party | Project | Date | Items | Amount |
 * Status | Actions), status filter tabs, sort by date or amount, search, Load more, and the
 * order's details in the shared dialog with its id in the address.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { SITE_ENGINEER, engineerDashboardServer } from '../engineer/engineerTestData.js'
import { MATERIAL, SUPPLIER, anOrderLine, supplierDashboardServer } from '../supplier/supplierTestData.js'

const FIND = { timeout: 15000 }
const id = (n) => `0190a8b2-4c1e-7aa0-9f00-${String(n).padStart(12, '0')}`

function anOrder(n, overrides = {}) {
  return {
    id: id(n),
    order_number: `${String(n).padStart(8, 'a')}4c1e7aa09f00000000000000`,
    supplier_name: 'Lakshmi Traders',
    project_name: 'Rao Family Home',
    estimated_amount: 100 * n,
    status: 'PENDING',
    created_at: `2026-11-${String(10 + (n % 15)).padStart(2, '0')}T09:00:00+05:30`,
    items: [{ line_id: id(500 + n), product_id: id(900), name: 'ACC PPC Cement', quantity: 1, unit: 'Bag', price: 100 * n, line_total: 100 * n, status: 'PENDING' }],
    ...overrides,
  }
}

function openEngineerOrders(orders, path = '/engineer/orders', routes = {}) {
  const detail = Object.fromEntries(orders.map((order) => [`GET /marketplace/orders/${order.id}`, { data: order }]))
  const server = installFakeServer(engineerDashboardServer({ 'GET /marketplace/orders': { data: orders }, ...detail, ...routes }))
  renderApp(path, { auth: signedInAs(SITE_ENGINEER) })
  return server
}

const rows = () => screen.getAllByTestId('order-row')
const numbers = () => rows().map((row) => within(row).getAllByRole('cell')[0].textContent)

describe('Site Engineer orders: the compact list', () => {
  const threeItems = anOrder(1, {
    estimated_amount: 284.2,
    items: [
      { line_id: id(601), product_id: id(900), name: 'ACC PPC Cement', quantity: 1, unit: 'Bag', price: 280, line_total: 280, status: 'FULFILLED', fulfilled_at: '2026-11-12T10:00:00+05:30' },
      { line_id: id(602), product_id: id(901), name: 'Binding wire', quantity: 1, unit: 'kg', price: 2.2, line_total: 2.2, status: 'ACCEPTED' },
      { line_id: id(603), product_id: id(902), name: 'Cover block', quantity: 2, unit: 'pc', price: 1, line_total: 2, status: 'ACCEPTED' },
    ],
  })

  it('shows one row per order with its number, supplier, project, date, items, amount and status', async () => {
    openEngineerOrders([threeItems])
    const row = await screen.findByTestId('order-row', {}, FIND)
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells[0]).toBe('#AAAAAAA1')
    expect(cells[1]).toBe('Lakshmi Traders')
    expect(cells[2]).toBe('Rao Family Home')
    expect(cells[3]).toMatch(/2026|Nov/)
    expect(cells[4]).toContain('ACC PPC Cement · 1 Bag')
    expect(cells[4]).toContain('+2 more')
    expect(cells[5]).toMatch(/284\.2/)
    expect(cells[6]).toBe('Pending')
    expect(within(row).getByRole('button', { name: /^View/ })).toBeInTheDocument()
    // The column headings, and no stray "?" or floating "Order details" text anywhere.
    for (const heading of ['Order #', 'Supplier', 'Project', 'Date', 'Product(s)', 'Amount', 'Status', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(`^${heading.replace(/[()#]/g, '\\$&')}`) })).toBeInTheDocument()
    }
    expect(document.body.textContent).not.toMatch(/ \? /)
    expect(screen.queryByRole('link', { name: 'Order details' })).not.toBeInTheDocument()
  })

  it('opens the order in the details dialog with its id in the address, and Back closes it', async () => {
    const user = userEvent.setup()
    openEngineerOrders([threeItems])
    await user.click(await screen.findByText('Rao Family Home', {}, FIND))
    const dialog = await screen.findByRole('dialog', { name: 'Order details' }, FIND)
    expect(new URLSearchParams(location.current.search).get('order')).toBe(threeItems.id)
    // Every line with its quantity, price and status, and the delivery history.
    for (const name of ['ACC PPC Cement', 'Binding wire', 'Cover block']) expect(within(dialog).getAllByText(name).length).toBeGreaterThan(0)
    expect(within(dialog).getByText('1 Bag')).toBeInTheDocument()
    expect(within(dialog).getByText(/^Fulfilled:/)).toBeInTheDocument()
    expect(within(dialog).getAllByText('Accepted')).toHaveLength(2)
    expect(within(dialog).getByRole('button', { name: 'Mark as Received' })).toBeInTheDocument()

    act(() => history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(location.current.search).not.toContain('order=')
  })

  it('opens the dialog straight from a link to the order', async () => {
    openEngineerOrders([threeItems], `/engineer/orders?order=${threeItems.id}`)
    expect(await screen.findByRole('dialog', { name: 'Order details' }, FIND)).toBeInTheDocument()
  })

  it('marks a fulfilled line as received from the dialog', async () => {
    const user = userEvent.setup()
    const server = openEngineerOrders([threeItems], `/engineer/orders?order=${threeItems.id}`, {
      [`POST /marketplace/orders/${threeItems.id}/items/${id(601)}/receive`]: { data: {} },
    })
    await user.click(await screen.findByRole('button', { name: 'Mark as Received' }, FIND))
    await waitFor(() => expect(server.calls(`POST /marketplace/orders/${threeItems.id}/items/${id(601)}/receive`)).toHaveLength(1))
  })

  it('filters by status, searches by order number, product or project, and sorts by amount', async () => {
    const user = userEvent.setup()
    openEngineerOrders([
      anOrder(1),
      anOrder(2, { status: 'ACCEPTED', project_name: 'Lake View Villa' }),
      anOrder(3, { status: 'REJECTED', items: [{ ...anOrder(3).items[0], name: 'TMT Bar 12mm' }] }),
    ])
    await screen.findAllByTestId('order-row', {}, FIND)
    expect(rows()).toHaveLength(3)

    const filters = screen.getByRole('group', { name: 'Status' })
    await user.click(within(filters).getByRole('button', { name: /^Accepted/ }))
    expect(numbers()).toEqual(['#AAAAAAA2'])
    expect(new URLSearchParams(location.current.search).get('orderStatus')).toBe('accepted')
    await user.click(within(filters).getByRole('button', { name: /^Rejected/ }))
    expect(numbers()).toEqual(['#AAAAAAA3'])
    await user.click(within(filters).getByRole('button', { name: /^All/ }))

    const search = within(screen.getByRole('region', { name: 'Orders' })).getByRole('searchbox')
    await user.type(search, 'tmt')
    expect(numbers()).toEqual(['#AAAAAAA3'])
    await user.clear(search)
    await user.type(search, 'lake view')
    expect(numbers()).toEqual(['#AAAAAAA2'])
    await user.clear(search)
    await user.type(search, 'aaaaaaa1')
    expect(numbers()).toEqual(['#AAAAAAA1'])
    await user.clear(search)
    await user.type(search, 'nothing like this')
    expect(screen.getByText('No orders match these filters')).toBeInTheDocument()
    await user.clear(search)

    await user.click(screen.getByRole('button', { name: /^Amount/ }))
    expect(numbers()).toEqual(['#AAAAAAA3', '#AAAAAAA2', '#AAAAAAA1'])
    expect(screen.getByRole('columnheader', { name: /^Amount/ })).toHaveAttribute('aria-sort', 'descending')
    await user.click(screen.getByRole('button', { name: /^Amount/ }))
    expect(numbers()).toEqual(['#AAAAAAA1', '#AAAAAAA2', '#AAAAAAA3'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Oldest first')
    expect(screen.getByRole('columnheader', { name: /^Date/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('shows 20 orders, then Load more', async () => {
    const user = userEvent.setup()
    openEngineerOrders(Array.from({ length: 25 }, (_, index) => anOrder(index + 1)))
    await screen.findAllByTestId('order-row', {}, FIND)
    expect(rows()).toHaveLength(20)
    expect(screen.getByText('Showing 20 of 25')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(rows()).toHaveLength(25)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('shows skeleton rows while loading and an empty state when there are none', async () => {
    let answer
    const gate = new Promise((resolve) => { answer = resolve })
    installFakeServer(engineerDashboardServer({ 'GET /marketplace/orders': () => gate.then(() => ({ data: [] })) }))
    renderApp('/engineer/orders', { auth: signedInAs(SITE_ENGINEER) })
    const list = await screen.findByRole('region', { name: 'Orders' }, FIND)
    expect(within(list).getByRole('status')).toHaveAttribute('aria-busy', 'true')
    answer()
    expect(await screen.findByText('No orders yet', {}, FIND)).toBeInTheDocument()
  })
})

function openSupplier(path, routes = {}) {
  const server = installFakeServer(supplierDashboardServer(MATERIAL, routes))
  renderApp(path, { auth: signedInAs(SUPPLIER) })
  return server
}

describe('Supplier orders: the compact list and its actions', () => {
  const single = anOrderLine()
  const twoLines = [
    anOrderLine({ id: id(701), request_code: '0190a8b2c0dec0de', material_name: 'TMT Bar 12mm', status: 'ACCEPTED', created_at: '2026-11-14T10:00:00+05:30' }),
    anOrderLine({ id: id(702), request_code: '0190a8b2c0dec0de', material_name: 'Binding wire', status: 'ACCEPTED', created_at: '2026-11-14T10:00:00+05:30' }),
  ]

  it('accepts a one-line order from its row', async () => {
    const user = userEvent.setup()
    const server = openSupplier('/supplier/orders', {
      'GET /supplier/material-requests': { data: [single] },
      [`POST /supplier/material-requests/${single.id}/respond`]: { data: {} },
    })
    const row = await screen.findByTestId('order-row', {}, FIND)
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('Meena Iyer')
    await user.click(within(row).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(server.calls(`POST /supplier/material-requests/${single.id}/respond`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /supplier/material-requests/${single.id}/respond`)[0].data)).toEqual({ action: 'ACCEPT' })
  })

  it('rejects a one-line order from its row', async () => {
    const user = userEvent.setup()
    const server = openSupplier('/supplier/orders', {
      'GET /supplier/material-requests': { data: [single] },
      [`POST /supplier/material-requests/${single.id}/respond`]: { data: {} },
    })
    await user.click(within(await screen.findByTestId('order-row', {}, FIND)).getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(server.calls(`POST /supplier/material-requests/${single.id}/respond`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /supplier/material-requests/${single.id}/respond`)[0].data)).toEqual({ action: 'REJECT' })
  })

  it('opens a longer order in its dialog (?order=<code>) and fulfils it line by line', async () => {
    const user = userEvent.setup()
    const server = openSupplier('/supplier/orders', {
      'GET /supplier/material-requests': { data: twoLines },
      [`POST /supplier/material-requests/${id(701)}/respond`]: { data: {} },
    })
    const row = await screen.findByTestId('order-row', {}, FIND)
    expect(within(row).queryByRole('button', { name: /Fulfil/ })).not.toBeInTheDocument() // decided per line, in the dialog
    expect(within(row).getAllByRole('cell')[4].textContent).toContain('+1 more')
    await user.click(within(row).getByRole('button', { name: /^View/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Order details' }, FIND)
    expect(new URLSearchParams(location.current.search).get('order')).toBe('0190a8b2c0dec0de')
    const fulfil = within(dialog).getAllByRole('button', { name: /Fulfil/ })
    expect(fulfil).toHaveLength(2)
    await user.click(fulfil[0])
    await waitFor(() => expect(server.calls(`POST /supplier/material-requests/${id(701)}/respond`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /supplier/material-requests/${id(701)}/respond`)[0].data)).toEqual({ action: 'FULFILL' })
  })

  it('keeps the House Owner / Builder choice beside the search', async () => {
    const user = userEvent.setup()
    openSupplier('/supplier/orders', {
      'GET /supplier/material-requests': { data: [single, anOrderLine({ id: id(703), request_code: '0190a8b2deadbeef', engineer_role: 'OWNER', engineer_name: 'Asha Rao' })] },
    })
    await screen.findAllByTestId('order-row', {}, FIND)
    expect(rows()).toHaveLength(2)
    await user.selectOptions(screen.getByRole('combobox', { name: 'From' }), 'owner')
    expect(rows()).toHaveLength(1)
    expect(within(rows()[0]).getAllByRole('cell')[1].textContent).toBe('Asha Rao')
    expect(new URLSearchParams(location.current.search).get('from')).toBe('owner')
  })
})

describe('Supplier purchase requests: the compact list and its actions', () => {
  const line = anOrderLine()

  it('accepts a whole request from its row', async () => {
    const user = userEvent.setup()
    const server = openSupplier('/supplier/requests', {
      'GET /supplier/material-requests': { data: [line] },
      [`POST /supplier/purchase-requests/${line.request_code}/respond`]: { data: {} },
    })
    const row = await screen.findByTestId('order-row', {}, FIND)
    await user.click(within(row).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(server.calls(`POST /supplier/purchase-requests/${line.request_code}/respond`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /supplier/purchase-requests/${line.request_code}/respond`)[0].data)).toEqual({ action: 'ACCEPT' })
    expect(await screen.findByText(/Order accepted successfully/, {}, FIND)).toBeInTheDocument()
  })

  it('opens a request in the details dialog, with its delivery location, and rejects it there', async () => {
    const user = userEvent.setup()
    const server = openSupplier('/supplier/requests', {
      'GET /supplier/material-requests': { data: [line] },
      [`POST /supplier/purchase-requests/${line.request_code}/respond`]: { data: {} },
    })
    await user.click(await screen.findByText('Rao Family Home', {}, FIND))
    const dialog = await screen.findByRole('dialog', { name: 'Order details' }, FIND)
    expect(new URLSearchParams(location.current.search).get('order')).toBe(line.request_code)
    expect(within(dialog).getByText('560001, Bengaluru')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Reject Order/ }))
    await waitFor(() => expect(server.calls(`POST /supplier/purchase-requests/${line.request_code}/respond`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /supplier/purchase-requests/${line.request_code}/respond`)[0].data)).toEqual({ action: 'REJECT' })
  })
})
