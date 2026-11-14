import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import {
  CHANNEL_ID,
  PROJECT_ID,
  SITE_ENGINEER,
  STORE_MANAGER,
  STORE_REQUEST_ID,
  STRUCTURAL_ENGINEER,
  SUPPLIER_ID,
  aRecorder,
  aSiteRequest,
  aSupplierProduct,
  anAssignedProject,
  engineerDashboardServer,
  storeDashboardServer,
} from './engineerTestData.js'

// hls.js stands in here; the test checks it is only asked for when a camera plays.
const hlsLoaded = vi.fn()
vi.mock('hls.js', () => {
  hlsLoaded()
  return { default: { isSupported: () => false } }
})

const FIND = { timeout: 15000 }
const ENGINEER_SECTIONS = ['/engineer', '/engineer/my-projects', '/engineer/my-supplies', '/engineer/store-requests', '/engineer/find-opportunities',
  '/engineer/calendar', '/engineer/daily-logs', '/engineer/messages', '/engineer/notifications', '/engineer/profile', '/engineer/live-camera']
const STORE_SECTIONS = ['/store-manager', '/store-manager/catalog', '/store-manager/buy', '/store-manager/payments', '/store-manager/requests',
  '/store-manager/approvals', '/store-manager/builders', '/store-manager/messages', '/store-manager/notifications', '/store-manager/profile']

function open(path, account, routes) {
  const server = installFakeServer(routes)
  const view = renderApp(path, { auth: signedInAs(account) })
  return { server, ...view }
}

describe('access', () => {
  it.each([...ENGINEER_SECTIONS, ...STORE_SECTIONS])('%s asks a signed-out visitor to sign in first', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: path })
  })

  it.each([
    ['a Store Manager', STORE_MANAGER, '/engineer/my-projects', '/store-manager'],
    ['a Store Manager', STORE_MANAGER, '/engineer/live-camera', '/store-manager'],
    ['a Site Engineer', SITE_ENGINEER, '/store-manager/buy', '/engineer'],
    ['a Structural Engineer', STRUCTURAL_ENGINEER, '/store-manager', '/engineer'],
    ['a House Owner', anAccount({ role: 'OWNER' }), '/engineer', '/owner'],
    ['a Builder', anAccount({ role: 'BUILDER' }), '/store-manager', '/contractor'],
    ['a Supplier', anAccount({ role: 'SUPPLIER' }), '/engineer/live-camera', '/supplier'],
  ])('%s is sent from %s to their own home', async (_who, account, path, home) => {
    installFakeServer({})
    renderApp(path, { auth: signedInAs(account) })
    await waitFor(() => expect(location.current.pathname).toBe(home))
  })

  it('opens the engineer dashboard for an engineer of any other category (as before)', async () => {
    open('/engineer', STRUCTURAL_ENGINEER, engineerDashboardServer())
    expect(await screen.findByText('Welcome, Kiran Das', {}, FIND)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/engineer')
  })
})

describe('Site Engineer dashboard', () => {
  it('greets the engineer and offers Book Technician (Site Engineer category only)', async () => {
    open('/engineer', SITE_ENGINEER, engineerDashboardServer())
    expect(await screen.findByText('Welcome, Meena Iyer', {}, FIND)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Book Technician/ })).toBeInTheDocument()
  })

  it('hides Book Technician from other engineer categories, as the server refuses them the hand-off', async () => {
    open('/engineer', STRUCTURAL_ENGINEER, engineerDashboardServer())
    expect(await screen.findByText('Welcome, Kiran Das', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Book Technician/ })).not.toBeInTheDocument()
  })

  it('lists the projects the engineer is assigned to', async () => {
    open('/engineer/my-projects', SITE_ENGINEER, engineerDashboardServer({ 'GET /engineers/my-projects': { data: [anAssignedProject()] } }))
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Project' })).toBeInTheDocument()
  })

  it('applies for a new project opportunity', async () => {
    const user = userEvent.setup()
    const opportunity = { ...anAssignedProject({ title: 'Lake View Villa' }), project_id: PROJECT_ID, company_logo_url: null }
    const { server } = open('/engineer/find-opportunities', SITE_ENGINEER, engineerDashboardServer({
      'GET /engineers/opportunities': { data: [opportunity] },
      [`POST /engineers/opportunities/${PROJECT_ID}/apply`]: { data: { message: 'Application sent' } },
    }))
    // The section opens on Join Team; the opportunities are its last tab.
    await screen.findByText('Welcome, Meena Iyer', {}, FIND).catch(() => null)
    const tabs = await screen.findAllByRole('button', { name: 'Find Opportunities' }, FIND)
    await user.click(tabs[tabs.length - 1])
    expect(await screen.findByText('Lake View Villa', {}, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Apply/ }))
    await waitFor(() => expect(server.calls(`POST /engineers/opportunities/${PROJECT_ID}/apply`)).toHaveLength(1))
  })
})

describe('Live camera page', () => {
  const cameraServer = (accessGranted, extra = {}) => engineerDashboardServer({
    'GET /engineers/my-projects': { data: [anAssignedProject()] },
    [`GET /cctv/projects/${PROJECT_ID}/camera-setup`]: {
      data: { project_id: PROJECT_ID, project_title: 'Rao Family Home', has_device: true, access_granted: accessGranted, verified_at: null },
    },
    [`GET /cctv/projects/${PROJECT_ID}/devices`]: { data: aRecorder() },
    ...extra,
  })

  it('verifies the recorder once: the password goes in the request body only and is never kept', async () => {
    const user = userEvent.setup()
    const { server, store } = open('/engineer/live-camera', SITE_ENGINEER, cameraServer(false, {
      [`POST /cctv/projects/${PROJECT_ID}/camera-setup`]: { status: 400, data: { detail: { code: 'CCTV_AUTH_FAILED', message: 'The recorder refused these credentials.' } } },
    }))
    await user.click(await screen.findByRole('button', { name: 'Connect DVR/NVR' }, FIND))
    await user.type(screen.getByLabelText('IP Address / Host'), '192.168.1.20')
    await user.type(screen.getByLabelText(/^Port/), '80')
    await user.type(screen.getByLabelText('Username'), 'admin')
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    await user.type(password, 'S3cret-recorder')
    await user.click(screen.getByRole('button', { name: 'Verify Device' }))

    await waitFor(() => expect(server.calls(`POST /cctv/projects/${PROJECT_ID}/camera-setup`)).toHaveLength(1))
    const sent = server.calls(`POST /cctv/projects/${PROJECT_ID}/camera-setup`)[0]
    expect(JSON.parse(sent.data).credentials).toEqual({ username: 'admin', password: 'S3cret-recorder' })
    expect(JSON.stringify(sent.params || {})).not.toContain('S3cret')
    // Cleared from the form whatever the outcome, and nowhere in the store or the browser.
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''))
    expect(JSON.stringify(store.getState())).not.toContain('S3cret-recorder')
    expect(JSON.stringify({ ...localStorage })).not.toContain('S3cret')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('S3cret')
  })

  it('lists the cameras and starts playback; the video library is loaded only then', async () => {
    const user = userEvent.setup()
    hlsLoaded.mockClear()
    const { server } = open('/engineer/live-camera', SITE_ENGINEER, cameraServer(true, {
      [`POST /cctv/channels/${CHANNEL_ID}/playback`]: {
        data: { session_id: '0190a8b2-4c1e-7aa0-9f00-0000000000d9', playback_token: 'one-time', playback_url: 'https://media.test/live.m3u8', expires_at: '2026-11-14T10:05:00+05:30' },
      },
    }))
    expect(await screen.findByText('Gate camera', {}, FIND)).toBeInTheDocument()
    expect(hlsLoaded).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Watch Gate camera' }))
    await waitFor(() => expect(hlsLoaded).toHaveBeenCalled())
    // This browser has no HLS support in the test, so playback stops before a session opens.
    expect(server.calls(`POST /cctv/channels/${CHANNEL_ID}/playback`)).toHaveLength(0)
  })
})

describe('Store Manager dashboard', () => {
  afterEach(() => {
    delete window.Razorpay
  })

  it('greets the Store Manager with the store overview', async () => {
    const { server } = open('/store-manager', STORE_MANAGER, storeDashboardServer())
    expect(await screen.findByText('Welcome, Suresh Nair', {}, FIND)).toBeInTheDocument()
    expect(server.calls('GET /store-manager/overview').length).toBeGreaterThan(0)
  })

  it("approves a Site Engineer's request", async () => {
    const user = userEvent.setup()
    const { server } = open('/store-manager/requests', STORE_MANAGER, storeDashboardServer({
      'GET /store-manager/requests': { data: [aSiteRequest()] },
      [`POST /store-manager/requests/${STORE_REQUEST_ID}/approve`]: { data: aSiteRequest({ status: 'APPROVED', stage: 'APPROVED' }) },
    }))
    expect(await screen.findByText('SR-0001', {}, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View details' }))
    const approve = await screen.findAllByRole('button', { name: 'Approve' })
    await user.click(approve[approve.length - 1])
    await waitFor(() => expect(server.calls(`POST /store-manager/requests/${STORE_REQUEST_ID}/approve`)).toHaveLength(1))
  })

  const buyServer = (order, extra = {}) => storeDashboardServer({
    'GET /store-manager/buy/products': { data: { products: [aSupplierProduct()], supplier_count: 1 } },
    'POST /store-manager/purchases/checkout': { data: order },
    'POST /store-manager/purchases/verify': { data: { status: 'PAID', reference_code: 'PO-0001', amount: 420 } },
    ...extra,
  })
  const anOrder = (gatewayMode) => ({
    payment_id: '0190a8b2-4c1e-7aa0-9f00-0000000000f9',
    reference_code: 'PO-0001',
    gateway_mode: gatewayMode,
    key_id: gatewayMode === 'test' ? 'rzp_test_key' : '',
    razorpay_order_id: 'order_TEST0001',
    amount: 420,
    amount_paise: 42000,
    currency: 'INR',
    supplier_id: SUPPLIER_ID,
    supplier_name: 'Lakshmi Traders',
    lines: [{ product_id: aSupplierProduct().id, name: 'UltraTech Cement', unit: 'bag', quantity: 1, unit_price: 420, line_total: 420 }],
  })

  async function addToOrderAndPay(user) {
    await user.click(await screen.findByRole('button', { name: 'Add UltraTech Cement 50 kg Lakshmi Traders' }, FIND))
    // A quantity first, then the order line, then pay.
    await user.type(await screen.findByLabelText('Quantity UltraTech Cement'), '1')
    await user.click(screen.getByRole('button', { name: 'Add to order' }))
    await user.click(await screen.findByRole('button', { name: 'Pay with Razorpay (TEST)' }))
  }

  it('buys from a supplier through the Razorpay client; the server prices and verifies the payment', async () => {
    const user = userEvent.setup()
    let options = null
    window.Razorpay = class {
      constructor(given) {
        options = given
      }
      on() {}
      open() {
        options.handler({ razorpay_order_id: 'order_TEST0001', razorpay_payment_id: 'pay_TEST0001', razorpay_signature: 'signed' })
      }
    }
    const { server } = open('/store-manager/buy', STORE_MANAGER, buyServer(anOrder('test')))
    await addToOrderAndPay(user)
    await waitFor(() => expect(server.calls('POST /store-manager/purchases/verify')).toHaveLength(1))
    const checkout = JSON.parse(server.calls('POST /store-manager/purchases/checkout')[0].data)
    expect(checkout).toMatchObject({ project_id: PROJECT_ID, supplier_id: SUPPLIER_ID })
    expect(checkout).not.toHaveProperty('amount')
    expect(options).toMatchObject({ key: 'rzp_test_key', order_id: 'order_TEST0001' })
    expect(JSON.parse(server.calls('POST /store-manager/purchases/verify')[0].data)).toEqual({
      payment_id: anOrder('test').payment_id,
      razorpay_order_id: 'order_TEST0001',
      razorpay_payment_id: 'pay_TEST0001',
      razorpay_signature: 'signed',
    })
  })

  it("uses the simulated checkout only when the server chooses it (its development mock)", async () => {
    const user = userEvent.setup()
    const { server } = open('/store-manager/buy', STORE_MANAGER, buyServer(anOrder('mock'), {
      'POST /store-manager/purchases/mock-checkout': {
        data: { succeeded: true, razorpay_order_id: 'order_MOCK1', razorpay_payment_id: 'pay_MOCK1', razorpay_signature: 'mock-signed' },
      },
    }))
    await addToOrderAndPay(user)
    const dialog = (await screen.findByText('Simulated test checkout')).closest('div')
    await user.click(within(dialog.parentElement).getByRole('button', { name: 'Simulate successful payment' }))
    await waitFor(() => expect(server.calls('POST /store-manager/purchases/verify')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /store-manager/purchases/mock-checkout')[0].data)).toEqual({ payment_id: anOrder('mock').payment_id, outcome: 'success' })
    expect(window.Razorpay).toBeUndefined()
  })
})
