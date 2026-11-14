import { Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSelector } from 'react-redux'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, ChevronDown, LogOut, MessageSquare, Moon, Search, Sun } from 'lucide-react'
import { Brand } from '../../features/public-site/components/landing/shared.jsx'
import LanguageSelector from '../ui/LanguageSelector.jsx'
import { useTheme } from '../../theme/ThemeContext.jsx'
import ActivityBell from '../../features/notifications/components/ActivityBell.jsx'
import NotificationBell from '../../features/notifications/components/NotificationBell.jsx'
import AdSlot from '../ui/AdSlot.jsx'
import { profileCompletionPercent } from '../../features/accounts/components/ProfileCompletionMeter.jsx'
import { SmartImage } from '../ui/ui.jsx'
import { avatarFromPath } from '../ui/avatars.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import { useLiveEventsConnection, useLiveRefresh } from '../hooks/useLiveRefresh.js'

/*
 * NavIcon -- the glyph tile every dashboard navigation item shows.
 *
 * One treatment, two states, no per-item colour: the strip stays a single
 * green surface and the icons read as one family rather than a row of
 * separate badges.
 *
 *   inactive   translucent tile, soft brand-green glyph (ocbrand-300)
 *   active     deep-green tile and glyph, on the amber pill
 *
 * Neither state uses a solid white tile. The selected item is already marked
 * by the amber pill behind it and by its deep-green label; a white block on
 * top of that only punched a hole in the strip.
 *
 * The h-7 w-7 footprint and the button's gap are exactly what the previous
 * tile occupied, so nothing in the strip reflows. Flat by design: no
 * extrusion, no gradient, no light sweep, no tilt -- the button already
 * carries the hover lift, and a navigation bar is not where depth belongs.
 */
function NavIcon({ icon: Icon, active }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-200 ${
        active
          ? 'bg-oc-deep/12 text-oc-deep ring-1 ring-oc-deep/20'
          : 'bg-white/10 text-ocbrand-300 ring-1 ring-white/15 group-hover:bg-white/20 group-hover:text-oc-mint'
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </span>
  )
}

function SidebarNavItem({ item, active, collapsed, onClick, onHover, onHoverEnd }) {
  const Icon = item.icon
  const badgeCount = Number(item.badge || 0)
  return (
    <button
      onClick={onClick}
      onMouseEnter={(event) => onHover(item.label, event.currentTarget)}
      onMouseLeave={onHoverEnd}
      onFocus={(event) => onHover(item.label, event.currentTarget)}
      onBlur={onHoverEnd}
      className={`group relative flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-14px_rgba(15,23,42,0.4)] ${
        collapsed ? 'justify-center' : ''
      } ${
        active
          // The landing page's amber, so the selected item carries the brand
          // accent against the deep green strip instead of a second green.
          ? 'dash-nav-amber bg-[linear-gradient(180deg,#f9c85f_0%,#f4b740_52%,#e9a92f_100%)] text-oc-deep shadow-[0_10px_22px_-12px_rgba(0,0,0,0.55)] ring-1 ring-[rgba(8,62,43,.18)]'
          // Light on the dark strip. Hovering lifts it with a translucent white
          // wash rather than a colour of its own, so the bar stays green.
          : 'text-white/80 hover:bg-white/10 hover:text-white'
      }`}
    >
      {/* `bareIcon` (opt-in per item): the icon on its own, a little larger,
          light mint on the green strip and dark on the amber pill. Items
          without it keep the boxed icon unchanged. */}
      {Icon && (item.bareIcon
        ? <Icon aria-hidden="true" className={`h-5 w-5 shrink-0 transition-colors duration-200 ${active ? 'text-oc-deep' : 'text-[#c4ead4] group-hover:text-white'}`} strokeWidth={1.8} />
        : <NavIcon icon={Icon} active={active} />)}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {item.hasDot && (
        <span className={`h-2 w-2 shrink-0 rounded-full bg-oc-amber shadow-[0_0_0_4px_rgba(46,125,85,0.2)] ${collapsed ? 'absolute right-2.5 top-2' : 'ml-auto'}`} />
      )}
      {!item.hasDot && badgeCount > 0 && (
        <span className={`grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[9px] font-extrabold leading-none ${
          active ? 'bg-oc-deep text-oc-amber' : 'bg-oc-sunken text-oc-muted'
        } ${collapsed ? 'absolute right-2 top-2' : 'ml-auto'}`}>
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </button>
  )
}

// The dashboard navigation. Horizontal: the items run left to right in a
// single row that scrolls sideways when they outgrow the width, so it never
// becomes a vertical list, a dropdown or a hamburger at any breakpoint.
//
// Logo, the WORKSPACE caption, the Logout button and the collapse toggle all
// used to live here while this was a vertical rail. The logo now sits in the
// topbar's left corner, logout is the one the topbar avatar menu already had,
// and the collapse toggle is gone -- so `collapsed` is never set and the items
// always render with their labels.
export function DashboardSidebar({ items, activeId, onNav, collapsed }) {
  const [tooltip, setTooltip] = useState(null)

  const showTooltip = (label, element) => {
    if (collapsed) {
      const rect = element.getBoundingClientRect()
      setTooltip({ label, x: rect.right + 10, y: rect.top + rect.height / 2 })
    }
  }
  const hideTooltip = () => setTooltip(null)

  return (
    <div className="flex items-center gap-2">
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.map((item) => (
          <SidebarNavItem
            key={item.id}
            item={item}
            active={item.id === activeId}
            collapsed={collapsed}
            onClick={() => onNav(item.id)}
            onHover={showTooltip}
            onHoverEnd={hideTooltip}
          />
        ))}
      </nav>

      <AnimatePresence>
        {collapsed && tooltip && (
          <motion.span
            key={tooltip.label}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="pointer-events-none fixed z-[120] whitespace-nowrap rounded-lg bg-oc-night px-2.5 py-1.5 text-xs font-bold text-white shadow-xl"
            style={{ left: tooltip.x, top: tooltip.y, y: '-50%' }}
          >
            {tooltip.label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

// Which advert placement each console counts as. Administrators are absent on
// purpose: the person placing an advert should not then be shown it, and the
// admin console is not an audience anyone is buying.
const AD_PLACEMENT_BY_ROLE = {
  OWNER: 'owner_dashboard',
  CONTRACTOR: 'contractor_dashboard',
  BUILDER: 'contractor_dashboard',
  SUPPLIER: 'supplier_dashboard',
  ENGINEER: 'engineer_dashboard',
}

// export function DashboardTopbar({ searchValue, onSearchChange, searchPlaceholder, user, roleLabel, userMenu = [], onUserMenuSelect, onLogout, onMessagesClick, unreadMessageCount = 0, activeId, defaultTab = 'dashboard', activityItems = null, onProfileImageUpload, projectSwitcher = null, headerActions = null, onNotificationsClick = null }) {
// export function DashboardTopbar({ searchValue, onSearchChange, searchPlaceholder, user, roleLabel, userMenu = [], onUserMenuSelect, onLogout, onMessagesClick, unreadMessageCount = 0, activeId, defaultTab = 'dashboard', activityItems = null, onProfileImageUpload, projectSwitcher = null, headerActions = null, showPartnerCta = false }) {
export function DashboardTopbar({ searchValue, onSearchChange, searchPlaceholder, showSearch = true, user, roleLabel, userMenu = [], onUserMenuSelect, onLogout, onMessagesClick, unreadMessageCount = 0, activeId, defaultTab = 'dashboard', activityItems = null, onProfileImageUpload, projectSwitcher = null, headerActions = null, onNotificationsClick = null, beforeLanguage = null }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { t, td } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  // Logout lives inside this menu, so a dashboard that passes only `onLogout`
  // still needs the menu to open. Counting the items alone left the admin console
  // with an avatar that did nothing and no way to sign out.
  const hasUserMenu = userMenu.length > 0 || Boolean(onLogout)
  // Whether to nudge the user toward finishing their profile. Read from the
  // same value the completion ring used, which the API computes - so it moves
  // on its own the moment the profile is saved, and is never stored here.
  const authUser = useSelector((state) => state.auth.user)
  const completionPercent = profileCompletionPercent(authUser)
  const profileIncomplete = completionPercent !== null && completionPercent < 100
  // Light and dark, in the same row shape as Profile Settings and Help Center.
  // Declared once and placed by the menu below so every dashboard that renders
  // this topbar gets exactly one of it. The theme itself is untouched: this
  // calls the same useTheme().toggleTheme the bar button used to call, so the
  // preference still lives in ThemeContext and its existing localStorage key.
  //
  // The menu deliberately stays open: this is a toggle, and closing it would
  // hide the result of the very thing that was just pressed.
  const themeMenuItem = (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={isDark}
      onClick={toggleTheme}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold text-oc-ink dash-gold-hover hover:text-oc-deep"
    >
      {isDark ? <Sun className="h-4 w-4 shrink-0 text-oc-green" /> : <Moon className="h-4 w-4 shrink-0 text-oc-green" />}
      {isDark ? t('ui.shared.lightMode') : t('ui.shared.darkMode')}
    </button>
  )
  return (
    // White, like the landing page's top bar, with a hairline above the
    // green navigation. Structure, contents and dimensions are untouched.
    <header
      className="sticky top-0 z-30 bg-white shadow-[inset_0_-1px_0_rgba(8,62,43,.12)]"
    >
      {/* On phones the language, bell, messages and avatar leave search no
          width at all (it was crushed under the language pill at 320px), so
          search takes a full-width second row there. Wider screens keep the
          single 56px row exactly as before. */}
      <div className="flex h-14 items-center gap-3 px-4 sm:px-5 max-sm:h-auto max-sm:min-h-14 max-sm:flex-wrap max-sm:gap-y-2 max-sm:py-2">
        {/* The same Logo component the sidebar rail used to render, with the
            same props it had when expanded, so the wordmark and the tagline
            both come from the existing component and its existing translation
            key. Hidden below `sm`, where the row has no width to spare once
            search and the account controls have taken theirs. */}
        <div className="hidden shrink-0 -ms-2 sm:block">
          {/* The landing page's logo and wordmark, straight on the white bar
              as on the landing header. In dark mode the bar turns dark, so the
              wordmark gets the landing's white pill to stay readable. */}
          <span className="inline-flex items-center rounded-full dark:bg-[#fff] dark:py-[5px] dark:ps-[10px] dark:pe-[14px]">
            <Brand logoOnly small />
          </span>
        </div>
        {/* Takes the space left over rather than claiming it: flex-1 with a
            zero basis means search is the first thing to give way, so the
            profile keeps room for the full name and role. */}
        {/* A page that carries its own search (e.g. the owner's Projects row)
            hides this one, so there is only one search box on screen. */}
        {showSearch && (
        <div className="relative min-w-0 flex-1 max-w-[320px] sm:min-w-[10rem] max-sm:order-last max-sm:max-w-none max-sm:basis-full">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-oc-deep/55" />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder || t('ui.searchPlaceholder')}
            // Bordered pill on the white bar. Same height, same radius.
            className="h-9 w-full rounded-full border border-[rgba(8,62,43,.18)] bg-white/50 pl-10 pr-4 text-[13px] font-medium text-oc-ink outline-none transition placeholder:text-oc-deep/55 focus:border-oc-deep/30 focus:bg-white focus:ring-4 focus:ring-white/40"
          />
        </div>
        )}
        {headerActions}
        {projectSwitcher}
        {/* Shrinkable so that, when the bar is crowded (tablets, long names, the
            Site Engineer's Live Camera button), the account name truncates
            instead of the group running off the right edge of the screen. */}
        <div className="ml-auto flex min-w-0 items-center gap-2.5 sm:gap-3">
          {/* Optional control placed just left of the language selector (the
              Site Engineer's Live Camera button). Absent on every other console. */}
          {beforeLanguage}
          <LanguageSelector compact variant="light" />
          <NotificationBell onOpen={onNotificationsClick} />
          {/* Shown only where messages go somewhere. The admin console has no
              conversations of its own — messaging is between an owner and a
              builder, not with the platform — and without a handler this was a
              button that could be clicked and did nothing at all. */}
          {onMessagesClick && (
            <button
              onClick={() => activeId === 'messages' ? onMessagesClick(defaultTab) : onMessagesClick('messages')}
              className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand-700 shadow-sm ring-1 ring-black/5"
              aria-label={t('ui.messages')}
            >
              <MessageSquare className="h-4 w-4" />
              {unreadMessageCount > 0 && (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                  {unreadMessageCount > 9 ? '9+' : unreadMessageCount}
                </span>
              )}
            </button>
          )}
          {activityItems !== null && <ActivityBell items={activityItems} />}
          {/* Light and dark now sits in the account menu below, beside Profile
              Settings, Help Center and Logout, so every dashboard offers it in
              the one place people look for account settings. It is deliberately
              not also on the bar: one setting in two places reads as two. */}
          <div className="relative flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => hasUserMenu && setUserMenuOpen((currentValue) => !currentValue)}
              aria-haspopup={hasUserMenu ? 'menu' : undefined}
              aria-expanded={userMenuOpen}
              className={`flex min-w-0 items-center gap-2 rounded-full bg-white py-0.5 pl-0.5 pr-2 ring-1 ring-slate-200 transition ${hasUserMenu ? 'hover:-translate-y-0.5 hover:shadow-md' : ''}`}
            >
              {/* The person's own picture when they have uploaded one; the
                  local avatar for their role when they have not. `authUser` is
                  the signed-in account, so the role is the real one rather than
                  whatever display object a console happened to build. */}
              <SmartImage
                src={avatarFromPath(user.profileImageUrl, authUser?.role)}
                alt={td(user.name)}
                className="h-8 w-8 shrink-0 rounded-full object-cover object-top"
              />
              <span className="hidden min-w-0 text-left sm:block">
                <span className="flex min-w-0 items-center gap-1.5">
                  {/* The name this person entered for themselves. */}
                  <span className="max-w-[180px] truncate text-[13px] font-extrabold leading-tight text-oc-ink">{td(user.name) || t('ui.shared.user')}</span>
                  {/* Red while the profile is unfinished, green once it is
                      done. Only the red one pulses - a finished profile is a
                      state, not something asking to be acted on. */}
                  {completionPercent !== null && (
                    <span
                      title={profileIncomplete ? t('profile.completeCta') : t('profile.complete')}
                      aria-label={profileIncomplete ? t('profile.completeCta') : t('profile.complete')}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        profileIncomplete ? 'bg-rose-500 animate-pulse-dot' : 'bg-emerald-500'
                      }`}
                    />
                  )}
                </span>
                <span className="block max-w-[180px] truncate text-[10px] font-semibold leading-tight text-oc-muted">{roleLabel}</span>
              </span>
              {hasUserMenu && <ChevronDown className={`hidden h-3.5 w-3.5 text-oc-faint transition-transform sm:block ${userMenuOpen ? 'rotate-180' : ''}`} />}
            </button>
            {/* The percentage ring used to sit here. Completion is now shown as
                a dot beside the name and on Profile Settings, reading the same
                value the ring read. */}
            {onProfileImageUpload && (
              <label title={t('ui.updatePhoto')} aria-label={t('ui.updatePhoto')}              className="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-oc-line bg-white text-oc-muted dash-gold-hover hover:text-oc-deep">
                <Camera className="h-3.5 w-3.5" />
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onProfileImageUpload(file); event.target.value = '' }} />
              </label>
            )}

            {hasUserMenu && userMenuOpen && createPortal(
                // `dash-canvas` so the menu, which renders outside the shell's
                // subtree, still gets the dark-theme remaps its contents need.
                // `dash-canvas-overlay` so this full-screen backdrop stays
                // transparent: without it the dark rule paints it near-black
                // over the whole app, which is what blacked out the page when
                // dark mode was switched on from the menu inside it.
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="dash-canvas dash-canvas-overlay fixed inset-0 z-[140]"
                >
                  <div className="absolute inset-0" onClick={() => setUserMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-4 top-[70px] w-60 overflow-hidden rounded-xl border border-oc-line bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)] sm:right-6"
                  >
                    <div className="border-b border-oc-line px-4 py-3">
                      <p className="truncate text-sm font-extrabold text-oc-ink">{td(user.name) || t('ui.shared.user')}</p>
                      <p className="text-[11px] font-semibold text-oc-muted">{roleLabel}</p>
                    </div>
                    <div className="p-1.5">
                      {userMenu.map((item) => (
                        <Fragment key={item.id}>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setUserMenuOpen(false)
                              onUserMenuSelect?.(item.id)
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold text-oc-ink dash-gold-hover hover:text-oc-deep"
                          >
                            {item.icon && <item.icon className="h-4 w-4 shrink-0 text-oc-green" />}
                            {item.label}
                            {/* Mirrors the dot beside the name, so the row that
                                fixes it carries the same signal. */}
                            {completionPercent !== null && item.id === 'profileSettings' && (
                              <span
                                className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
                                  profileIncomplete ? 'bg-rose-500 animate-pulse-dot' : 'bg-emerald-500'
                                }`}
                              />
                            )}
                          </button>
                          {item.id === 'profileSettings' && themeMenuItem}
                        </Fragment>
                      ))}
                      {/* The admin console passes no userMenu at all, so without
                          this the row it is anchored to never renders and that
                          console would lose light and dark entirely. */}
                      {!userMenu.some((item) => item.id === 'profileSettings') && themeMenuItem}
                      {/* Logout closes the standard four-option menu every
                          dashboard shows. It calls the same handler the
                          sidebar's own logout button already uses. */}
                      {onLogout && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setUserMenuOpen(false)
                            onLogout()
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-bold text-oc-ink dash-gold-hover hover:text-oc-deep"
                        >
                          <LogOut className="h-4 w-4 shrink-0 text-oc-green" />
                          {t('ui.logout')}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>,
                document.body,
              )}
          </div>
        </div>
      </div>
    </header>
  )
}

/**
 * Where you are inside the dashboard: Dashboard / <section>.
 *
 * It starts at Dashboard, never at the public site's Home: a signed-in user is
 * inside the application, and a Home crumb would take them out of it.
 *
 * Every part of it comes from props the shell is already given — the role label
 * the dashboard passes, the same `sidebarItems` it builds its navigation from,
 * and the same `onNav` / `defaultTab` that navigation already uses. Nothing here
 * knows the name of a dashboard, a section or a route, so all four dashboards
 * get it without a single new definition and without any per-role branching.
 *
 * The section labels are the ones each dashboard already translated for its own
 * nav, so no copy is duplicated.
 *
 * The type styling is the one breadcrumb style this application already had —
 * the line on the builder profile page — so this introduces no new look.
 *
 * `trail` is for a dashboard whose location runs deeper than a single section:
 * a project opened as a page of its own, where the crumbs are
 * Projects / <that project> / <section inside it>. When it is given, those
 * crumbs stand in for the one section crumb; the Dashboard crumb before them,
 * the separators and the type are all still the ones above. Each entry is
 * { label, onClick? } — an entry with an onClick is a link, and the last entry
 * is always the current page.
 */
export function DashboardBreadcrumb({ items = [], activeId, onNav, defaultTab, trail = null }) {
  const { t } = useLanguage()
  // The first crumb names the place, not the person: every role's landing
  // screen is its dashboard, so it reads "Dashboard" rather than "House Owner"
  // or "Builder". The role is still shown in the topbar, where it identifies
  // the account. `ui.dashboard` is the key the nav already uses for it.
  const dashboardLabel = t('ui.dashboard')
  const current = items.find((item) => item.id === activeId)
  // Sections that are not in the nav (profile, settings, messages) simply have
  // no crumb of their own rather than inventing a label for themselves.
  const showSection = Boolean(current) && current.id !== defaultTab
  const linkClass = 'rounded transition-colors hover:text-oc-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocbrand-200'
  const trailCrumbs = (trail || []).filter(Boolean)

  return (
    <nav aria-label={t('ui.shared.breadcrumb')} className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-graphite/55">
      {trailCrumbs.length > 0 ? (
        <>
          <button type="button" onClick={() => onNav(defaultTab)} className={linkClass}>{dashboardLabel}</button>
          {trailCrumbs.map((crumb, index) => {
            const isLastCrumb = index === trailCrumbs.length - 1
            return (
              <Fragment key={`${crumb.label}-${index}`}>
                <span aria-hidden="true">/</span>
                {crumb.onClick && !isLastCrumb ? (
                  <button type="button" onClick={crumb.onClick} className={linkClass}>{crumb.label}</button>
                ) : (
                  <span className={isLastCrumb ? 'text-graphite' : undefined} aria-current={isLastCrumb ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                )}
              </Fragment>
            )
          })}
        </>
      ) : showSection ? (
        <>
          <button type="button" onClick={() => onNav(defaultTab)} className={linkClass}>{dashboardLabel}</button>
          <span aria-hidden="true">/</span>
          <span className="text-graphite" aria-current="page">{current.label}</span>
        </>
      ) : (
        <span className="text-graphite" aria-current="page">{dashboardLabel}</span>
      )}
    </nav>
  )
}

export default function DashboardShell({
  sidebarItems,
  activeId,
  onNav,
  user,
  roleLabel,
  onLogout,
  searchValue = '',
  onSearchChange = () => {},
  searchPlaceholder,
  // False hides the topbar search on a page that shows its own.
  showSearch = true,
  headerActions = null,
  // Optional control shown just left of the language selector.
  beforeLanguage = null,
  userMenu = [],
  onUserMenuSelect,
  onMessagesClick,
  // Given, the notification bell navigates instead of opening its dropdown.
  onNotificationsClick = null,
  unreadMessageCount = 0,
  defaultTab = 'dashboard',
  activityItems = null,
  onProfileImageUpload,
  projectSwitcher = null,
  breadcrumbTrail = null,
  // A page that stands on its own — one project, opened as its own page — hides
  // the strip so the only navigation offered is the breadcrumb back out of it.
  // Every other page leaves this alone and keeps the navigation it has always
  // had; the topbar and the breadcrumb are unaffected either way.
  showNav = true,
  // An optional small control pinned to the right end of the breadcrumb row
  // (e.g. a dashboard's page-level action). Null by default, so no dashboard
  // that does not pass it is affected.
  breadcrumbAction = null,
  // Drawn in place of the breadcrumb (not beside it) when given -- a page whose
  // breadcrumb would only name the page it is already on. Null by default.
  breadcrumbReplacement = null,
  // True drops the city scene behind the page and paints it a plain light
  // grey (#F3F4F6; dark mode keeps its own colour). Off by default, so
  // every other dashboard keeps its backdrop.
  plainBackground = false,
  // Opt-in wider page (1600px instead of 1400px) for a page that is a full
  // marketplace grid. Nav strip, breadcrumb and <main> widen together so they
  // stay aligned; every dashboard that does not pass it is unchanged.
  wide = false,
  // Shows the Talk to Partner call to action immediately left of the language
  // control. Opt-in and off by default, so the dashboards that do not ask for
  // it — Supplier and Engineer — keep exactly the header they have today.
  children,
}) {
  // Taken from the signed-in account, not from the `user` prop.
  //
  // That prop is a display object each console builds for the topbar — name,
  // initials, picture — and the owner console's carries no role at all, so the
  // lookup below quietly produced undefined and no advert ever rendered there.
  // Nothing failed and nothing was logged; the console simply had no slot. The
  // account in the store always has both fields, so no console can forget them.
  const adUser = useSelector((state) => state.auth.user)

  // The one live-events connection for whichever dashboard is open: a request,
  // answer, counter-offer or assignment made by someone else is announced here
  // and each panel reloads through its own existing loader. The notification
  // bell reloads through the refresh event it already listens for.
  useLiveEventsConnection()
  useLiveRefresh(() => window.dispatchEvent(new Event('crewnbuild_notifications_refresh')))

  // The section the console is showing is named too, so an advert can be placed
  // on "Owner dashboard - Projects" rather than the whole console. The section
  // is the id the console already uses for that page in its own navigation, so
  // there is no second list here to fall out of step with the nav. An advert
  // placed on the console as a whole still answers a section request, which is
  // what ticking the console means and what every advert placed before sections
  // existed says — so an unrecognised section is harmless rather than blank.
  const adConsole = AD_PLACEMENT_BY_ROLE[adUser?.role]
  const adPlacement = adConsole && activeId ? `${adConsole}:${activeId}` : adConsole

  const sidebarProps = { items: sidebarItems, activeId, onNav }
  const pageWidth = wide ? 'max-w-[1584px] px-4' : 'max-w-[1400px] px-4 sm:px-5'

  return (
    <div className={`dash-canvas min-h-screen dash-yellow-bg text-oc-ink ${plainBackground ? 'before:!bg-none !bg-[#F3F4F6] dark:!bg-[#0a1014]' : ''}`}>
      <div className="flex min-h-screen flex-col">
        <DashboardTopbar
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          searchPlaceholder={searchPlaceholder}
          showSearch={showSearch}
          headerActions={headerActions}
          beforeLanguage={beforeLanguage}
          user={user}
          roleLabel={roleLabel}
          userMenu={userMenu}
          onUserMenuSelect={onUserMenuSelect}
          onLogout={onLogout}
          onMessagesClick={onMessagesClick}
          onNotificationsClick={onNotificationsClick}
          unreadMessageCount={unreadMessageCount}
          activeId={activeId}
          defaultTab={defaultTab}
          activityItems={activityItems}
          onProfileImageUpload={onProfileImageUpload}
          projectSwitcher={projectSwitcher}
        />
        {/* The existing navigation, now a horizontal strip directly under the
            topbar instead of a fixed rail on the left. Same component, same
            `sidebarItems` each dashboard already builds, same activeId/onNav
            handlers, same collapse state -- only the position and the axis
            changed.

            Kept outside <main> on purpose: `.dashboard-main` in index.css
            scopes typography to its subtree (`.dashboard-main button` sets
            font-size and line-height), so rendering the nav inside it would
            restyle every nav button. The inner container repeats <main>'s own
            width and padding so the items line up with the content below. */}
        {showNav && (
          <div className="dash-nav-strip shrink-0 border-b border-oc-deep bg-oc-deep">
            {/* py-1 rather than py-2: the strip was 61px against the 56px
                header above it, so the secondary bar read as the taller of the
                two. Trimming only this wrapper's vertical padding takes it to
                53px without touching the buttons -- they keep their own size,
                and the padding stays symmetric so they stay centred. */}
            <div className={`mx-auto w-full py-1 ${pageWidth}`}>
              <DashboardSidebar {...sidebarProps} />
            </div>
          </div>
        )}
        {/* Kept outside <main> for the same reason the nav strip above is:
            `.dashboard-main` in index.css restyles every button inside it, and
            the breadcrumb's crumbs are buttons. The container repeats <main>'s
            own width and padding so it lines up with the content below. */}
        <div className={`mx-auto flex w-full shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 ${wide ? 'pt-2' : 'pt-3'} ${pageWidth}`}>
          {breadcrumbReplacement || (
            <DashboardBreadcrumb
              items={sidebarItems}
              activeId={activeId}
              onNav={onNav}
              defaultTab={defaultTab}
              trail={breadcrumbTrail}
            />
          )}
          {breadcrumbAction}
        </div>
        <main className={`dashboard-main mx-auto w-full flex-1 space-y-4 ${wide ? 'pb-4 pt-2' : 'py-4'} ${pageWidth}`}>
          {/* A banner above the console's own content, for an advert placed
              there. Most are placed above the footer instead, and this renders
              nothing at all for them. */}
          {adPlacement && (
            <AdSlot placement={adPlacement} position="top" country={adUser?.country_of_residence} />
          )}
          {children}
          {/* Below the page's own content, never above it: somebody opens their
              dashboard to see their projects, and an advert in front of that is
              an advert in the way. Renders nothing when none is running, and
              nothing at all in the admin console — an administrator placing an
              advert should not then be shown it. */}
          {adPlacement && (
            <AdSlot
              placement={adPlacement}
              position="footer"
              country={adUser?.country_of_residence}
              className="pt-2"
            />
          )}
        </main>
      </div>
    </div>
  )
}
