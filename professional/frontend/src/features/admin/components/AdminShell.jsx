/**
 * The admin console's frame: a fixed left sidebar grouped by kind of work, and a top bar
 * with the page title and breadcrumb on the left and the usual controls on the right.
 *
 * Layout only. The sections, their permissions, the routes, the controls on the right
 * (search, weather, language, notifications, the administrator's menu) and what each one
 * does are the ones the console already had; they are handed in, never decided here. A
 * section the administrator may not open is simply not in `groups`, as before.
 *
 * The sidebar collapses to icons on a wide screen (remembered in this browser only) and
 * is a slide-in drawer on a narrow one. Up / Down / Home / End move between its items.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronsLeft, ChevronsRight, Menu, X } from 'lucide-react'
import { Brand } from '../../public-site/components/landing/shared.jsx'
import { DashboardTopbar } from '../../../shared/dashboard/DashboardShell.jsx'
import { useLiveEventsConnection, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'

const COLLAPSED_KEY = 'crewnbuild_admin_sidebar_collapsed'

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function SidebarItem({ item, active, collapsed, badge, onSelect, onKeyDown }) {
  const badgeId = badge ? `admin-nav-badge-${item.id}` : undefined
  return (
    <li>
      <button
        type="button"
        data-admin-nav-item
        onClick={() => onSelect(item.id)}
        onKeyDown={onKeyDown}
        aria-current={active ? 'page' : undefined}
        aria-describedby={badgeId}
        title={collapsed ? item.label : undefined}
        className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-oc-amber focus-visible:ring-offset-2 focus-visible:ring-offset-oc-deep ${
          collapsed ? 'justify-center px-0' : ''
        } ${active ? 'bg-oc-amber text-oc-deep' : 'text-white/85 hover:bg-white/10 hover:text-white'}`}
      >
        <item.icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-oc-deep' : 'text-white/75 group-hover:text-white'}`} aria-hidden="true" />
        {/* The label stays in the accessible name even when only the icon shows. */}
        <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
        {badge > 0 && (
          <span
            aria-hidden="true"
            className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums ${
              active ? 'bg-oc-deep text-white' : 'bg-oc-amber text-oc-deep'
            } ${collapsed ? 'absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[10px]' : ''}`}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      {/* What a screen reader hears as the item's description; outside the
          button so the item's name stays its label alone. */}
      {badge > 0 && <span id={badgeId} className="sr-only">{badge} waiting</span>}
    </li>
  )
}

function Sidebar({ groups, activeId, badges, collapsed, onSelect, onToggleCollapsed, onClose, mobile }) {
  const listRef = useRef(null)
  // Up / Down / Home / End between the items, Tab still leaves the sidebar.
  const moveFocus = useCallback((event) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const items = [...(listRef.current?.querySelectorAll('[data-admin-nav-item]') || [])]
    const at = items.indexOf(event.currentTarget)
    if (at < 0 || !items.length) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }, [])

  return (
    <div className="flex h-full flex-col bg-oc-deep text-white">
      <div className={`flex h-14 shrink-0 items-center border-b border-white/10 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
        {/* The landing logo on its white pill, so it reads on the dark green. */}
        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5">
          <Brand logoOnly small />
        </span>
        {mobile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-white/85 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-oc-amber"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav aria-label="Admin sections" className="min-h-0 flex-1 overflow-y-auto px-3 py-3" ref={listRef}>
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`admin-nav-group-${group.id}`} className="mb-4 last:mb-0" data-testid={`admin-nav-group-${group.id}`}>
            <h2
              id={`admin-nav-group-${group.id}`}
              className={collapsed ? 'sr-only' : 'mb-1 px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/70'}
            >
              {group.label}
            </h2>
            {collapsed && <div className="mx-auto mb-1 h-px w-6 bg-white/15" aria-hidden="true" />}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarItem
                  key={item.id}
                  item={item}
                  active={activeId === item.id}
                  collapsed={collapsed}
                  badge={badges?.[item.id] || 0}
                  onSelect={onSelect}
                  onKeyDown={moveFocus}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
      {!mobile && (
        <div className="shrink-0 border-t border-white/10 p-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold text-white/80 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-oc-amber ${collapsed ? 'justify-center px-0' : ''}`}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </div>
      )}
    </div>
  )
}

/** Admin › Group › Page, then the page title. */
function TitleBlock({ title, trail, onMenu }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-oc-deep outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-oc-deep lg:hidden dark:text-white dark:hover:bg-white/10"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="hidden sm:block">
          <ol className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {trail.map((crumb, index) => (
              <li key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1">
                {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />}
                <span className="truncate" aria-current={index === trail.length - 1 ? 'page' : undefined}>{crumb}</span>
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="truncate font-display text-[17px] font-bold leading-tight text-oc-ink dark:text-white">{title}</h1>
      </div>
    </div>
  )
}

export default function AdminShell({
  groups,
  activeId,
  onNav,
  badges = {},
  title,
  trail = [],
  user,
  roleLabel,
  onLogout,
  userMenu = [],
  onUserMenuSelect,
  beforeLanguage = null,
  onNotificationsClick = null,
  headerActions = null,
  children,
}) {
  // The same live-events connection every dashboard frame opens, as before.
  useLiveEventsConnection()
  useLiveRefresh(() => window.dispatchEvent(new Event('crewnbuild_notifications_refresh')))

  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, current ? '0' : '1')
      } catch {
        // Not remembered; the sidebar still collapses.
      }
      return !current
    })
  }
  const select = (id) => {
    setDrawerOpen(false)
    onNav(id)
  }

  // The drawer closes on Escape.
  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const sidebarProps = { groups, activeId, badges, onSelect: select }

  return (
    // `dash-canvas` is the scope the app's dark mode remaps its light surfaces in
    // (index.css), as on every dashboard; without it the console would stay light.
    <div className="admin-console dash-canvas min-h-screen bg-[#F3F4F6] text-oc-ink">
      {/* Wide screens: the fixed sidebar. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-oc-deep lg:block ${collapsed ? 'w-[76px]' : 'w-64'} transition-[width] duration-200`}
        data-testid="admin-sidebar"
      >
        <Sidebar {...sidebarProps} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      {/* Narrow screens: the same sidebar as a drawer. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[120] lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            <Sidebar {...sidebarProps} collapsed={false} mobile onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className={`flex min-h-screen flex-col ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'} transition-[padding] duration-200`}>
        <DashboardTopbar
          user={user}
          roleLabel={roleLabel}
          onLogout={onLogout}
          userMenu={userMenu}
          onUserMenuSelect={onUserMenuSelect}
          beforeLanguage={beforeLanguage}
          onNotificationsClick={onNotificationsClick}
          headerActions={headerActions}
          activeId={activeId}
          searchValue=""
          onSearchChange={() => {}}
          leading={<TitleBlock title={title} trail={trail} onMenu={() => setDrawerOpen(true)} />}
        />
        <main className="dashboard-main mx-auto w-full max-w-[1400px] flex-1 space-y-4 px-4 py-5 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}
