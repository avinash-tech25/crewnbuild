/**
 * The admin console's frame (AdminShell): the sidebar's groups and their order, sections
 * hidden without permission (and a group with nothing left hidden with them), the active
 * item, the badge counts from the dashboard's own queues, keyboard movement, the mobile
 * drawer, and the top bar's title and breadcrumb.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { adminServer, anAdminAccount, anIdentity } from './adminTestData.js'

const FIND = { timeout: 15000 }

const GROUPS = {
  overview: ['Dashboard'],
  people: ['Users', 'Administrators', 'Verification', 'Account Deletion'],
  activity: ['Projects', 'Leads', 'Reports', 'Support Tickets'],
  marketplace: ['Master Catalog', 'Adverts', 'Coupons', 'Subscription Payments'],
  system: ['Audit Log', 'Mobile number'],
}

function openConsole(path, identity, routes = {}) {
  const kind = identity.role === 'MANAGER' ? 'manager' : identity.is_global ? 'global' : 'location'
  const server = installFakeServer(adminServer(identity, routes))
  renderApp(path, { auth: signedInAs(anAdminAccount(kind)) })
  return server
}

const sidebar = () => within(screen.getByTestId('admin-sidebar'))
// Waits for the console to load the administrator, then the sidebar.
const loadedSidebar = async () => within(await screen.findByTestId('admin-sidebar', {}, FIND))
const itemsOf = (group) => within(screen.getByTestId(`admin-nav-group-${group}`)).getAllByRole('button').map((button) => button.textContent.replace(/\d+$/, '').trim())

afterEach(() => vi.restoreAllMocks())

describe('admin sidebar: groups', () => {
  it('groups every section a Super Admin may open, in order', async () => {
    openConsole('/admin', anIdentity('global'))
    await screen.findByText('Nothing needs your attention', {}, FIND)
    const headings = sidebar().getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Overview', 'People', 'Activity', 'Marketplace', 'System'])
    for (const [group, labels] of Object.entries(GROUPS)) expect(itemsOf(group)).toEqual(labels)
  })

  it('hides the sections a manager may not open, and a group left with none', async () => {
    openConsole('/admin', anIdentity('manager', ['users.view', 'coupons.view']))
    await screen.findByText('Nothing needs your attention', {}, FIND)
    expect(itemsOf('overview')).toEqual(['Dashboard'])
    expect(itemsOf('people')).toEqual(['Users'])
    expect(itemsOf('marketplace')).toEqual(['Coupons'])
    expect(itemsOf('system')).toEqual(['Mobile number'])
    // Nothing in Activity is open to this manager, so the group is not drawn.
    expect(screen.queryByTestId('admin-nav-group-activity')).not.toBeInTheDocument()
    for (const hidden of ['Administrators', 'Verification', 'Projects', 'Leads', 'Audit Log', 'Adverts']) {
      expect(sidebar().queryByRole('button', { name: hidden })).not.toBeInTheDocument()
    }
  })
})

describe('admin sidebar: state', () => {
  it('marks the open section, and names it in the title and breadcrumb', async () => {
    openConsole('/admin/coupons', anIdentity('global'), { 'GET /admin/coupons': { data: { coupons: [] } } })
    const coupons = await (await loadedSidebar()).findByRole('button', { name: 'Coupons' }, FIND)
    expect(coupons).toHaveAttribute('aria-current', 'page')
    expect(sidebar().getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { level: 1, name: 'Coupons' })).toBeInTheDocument()
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getAllByRole('listitem').map((item) => item.textContent)
    expect(crumbs).toEqual(['Admin', 'Marketplace', 'Coupons'])
  })

  it('shows the waiting counts from the dashboard queues beside their sections', async () => {
    openConsole('/admin', anIdentity('global'), {
      'GET /admin/overview': { data: { attention: { pending_verifications: 3, open_reports: 2, stalled_requests: 0, suspended_accounts: 5 }, countries: [] } },
    })
    const verification = await (await loadedSidebar()).findByRole('button', { name: 'Verification' }, FIND)
    await waitFor(() => expect(verification).toHaveAccessibleDescription('3 waiting'))
    expect(sidebar().getByRole('button', { name: 'Reports' })).toHaveAccessibleDescription('2 waiting')
    // No badge for an empty queue, nor for a total that is not a queue.
    expect(sidebar().getByRole('button', { name: 'Leads' })).not.toHaveAccessibleDescription()
    expect(sidebar().getByRole('button', { name: 'Users' })).not.toHaveAccessibleDescription()
  })

  it('moves between items with the arrow keys and opens one with Enter', async () => {
    const user = userEvent.setup()
    openConsole('/admin', anIdentity('global'), { 'GET /admin/users': { data: { users: [], total: 0 } } })
    const dashboard = await (await loadedSidebar()).findByRole('button', { name: 'Dashboard' }, FIND)
    dashboard.focus()
    await user.keyboard('{ArrowDown}')
    expect(sidebar().getByRole('button', { name: 'Users' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(sidebar().getByRole('button', { name: 'Mobile number' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(dashboard).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(location.current.pathname).toBe('/admin/users'))
  })

  it('opens the same sections in a drawer from the menu button, and closes it on Escape', async () => {
    const user = userEvent.setup()
    openConsole('/admin', anIdentity('global'))
    await user.click(await screen.findByRole('button', { name: 'Open menu' }, FIND))
    const drawer = screen.getByRole('dialog', { name: 'Admin menu' })
    expect(within(drawer).getByRole('button', { name: 'Support Tickets' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Admin menu' })).not.toBeInTheDocument()
  })

  it('collapses to icons and keeps every label as the accessible name', async () => {
    const user = userEvent.setup()
    openConsole('/admin', anIdentity('global'))
    await user.click(await (await loadedSidebar()).findByRole('button', { name: 'Collapse sidebar' }, FIND))
    expect(sidebar().getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
    for (const labels of Object.values(GROUPS)) {
      for (const label of labels) expect(sidebar().getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})

describe('admin dashboard: the KPI row', () => {
  it('shows the four queues and the two totals, accenting only what needs attention', async () => {
    openConsole('/admin', anIdentity('global'), {
      'GET /admin/overview': {
        data: {
          attention: { pending_verifications: 2, open_reports: 0, stalled_requests: 0, suspended_accounts: 1 },
          countries: [{ country: 'India', scope: 'IN', accounts: 40, projects: 7, open_reports: 0, administrators: 2 }],
        },
      },
    })
    expect(await screen.findByText('Needs your attention', {}, FIND)).toBeInTheDocument()
    for (const label of ['Awaiting verification', 'Open reports', 'Unanswered requests', 'Suspended accounts', 'Total accounts', 'Projects']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    const card = (label) => screen.getAllByText(label)[0].closest('button, div.relative')
    expect(card('Awaiting verification').className).toMatch(/border-amber/)
    expect(card('Open reports').className).not.toMatch(/border-amber/)
    expect(card('Suspended accounts').className).not.toMatch(/border-amber/)
    expect(card('Total accounts').textContent).toContain('40')
  })
})
