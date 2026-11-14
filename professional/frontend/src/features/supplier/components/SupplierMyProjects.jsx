import { useMemo, useState } from 'react'
import {
  ArrowRight, ChevronRight, FolderKanban, LayoutGrid, LayoutList, MapPin, Package, Search, X,
} from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar, EntityPill } from '../../../shared/ui/EntityPill.jsx'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { formatDate } from '../../../shared/utils/formatters.js'
import { completionPercent, completionText } from '../../../shared/utils/projectProgress.js'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { UNIT_LABEL_KEYS } from '../supplierConstants.js'
import { optionLabel } from '../../../i18n/optionKeys.js'

// Project status is read from the existing project fields — a project is
// completed exactly when the rest of the application says it is. 'pending' is
// kept as a bucket only if a project row ever carries that status; nothing is
// invented for projects whose stored status is active.
const PROJECT_STATUS_TONE = {
  active: 'bg-emerald-500',
  pending: 'bg-amber-400',
  completed: 'bg-sky-500',
}
const STATUS_LABEL_KEYS = {
  active: 'ui.status.active',
  pending: 'ui.status.pending',
  completed: 'ui.status.completed',
}
// The same stored order statuses the Orders screen already labels, with the
// same colours, so a project's items never read differently from Orders.
const ORDER_STATUS_PILL = {
  FULFILLED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED: 'bg-sky-100 text-sky-800',
  REJECTED: 'bg-rose-100 text-rose-700',
  PENDING: 'bg-brand-100 text-brand-800',
}
const ORDER_STATUS_KEYS = {
  FULFILLED: 'ui.status.completed',
  ACCEPTED: 'ui.requests.accepted',
  REJECTED: 'ui.requests.rejected',
  PENDING: 'ui.status.pending',
}

export default function SupplierMyProjects({ projectList = [], materialRequestList = [] }) {
  const { t, td } = useLanguage()
  // Table is the default presentation, matching the reference layout.
  const [viewMode, setViewMode] = useState('table')
  const [search, setSearch] = useState('')
  const [requesterFilter, setRequesterFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [openProject, setOpenProject] = useState(null)

  const isCompleted = (project) => (
    String(project?.status || '').toLowerCase() === 'completed'
    || Number(project?.completion_percentage || 0) >= 100
  )
  const statusOf = (project) => {
    if (isCompleted(project)) return 'completed'
    return String(project?.status || '').toLowerCase() === 'pending' ? 'pending' : 'active'
  }

  // Items/products and total value come from the same supplier material
  // requests the Orders screen renders — grouped per project here, with the
  // same price × quantity total the order cards use.
  const metricsByProject = useMemo(() => {
    const grouped = {}
    materialRequestList.forEach((row) => {
      const key = String(row.project_id)
      if (!grouped[key]) grouped[key] = { rows: [], items: 0, products: new Set(), total: 0 }
      grouped[key].rows.push(row)
      grouped[key].items += 1
      if (row.product_id) grouped[key].products.add(row.product_id)
      grouped[key].total += Number(row.price || 0) * Number(row.quantity || 0)
    })
    const result = {}
    Object.keys(grouped).forEach((key) => {
      result[key] = { rows: grouped[key].rows, items: grouped[key].items, products: grouped[key].products.size, total: grouped[key].total }
    })
    return result
  }, [materialRequestList])
  const metricsFor = (project) => metricsByProject[String(project.project_id)] || { rows: [], items: 0, products: 0, total: 0 }

  // Requester options come from the actual records only — a supplier with no
  // Builder-sourced projects never sees a dead Builder option.
  const requesterTypeOptions = useMemo(() => {
    const roles = [...new Set(projectList.map((project) => project.requester?.role).filter(Boolean))]
    return roles.sort()
  }, [projectList])

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLowerCase()
    return projectList.filter((project) => {
      if (requesterFilter !== 'all' && project.requester?.role !== requesterFilter) return false
      if (statusFilter !== 'all' && statusOf(project) !== statusFilter) return false
      if (dateFilter !== 'all') {
        const assigned = project.assigned_on ? new Date(project.assigned_on) : null
        if (!assigned) return false
        const cutoff = Date.now() - Number(dateFilter) * 24 * 60 * 60 * 1000
        if (assigned.getTime() < cutoff) return false
      }
      if (term && ![project.title, project.requester?.name, project.requester?.company_name].some((value) => String(value || '').toLowerCase().includes(term))) return false
      return true
    })
  }, [dateFilter, projectList, requesterFilter, search, statusFilter])

  // The requester's own name, and their company on the line beneath it — e.g.
  // "pradeep" with "GHR Constructions" under it — so the person behind the
  // project is still the first thing read, with the company they belong to on
  // its own line rather than run together with the name.
  const requesterName = (project) => td(project.requester?.name) || '—'
  const requesterCompany = (project) => td(project.requester?.company_name || '')
  const requesterLabel = (role) => (role === 'BUILDER' ? t('role.builder') : t('role.owner'))
  const requesterBadge = (role) => (role === 'BUILDER'
    ? 'bg-sky-50 text-sky-700 ring-sky-200'
    : 'bg-emerald-50 text-emerald-700 ring-emerald-200')
  const requesterTile = (role) => (role === 'BUILDER'
    ? 'bg-sky-50 text-sky-700 ring-sky-200'
    : 'bg-emerald-50 text-emerald-700 ring-emerald-200')
  // The same day/month/year shape as before, in the selected language: the
  // pinned 'en-GB' printed "Sep" in all seven.
  const formatAssignedOn = (value) => formatDate(value, '—')

  const renderTable = () => (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">
            <th className="px-4 py-3">{t('dash.common.project')} / {t('dash.supplier.requester')}</th>
            <th className="px-4 py-3">{t('dash.supplier.requesterType')}</th>
            <th className="px-4 py-3">{t('dash.supplier.assignedOn')}</th>
            <th className="px-4 py-3">{t('dash.common.status')}</th>
            <th className="px-4 py-3">{t('dash.supplier.totalValue')}</th>
            <th className="px-4 py-3 text-right">{t('dash.common.action')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visibleProjects.map((project) => {
            const role = project.requester?.role
            const status = statusOf(project)
            const metrics = metricsFor(project)
            return (
              <tr key={project.project_id} className="dash-gold-hover text-sm">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* The requester's own avatar, in the tile the role icon
                        used to sit in — same size, radius, ring and tint. */}
                    <span className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ${requesterTile(role)}`}>
                      <img
                        src={userAvatarSrc(project.requester)}
                        alt={requesterName(project)}
                        className="h-full w-full object-cover"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-extrabold text-graphite">{requesterName(project)}</p>
                      {requesterCompany(project) && (
                        <p className="truncate text-xs font-semibold text-graphite/70">{requesterCompany(project)}</p>
                      )}
                      <p className="truncate text-xs font-semibold text-graphite/55">{td(project.title)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${requesterBadge(role)}`}>
                    {requesterLabel(role)}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold text-graphite/60">{formatAssignedOn(project.assigned_on)}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-graphite/70">
                    <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_STATUS_TONE[status] || 'bg-slate-300'}`} />
                    {t(STATUS_LABEL_KEYS[status] || 'ui.status.active')}
                  </span>
                </td>
                <td className="px-4 py-3 font-extrabold text-graphite">{countryFormatMoney(metrics.total)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenProject(project)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-brand-700 transition hover:border-brand-300 hover:bg-brand-50"
                  >
                    {t('dash.supplier.viewDetails')}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            )
          })}
          {!visibleProjects.length && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-xs font-medium text-graphite/45">
                {t('dash.supplier.noMyProjects')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  const renderCards = () => (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {visibleProjects.map((project) => {
        const role = project.requester?.role
        const status = statusOf(project)
        const metrics = metricsFor(project)
        return (
          <EntityCard
            key={project.project_id}
            compact
            onClick={() => setOpenProject(project)}
            avatar={
              // The requester's own profile photo, matching the name beside it.
              // Falls back to their initial when they have not set one, which is
              // what EntityAvatar already does elsewhere in the dashboard.
              <EntityAvatar
                user={project.requester}
                alt={requesterName(project)}
              />
            }
            title={requesterName(project)}
            subtitle={
              requesterCompany(project) ? (
                // Two block lines inside the subtitle EntityCard already
                // renders, so the company sits under the name here too without
                // the shared card component needing a change.
                <>
                  <span className="block truncate">{requesterCompany(project)}</span>
                  <span className="block truncate">{td(project.title)}</span>
                </>
              ) : (
                td(project.title)
              )
            }
            pills={[
              { key: 'requester', text: requesterLabel(role) },
              { key: 'status', text: t(STATUS_LABEL_KEYS[status] || 'ui.status.active') },
            ]}
            footerLabel={t('dash.supplier.totalValue')}
            footerValue={<EntityPill tone="positive">{countryFormatMoney(metrics.total)}</EntityPill>}
          >
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setOpenProject(project)}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-oc-green px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-oc-deep"
              >
                {t('dash.supplier.viewDetails')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </button>
            </div>
          </EntityCard>
        )
      })}
    </div>
  )

  const openMetrics = openProject ? metricsFor(openProject) : { rows: [], items: 0, products: 0, total: 0 }
  const openStatus = openProject ? statusOf(openProject) : 'active'
  const openRole = openProject?.requester?.role

  return (
    <div className="space-y-3">
      {projectList.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-11 min-w-[220px] flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 text-graphite focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
              <Search className="h-4 w-4 shrink-0 text-brand-800" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('dash.supplier.searchMyProjects')}
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-graphite outline-none placeholder:text-graphite/45"
              />
            </label>
            <select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-graphite outline-none focus:border-brand-400">
              <option value="all">{t('dash.supplier.allRequesters')}</option>
              {requesterTypeOptions.includes('OWNER') && <option value="OWNER">{t('role.owner')}</option>}
              {requesterTypeOptions.includes('BUILDER') && <option value="BUILDER">{t('role.builder')}</option>}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-11 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-graphite outline-none focus:border-brand-400">
              <option value="all">{t('dash.supplier.allStatus')}</option>
              <option value="active">{t('ui.status.active')}</option>
              <option value="pending">{t('ui.status.pending')}</option>
              <option value="completed">{t('ui.status.completed')}</option>
            </select>
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="h-11 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-graphite outline-none focus:border-brand-400">
              <option value="all">{t('dash.supplier.allDates')}</option>
              <option value="30">{t('dash.supplier.last30Days')}</option>
              <option value="90">{t('dash.supplier.last90Days')}</option>
            </select>
            <div className="flex h-11 items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button type="button" onClick={() => setViewMode('table')} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition ${viewMode === 'table' ? 'bg-white text-graphite shadow-sm' : 'text-graphite/55 hover:text-graphite'}`}><LayoutList className="h-3.5 w-3.5" />{t('dash.supplier.table')}</button>
              <button type="button" onClick={() => setViewMode('cards')} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition ${viewMode === 'cards' ? 'bg-white text-graphite shadow-sm' : 'text-graphite/55 hover:text-graphite'}`}><LayoutGrid className="h-3.5 w-3.5" />{t('dash.supplier.cards')}</button>
            </div>
          </div>

          {viewMode === 'table' ? renderTable() : renderCards()}
        </>
      )}

      {!projectList.length && (
        <section className="rounded-2xl border border-dashed border-brand-200 bg-white p-10 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          <FolderKanban className="mx-auto mb-2 h-8 w-8 text-brand-400" />
          <h2 className="font-display text-base font-extrabold text-slate-950">{t('dash.supplier.noMyProjects')}</h2>
          <p className="mx-auto mt-1 max-w-md text-xs font-medium text-slate-500">{t('dash.supplier.noMyProjectsSub')}</p>
        </section>
      )}

      {openProject && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpenProject(null)} />
          <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 p-5">
              <span className={`grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ${requesterTile(openRole)}`}>
                <img
                  src={userAvatarSrc(openProject.requester)}
                  alt={requesterName(openProject)}
                  className="h-full w-full object-cover"
                />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg font-extrabold text-graphite">{requesterName(openProject)}</h2>
                {requesterCompany(openProject) && (
                  <p className="truncate text-xs font-semibold text-graphite/70">{requesterCompany(openProject)}</p>
                )}
                <p className="truncate text-xs font-semibold text-graphite/55">
                  {td(openProject.title)}{openProject.address ? ` · ${td(openProject.address)}${openProject.pincode ? ` - ${openProject.pincode}` : ''}` : (openProject.pincode ? ` · ${t('dash.common.pincode')} ${openProject.pincode}` : '')}
                </p>
              </div>
              <button type="button" onClick={() => setOpenProject(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-graphite/55 transition hover:bg-slate-50">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.supplier.requesterType')}</p>
                <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${requesterBadge(openRole)}`}>{requesterLabel(openRole)}</span>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.supplier.assignedOn')}</p>
                <p className="mt-1 text-sm font-extrabold text-graphite">{formatAssignedOn(openProject.assigned_on)}</p>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.common.status')}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-extrabold text-graphite">
                  <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_STATUS_TONE[openStatus] || 'bg-slate-300'}`} />
                  {t(STATUS_LABEL_KEYS[openStatus] || 'ui.status.active')}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.supplier.totalValue')}</p>
                <p className="mt-1 text-sm font-extrabold text-graphite">{countryFormatMoney(openMetrics.total)}</p>
              </div>
              {/* Completion only once it can be measured. */}
              {completionPercent(openProject) !== null && (
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{t('dash.supplier.completion')}</p>
                  <p className="mt-1 text-sm font-extrabold text-graphite">{completionText(openProject, t)}</p>
                </div>
              )}
            </div>

            <div className="px-5 pb-5">
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-graphite/45">{t('shop.orderDetails')}</p>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">
                      <th className="px-4 py-2.5">{t('ui.products')}</th>
                      <th className="px-4 py-2.5">{t('shop.quantity')}</th>
                      <th className="px-4 py-2.5">{t('se.rate')}</th>
                      <th className="px-4 py-2.5">{t('dash.contractor.amount')}</th>
                      <th className="px-4 py-2.5 text-right">{t('dash.common.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {openMetrics.rows.map((row) => (
                      <tr key={row.id} className="text-sm">
                        <td className="px-4 py-2.5 font-extrabold text-graphite">{td(row.material_name)}</td>
                        <td className="px-4 py-2.5 font-semibold text-graphite/60">{row.quantity} {optionLabel(t, UNIT_LABEL_KEYS, row.unit)}</td>
                        <td className="px-4 py-2.5 font-semibold text-graphite/60">{countryFormatMoney(row.price)}/{optionLabel(t, UNIT_LABEL_KEYS, row.unit)}</td>
                        <td className="px-4 py-2.5 font-extrabold text-graphite">{countryFormatMoney(Number(row.price || 0) * Number(row.quantity || 0))}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${ORDER_STATUS_PILL[row.status] || 'bg-slate-100 text-slate-600'}`}>
                            {ORDER_STATUS_KEYS[row.status] ? t(ORDER_STATUS_KEYS[row.status]) : row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!openMetrics.rows.length && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-xs font-medium text-graphite/45">
                          {t('dash.supplier.material.none')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
