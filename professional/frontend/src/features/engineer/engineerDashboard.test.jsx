import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import {
  CHANNEL_ID,
  PROJECT_ID,
  SITE_ENGINEER,
  STRUCTURAL_ENGINEER,
  SUPPLIER_ID,
  aRecorder,
  aSupplierProduct,
  anAssignedProject,
  engineerDashboardServer,
} from './engineerTestData.js'

// hls.js stands in here; the test checks it is only asked for when a camera plays.
const hlsLoaded = vi.fn()
vi.mock('hls.js', () => {
  hlsLoaded()
  return { default: { isSupported: () => false } }
})

const FIND = { timeout: 15000 }
const ENGINEER_SECTIONS = ['/engineer', '/engineer/my-projects', '/engineer/my-supplies', '/engineer/find-opportunities',
  '/engineer/calendar', '/engineer/daily-logs', '/engineer/messages', '/engineer/notifications', '/engineer/profile', '/engineer/live-camera']
// The removed Store Manager dashboard and the Site Engineer's Store Requests page.
const OLD_STORE_ADDRESSES = ['/store-manager', '/store-manager/requests', '/store-manager/buy', '/engineer/store-requests']

function open(path, account, routes) {
  const server = installFakeServer(routes)
  const view = renderApp(path, { auth: signedInAs(account) })
  return { server, ...view }
}

describe('access', () => {
  it.each([...ENGINEER_SECTIONS, ...OLD_STORE_ADDRESSES])('%s asks a signed-out visitor to sign in first', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: path })
  })

  it.each([
    ['a Site Engineer', SITE_ENGINEER, '/store-manager/requests', '/engineer'],
    ['a Site Engineer', SITE_ENGINEER, '/store-manager', '/engineer'],
    ['a Structural Engineer', STRUCTURAL_ENGINEER, '/store-manager/buy', '/engineer'],
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

describe('Site Engineer orders material from the project suppliers', () => {
  const OTHER_PROJECT_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000a2'
  const STEEL = { id: '0190a8b2-4c1e-7aa0-9f00-0000000c0001', name: 'Steel', image_url: null }
  const TMT_BAR = { id: '0190a8b2-4c1e-7aa0-9f00-0000000a0001', name: 'TMT Bar 12mm', category_id: STEEL.id, subcategory_id: null, image_url: null, variants: [] }
  const product = aSupplierProduct({ name: 'TMT Bar 12mm', master_product_id: TMT_BAR.id, price: 72, discounted_price: 72, unit: 'rod' })
  const line = { id: '0190a8b2-4c1e-7aa0-9f00-0000000000f7', product_id: product.id, name: 'TMT Bar 12mm', unit: 'rod', price: 72, quantity: 1, line_total: 72, available_quantity: 500, image_url: null }
  const aCart = (items) => ({
    items,
    suppliers: items.length ? [{ supplier_id: SUPPLIER_ID, supplier_name: 'Lakshmi Traders', store_name: 'Lakshmi Traders', items, total: 72 }] : [],
    item_count: items.length,
    total: items.length ? 72 : 0,
  })

  // Two assigned projects; the cart is the server's, answered for whichever project is asked.
  function openShop(path, routes = {}) {
    let cartItems = []
    return open(path, SITE_ENGINEER, engineerDashboardServer({
      'GET /engineers/my-projects': { data: [anAssignedProject(), anAssignedProject({ id: OTHER_PROJECT_ID, title: 'Lake View Villa' })] },
      'GET /catalog/categories': { data: [STEEL] },
      'GET /catalog/products': { data: [TMT_BAR] },
      [`GET /catalog/products/${TMT_BAR.id}`]: { data: TMT_BAR },
      [`GET /catalog/products/${TMT_BAR.id}/variants`]: { data: [] },
      'GET /shop/products': { data: { products: [product], categories: ['Steel'], restricted: true } },
      'GET /cart': () => ({ data: aCart(cartItems) }),
      'POST /cart/items': () => { cartItems = [line]; return { data: aCart(cartItems) } },
      'POST /cart/checkout': () => { cartItems = []; return { data: { request_code: '0190a8b2-ord1', cart: aCart([]) } } },
      ...routes,
    }))
  }

  async function addToCartFrom(user, projectTitle) {
    await user.selectOptions(await screen.findByLabelText('Project', {}, FIND), projectTitle)
    const strip = await screen.findByRole('list', { name: 'Categories' }, FIND)
    await user.click(within(strip).getByText('Steel'))
    await user.click(await screen.findByRole('button', { name: 'View TMT Bar 12mm' }, FIND))
    await user.click(await screen.findByRole('button', { name: 'Add to Cart' }, FIND))
  }

  it('picks a project, adds a product to its cart and places the order with the supplier', async () => {
    const user = userEvent.setup()
    const { server } = openShop('/engineer/my-supplies?tab=catalog')
    await addToCartFrom(user, 'Lake View Villa')
    await waitFor(() => expect(server.calls('POST /cart/items')).toHaveLength(1))
    // The catalogue lists only what the chosen project's suppliers sell.
    expect(server.calls('GET /shop/products').some((call) => call.params?.project_id === OTHER_PROJECT_ID)).toBe(true)
    expect(JSON.parse(server.calls('POST /cart/items')[0].data)).toEqual({ project_id: OTHER_PROJECT_ID, product_id: product.id, quantity: 1 })

    await user.click(screen.getByRole('button', { name: /^Cart/, pressed: false }))
    await user.click((await screen.findAllByRole('button', { name: /Send Buy Request/ }, FIND))[0])
    await waitFor(() => expect(server.calls('POST /cart/checkout')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /cart/checkout')[0].data)).toEqual({ project_id: OTHER_PROJECT_ID, supplier_id: SUPPLIER_ID })
    // No payment step: the order goes straight to the supplier.
    expect(server.requests.some((request) => request.path.includes('razorpay') || request.path.includes('/purchases/'))).toBe(false)
  })

  it('says to ask the builder when the project has no supplier assigned', async () => {
    const { server } = openShop('/engineer/my-supplies?tab=catalog', {
      'GET /shop/products': { data: { products: [], categories: [], restricted: true, no_suppliers: true } },
    })
    expect(await screen.findByText('Ask your builder to assign a supplier to this project.', {}, FIND)).toBeInTheDocument()
    expect(server.calls('GET /shop/products').at(-1).params).toEqual({ project_id: PROJECT_ID })
    expect(screen.queryByRole('list', { name: 'Categories' })).not.toBeInTheDocument()
  })

  it('asks for a project first when the server needs one', async () => {
    open('/engineer/my-supplies?tab=catalog', SITE_ENGINEER, engineerDashboardServer({
      'GET /shop/products': { data: { products: [], categories: [], restricted: true, needs_project: true } },
    }))
    expect(await screen.findByText('Select a project to request materials for.', {}, FIND)).toBeInTheDocument()
  })

  it('shows the reason the server gives when it refuses the product', async () => {
    const user = userEvent.setup()
    openShop('/engineer/my-supplies?tab=catalog', {
      'POST /cart/items': { status: 403, data: { detail: 'Only an actively assigned Site Engineer can order for this project.' } },
    })
    await addToCartFrom(user, 'Rao Family Home')
    expect(await screen.findByText('Only an actively assigned Site Engineer can order for this project.', {}, FIND)).toBeInTheDocument()
  })

  it('shows the reason the server gives when it refuses the order', async () => {
    const user = userEvent.setup()
    const { server } = openShop('/engineer/my-supplies?tab=cart', {
      'GET /cart': { data: aCart([line]) },
      'POST /cart/checkout': { status: 403, data: { detail: 'Ask your builder to assign a supplier to this project.' } },
    })
    await user.click((await screen.findAllByRole('button', { name: /Send Buy Request/ }, FIND))[0])
    await waitFor(() => expect(server.calls('POST /cart/checkout')).toHaveLength(1))
    expect(await screen.findByText('Ask your builder to assign a supplier to this project.', {}, FIND)).toBeInTheDocument()
  })
})

describe('Engineer Category', () => {
  it('offers no Store Manager category', async () => {
    const newEngineer = anAccount({
      role: 'ENGINEER',
      engineer_profile: null,
      profile_completion: { missing_fields: [{ field: 'specialization' }] },
    })
    installFakeServer({})
    renderApp('/engineer-category', { auth: signedInAs(newEngineer) })
    expect(await screen.findByRole('radio', { name: 'Site Engineer' }, FIND)).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(14)
    expect(screen.queryByRole('radio', { name: 'Store Manager' })).not.toBeInTheDocument()
  })
})
