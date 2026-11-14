/**
 * CREWNBUILD Admin — shell and pages.
 *
 * Kept intentionally plain: an operations console is scanned and acted on, not
 * read, so it favours dense tables and clear status over decoration. It reuses
 * the existing `oc-` palette rather than introducing a second design system.
 *
 * Nothing here is a security control. The sidebar hides sections the signed-in
 * administrator has no permission for, and that is a convenience only — every
 * endpoint re-checks the caller's role, permission and country scope server-side,
 * so a tampered browser gains nothing.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  BadgeCheck,
  Building2,
  Handshake,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Flag,
  Globe,
  Megaphone,
  Library,
  TicketPercent,
  Receipt,
  ScrollText,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  UserX,
  LifeBuoy,
} from 'lucide-react'
import AdminShell from '../components/AdminShell.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import { logoutUser } from '../../../shared/auth/authSlice.js'
import {
  AdminCountryProvider,
  CountryFlag,
  useAdminCountry,
} from '../components/AdminCountry.jsx'
import { LeadsPage } from '../components/LeadsSection.jsx'
import { Overview } from '../components/OverviewSection.jsx'
import { AdsPage } from '../components/AdsSection.jsx'
import { AuditPage } from '../components/AuditSection.jsx'
import { AccountDeletionPage } from '../components/AccountDeletionSection.jsx'
import { SupportTicketsAdminPage } from '../components/SupportTicketsSection.jsx'
import { CatalogPage } from '../components/CatalogSection.jsx'
import { CouponsPage } from '../components/CouponsSection.jsx'
import { SubscriptionPaymentsPage } from '../components/SubscriptionPaymentsSection.jsx'
import { NotificationsPage } from '../components/NotificationsSection.jsx'
import { PAGE_SIZE, Pagination } from '../components/AdminPagination.jsx'
import { ProjectDetailDrawer } from '../components/ProjectDetail.jsx'
import { UserDetailDrawer } from '../components/UserDetail.jsx'
import { completionPercent, formatPercent } from '../../../shared/utils/projectProgress.js'
import { ReportsPage, VerificationPage } from '../components/ReviewSections.jsx'
import WeatherNavButton from '../../weather/components/WeatherNavButton.jsx'
import { SECTION_PERMISSIONS, can, mayOpen } from '../adminAccess.js'
import {
  createAdministrator,
  fetchAdminIdentity,
  fetchAdminOverview,
  fetchAdminProjects,
  fetchAdminUsers,
  fetchAdministrators,
  fetchManagerPresets,
  setAdministratorActive,
  setUserActive,
  updateAdministrator,
  setViewingCountry,
} from '../adminApi.js'

const SCOPE_LABELS = { GLOBAL: 'Global', IN: 'India' }

// Marketplace roles only. Administrators are staff and live on their own screen,
// so they are neither listed here nor returned by the endpoint.
const MARKETPLACE_ROLES = [
  ['', 'All roles'],
  ['OWNER', 'House Owners'],
  ['BUILDER', 'Builders'],
  ['SUPPLIER', 'Suppliers'],
  ['ENGINEER', 'Site Engineers'],
  // Experts moved to CREWNBUILD Partner, which shares this users table. They are
  // still listed here because the accounts are real and an administrator may
  // need to find one, but the label says whose they are.
  ['PROFESSIONAL', 'Experts (CREWNBUILD Partner)'],
]

// Each section names the permission it needs and the sidebar group it sits in. The
// sidebar is built from this list, so adding an area later — Partner's jobs, for
// instance — is one entry rather than a layout change. A section the administrator's
// permissions do not cover is left out of the sidebar, as before.
//
// Notifications is reached from the bell in the topbar rather than the sidebar. An
// administrator receives none of their own, so the bell's dropdown would always be
// empty; pointing it at the screen gives it a purpose and saves a sidebar row.
const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'overview', permission: SECTION_PERMISSIONS['dashboard'] },
  { id: 'users', label: 'Users', icon: Users, group: 'people', permission: SECTION_PERMISSIONS['users'] },
  { id: 'admins', label: 'Administrators', icon: ShieldCheck, group: 'people', permission: SECTION_PERMISSIONS['admins'] },
  { id: 'verification', label: 'Verification', icon: BadgeCheck, group: 'people', permission: SECTION_PERMISSIONS['verification'] },
  { id: 'account-deletion', label: 'Account Deletion', icon: UserX, group: 'people', permission: SECTION_PERMISSIONS['account-deletion'] },
  { id: 'projects', label: 'Projects', icon: Building2, group: 'activity', permission: SECTION_PERMISSIONS['projects'] },
  { id: 'leads', label: 'Leads', icon: Handshake, group: 'activity', permission: SECTION_PERMISSIONS['leads'] },
  { id: 'reports', label: 'Reports', icon: Flag, group: 'activity', permission: SECTION_PERMISSIONS['reports'] },
  { id: 'support', label: 'Support Tickets', icon: LifeBuoy, group: 'activity', permission: SECTION_PERMISSIONS['support'] },
  { id: 'catalog', label: 'Master Catalog', icon: Library, group: 'marketplace', permission: SECTION_PERMISSIONS['catalog'] },
  { id: 'ads', label: 'Adverts', icon: Megaphone, group: 'marketplace', permission: SECTION_PERMISSIONS['ads'] },
  { id: 'coupons', label: 'Coupons', icon: TicketPercent, group: 'marketplace', permission: SECTION_PERMISSIONS['coupons'] },
  { id: 'subscription-payments', label: 'Subscription Payments', icon: Receipt, group: 'marketplace', permission: SECTION_PERMISSIONS['subscription-payments'] },
  { id: 'audit', label: 'Audit Log', icon: ScrollText, group: 'system', permission: SECTION_PERMISSIONS['audit'] },
  // Every administrator's own WhatsApp sign-in number (also in the account menu).
  { id: 'mobile', label: 'Mobile number', icon: Smartphone, group: 'system', permission: SECTION_PERMISSIONS['mobile'] },
]

// The sidebar's groups, in order. A group with no section left to show is not drawn.
export const SIDEBAR_GROUPS = [
  { id: 'overview', label: 'Overview' },
  { id: 'people', label: 'People' },
  { id: 'activity', label: 'Activity' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'system', label: 'System' },
]

// Pages that are not in the sidebar, for the top bar's title.
const OTHER_PAGES = { notifications: 'Notifications' }

// The sidebar's counts, from the dashboard's own queues (GET /admin/overview): only
// the queues that are work waiting, never a plain total.
const BADGE_SOURCES = { verification: 'pending_verifications', reports: 'open_reports', leads: 'stalled_requests' }

function StatusPill({ value }) {
  const active = (value || 'ACTIVE').toUpperCase() === 'ACTIVE'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
        active ? 'bg-ocbrand-50 text-ocbrand-700' : 'bg-red-50 text-red-600'
      }`}
    >
      {active ? 'Active' : 'Suspended'}
    </span>
  )
}

function ScopeChip({ scope }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-oc-mint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-oc-deep">
      {/* A globe for GLOBAL, since no country's flag means "everywhere" — and
          the same globe the country switch shows when it is set to all
          countries, so the two say the same thing in the same way. */}
      {scope === 'GLOBAL' ? (
        <Globe className="h-3 w-3 shrink-0" />
      ) : (
        <CountryFlag country={SCOPE_LABELS[scope]} className="h-2.5 w-4" />
      )}
      {SCOPE_LABELS[scope] || scope}
    </span>
  )
}

// Matches DashboardCard, which every other dashboard uses: a soft-shadowed
// white card on the amber ground, rather than a flat bordered box.
function Panel({ title, subtitle, children, right }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6 dark:border-slate-700">
        <div>
          <h2 className="flex items-center gap-2 font-display text-[15px] font-bold text-graphite dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-600 dark:text-slate-300">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

// A section the administrator's permissions do not cover, opened by its address. The
// server would refuse its data anyway; this says so instead of showing errors.
function NoAccess() {
  return (
    <div className="p-4 sm:p-6">
      <div role="alert" className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)]">
        <h1 className="font-display text-lg font-bold text-graphite">No access</h1>
        <p className="mt-2 text-sm text-slate-500">Your administrator account does not have permission to open this section.</p>
      </div>
    </div>
  )
}

function EmptyRow({ colSpan, message }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm font-medium text-slate-500">
        {message}
      </td>
    </tr>
  )
}

function useAsync(loader, dependencies = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true })
  const [nonce, setNonce] = useState(0)
  // Every screen reloads when the country changes. Doing it here rather than in
  // each page's dependency list means a new screen cannot be written that
  // quietly keeps showing the previous country's data.
  const { country } = useAdminCountry()

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, loading: true }))
    loader()
      .then((data) => !cancelled && setState({ data, error: '', loading: false }))
      .catch((error) =>
        !cancelled &&
        setState({
          data: null,
          loading: false,
          error: error.response?.data?.detail || 'Could not load this. Try again.',
        }),
      )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, country, nonce])

  return { ...state, reload: () => setNonce((value) => value + 1) }
}

/* -------------------------------------------------------------------- Users */

function UsersPage({ identity }) {
  // The country arrives in the URL so the dashboard's "Open India accounts"
  // link lands on a filtered list rather than on everybody.
  const [searchParams, setSearchParams] = useSearchParams()
  const country = searchParams.get('country') || ''
  const statusFilter = searchParams.get('status') || ''
  const [role, setRole] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')
  const [openUserId, setOpenUserId] = useState(null)

  const { data, error, loading, reload } = useAsync(
    () =>
      fetchAdminUsers({
        role: role || undefined,
        country: country || undefined,
        status: statusFilter || undefined,
        search: query || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    [role, country, statusFilter, query, offset],
  )

  // Changing a filter puts you back on the first page; staying on page 4 of a
  // result set that no longer has four pages shows an empty table for no reason.
  const applyFilter = (setter) => (value) => {
    setOffset(0)
    setter(value)
  }

  const canSuspend = can(identity, 'users.suspend')

  const toggleActive = async (user) => {
    const reactivating = (user.status || 'ACTIVE').toUpperCase() !== 'ACTIVE'
    // Suspension ends the account's live sessions, so it is confirmed rather than
    // being one stray click. The reason is what the audit entry is read for later,
    // and the server requires it.
    const reason = window.prompt(
      reactivating
        ? `Reactivate ${user.email}. Reason for the record:`
        : `Suspend ${user.email}? They will be signed out immediately.\n\nReason (required):`,
      '',
    )
    if (reason === null) return
    if (!reactivating && !reason.trim()) {
      setActionError('A reason is required to suspend an account.')
      return
    }
    setBusyId(user.id)
    setActionError('')
    try {
      await setUserActive(user.id, reactivating, reason)
      reload()
    } catch (requestError) {
      setActionError(requestError.response?.data?.detail || 'Could not change that account.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Panel
      title="Users"
      subtitle={
        data
          ? `${data.total} marketplace account${data.total === 1 ? '' : 's'}${
              statusFilter ? ` · ${statusFilter.toLowerCase()}` : ''
            }${country ? ` in ${country}` : ' in your scope'}`
          : 'Loading…'
      }
      right={
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              applyFilter(setQuery)(search.trim())
            }}
            className="flex h-9 items-center gap-2 rounded-lg border border-oc-line bg-white px-3"
          >
            <Search className="h-3.5 w-3.5 text-oc-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email or phone"
              className="w-44 bg-transparent text-sm outline-none placeholder:text-oc-faint"
            />
          </form>
          {statusFilter && (
            <button
              type="button"
              onClick={() => {
                setOffset(0)
                setSearchParams(country ? { country } : {}, { replace: true })
              }}
              className="h-9 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-extrabold text-amber-800 hover:bg-amber-100"
            >
              {statusFilter.toLowerCase()} only ✕
            </button>
          )}
          {identity.is_global && (
            <select
              value={country}
              onChange={(event) => {
                setOffset(0)
                const next = event.target.value
                setSearchParams(next ? { country: next } : {}, { replace: true })
              }}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite"
            >
              <option value="">All countries</option>
              <option value="India">India</option>
            </select>
          )}
          <select
            value={role}
            onChange={(event) => applyFilter(setRole)(event.target.value)}
            className="h-9 rounded-lg border border-oc-line bg-white px-3 text-sm font-semibold text-oc-ink"
          >
            {MARKETPLACE_ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={reload}
            className="grid h-9 w-9 place-items-center rounded-lg border border-oc-line bg-white text-oc-muted hover:bg-oc-sunken"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {actionError && (
        <p className="border-b border-oc-line bg-red-50 px-5 py-2 text-xs font-bold text-red-600">
          {actionError}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Phone</th>
              <th className="px-4 py-2.5">Country</th>
              <th className="px-4 py-2.5">Verified</th>
              <th className="px-4 py-2.5">Profile</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Joined</th>
              {canSuspend && <th className="px-4 py-2.5 text-right">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error && <EmptyRow colSpan={10} message={error} />}
            {!error && loading && <EmptyRow colSpan={10} message="Loading…" />}
            {!error && !loading && !data?.users.length && (
              <EmptyRow colSpan={10} message="No accounts match these filters." />
            )}
            {!error &&
              !loading &&
              data?.users.map((user) => {
                const isActive = (user.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                return (
                  <tr
                    key={user.id}
                    onClick={() => setOpenUserId(user.id)}
                    className="cursor-pointer hover:bg-brand-50/40"
                  >
                    <td className="px-4 py-3 font-semibold text-graphite">{user.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-md bg-oc-sunken px-2 py-0.5 text-[11px] font-bold text-oc-deep">
                        {user.supplier_category || user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{user.email}</td>
                    <td className="px-4 py-2.5 tabular-nums text-oc-muted">{user.phone || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{user.country || '—'}</td>
                    <td className="px-4 py-2.5">
                      {/* Only builders and suppliers submit documents, so the rest
                          show a dash rather than an unverified badge they could
                          never earn. */}
                      {user.verification_status === null ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : user.verified ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ocbrand-50 px-2 py-0.5 text-[11px] font-extrabold text-ocbrand-700">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400">
                          {user.verification_status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {user.profile_complete ? (
                        <span className="text-xs font-bold text-ocbrand-700">Complete</span>
                      ) : (
                        <span className="text-xs font-bold text-oc-amber">Incomplete</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill value={user.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-500">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    {canSuspend && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          disabled={busyId === user.id}
                          onClick={(event) => {
                            // The row opens the drawer; the button must not.
                            event.stopPropagation()
                            toggleActive(user)
                          }}
                          className={`h-8 rounded-lg border px-3 text-xs font-extrabold disabled:opacity-50 ${
                            isActive
                              ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                              : 'border-ocbrand-200 bg-ocbrand-50 text-ocbrand-700 hover:bg-ocbrand-100'
                          }`}
                        >
                          {isActive ? 'Suspend' : 'Reactivate'}
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      <Pagination data={data} offset={offset} onChange={setOffset} loading={loading} />
      <UserDetailDrawer userId={openUserId} onClose={() => setOpenUserId(null)} />
    </Panel>
  )
}

/* ----------------------------------------------------------------- Projects */

function ProjectsPage() {
  const [offset, setOffset] = useState(0)
  const [openProjectId, setOpenProjectId] = useState(null)
  const { data, error, loading, reload } = useAsync(
    () => fetchAdminProjects({ limit: PAGE_SIZE, offset }),
    [offset],
  )

  return (
    <Panel
      title="Projects"
      subtitle="Scoped by where the site is, not by where the owner is from."
      right={
        <button
          type="button"
          onClick={reload}
          className="grid h-9 w-9 place-items-center rounded-lg border border-oc-line bg-white text-oc-muted hover:bg-oc-sunken"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Project</th>
              <th className="px-4 py-2.5">Owner</th>
              <th className="px-4 py-2.5">Owner is from</th>
              <th className="px-4 py-2.5">Site is in</th>
              <th className="px-4 py-2.5">Progress</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error && <EmptyRow colSpan={7} message={error} />}
            {!error && loading && <EmptyRow colSpan={7} message="Loading…" />}
            {!error && !loading && !data?.projects.length && (
              <EmptyRow colSpan={7} message="No projects in your scope yet." />
            )}
            {!error &&
              !loading &&
              data?.projects.map((project) => (
                <tr
                  key={project.id}
                  onClick={() => setOpenProjectId(project.id)}
                  className="cursor-pointer hover:bg-brand-50/40"
                >
                  <td className="px-4 py-2.5 tabular-nums text-oc-faint">{project.id}</td>
                  <td className="px-4 py-3 font-semibold text-graphite">{project.title}</td>
                  <td className="px-4 py-3 text-slate-500">{project.owner_name || '—'}</td>
                  {/* Deliberately side by side: these two often differ, and seeing
                      both is how the distinction stays visible to the administrator. */}
                  <td className="px-4 py-3 text-slate-500">{project.owner_country || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-oc-ink">{project.project_country || 'India'}</span>
                    {project.project_city && (
                      <span className="text-oc-muted"> · {project.project_city}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-oc-muted">
                    {completionPercent(project) === null ? 'Not available' : formatPercent(completionPercent(project))}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{project.status}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Pagination data={data} offset={offset} onChange={setOffset} loading={loading} />
      <ProjectDetailDrawer projectId={openProjectId} onClose={() => setOpenProjectId(null)} />
    </Panel>
  )
}

/* ----------------------------------------------------------- Administrators */

const BLANK_ADMIN = { name: '', email: '', password: '', role: '', scope: '', permissions: [] }

const sameSet = (left, right) => {
  if (left.length !== right.length) return false
  const other = new Set(right)
  return left.every((value) => other.has(value))
}

/**
 * What a manager is allowed to do, chosen as a job rather than assembled from
 * permission strings.
 *
 * The ready-made kinds come from the server, so "ads manager" means one thing in
 * one place. Picking one ticks its permissions; ticking them by hand is still
 * allowed and simply shows as Custom. Both matter: the list covers the managers
 * anybody actually creates, and the checkboxes cover the one that does not fit.
 *
 * Choosing from a list also closes a gap the bare checkboxes left open. Granting
 * `ads.manage` without `ads.view` produced a manager the server would accept
 * edits from but whose console had no adverts screen — a half-grant that reads as
 * a broken account, and one nobody would make deliberately.
 */
function ManagerRemit({ catalogue, fallback, permissions, onChange }) {
  const presets = catalogue?.presets || []
  const entries =
    catalogue?.permissions?.length
      ? catalogue.permissions
      : // The console still works if the catalogue could not be fetched; it just
        // falls back to naming permissions the way it used to.
        fallback.map((key) => ({ key, label: key }))

  const matched = presets.find((preset) => sameSet(preset.permissions, permissions))

  const toggle = (permission) =>
    onChange(
      permissions.includes(permission)
        ? permissions.filter((value) => value !== permission)
        : [...permissions, permission],
    )

  return (
    <div className="mt-3">
      {presets.length > 0 && (
        <label className="grid max-w-[240px] gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
            Manager type
          </span>
          <select
            value={matched?.key || ''}
            onChange={(event) => {
              const preset = presets.find((entry) => entry.key === event.target.value)
              if (preset) onChange(preset.permissions)
            }}
            className="h-9 w-full rounded-lg border border-oc-line bg-white px-3 text-sm outline-none focus:border-ocbrand-400"
          >
            <option value="">Custom (choose below)</option>
            {presets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <p className="mt-3 text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
        What this manager may do
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {entries.map(({ key, label }) => (
          <label
            key={key}
            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold ${
              permissions.includes(key)
                ? 'border-ocbrand-400 bg-ocbrand-50 text-ocbrand-700'
                : 'border-oc-line bg-white text-oc-muted'
            }`}
          >
            <input
              type="checkbox"
              checked={permissions.includes(key)}
              onChange={() => toggle(key)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}

function CreateAdministratorForm({ identity, catalogue, onCreated, onCancel }) {
  const [draft, setDraft] = useState(BLANK_ADMIN)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  // A Global Super Admin creates Location Super Admins; a Location Super Admin
  // creates Managers. The server enforces this either way — the list below only
  // spares the administrator from choosing something that will be refused.
  const creatableRoles = identity.is_global
    ? [['LOCATION_SUPER_ADMIN', 'Location Super Admin'], ['MANAGER', 'Manager']]
    : [['MANAGER', 'Manager']]

  const isManager = draft.role === 'MANAGER'
  // A manager can never be granted administrator management, so it is not offered.
  const grantable = identity.permissions.filter((permission) => permission !== 'admins.manage')

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      await createAdministrator({
        name: draft.name,
        email: draft.email,
        password: draft.password,
        role: draft.role,
        // Ignored by the server for a location administrator, whose own scope wins.
        scope: identity.is_global ? draft.scope : undefined,
        permissions: isManager ? draft.permissions : undefined,
      })
      setDraft(BLANK_ADMIN)
      onCreated()
    } catch (error) {
      setMessage(error.response?.data?.detail || 'Could not create this administrator.')
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-9 w-full rounded-lg border border-oc-line bg-white px-3 text-sm outline-none focus:border-ocbrand-400'

  return (
    <form onSubmit={submit} className="border-b border-oc-line bg-oc-sunken/50 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">Name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className={field}
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">Email</span>
          <input
            type="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            className={field}
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
            Password
          </span>
          <input
            type="password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            onCopy={(event) => event.preventDefault()}
            onCut={(event) => event.preventDefault()}
            onPaste={(event) => event.preventDefault()}
            placeholder="10+ chars, mixed case, number, symbol"
            className={field}
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">Role</span>
          <select
            value={draft.role}
            onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            className={field}
            required
          >
            <option value="">Choose…</option>
            {creatableRoles.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {identity.is_global && (
          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
              Country
            </span>
            <select
              value={draft.scope}
              onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
              className={field}
              required
            >
              <option value="">Choose…</option>
              <option value="IN">India</option>
            </select>
          </label>
        )}
      </div>

      {isManager && (
        <ManagerRemit
          catalogue={catalogue}
          fallback={grantable}
          permissions={draft.permissions}
          onChange={(permissions) => setDraft((current) => ({ ...current, permissions }))}
        />
      )}

      {!identity.is_global && (
        <p className="mt-3 text-xs font-medium text-oc-muted">
          This account will be created in {SCOPE_LABELS[identity.scope]} — you can only create
          administrators for your own country.
        </p>
      )}

      {message && <p className="mt-3 text-xs font-bold text-red-600">{message}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="h-9 rounded-lg bg-oc-green px-4 text-sm font-extrabold text-white hover:bg-oc-deep disabled:opacity-60"
        >
          {saving ? 'Creating…' : 'Create administrator'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg border border-oc-line bg-white px-4 text-sm font-bold text-oc-muted hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Change what an existing administrator may do, and where.
 *
 * A manager's remit moves — they pick up reports, or change market — and without
 * this the only way to reflect that was to deactivate the account and create a
 * second one, which leaves a dead entry in the list and splits their history
 * across two identities.
 *
 * It opens with their current grant already ticked, so the question on screen is
 * "what should this change to", not "what did they have again".
 */
function EditAdministratorRow({ identity, admin, catalogue, onSaved, onCancel }) {
  const isManager = admin.role === 'MANAGER'
  const grantable = identity.permissions.filter((permission) => permission !== 'admins.manage')
  const [permissions, setPermissions] = useState(admin.permissions || [])
  const [scope, setScope] = useState(admin.scope)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      // Only what actually differs is sent, so the server's "nothing was changed"
      // means the same thing the person sees.
      const changes = { reason }
      if (isManager) changes.permissions = permissions
      if (identity.is_global && scope !== admin.scope) changes.scope = scope
      await updateAdministrator(admin.user_id, changes)
      onSaved()
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'Could not save those changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="bg-brand-50/40">
      <td colSpan={7} className="px-4 py-3">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
          Editing {admin.name} · {admin.email}
        </p>

        {isManager ? (
          <ManagerRemit
            catalogue={catalogue}
            fallback={grantable}
            permissions={permissions}
            onChange={setPermissions}
          />
        ) : (
          <p className="mt-2 text-xs font-semibold text-oc-muted">
            A Super Admin holds every permission by virtue of the role, so there is
            nothing to tick. Only their country can be changed.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          {/* Only a Global Super Admin can move somebody between countries; a
              location administrator has one scope and the server ignores the
              field from them anyway. */}
          {identity.is_global && (
            <label className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
              Country
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                className="ml-2 h-8 rounded-lg border border-oc-line bg-white px-2 text-xs font-bold text-graphite"
              >
                <option value="IN">India</option>
              </select>
            </label>
          )}
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for the record"
            className="h-8 min-w-56 flex-1 rounded-lg border border-oc-line bg-white px-2.5 text-xs font-semibold text-graphite"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-8 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white hover:bg-oc-deep disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-8 rounded-lg border border-oc-line px-3 text-xs font-extrabold text-oc-muted hover:bg-white"
          >
            Cancel
          </button>
        </div>

        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
      </td>
    </tr>
  )
}

function AdministratorsPage({ identity }) {
  const { data, error, loading, reload } = useAsync(() => fetchAdministrators(), [])
  // The manager kinds and the permission descriptions, fetched once for the two
  // forms below rather than by each of them.
  const { data: catalogue } = useAsync(() => fetchManagerPresets(), [])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState('')

  const toggleActive = async (admin) => {
    const active = (admin.status || 'ACTIVE').toUpperCase() !== 'ACTIVE'
    const verb = active ? 'Reactivate' : 'Deactivate'
    // A destructive change to somebody's access is confirmed, and the reason is
    // kept, because it is what the audit entry will be read for later.
    const reason = window.prompt(`${verb} ${admin.email}. Reason for the record:`, '')
    if (reason === null) return
    setBusyId(admin.user_id)
    setActionError('')
    try {
      await setAdministratorActive(admin.user_id, active, reason)
      reload()
    } catch (requestError) {
      setActionError(requestError.response?.data?.detail || 'Could not change that account.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Panel
      title="Administrators"
      subtitle={
        identity.is_global
          ? 'Every administrator on the platform.'
          : `Administrators for ${SCOPE_LABELS[identity.scope]}.`
      }
      right={
        !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-3.5 text-sm font-extrabold text-white hover:bg-oc-deep"
          >
            <Plus className="h-3.5 w-3.5" /> New administrator
          </button>
        )
      }
    >
      {showForm && (
        <CreateAdministratorForm
          identity={identity}
          catalogue={catalogue}
          onCreated={() => {
            setShowForm(false)
            reload()
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {actionError && (
        <p className="border-b border-oc-line bg-red-50 px-5 py-2 text-xs font-bold text-red-600">
          {actionError}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Scope</th>
              <th className="px-4 py-2.5">Permissions</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error && <EmptyRow colSpan={7} message={error} />}
            {!error && loading && <EmptyRow colSpan={7} message="Loading…" />}
            {!error &&
              !loading &&
              data?.admins.map((admin) => {
                const isSelf = admin.user_id === identity.id
                const isActive = (admin.status || 'ACTIVE').toUpperCase() === 'ACTIVE'
                return (
                  <Fragment key={admin.id}>
                  <tr className="hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-semibold text-graphite">
                      {admin.name}
                      {isSelf && <span className="ml-1.5 text-[11px] text-oc-faint">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{admin.email}</td>
                    <td className="px-4 py-2.5 text-xs font-bold text-oc-deep">{admin.role}</td>
                    <td className="px-4 py-2.5">
                      <ScopeChip scope={admin.scope} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-oc-muted">
                      {admin.permissions.length ? admin.permissions.join(', ') : 'All (by role)'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill value={admin.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {/* Your own account and Global administrators are not editable
                          here; the server refuses both regardless of what is shown. */}
                      {isSelf || admin.role === 'GLOBAL_SUPER_ADMIN' ? (
                        <span className="text-xs text-oc-faint">—</span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          {/* Editing a suspended account would let a grant be widened
                              on somebody who cannot sign in to use it; reactivate
                              first, so the two decisions stay separate. */}
                          {isActive && (
                            <button
                              type="button"
                              onClick={() =>
                                setEditingId(editingId === admin.user_id ? null : admin.user_id)
                              }
                              className="h-8 rounded-lg border border-oc-line px-3 text-xs font-extrabold text-oc-deep hover:bg-brand-50"
                            >
                              {editingId === admin.user_id ? 'Close' : 'Edit'}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === admin.user_id}
                            onClick={() => toggleActive(admin)}
                            className={`h-8 rounded-lg border px-3 text-xs font-extrabold disabled:opacity-50 ${
                              isActive
                                ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
                                : 'border-ocbrand-200 bg-ocbrand-50 text-ocbrand-700 hover:bg-ocbrand-100'
                            }`}
                          >
                            {isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {editingId === admin.user_id && (
                    <EditAdministratorRow
                      identity={identity}
                      admin={admin}
                      catalogue={catalogue}
                      onSaved={() => {
                        setEditingId(null)
                        reload()
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                  </Fragment>
                )
              })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ---------------------------------------------------------------- Audit log */

/* -------------------------------------------------------------------- Shell */

export default function AdminDashboard() {
  const [identity, setIdentity] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAdminIdentity()
      .then(setIdentity)
      .catch((loadError) =>
        setError(loadError.response?.data?.detail || 'Could not load your administrator profile.'),
      )
  }, [])

  return (
    <AdminCountryProvider>
      <AdminConsole identity={identity} error={error} onIdentityChanged={setIdentity} />
    </AdminCountryProvider>
  )
}

function AdminConsole({ identity, error, onIdentityChanged }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useSelector((state) => state.auth)
  const { country } = useAdminCountry()

  // Every admin request carries the chosen country, so a screen cannot forget to
  // pass it. Set before anything renders that would fetch.
  setViewingCountry(country)

  const sections = useMemo(
    () =>
      identity
        ? SECTIONS.filter(
            (section) => can(identity, section.permission),
          )
        : [],
    [identity],
  )

  // The shell drives navigation by id while the browser keeps a real URL, so an
  // administrator can bookmark a section and the back button behaves.
  const activeId = location.pathname.replace(/^\/admin\/?/, '').split('/')[0] || 'dashboard'

  // The sidebar's counts: the dashboard's own queues, read again when the
  // administrator moves to another section so a count follows the work done.
  const [badges, setBadges] = useState({})
  useEffect(() => {
    if (!identity) return undefined
    let cancelled = false
    fetchAdminOverview()
      .then((data) => {
        if (cancelled) return
        const attention = data?.attention || {}
        setBadges(Object.fromEntries(Object.entries(BADGE_SOURCES).map(([section, key]) => [section, attention[key] || 0])))
      })
      .catch(() => { if (!cancelled) setBadges({}) })
    return () => { cancelled = true }
  }, [identity, activeId])

  const groups = useMemo(
    () => SIDEBAR_GROUPS
      .map((group) => ({ ...group, items: sections.filter((section) => section.group === group.id) }))
      .filter((group) => group.items.length > 0),
    [sections],
  )

  const signOut = () => {
    dispatch(logoutUser())
    navigate('/login', { replace: true })
  }

  const shellUser = useMemo(
    () => ({
      name: user?.name || '',
      initials: (user?.name || 'AD').slice(0, 2).toUpperCase(),
      profileImageUrl: user?.profile_image_url || '',
    }),
    [user],
  )

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F3F4F6] dark:bg-[#0a1014] px-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_16px_50px_-40px_rgba(15,23,42,0.55)]">
          <h1 className="font-display text-lg font-bold text-graphite">Administrator access</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={signOut}
            className="mt-4 h-9 rounded-lg bg-oc-green px-4 text-sm font-extrabold text-white hover:bg-oc-deep"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (!identity) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F3F4F6] dark:bg-[#0a1014] text-sm font-medium text-slate-600">
        Loading your console…
      </div>
    )
  }

  const roleLabel =
    identity.role === 'GLOBAL_SUPER_ADMIN'
      ? 'Global Super Admin'
      : identity.role === 'LOCATION_SUPER_ADMIN'
        ? `${SCOPE_LABELS[identity.scope]} Super Admin`
        : `${SCOPE_LABELS[identity.scope]} Manager`

  const current = SECTIONS.find((section) => section.id === activeId)
  const title = current?.label || OTHER_PAGES[activeId] || 'Dashboard'
  const groupLabel = SIDEBAR_GROUPS.find((group) => group.id === current?.group)?.label
  const trail = ['Admin', ...(groupLabel ? [groupLabel] : []), title]

  return (
      <AdminShell
        groups={groups}
        activeId={activeId}
        onNav={(id) => navigate(id === 'dashboard' ? '/admin' : `/admin/${id}`)}
        badges={badges}
        title={title}
        trail={trail}
        user={shellUser}
        roleLabel={roleLabel}
        // The shell appends its own Logout whenever `onLogout` is given, the
        // same one every other dashboard shows.
        onLogout={signOut}
        // Every administrator signs in with a WhatsApp code to its own number,
        // set here while signed in and saved only once verified.
        userMenu={[{ id: 'mobile', label: 'Mobile number (WhatsApp sign-in)', icon: Smartphone }]}
        onUserMenuSelect={(id) => { if (id === 'mobile') navigate('/admin/mobile') }}
        beforeLanguage={<WeatherNavButton />}
        onNotificationsClick={
          can(identity, SECTION_PERMISSIONS.notifications)
            ? () => navigate('/admin/notifications')
            : null
        }
        headerActions={
          // A location administrator gets a chip naming their territory, which
          // is their only indication of it. A Global Super Admin gets nothing
          // here: a chip reading "Global" would repeat the role label beside it.
          identity.is_global ? null : <ScopeChip scope={identity.scope} />
        }
      >
        {!mayOpen(identity, activeId) ? <NoAccess /> : (
        <Routes>
          <Route
            index
            element={
              <Overview
                identity={identity}
                Panel={Panel}
                useAsync={useAsync}
                onNav={(id) => navigate(`/admin/${id}`)}
              />
            }
          />
          <Route path="users" element={<UsersPage identity={identity} />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="leads" element={<LeadsPage Panel={Panel} useAsync={useAsync} />} />
          <Route
            path="verification"
            element={
              <VerificationPage
                identity={identity}
                Panel={Panel}
                EmptyRow={EmptyRow}
                useAsync={useAsync}
              />
            }
          />
          <Route
            path="reports"
            element={<ReportsPage identity={identity} Panel={Panel} useAsync={useAsync} />}
          />
          <Route
            path="notifications"
            element={<NotificationsPage identity={identity} Panel={Panel} useAsync={useAsync} />}
          />
          <Route path="admins" element={<AdministratorsPage identity={identity} />} />
          <Route path="ads" element={<AdsPage identity={identity} Panel={Panel} />} />
          <Route path="audit" element={<AuditPage Panel={Panel} useAsync={useAsync} />} />
          <Route path="catalog" element={<CatalogPage key={country} Panel={Panel} canManage={can(identity, 'catalog.manage')} />} />
          <Route path="coupons" element={<CouponsPage identity={identity} Panel={Panel} useAsync={useAsync} />} />
          <Route path="subscription-payments" element={<SubscriptionPaymentsPage identity={identity} Panel={Panel} useAsync={useAsync} />} />
          <Route path="account-deletion" element={<AccountDeletionPage Panel={Panel} useAsync={useAsync} />} />
          <Route path="support" element={<SupportTicketsAdminPage identity={identity} Panel={Panel} useAsync={useAsync} />} />
          <Route
            path="mobile"
            element={(
              <div className="mx-auto max-w-3xl space-y-3 p-4">
                <h1 className="font-display text-xl font-extrabold text-graphite">Mobile number</h1>
                <p className="text-sm text-slate-600">
                  Add the number this account will receive WhatsApp sign-in codes on. A code is sent to the new
                  number first; the number is saved only once that code is entered. This is the number you sign in
                  with.
                </p>
                {/* The number is the administrator's admin profile's (GET /admin/me),
                    re-read after the verified change saves it. */}
                <PhoneChangeSection
                  currentPhone={identity.phone || ''}
                  onSaved={() => fetchAdminIdentity().then(onIdentityChanged)}
                />
              </div>
            )}
          />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        )}
      </AdminShell>
  )
}
