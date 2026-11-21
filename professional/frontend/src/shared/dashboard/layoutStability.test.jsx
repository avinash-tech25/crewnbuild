/**
 * Layout-stability guards for switching tabs and sections.
 *
 * Honest scope: jsdom does no layout, so nothing here measures a height, a width or a
 * shift on screen. What it can check, and what these tests pin down, are the structural
 * causes of a jump:
 *   - the tab bar / nav and the page container are the SAME DOM nodes, with the SAME
 *     className, before and after a switch (nothing is re-mounted or restyled);
 *   - the page container uses the one shared page width (`max-w-page`);
 *   - a loading area renders a skeleton (role="status") rather than nothing;
 *   - a count badge keeps its slot (invisible, aria-hidden) when the count is 0.
 * A real layout-shift measurement would need a browser (e.g. Playwright + CLS).
 */
import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Building2, LayoutGrid, Package } from 'lucide-react'
import AppProviders from '../../app/AppProviders.jsx'
import { createAppStore } from '../../app/store.js'
import { initialAuthState } from '../auth/authSlice.js'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { adminServer, anAdminAccount, anIdentity } from '../../features/admin/adminTestData.js'
import DashboardShell from './DashboardShell.jsx'

const FIND = { timeout: 15000 }

const ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'projects', label: 'Projects', icon: Building2, badge: 3 },
  { id: 'orders', label: 'Orders', icon: Package },
]

function Harness() {
  const [activeId, setActiveId] = useState('dashboard')
  return (
    <DashboardShell
      sidebarItems={ITEMS}
      activeId={activeId}
      onNav={setActiveId}
      user={{ name: 'Asha Rao' }}
      roleLabel="House Owner"
    >
      <p>Section: {activeId}</p>
    </DashboardShell>
  )
}

function renderShell() {
  installFakeServer({ 'GET /notifications': { data: [] }, 'GET /ads': { data: [] } })
  const store = createAppStore({ auth: { ...initialAuthState, ...signedInAs(anAccount()) } })
  return render(
    <AppProviders store={store}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </AppProviders>,
  )
}

describe('dashboard navigation', () => {
  it('names the section strip and marks only the active item aria-current="page"', async () => {
    const user = userEvent.setup()
    renderShell()
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' })
    const button = (name) => within(nav).getByRole('button', { name: new RegExp(`^${name}`) })
    expect(button('Dashboard')).toHaveAttribute('aria-current', 'page')
    expect(button('Projects')).not.toHaveAttribute('aria-current')

    await user.click(button('Projects'))
    expect(button('Projects')).toHaveAttribute('aria-current', 'page')
    expect(button('Dashboard')).not.toHaveAttribute('aria-current')
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('keeps the nav and the page container as the same nodes, unchanged, across a switch', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    const nav = screen.getByRole('navigation', { name: 'Dashboard sections' })
    const main = container.querySelector('main')
    const before = { nav: nav.className, main: main.className }
    // The one page width, not a per-screen pixel value.
    expect(main.className).toMatch(/\bmax-w-page\b/)
    expect(main.className).not.toMatch(/max-w-\[/)

    await user.click(within(nav).getByRole('button', { name: /^Orders/ }))
    expect(await screen.findByText('Section: orders')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Dashboard sections' })).toBe(nav)
    expect(container.querySelector('main')).toBe(main)
    expect(nav.className).toBe(before.nav)
    expect(main.className).toBe(before.main)
  })
})

describe('admin Master Catalog tabs', () => {
  // The product list never answers, so the products area stays in its loading state.
  const pending = () => new Promise(() => {})

  it('switches tabs without replacing the tab bar or the page, skeleton while loading, badge slots kept at 0', async () => {
    const user = userEvent.setup()
    installFakeServer(adminServer(anIdentity('global'), {
      'GET /admin/catalog/categories': { data: [] },
      'GET /admin/catalog/brands': { data: [] },
      'GET /admin/catalog/units': { data: [] },
      'GET /admin/catalog/products': pending,
    }))
    renderApp('/admin/catalog', { auth: signedInAs(anAdminAccount('global')) })

    const tablist = await screen.findByRole('tablist', { name: 'Master catalog sections' }, FIND)
    const main = tablist.closest('main')
    expect(main.className).toMatch(/\bmax-w-page\b/)

    // Loading products: a skeleton that holds the grid's place, not an empty area.
    await waitFor(() => expect(within(main).getByRole('status')).toHaveTextContent('Loading'), FIND)

    // Every tab has its count slot; at 0 it is there but invisible and hidden from AT.
    const brandsTab = within(tablist).getByRole('tab', { name: /^Brands/ })
    const brandsBadge = brandsTab.querySelector('span.tabular-nums')
    expect(brandsBadge).not.toBeNull()
    expect(brandsBadge).toHaveClass('invisible')
    expect(brandsBadge).toHaveAttribute('aria-hidden', 'true')

    const before = { tablist: tablist.className, main: main.className, badge: brandsBadge }
    await user.click(brandsTab)
    await waitFor(() => expect(within(tablist).getByRole('tab', { name: /^Brands/ })).toHaveAttribute('aria-selected', 'true'))

    expect(screen.getByRole('tablist', { name: 'Master catalog sections' })).toBe(tablist)
    expect(tablist.closest('main')).toBe(main)
    expect(tablist.className).toBe(before.tablist)
    expect(main.className).toBe(before.main)
    // The badge is the same node; only its colours follow the selected state.
    expect(within(tablist).getByRole('tab', { name: /^Brands/ }).querySelector('span.tabular-nums')).toBe(before.badge)
  })
})
