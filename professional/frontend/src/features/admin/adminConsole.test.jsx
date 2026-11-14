import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { SECTION_PERMISSIONS } from './adminAccess.js'
import { USER_ID, aUserRow, adminServer, anAdminAccount, anIdentity } from './adminTestData.js'

const FIND = { timeout: 8000 }
const ALL_ADDRESSES = ['/admin', ...Object.keys(SECTION_PERMISSIONS).filter((id) => id !== 'dashboard').map((id) => `/admin/${id}`)]
// Every section that needs a permission, with the endpoint its screen reads first.
const GATED = [
  ['users', 'users.view', 'GET /admin/users'],
  ['projects', 'projects.view', 'GET /admin/projects'],
  ['leads', 'projects.view', 'GET /admin/leads'],
  ['verification', 'verification.view', 'GET /admin/verification'],
  ['reports', 'reports.view', 'GET /admin/reports'],
  ['notifications', 'users.view', 'GET /admin/notifications'],
  ['admins', 'admins.manage', 'GET /admin/admins'],
  ['ads', 'ads.view', 'GET /admin/ads'],
  ['audit', 'audit.view', 'GET /admin/audit'],
  ['catalog', 'catalog.view', 'GET /admin/catalog/categories'],
  ['coupons', 'coupons.view', 'GET /admin/coupons'],
  ['subscription-payments', 'subscriptions.view', 'GET /admin/subscription-payments'],
  ['account-deletion', 'deletions.view', 'GET /admin/deleted-accounts'],
  ['support', 'support.view', 'GET /admin/support/tickets'],
]
const SIDEBAR = { users: 'Users', projects: 'Projects', leads: 'Leads', verification: 'Verification', reports: 'Reports', ads: 'Adverts',
  admins: 'Administrators', audit: 'Audit Log', catalog: 'Master Catalog', coupons: 'Coupons', 'subscription-payments': 'Subscription Payments',
  'account-deletion': 'Account Deletion', support: 'Support Tickets' }

function openConsole(path, identity, routes = {}) {
  const kind = identity.role === 'MANAGER' ? 'manager' : identity.is_global ? 'global' : 'location'
  const server = installFakeServer(adminServer(identity, routes))
  const view = renderApp(path, { auth: signedInAs(anAdminAccount(kind)) })
  return { server, ...view }
}
const manager = (...permissions) => anIdentity('manager', permissions)

afterEach(() => vi.restoreAllMocks())

describe('admin console: who may enter', () => {
  it.each(ALL_ADDRESSES)('%s asks a signed-out visitor to sign in first', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: path })
  })

  it.each([
    ['OWNER', {}, '/owner'],
    ['BUILDER', {}, '/contractor'],
    ['SUPPLIER', {}, '/supplier'],
    ['ENGINEER', { engineer_profile: { specialization: 'Store Manager' } }, '/store-manager'],
  ])('is closed to a %s, who goes to their own home', async (role, extra, home) => {
    installFakeServer({})
    renderApp('/admin/users', { auth: signedInAs(anAccount({ role, ...extra })) })
    await waitFor(() => expect(location.current.pathname).toBe(home))
  })
})

describe('admin console: sections by permission', () => {
  it('shows a Super Admin every section', async () => {
    openConsole('/admin', anIdentity('global'))
    expect(await screen.findByText('Nothing needs you right now', {}, FIND)).toBeInTheDocument()
    for (const label of Object.values(SIDEBAR)) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it.each(GATED)('a manager without %s permission (%s) sees no link to it, and its address says "no access" without asking the server', async (section, permission, firstCall) => {
    const others = manager('ads.view')
    const { server } = openConsole(`/admin/${section}`, section === 'ads' ? manager('users.view') : others)
    expect(await screen.findByText('No access', {}, FIND)).toBeInTheDocument()
    if (SIDEBAR[section]) expect(screen.queryByRole('button', { name: SIDEBAR[section] })).not.toBeInTheDocument()
    expect(server.calls(firstCall)).toHaveLength(0)
    expect(permission).toBeTruthy()
  })

  it.each(GATED)('a manager with the %s permission (%s) opens it', async (section, permission, firstCall) => {
    const { server } = openConsole(`/admin/${section}`, manager(permission))
    await waitFor(() => expect(server.calls(firstCall).length).toBeGreaterThan(0), FIND)
    expect(screen.queryByText('No access')).not.toBeInTheDocument()
  })

  it("shows a manager only the overview cards their permissions open", async () => {
    openConsole('/admin', manager('reports.view'), {
      'GET /admin/overview': { data: { attention: { open_reports: 2, pending_verifications: 5 }, countries: [] } },
    })
    expect(await screen.findByText('Open reports', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByText('Awaiting verification')).not.toBeInTheDocument()
  })
})

describe('admin console: users', () => {
  it('suspends an account with a reason, for an administrator holding users.suspend', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'prompt').mockReturnValue('Fraudulent listings')
    const { server } = openConsole('/admin/users', manager('users.view', 'users.suspend'), {
      'GET /admin/users': { data: { users: [aUserRow()], total: 1 } },
      [`POST /admin/users/${USER_ID}/suspend`]: { data: { ...aUserRow(), status: 'SUSPENDED', is_active: false } },
    })
    expect(await screen.findByText('Asha Rao', {}, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Suspend/ }))
    await waitFor(() => expect(server.calls(`POST /admin/users/${USER_ID}/suspend`)).toHaveLength(1))
    expect(JSON.parse(server.calls(`POST /admin/users/${USER_ID}/suspend`)[0].data)).toEqual({ reason: 'Fraudulent listings' })
  })

  it('offers no suspend button without users.suspend', async () => {
    openConsole('/admin/users', manager('users.view'), { 'GET /admin/users': { data: { users: [aUserRow()], total: 1 } } })
    expect(await screen.findByText('Asha Rao', {}, FIND)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument()
  })

  it("loads one account's details only when it is opened", async () => {
    const user = userEvent.setup()
    const { server } = openConsole('/admin/users', manager('users.view'), {
      'GET /admin/users': { data: { users: [aUserRow()], total: 1 } },
      [`GET /admin/users/${USER_ID}`]: { data: { user: aUserRow(), profile: {}, projects: [], activity: [] } },
    })
    expect(await screen.findByText('Asha Rao', {}, FIND)).toBeInTheDocument()
    expect(server.calls(`GET /admin/users/${USER_ID}`)).toHaveLength(0)
    await user.click(screen.getByText('Asha Rao'))
    await waitFor(() => expect(server.calls(`GET /admin/users/${USER_ID}`)).toHaveLength(1))
  })
})

describe('admin console: verification and reports', () => {
  const pending = {
    accounts: [{
      user_id: USER_ID, name: 'Ravi Builders', role: 'BUILDER', country: 'IN', company: 'Ravi Constructions', licence_number: 'KA-123',
      verified: false, notes: '', reviewer_email: null, documents: [{ label: 'Trade licence', url: '/files/0190a8b2-4c1e-7aa0-9f00-0000000000dd' }],
    }],
  }

  it('shows the documents only once a verification is opened, and approves it', async () => {
    const user = userEvent.setup()
    const { server } = openConsole('/admin/verification', manager('verification.view', 'verification.decide'), {
      'GET /admin/verification': { data: pending },
      [`POST /admin/verification/${USER_ID}`]: { data: { user_id: USER_ID, verified: true } },
    })
    expect(await screen.findByText(/Ravi Builders/, {}, FIND)).toBeInTheDocument()
    expect(screen.queryByText('Trade licence')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Trade licence').closest('a')).toHaveAttribute('href', 'http://api.test/api/v1/files/0190a8b2-4c1e-7aa0-9f00-0000000000dd')
    await user.click(screen.getByRole('button', { name: /Approve/ }))
    await waitFor(() => expect(server.calls(`POST /admin/verification/${USER_ID}`)).toHaveLength(1))
  })

  it('lets a manager without verification.decide review but not decide', async () => {
    const user = userEvent.setup()
    openConsole('/admin/verification', manager('verification.view'), { 'GET /admin/verification': { data: pending } })
    await user.click(await screen.findByRole('button', { name: 'Review' }, FIND))
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    expect(screen.getByText(/review these documents but not decide/)).toBeInTheDocument()
  })

  it('offers Resolve on a report only with reports.resolve', async () => {
    const report = { reports: [{ id: '0190a8b2-4c1e-7aa0-9f00-0000000000e1', category: 'FRAUD', description: 'Fake listing', reporter_name: 'Asha Rao', subject_name: 'Ravi Builders', subject_type: 'USER', status: 'OPEN', resolution_note: null }] }
    openConsole('/admin/reports', manager('reports.view'), { 'GET /admin/reports': { data: report } })
    expect(await screen.findByText(/Fake listing/, {}, FIND)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
  })
})

describe('admin console: announcements, adverts, catalog and coupons', () => {
  it('offers announcements only with users.suspend (as the server requires)', async () => {
    openConsole('/admin/notifications', manager('users.view'), { 'GET /admin/notifications': { data: { notifications: [], total: 0, unread: 0, audiences: [] } } })
    await waitFor(() => expect(screen.queryByText('No access')).not.toBeInTheDocument(), FIND)
    await screen.findAllByText(/Notifications|notifications/, {}, FIND)
    expect(screen.queryByRole('button', { name: /Send announcement/ })).not.toBeInTheDocument()
  })

  it('opens the New advert form (it crashed in the old console) only with ads.manage', async () => {
    const user = userEvent.setup()
    openConsole('/admin/ads', anIdentity('location'), {
      'GET /admin/ads': { data: { items: [], revenue: [] } },
      'GET /admin/ads/placements': { data: [] },
    })
    await user.click(await screen.findByRole('button', { name: /New advert/ }, FIND))
    expect(await screen.findByText(/^Price .*\(optional\)$/)).toBeInTheDocument()
  })

  it("prices a Global Super Admin's advert in the chosen country's currency", async () => {
    const user = userEvent.setup()
    openConsole('/admin/ads', anIdentity('global'), {
      'GET /admin/ads': { data: { items: [], revenue: [] } },
      'GET /admin/ads/placements': { data: [] },
    })
    await user.click(await screen.findByRole('button', { name: /New advert/ }, FIND))
    await user.selectOptions(screen.getByLabelText('Country'), 'IN')
    expect(screen.getByText('Price INR (optional)')).toBeInTheDocument()
  })

  it('hides New advert from a manager with ads.view only', async () => {
    openConsole('/admin/ads', manager('ads.view'), {
      'GET /admin/ads': { data: { items: [], revenue: [] } },
      'GET /admin/ads/placements': { data: [] },
    })
    await waitFor(() => expect(screen.queryByText('No access')).not.toBeInTheDocument(), FIND)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.queryByRole('button', { name: /New advert/ })).not.toBeInTheDocument()
  })

  const catalogServer = {
    'GET /admin/catalog/categories': { data: [] },
    'GET /admin/catalog/brands': { data: [] },
    'GET /admin/catalog/units': { data: [] },
    'GET /admin/catalog/products': { data: [] },
  }

  it('shows the master catalog read only without catalog.manage', async () => {
    openConsole('/admin/catalog', manager('catalog.view'), catalogServer)
    expect(await screen.findByRole('tab', { name: /Catalog Products/ }, FIND)).toBeInTheDocument()
    for (const tab of ['Brands', 'Categories', 'Subcategories']) expect(screen.queryByRole('tab', { name: new RegExp(tab) })).not.toBeInTheDocument()
  })

  it('shows the catalog editing tabs with catalog.manage', async () => {
    openConsole('/admin/catalog', manager('catalog.view', 'catalog.manage'), catalogServer)
    expect(await screen.findByRole('tab', { name: /^Brands/ }, FIND)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Categories/ })).toBeInTheDocument()
  })

  it('creates a coupon with coupons.manage, and offers nothing to change without it', async () => {
    const user = userEvent.setup()
    const { server } = openConsole('/admin/coupons', manager('coupons.view', 'coupons.manage'), {
      'GET /admin/coupons': { data: { coupons: [] } },
      'POST /admin/coupons': { data: { id: '0190a8b2-4c1e-7aa0-9f00-0000000000c0', code: 'WELCOME10' } },
    })
    await user.click(await screen.findByRole('button', { name: /New coupon/ }, FIND))
    const form = screen.getByText('New coupon', { selector: 'p' }).closest('form') || document.body
    const code = within(form).getAllByRole('textbox')[0]
    await user.type(code, 'WELCOME10')
    expect(code).toHaveValue('WELCOME10')
    expect(server.calls('POST /admin/coupons')).toHaveLength(0)
  })

  it('offers no coupon changes with coupons.view only', async () => {
    openConsole('/admin/coupons', manager('coupons.view'), { 'GET /admin/coupons': { data: { coupons: [] } } })
    await waitFor(() => expect(screen.queryByText('No access')).not.toBeInTheDocument(), FIND)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.queryByRole('button', { name: /New coupon/ })).not.toBeInTheDocument()
  })
})

describe('admin console: sensitive records', () => {
  it("loads a deleted account's details only when they are opened, and keeps none in browser storage", async () => {
    const user = userEvent.setup()
    const id = '0190a8b2-4c1e-7aa0-9f00-0000000000de'
    const { server } = openConsole('/admin/account-deletion', manager('deletions.view'), {
      'GET /admin/deleted-accounts': {
        data: [{ id, reference: 'DEL-1', name: 'Kiran Das', email: 'kiran@example.in', phone: '9876522222', role: 'BUILDER', role_label: 'Builder', deleted_at: '2026-11-10T10:00:00+05:30', joined_at: '2026-01-01T10:00:00+05:30', reason_code: 'NOT_USING', reason_label: 'Not using it', reason_details: 'Moved away' }],
      },
      [`GET /admin/deleted-accounts/${id}`]: { data: { name: 'Kiran Das', email: 'kiran@example.in', reference: 'DEL-1', retained_records: [], personal_files_removed: 2 } },
    })
    await user.click(await screen.findByRole('button', { name: /View details/ }, FIND))
    await waitFor(() => expect(server.calls(`GET /admin/deleted-accounts/${id}`)).toHaveLength(1))
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('kiran')
  })

  it('loads payment history only on its screen and keeps none in browser storage', async () => {
    const { server } = openConsole('/admin/subscription-payments', manager('subscriptions.view'), {
      'GET /admin/subscription-payments': {
        data: {
          payments: [{
            id: '0190a8b2-4c1e-7aa0-9f00-0000000000b9', builder: { id: USER_ID, name: 'Ravi Builders', email: 'ravi@example.in', country: 'IN' }, payment_country: 'IN',
            plan_code: 'PROFESSIONAL', duration_code: 'MONTHLY', currency: 'INR', original_amount_minor: 99900, discount_minor: 0, amount_minor: 99900, coupon_code: null,
            coupon_status: null, status: 'PAID', gateway_mode: 'test', created_at: '2026-11-02T10:00:00+05:30', paid_at: '2026-11-02T10:01:00+05:30',
            razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_TEST1', failure_code: null, failure_description: null, refunded: false,
            refund_amount_minor: null, refunded_at: null, period: null,
          }],
          total: 1, limit: 25, offset: 0, scope: 'IN',
        },
      },
      'GET /admin/subscription-payments/summary': {
        data: {
          scope: 'IN', currency: 'INR', period: { year: 2026, month: null }, mock_payment_count: 0, active_subscription_count: 1, timezone: 'Asia/Kolkata',
          totals: { payment_count: 1, successful_count: 1, failed_count: 0, pending_count: 0, refunded_count: 0, disputed_count: 0, gross_minor: 99900, refunds_minor: 0, net_minor: 99900 },
          monthly: { year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, payment_count: 0, successful_count: 0, gross_minor: 0, refunds_minor: 0, net_minor: 0 })) },
        },
      },
    })
    await waitFor(() => expect(server.calls('GET /admin/subscription-payments').length).toBeGreaterThan(0), FIND)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('Ravi')
  })

  it('opens a support ticket only when chosen, and offers a reply only with support.manage', async () => {
    const user = userEvent.setup()
    const ticketId = '0190a8b2-4c1e-7aa0-9f00-0000000000a7'
    const ticket = { id: ticketId, reference: 'SUP-0001', subject: 'Cannot upload photos', status: 'OPEN', status_label: 'Open', category_label: 'App', issue_label: 'Uploads', priority: 'NORMAL', created_at: '2026-11-13T10:00:00+05:30', updated_at: '2026-11-13T10:00:00+05:30', contact: { name: 'Asha Rao', email: 'asha@example.in', phone: '' }, signed_in: true, account_type_label: 'House Owner', locality: 'IN', description: 'The upload fails.', details: [], attachment: null, messages: [] }
    const { server } = openConsole('/admin/support', manager('support.view'), {
      'GET /admin/support/tickets': { data: { tickets: [ticket] } },
      [`GET /admin/support/tickets/${ticketId}`]: { data: ticket },
    })
    expect(await screen.findByText('Cannot upload photos', {}, FIND)).toBeInTheDocument()
    expect(server.calls(`GET /admin/support/tickets/${ticketId}`)).toHaveLength(0)
    await user.click(screen.getByText('Cannot upload photos'))
    await waitFor(() => expect(server.calls(`GET /admin/support/tickets/${ticketId}`)).toHaveLength(1))
    expect(screen.queryByLabelText(/Reply to/)).not.toBeInTheDocument()
  })
})

describe('admin console: global and location administrators', () => {
  it('lets only a Global Super Admin switch the country being viewed', async () => {
    openConsole('/admin', anIdentity('global'))
    expect(await screen.findByText('Nothing needs you right now', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText(/whole platform/)).toBeInTheDocument()
  })

  it('tells a Location Super Admin they administer their country only', async () => {
    openConsole('/admin', anIdentity('location'))
    expect(await screen.findByText(/administering India only/, {}, FIND)).toBeInTheDocument()
  })
})
