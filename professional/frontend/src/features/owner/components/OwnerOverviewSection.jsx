/**
 * The House Owner's global Dashboard — every project at once.
 *
 * This is the landing page, and it is the one place that is deliberately not
 * scoped to a single project: the counts, the status split, the progress and
 * the budgets are read across the whole `projectList`. Opening one project
 * leaves here for that project's own page.
 *
 * Three tiers, evenly spaced: the four figures, then Recent Activity beside
 * Upcoming Deadlines, then Project Status beside Budget Across Projects. All
 * four panels share one list height, so a row reads as a single band and no
 * card can grow into the row beneath it — while every row of real data stays on
 * the page, scrolling inside its own card rather than being truncated away.
 *
 * Everything is derived from data the dashboard has already fetched
 * (`projectList` and `requestList`), so this screen makes no request of its
 * own, and every bar is the same hand-drawn CSS the other analytics screens
 * use, in the owner palette's existing tokens — no chart library, no new colour.
 *
 * Money is never summed across countries. A project is always shown in its own
 * project country's currency, and the totals under the budget bars are one line
 * per country, so two projects priced in different currencies can never be
 * added into a single meaningless number.
 */
import { useMemo, useState } from 'react'
import { Activity, ArrowRight, Calendar, Check, ClipboardList, HardHat, Home, TrendingUp, X } from 'lucide-react'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { requestTypeLabel } from './OwnerSections.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { Card, EmptyState, Hero } from './OwnerPanels.jsx'
import { OwnerMaterialsSection, OwnerTechnicianSection } from './OwnerDiscovery.jsx'
import { constructionTypeText, countryText, currentProjectAmount, formatProjectDate, money, projectBuilderContext } from '../ownerHelpers.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatDateTime, todayCalendarDate } from '../../../shared/utils/formatters.js'
import { averageCompletion, averageSchedule, completionPercent, completionText, completionWidth, formatPercent, scheduleText, scheduleWidth } from '../../../shared/utils/projectProgress.js'

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))))

// One list height for all four panels: each is bounded and scrolls inside its
// own card, so every row is the same height and a card can never spill over the
// one below it, without any list being truncated.
const PANEL_LIST = 'max-h-52 space-y-2 overflow-y-auto pr-0.5'

// Each service card's colour, in order: blue, purple, green, orange -- a soft
// tint of its hue, with the icon chip and arrow in the same hue. Used by the
// House Owner's cards and the Site Engineer dashboard's compact ones alike.
const QUICK_TONES = {
  construction: {
    card: 'bg-blue-100/60 border-blue-200 hover:border-blue-300 dark:bg-blue-950/60 dark:border-blue-900',
    chip: 'bg-blue-100 text-blue-700 ring-blue-200 group-hover:bg-blue-200',
  },
  buySell: {
    card: 'bg-purple-100/60 border-purple-200 hover:border-purple-300 dark:bg-purple-950/60 dark:border-purple-900',
    chip: 'bg-purple-100 text-purple-700 ring-purple-200 group-hover:bg-purple-200',
  },
  technician: {
    card: 'bg-green-100/60 border-green-200 hover:border-green-300 dark:bg-green-950/60 dark:border-green-900',
    chip: 'bg-green-100 text-green-700 ring-green-200 group-hover:bg-green-200',
  },
  order: {
    card: 'bg-orange-100/60 border-orange-200 hover:border-orange-300 dark:bg-orange-950/60 dark:border-orange-900',
    chip: 'bg-orange-100 text-orange-700 ring-orange-200 group-hover:bg-orange-200',
  },
}

// Each Quick Action's picture (public/landing/owner-quick/, credits in its
// CREDITS.json). All four pictures are cut-outs, so they are contained on the
// card's white rather than cropped to fill the frame.
const QUICK_VISUALS = {
  construction: { image: '/landing/owner-quick/construction.png', contain: true },
  buySell: { image: '/landing/owner-quick/property.png', contain: true },
  technician: { image: '/landing/owner-quick/technician.png', contain: true },
  order: { image: '/landing/owner-quick/materials.png', contain: true },
}

// One Quick Action: picture on the left, title, hint and arrow on the right.
// A picture that fails to load gives way to the action's own icon, as the card
// showed before.
// compact: a smaller card (the Site Engineer dashboard); the House Owner's is unchanged.
export function QuickActionCard({ action, compact = false }) {
  const [imageFailed, setImageFailed] = useState(false)
  // `tone` (optional) borrows another card's colour; the House Owner's four use their own.
  const tone = QUICK_TONES[action.tone] || QUICK_TONES[action.id] || QUICK_TONES.construction
  const visual = QUICK_VISUALS[action.id]
  const showImage = visual?.image && !imageFailed
  return (
    <button
      type="button"
      data-testid={`owner-quick-${action.id}`}
      onClick={action.onClick}
      disabled={action.disabled}
      className={`group flex min-w-0 flex-col border text-left ${compact ? 'rounded-xl px-2 py-1.5' : 'rounded-2xl p-3'} shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-26px_rgba(15,23,42,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ocaccent-300 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${tone.card}`}
    >
      <span className={`flex w-full min-w-0 items-center ${compact ? 'gap-2.5' : 'gap-3'}`}>
        <span className={`shrink-0 overflow-hidden ${compact ? 'h-11 w-14 rounded-lg' : 'h-24 w-28 rounded-xl'}`}>
          {showImage ? (
            <img
              src={visual.image}
              alt=""
              width="224"
              height="192"
              loading="lazy"
              onError={() => setImageFailed(true)}
              className={`h-full w-full ${visual.contain ? 'object-contain' : 'object-cover transition duration-300 group-hover:scale-105'}`}
            />
          ) : (
            <span className={`grid h-full w-full place-items-center ring-1 ${tone.chip}`}>
              <action.icon aria-hidden="true" className={compact ? 'h-5 w-5' : 'h-8 w-8'} strokeWidth={1.75} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`font-display font-extrabold leading-tight text-oc-ink ${compact ? 'truncate text-[13px]' : 'text-[15px]'}`}>{action.label}</span>
          <span className={`text-oc-muted ${compact ? 'mt-0.5 truncate text-[11px]' : 'mt-1 text-xs leading-snug'}`}>{action.hint}</span>
          <span className={`grid place-items-center rounded-full ring-1 transition ${compact ? 'mt-1 h-5 w-5' : 'mt-2 h-8 w-8'} ${tone.chip}`} aria-hidden="true">
            <ArrowRight className={`${compact ? 'h-3 w-3' : 'h-4 w-4'} transition group-hover:translate-x-0.5 rtl:-scale-x-100`} strokeWidth={2.25} />
          </span>
        </span>
      </span>
    </button>
  )
}

export default function OwnerOverviewSection({
  user,
  userShell,
  projectList = [],
  requestList = [],
  onOpenProject,
  quickActions = [],
  onOpenCatalog,
  catalogAvailable = false,
  onBookTechnician,
  onAcceptRequest,
  onRejectRequest,
  decisionMessage = '',
}) {
  const { t, td } = useLanguage()

  const summary = useMemo(() => {
    const total = projectList.length
    const isCompleted = (project) => String(project.status || '').toLowerCase() === 'completed' || clampPercent(project.completion_percentage) >= 100
    const completed = projectList.filter(isCompleted).length
    // In progress: started (the server's `started` flag -- start date reached,
    // progress or work recorded) and not yet completed.
    const active = projectList.filter((project) => project.started === true && !isCompleted(project)).length
    // Over the projects whose verified completion is known; null when none is.
    // Completion once it can be measured; until then the average schedule.
    const averageProgress = averageCompletion(projectList) ?? averageSchedule(projectList)

    // One bucket per status value the projects actually carry, so a status the
    // API adds later appears here on its own without a change to this screen.
    const statusCounts = projectList.reduce((counts, project) => {
      const status = String(project.status || 'active').toLowerCase()
      counts[status] = (counts[status] || 0) + 1
      return counts
    }, {})

    // Budgets stay inside their own project country. Never a cross-country sum.
    const budgetByCountry = projectList.reduce((totals, project) => {
      const country = project.project_country || user?.country_of_residence || 'India'
      totals[country] = (totals[country] || 0) + (currentProjectAmount(project) || 0)
      return totals
    }, {})

    return { total, active, completed, averageProgress, statusCounts, budgetByCountry }
  }, [projectList, user?.country_of_residence])

  // The widest budget on the board sets the bar scale, exactly as the existing
  // category bars do. Only projects that actually carry a budget are plotted.
  // Each project's current amount (contract, else awarded quotation, else
  // budget) -- the same figure its project card shows.
  const budgetedProjects = projectList.filter((project) => currentProjectAmount(project) !== null)
  const largestBudget = Math.max(...budgetedProjects.map((project) => currentProjectAmount(project)), 1)

  // What is still ahead: each project's own end date (the one the owner
  // entered), soonest first, from today on. A project whose end date is not
  // set has no deadline and is not listed. Calendar dates ("YYYY-MM-DD")
  // compare as text.
  const upcomingDeadlines = useMemo(() => {
    const today = todayCalendarDate()
    return projectList
      .map((project) => ({ project, dueAt: project.end_date || null }))
      .filter(({ dueAt }) => dueAt && dueAt >= today)
      .sort((first, second) => (first.dueAt < second.dueAt ? -1 : first.dueAt > second.dueAt ? 1 : 0))
  }, [projectList])

  // What has happened. Every request the account has sent or received, which is
  // the activity record this dashboard already holds; the API returns them
  // newest first, so no re-sorting and no second timestamp format.
  const recentActivity = requestList

  return (
    // Three tiers, one gap value between and inside every row.
    <div className="flex flex-col gap-4">
      {/* The four figures now sit in the banner's right side. */}
      {/* The banner shows the welcome and the House Owner picture only; the
          four figures are no longer drawn inside it. */}
      <Hero user={userShell} />

      {/* QUICK ACTIONS — the four things a House Owner comes here to start.
          Each card opens a page that already exists; the handlers come from
          the dashboard. One across on a phone, two on a tablet, four from `xl`. */}
      {quickActions.length > 0 && (
        <section aria-labelledby="owner-quick-actions">
          <p id="owner-quick-actions" className="mb-2 text-xs font-extrabold uppercase tracking-wide text-oc-muted">
            {t('owner.quick.title')}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            {quickActions.map((action) => (
              <QuickActionCard key={action.id} action={action} />
            ))}
          </div>
        </section>
      )}

      {/* The technician trades Partner books, then what can be ordered (real
          /shop/products rows). Both open places that already exist. */}
      {onBookTechnician && <OwnerTechnicianSection onBook={onBookTechnician} />}
      <OwnerMaterialsSection onOpenCatalog={onOpenCatalog} catalogAvailable={catalogAvailable} country={user?.country_of_residence || 'India'} />

      {/* MIDDLE ROW — Recent Activity beside Upcoming Deadlines. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card compact title={t('dash.owner.overview.activityTitle')} icon={Activity} className="scroll-mt-24" id="owner-recent-activity">
          {decisionMessage && (
            <div role="alert" className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {decisionMessage}
            </div>
          )}
          {recentActivity.length ? (
            <div className={PANEL_LIST}>
              {recentActivity.map((request) => {
                // The same rule the requests table applies: only a pending
                // request that somebody else sent can be acted on.
                const canAct = request.status === 'pending' && !request.is_sender
                return (
                  <div key={request.id} className="rounded-xl border border-oc-line px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-oc-mint ring-1 ring-oc-line">
                        <img src={userAvatarSrc(request)} alt="" className="h-full w-full object-cover" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-oc-ink">{requestTypeLabel(request.request_type, t, td)}</span>
                        <span className="block truncate text-[10px] font-semibold text-oc-muted">
                          {td(request.sender_name)}
                          {request.project_title ? ` · ${td(request.project_title)}` : ''}
                        </span>
                      </span>
                      <StatusPill status={request.status} soft />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      {/* The raw ISO timestamp used to be printed here. */}
                      <span className="text-[10px] font-semibold text-oc-faint">{formatDateTime(request.created_at)}</span>
                      {canAct && (
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onAcceptRequest?.(request.id)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-oc-green px-2.5 text-[11px] font-extrabold text-white transition hover:bg-oc-deep"
                          >
                            <Check className="h-3 w-3" /> {t('dash.common.accept')}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRejectRequest?.(request.id)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 text-[11px] font-extrabold text-red-600 transition hover:bg-red-100"
                          >
                            <X className="h-3 w-3" /> {t('dash.common.reject')}
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState title={t('dash.owner.overview.activityEmptyTitle')} message={t('dash.owner.overview.activityEmptySub')} />
          )}
        </Card>

        <Card compact title={t('dash.owner.overview.deadlinesTitle')} icon={Calendar}>
          {upcomingDeadlines.length ? (
            <div className={PANEL_LIST}>
              {upcomingDeadlines.map(({ project, dueAt }) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpenProject?.(project)}
                  className="dash-gold-hover flex w-full items-center justify-between gap-2 rounded-xl border border-oc-line px-2.5 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-oc-ink">{td(project.title)}</span>
                    <span className="block truncate text-[10px] font-semibold text-oc-muted">{t('dash.owner.projectDetails.endDate')}</span>
                  </span>
                  <span className="shrink-0 rounded-full border border-oc-line bg-oc-paper px-2 py-0.5 text-[10px] font-extrabold text-oc-deep">
                    {formatProjectDate(dueAt, t)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title={t('dash.owner.overview.deadlinesEmptyTitle')} message={t('dash.owner.overview.deadlinesEmptySub')} />
          )}
        </Card>
      </div>

      {/* BOTTOM ROW — Project Status beside Budget Across Projects. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card compact title={t('dash.owner.overview.statusTitle')} icon={ClipboardList}>
          {projectList.length ? (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {Object.entries(summary.statusCounts).map(([status, count]) => (
                  <span key={status} className="inline-flex items-center gap-1.5 rounded-full border border-oc-line bg-oc-paper px-2 py-1">
                    <StatusPill status={status} />
                    <span className="text-[11px] font-extrabold text-oc-ink">{count}</span>
                  </span>
                ))}
              </div>
              <div className={PANEL_LIST}>
                {projectList.map((project) => {
                  const builderContext = projectBuilderContext(project)
                  const builderLabel = builderContext.kind === 'self'
                    ? constructionTypeText(project.construction_type, t)
                    : builderContext.kind === 'builder'
                      ? td(builderContext.name)
                      : t('dash.owner.projectList.notAssigned')
                  // Completion once it can be measured; until then the bar and
                  // figure follow the schedule, as the project cards do.
                  const measured = completionPercent(project) !== null
                  const completion = measured ? completionWidth(project) : scheduleWidth(project)
                  const hasSchedule = ['in_progress', 'end_date_passed'].includes(project.schedule_status)
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onOpenProject?.(project)}
                      className="dash-gold-hover block w-full rounded-xl border border-oc-line px-2.5 py-2 text-left"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-bold text-oc-ink">{td(project.title)}</span>
                          <span className="block truncate text-[10px] font-semibold text-oc-muted">{builderLabel}</span>
                        </span>
                        <StatusPill status={project.status || 'active'} />
                      </span>
                      {/* The per-project progress bar that had a panel of its
                          own before. Same value, on the row it describes. */}
                      <span className="mt-1.5 flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-oc-sunken">
                          <span className="block h-full rounded-full bg-[linear-gradient(90deg,#126b45,#22a06b)]" style={{ width: `${completion}%` }} />
                        </span>
                        <span className="shrink-0 text-[10px] font-bold text-oc-muted" title={measured ? undefined : scheduleText(project, t) || undefined}>{measured ? completionText(project, t) : hasSchedule ? formatPercent(completion) : t('progress.notAvailable')}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <EmptyState title={t('dash.owner.overview.emptyTitle')} message={t('dash.owner.overview.emptySub')} />
          )}
        </Card>

        <Card compact title={t('dash.owner.overview.budgetTitle')} icon={Home}>
          {budgetedProjects.length ? (
            <>
              <div className={PANEL_LIST}>
                {budgetedProjects.map((project) => {
                  const amount = currentProjectAmount(project)
                  const share = Math.max(4, Math.round((amount / largestBudget) * 100))
                  return (
                    <div key={project.id}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-bold text-oc-muted">
                        <span className="truncate text-oc-ink">{td(project.title)}</span>
                        <span className="shrink-0">{money(amount, project.project_country)}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-oc-sunken">
                        <div className="h-full rounded-full bg-[linear-gradient(90deg,#126b45,#22a06b)]" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* One total per project country. Two currencies are never added
                  together into a single figure. */}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-oc-line pt-2">
                {Object.entries(summary.budgetByCountry)
                  .filter(([, amount]) => amount > 0)
                  .map(([country, amount]) => (
                    <span key={country} className="text-[11px] font-bold text-oc-muted">
                      {countryText(country, t)}: <b className="text-oc-ink">{money(amount, country)}</b>
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <EmptyState title={t('dash.owner.overview.emptyTitle')} message={t('dash.owner.overview.emptySub')} />
          )}
        </Card>
      </div>
    </div>
  )
}
