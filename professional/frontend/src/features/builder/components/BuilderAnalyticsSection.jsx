/**
 * Builder dashboard: everything below the welcome card, laid out as the
 * Builder dashboard reference -- four figures, Projects by Category, Requests by
 * Status, Project Progress, Recent Requests, Budget Overview and Quick Actions.
 *
 * The numbers are derived from data the dashboard has already loaded -- the
 * project list from /owners/projects and the request list from
 * /project-requests/incoming -- except Budget Overview, which reads each of the
 * builder's projects' cost summary (the same read-only call the Site Engineer
 * and the site log already make). Nothing is stored and nothing is hardcoded:
 * a section with no data shows the existing empty-state style.
 *
 * Every link opens a section the dashboard already has, through `onNavigate`.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Building2, ChevronRight, ClipboardList, FileText, HardHat, Home, Layers, LineChart, Monitor, MoreHorizontal, Send,
  ShoppingCart, UserSearch, Users, Wallet, Wrench, Zap,
} from 'lucide-react'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { groupProjectsByCategory } from '../builderHelpers.js'
import { defaultProjectImage } from '../builderConstants.js'
import { requestTypeLabel } from '../../owner/components/OwnerSections.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { fetchCostToolSummary } from '../../projects/costToolApi.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { newestRequests, requestAgeLabel } from '../../../shared/utils/requestTimes.js'
import { averageCompletion, averageSchedule, formatPercent, scheduleText, scheduleWidth } from '../../../shared/utils/projectProgress.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

const REQUEST_COLORS = { accepted: '#1f7a4d', sent: '#38bdf8', rejected: '#ef4444', pending: '#f5b31b', withdrawn: '#94a3b8' }
const STATUS_PILLS = {
  accepted: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  sent: 'bg-sky-50 text-sky-700',
  rejected: 'bg-rose-50 text-rose-700',
  withdrawn: 'bg-slate-100 text-slate-600',
}

const panel = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]'

// How the requests board categorises a request, so the figures and the board agree.
function requestState(request) {
  if (request.status === 'accepted') return 'accepted'
  if (request.status === 'rejected') return 'rejected'
  if (request.status === 'withdrawn') return 'withdrawn'
  if (request.is_sender && request.status === 'pending') return 'sent'
  return 'pending'
}

function StatCard({ icon: Icon, label, value, sub, tone, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 ${tone.card}`}
    >
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tone.chip}`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-graphite/80">{label}</span>
        <span className="block font-display text-2xl font-extrabold leading-tight text-graphite [overflow-wrap:anywhere]">{value}</span>
        {sub && <span className="block truncate text-xs text-graphite/55">{sub}</span>}
      </span>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition group-hover:translate-x-0.5 ${tone.arrow}`}>
        <ChevronRight className="h-5 w-5" />
      </span>
    </button>
  )
}

function PanelHeader({ icon: Icon, title, onViewAll, action }) {
  const { t } = useLanguage()
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-[15px] font-extrabold text-graphite">
        <Icon className="h-[18px] w-[18px] text-brand-700" /> {title}
      </h2>
      {action}
      {onViewAll && (
        <button type="button" onClick={onViewAll} className="h-8 shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-graphite/80 transition hover:bg-slate-50">
          {t('dash.bld.viewAll')}
        </button>
      )}
    </div>
  )
}

// A ring of slices with the total in its middle, and a legend beside it.
function Donut({ slices, total, centreLabel, centreValue, showPercent = true }) {
  const radius = 46
  const circumference = 2 * Math.PI * radius
  let consumed = 0
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-6 py-1">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" role="img">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="16" />
          {total > 0 && slices.map((slice) => {
            const dash = (slice.value / total) * circumference
            const segment = (
              <circle
                key={slice.id}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="16"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-consumed}
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            )
            consumed += dash
            return segment
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-display text-3xl font-extrabold leading-none text-graphite">{centreValue ?? total}</p>
            <p className="mt-1 text-xs leading-tight text-graphite/60">{centreLabel}</p>
          </div>
        </div>
      </div>
      <ul className="w-full max-w-[15rem] space-y-3.5 sm:w-auto sm:min-w-[12rem]">
        {slices.map((slice) => (
          <li key={slice.id} className="flex items-center gap-2.5 text-[13px] text-graphite/80">
            <i className="h-3 w-3 shrink-0 rounded-full" style={{ background: slice.color }} />
            <span className="truncate">{slice.label}</span>
            <span className="ml-auto pl-2 font-semibold tabular-nums text-graphite">
              {slice.value}{showPercent ? ` (${total > 0 ? Math.round((slice.value / total) * 100) : 0}%)` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The reference's five categories, read from each project's stored building
// type (and construction type, where renovation or interior work is recorded).
// Nothing is stored; a type that matches none of them counts under Others.
const PROJECT_CATEGORIES = [
  { id: 'residential', match: /RESIDEN|VILLA|DUPLEX|HOUSE|APARTMENT|FLAT|BUNGALOW|HOME/, icon: Home, labelKey: 'dash.common.residential', bar: 'bg-[#1f7a4d]', chip: 'bg-emerald-50 text-emerald-700' },
  { id: 'commercial', match: /COMMERC|OFFICE|SHOP|RETAIL|MALL|WAREHOUSE|INDUSTR/, icon: Building2, labelKey: 'dash.common.commercial', bar: 'bg-orange-500', chip: 'bg-orange-50 text-orange-600' },
  { id: 'renovation', match: /RENOVAT|REPAIR|REMODEL/, icon: Wrench, labelKey: 'dash.bld.renovation', bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-600' },
  { id: 'interior', match: /INTERIOR/, icon: Monitor, labelKey: 'dash.bld.interior', bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600' },
]

function projectCategory(project) {
  const text = `${project.construction_type || ''} ${project.building_type || ''}`.toUpperCase()
  // Renovation and interior first: they describe the job whatever the building is.
  const order = ['renovation', 'interior', 'commercial', 'residential']
  const found = order.map((id) => PROJECT_CATEGORIES.find((item) => item.id === id)).find((item) => item.match.test(text))
  return found ? found.id : 'others'
}

function CategoryBars({ projects }) {
  const { t } = useLanguage()
  const total = projects.length
  const rows = [
    ...PROJECT_CATEGORIES,
    { id: 'others', icon: MoreHorizontal, labelKey: 'dash.bld.others', bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-600' },
  ].map((row) => ({ ...row, count: projects.filter((project) => projectCategory(project) === row.id).length }))
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const share = total ? Math.round((row.count / total) * 100) : 0
        return (
          <li key={row.id} className="flex items-center gap-3">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${row.chip}`}><row.icon className="h-4 w-4" /></span>
            <span className="w-24 shrink-0 truncate text-[13px] font-semibold text-graphite">{t(row.labelKey)}</span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className={`block h-full rounded-full ${row.bar}`} style={{ width: `${share}%` }} />
            </span>
            <span className="w-14 shrink-0 text-right text-[13px] font-semibold tabular-nums text-graphite">{row.count} ({share}%)</span>
          </li>
        )
      })}
    </ul>
  )
}

function ProjectProgressList({ projects }) {
  const { t, td } = useLanguage()
  return (
    <ul className="divide-y divide-slate-100">
      {projects.map((project) => {
        // The bar fills to the schedule figure (elapsed planned time), once
        // work has actually started on site; before that it stays empty.
        const started = project.work_started === true
        const percent = started ? scheduleWidth(project) : 0
        const place = project.project_city || project.address || project.pincode
        return (
          <li key={project.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <img
              src={project.cover_image_url ? imageUrl(project.cover_image_url) : defaultProjectImage}
              alt=""
              loading="lazy"
              onError={(event) => { event.currentTarget.src = defaultProjectImage }}
              className="h-14 w-16 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-graphite">{td(project.title)}</p>
              {place && <p className="truncate text-xs text-graphite/55">{td(place)}</p>}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#1f7a4d,#2e9d63)]" style={{ width: `${percent}%` }} />
                </div>
                <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-graphite/70" title={scheduleText(project, t) || undefined}>{!started ? t('progress.scheduleNotStarted') : ['in_progress', 'end_date_passed'].includes(project.schedule_status) ? formatPercent(percent) : t('progress.notAvailable')}</span>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// Total budget against what the builder's projects have spent, from each
// project's cost summary.
function useBudgetTotals(projectList) {
  const [totals, setTotals] = useState(null)
  const ids = projectList.map((project) => project.id).join(',')
  useEffect(() => {
    if (!projectList.length) { setTotals(null); return undefined }
    let active = true
    Promise.allSettled(projectList.map((project) => fetchCostToolSummary(project.id))).then((results) => {
      if (!active) return
      const sum = { budget: 0, spent: 0 }
      results.forEach((result, index) => {
        const dash = result.status === 'fulfilled' ? result.value?.dashboard || {} : {}
        // The summary's own budget, or the project's when the summary is unavailable.
        sum.budget += Number(dash.estimated_budget ?? projectList[index].budget ?? 0)
        sum.spent += Number(dash.spent_budget || 0)
      })
      setTotals(sum)
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
  return totals
}

export default function ContractorAnalyticsSection({ projectList = [], requestList = [], onNavigate }) {
  const { t, td } = useLanguage()
  const go = (sectionId) => () => onNavigate?.(sectionId)

  const projectStats = useMemo(() => {
    const groups = groupProjectsByCategory(projectList)
    return {
      groups,
      total: projectList.length,
      // Over the projects whose verified completion is known; null when none is.
      // Completion once it can be measured; until then the average schedule.
      // Only projects where work has started count towards the average.
      averageProgress: averageCompletion(projectList) ?? averageSchedule(projectList.filter((project) => project.work_started === true)),
    }
  }, [projectList])

  const requestStats = useMemo(() => {
    const counts = { accepted: 0, pending: 0, sent: 0, rejected: 0, withdrawn: 0 }
    requestList.forEach((request) => { counts[requestState(request)] += 1 })
    return counts
  }, [requestList])

  const totalRequests = requestList.length
  const requestSlices = [
    { id: 'accepted', label: t('ui.status.accepted'), value: requestStats.accepted, color: REQUEST_COLORS.accepted },
    { id: 'sent', label: t('dash.contractor.status.proposalSent'), value: requestStats.sent, color: REQUEST_COLORS.sent },
    { id: 'pending', label: t('ui.status.pending'), value: requestStats.pending, color: REQUEST_COLORS.pending },
    { id: 'rejected', label: t('ui.status.rejected'), value: requestStats.rejected, color: REQUEST_COLORS.rejected },
    // Shown only when there are any, as before.
    ...(requestStats.withdrawn ? [{ id: 'withdrawn', label: t('ui.shared.statusWithdrawn'), value: requestStats.withdrawn, color: REQUEST_COLORS.withdrawn }] : []),
  ]
  const statusLabel = {
    accepted: t('ui.status.accepted'),
    pending: t('ui.status.pending'),
    sent: t('dash.bld.sent'),
    rejected: t('ui.status.rejected'),
    withdrawn: t('ui.shared.statusWithdrawn'),
  }

  const rankedProjects = useMemo(
    () => [...projectList].sort((a, b) => Number(b.completion_percentage || 0) - Number(a.completion_percentage || 0)).slice(0, 3),
    [projectList],
  )
  // Newest first by the instant each request was created, not by its text.
  const recentRequests = useMemo(() => newestRequests(requestList, 3), [requestList])

  const budget = useBudgetTotals(projectList)
  const country = projectList[0]?.project_country
  const remaining = budget ? Math.max(0, budget.budget - budget.spent) : 0
  const spentShare = budget?.budget > 0 ? Math.round((budget.spent / budget.budget) * 100) : 0

  const hasProjects = projectStats.total > 0
  const hasRequests = totalRequests > 0

  const quickActions = [
    // The same soft tints as the House Owner's and Site Engineer's service
    // cards: a 60% tint of the hue, its 200 border (300 on hover), a 100 chip.
    { id: 'order', label: t('owner.quick.order'), icon: HardHat, tone: 'border border-emerald-200 bg-emerald-100/60 text-emerald-700 hover:border-emerald-300', chip: 'bg-emerald-100 ring-1 ring-emerald-200', onClick: go('productCatalog') },
    { id: 'partners', label: t('dash.bld.findPartners'), icon: Users, tone: 'border border-orange-200 bg-orange-100/60 text-orange-600 hover:border-orange-300', chip: 'bg-orange-100 ring-1 ring-orange-200', onClick: go('engineers') },
    { id: 'clients', label: t('ui.findClients'), icon: UserSearch, tone: 'border border-sky-200 bg-sky-100/60 text-sky-700 hover:border-sky-300', chip: 'bg-sky-100 ring-1 ring-sky-200', onClick: go('findClients') },
    { id: 'buySell', label: t('dash.bld.buySellMaterials'), icon: ShoppingCart, tone: 'border border-violet-200 bg-violet-100/60 text-violet-700 hover:border-violet-300', chip: 'bg-violet-100 ring-1 ring-violet-200', onClick: go('buySell') },
  ]

  return (
    <section className="space-y-4">
      {/* Four across only where a card has room for its label and value beside
          the icon (each card's text column was 31-90px wide below 1280px, so
          labels were cut to a few letters and a worded value such as "Not
          available" spilled out of the card and the page). */}
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Layers} label={t('dash.bld.totalProjects')} value={projectStats.total} sub={t('dash.bld.currentProjectsSub', { count: projectStats.groups.current.length })}
          tone={{ card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', arrow: 'bg-blue-100 text-blue-700' }} onClick={go('projects')} />
        <StatCard icon={ClipboardList} label={t('dash.bld.acceptedRequests')} value={requestStats.accepted} sub={t('dash.contractor.analytics.pendingSub', { count: requestStats.pending })}
          tone={{ card: 'border-purple-200 bg-purple-50', chip: 'bg-purple-100 text-purple-700', arrow: 'bg-purple-100 text-purple-700' }} onClick={go('requestsBoard')} />
        <StatCard icon={Send} label={t('dash.bld.proposalsSent')} value={requestStats.sent} sub={t('dash.contractor.analytics.rejectedSub', { count: requestStats.rejected })}
          tone={{ card: 'border-green-200 bg-green-50', chip: 'bg-green-100 text-green-700', arrow: 'bg-green-100 text-green-700' }} onClick={go('requestsBoard')} />
        <StatCard icon={BarChart3} label={t('dash.bld.averageProgress')} value={projectStats.averageProgress === null ? t('progress.notAvailable') : formatPercent(projectStats.averageProgress)} sub={t('dash.contractor.analytics.upcomingSub', { count: projectStats.groups.upcoming.length })}
          tone={{ card: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-600', arrow: 'bg-orange-100 text-orange-600' }} onClick={go('projects')} />
      </div>

      {/* One line: Projects by Category, Recent Requests and Quick Actions.
          From 1024px: at 768px each panel was ~198px, too narrow for a request
          row's title, status and age, which ran out of the panel. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={panel}>
          <PanelHeader icon={BarChart3} title={t('dash.bld.projectsByCategory')} onViewAll={go('projects')} />
          {hasProjects
            ? <CategoryBars projects={projectList} />
            : <EmptyState title={t('dash.contractor.noAssignedProjects')} message={t('dash.contractor.analytics.noProjectData')} />}
        </div>

        <div className={panel}>
          <PanelHeader icon={ClipboardList} title={t('dash.bld.recentRequests')} onViewAll={go('requestsBoard')} />
          {recentRequests.length ? (
            <ul className="divide-y divide-slate-100">
              {recentRequests.map((request) => {
                const state = requestState(request)
                const other = request.is_sender ? request.receiver_name : request.sender_name
                return (
                  <li key={request.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${STATUS_PILLS[state]}`}>
                      {state === 'sent' ? <Send className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-graphite">{requestTypeLabel(request.request_type, t, td)}</span>
                      <span className="block truncate text-xs text-graphite/55">{td(request.project_title || other || '')}</span>
                    </span>
                    <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${STATUS_PILLS[state]}`}>{statusLabel[state]}</span>
                    <span className="hidden min-w-20 shrink-0 whitespace-nowrap text-right text-[11px] text-graphite/50 sm:block">{requestAgeLabel(request.created_at)}</span>
                  </li>
                )
              })}
            </ul>
          ) : <EmptyState title={t('dash.contractor.empty.allTitle')} message={t('dash.contractor.analytics.noRequestData')} />}
        </div>

        <div className={panel}>
          <PanelHeader icon={Zap} title={t('dash.engineer.quickActions')} />
          <div className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-center transition hover:-translate-y-0.5 hover:shadow-sm ${action.tone}`}
              >
                <span className={`grid h-8 w-8 place-items-center rounded-full ${action.chip}`}><action.icon className="h-[18px] w-[18px]" /></span>
                <span className="max-w-full text-xs font-bold leading-tight text-graphite [overflow-wrap:anywhere]">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={panel}>
          <PanelHeader icon={LineChart} title={t('dash.bld.projectProgress')} onViewAll={go('projects')} />
          {hasProjects
            ? <ProjectProgressList projects={rankedProjects} />
            : <EmptyState title={t('dash.contractor.noAssignedProjects')} message={t('dash.contractor.analytics.noProgressData')} />}
        </div>

        <div className={panel}>
          <PanelHeader icon={FileText} title={t('dash.bld.requestsByStatus')} onViewAll={go('requestsBoard')} />
          {hasRequests
            ? <Donut slices={requestSlices} total={totalRequests} centreLabel={t('dash.bld.totalRequests')} />
            : <EmptyState title={t('dash.contractor.empty.allTitle')} message={t('dash.contractor.analytics.noRequestData')} />}
        </div>

        <div className={panel}>
          <PanelHeader icon={Wallet} title={t('dash.bld.budgetOverview')} />
          {hasProjects && budget && budget.budget > 0 ? (
            <div className="flex flex-wrap items-center gap-5">
              <div className="relative h-36 w-36 shrink-0">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
                  <circle cx="60" cy="60" r="46" fill="none" stroke="#f5b31b" strokeWidth="14" />
                  <circle cx="60" cy="60" r="46" fill="none" stroke="#1f7a4d" strokeWidth="14"
                    strokeDasharray={`${(spentShare / 100) * 2 * Math.PI * 46} ${2 * Math.PI * 46}`} />
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="font-display text-lg font-extrabold leading-none text-graphite">{formatMoney(budget.budget, country, { notation: 'compact', maximumFractionDigits: 2 })}</p>
                    <p className="mt-1 text-[11px] text-graphite/60">{t('dash.bld.totalBudget')}</p>
                  </div>
                </div>
              </div>
              <dl className="min-w-[10rem] flex-1 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <dt className="flex items-center gap-2 text-[13px] text-graphite/70"><i className="h-3 w-3 rounded-full bg-[#1f7a4d]" />{t('dash.engineer.analytics.spent')}</dt>
                    <dd className="font-display text-lg font-extrabold text-graphite">{formatMoney(budget.spent, country)}</dd>
                  </div>
                  <span className="text-[13px] text-graphite/60">{spentShare}%</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div>
                    <dt className="flex items-center gap-2 text-[13px] text-graphite/70"><i className="h-3 w-3 rounded-full bg-[#f5b31b]" />{t('dash.engineer.analytics.remaining')}</dt>
                    <dd className="font-display text-lg font-extrabold text-graphite">{formatMoney(remaining, country)}</dd>
                  </div>
                  <span className="text-[13px] text-graphite/60">{Math.max(0, 100 - spentShare)}%</span>
                </div>
              </dl>
            </div>
          ) : (
            <EmptyState
              title={hasProjects ? t('dash.bld.budgetOverview') : t('dash.contractor.noAssignedProjects')}
              message={!hasProjects ? t('dash.contractor.analytics.noProjectData') : budget ? t('dash.engineer.analytics.noBudgetYet') : t('shop.loading')}
            />
          )}
        </div>

      </div>
    </section>
  )
}
