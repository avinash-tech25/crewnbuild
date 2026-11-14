/**
 * The Site Engineer dashboard's body, laid out as the dashboard reference:
 * Quick Actions, four budget figures, then Budget Utilization, Cost Breakdown
 * and Daily Expenditure beside Site Activity Overview, Recent Activities and
 * Top Materials Usage.
 *
 * Every figure is an existing one: the project's cost-tool summary (the same
 * call the old analytics cards made), the dashboard's own counts, and the
 * engineer's notifications. Nothing new is fetched from the server or saved.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell, BellRing, ClipboardCheck, ClipboardList, FileText, FolderKanban, HandCoins, Hammer, Layers,
  Package, PieChart, ReceiptText, Truck, Users, Wallet, Wrench, Zap, BarChart3, ArrowRight, Building2,
} from 'lucide-react'
import { fetchCostToolSummary } from '../../projects/costToolApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatRelativeTime } from '../../../shared/utils/formatters.js'
import { DailyLine, axisDateLabel, formatQty, money, unitLabelFrom } from '../../site-work/components/EngineerAnalyticsSection.jsx'

const panel = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] sm:p-5'

function PanelTitle({ icon: Icon, title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-slate-900">
        <Icon className="h-[18px] w-[18px] text-brand-700" /> {title}
      </h2>
      {action}
    </div>
  )
}

function LinkButton({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 transition hover:text-brand-900">
      {children} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  )
}

function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs font-bold text-slate-400">{children}</p>
}

function Bar({ value, className }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone, children }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.35)] ${tone.card}`}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tone.chip}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold text-slate-500">{label}</p>
        <p className="truncate font-display text-base font-extrabold leading-tight text-slate-950">{value}</p>
        {sub && <p className="truncate text-[11px] text-slate-500">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

function Ring({ fraction }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const spent = Math.max(0, Math.min(1, fraction)) * circumference
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#fbbf24" strokeOpacity="0.85" strokeWidth="16" />
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#1f7a4d" strokeWidth="16" strokeDasharray={`${spent} ${circumference - spent}`} />
    </svg>
  )
}

const RANGES = ['7', '30', 'month', 'all']

const ACTIVITY_ICONS = {
  supplier: Truck,
  material: Package,
  team: Users,
  task: ClipboardCheck,
  budget: HandCoins,
  message: Bell,
}

function activityIcon(notification) {
  const text = `${notification.module || ''} ${notification.title || ''}`.toLowerCase()
  const match = Object.keys(ACTIVITY_ICONS).find((key) => text.includes(key))
  return ACTIVITY_ICONS[match] || BellRing
}

export default function EngineerDashboardOverview({
  projectList = [],
  projectId,
  quickActions,
  activityTiles = [],
  notifications = [],
  onViewAllActivity,
}) {
  const { t, td } = useLanguage()
  const unitLabel = unitLabelFrom(t, td)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState('all')
  const [allMaterials, setAllMaterials] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectId) { setSummary(null); return }
    setLoading(true)
    try {
      setSummary(await fetchCostToolSummary(projectId))
    } catch {
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { refresh() }, [refresh])
  // As before: the figures refresh when the engineer comes back to the tab.
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const project = projectList.find((item) => String(item.id) === String(projectId))
  const country = project?.project_country
  const dash = summary?.dashboard || {}
  const budget = Number(dash.estimated_budget || 0)
  const spent = Number(dash.spent_budget || 0)
  const remaining = budget - spent
  const pct = Number(dash.budget_percentage || 0)
  const days = summary?.registers?.length || 0
  const ready = Boolean(projectId && summary)
  const show = (value) => (ready ? value : loading ? '…' : '—')

  const categories = [
    { key: 'material', label: t('dash.engineer.analytics.material'), value: Number(dash.material_cost || 0), icon: Building2, bar: 'bg-brand-600', chip: 'bg-sky-50 text-sky-700' },
    { key: 'labour', label: t('dash.engineer.analytics.labour'), value: Number(dash.labour_cost || 0), icon: Hammer, bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-600' },
    { key: 'equipment', label: t('dash.engineer.analytics.equipment'), value: Number(dash.machinery_cost || 0), icon: Wrench, bar: 'bg-sky-400', chip: 'bg-sky-50 text-sky-600' },
    { key: 'other', label: t('dash.engineer.analytics.otherExpenses'), value: Number(dash.expenses || 0), icon: Layers, bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-600' },
  ]
  const categoryTotal = categories.reduce((sum, item) => sum + item.value, 0)

  const dailySeries = useMemo(() => {
    const now = new Date()
    const since = range === '7' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
      : range === '30' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
        : range === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
          : null
    return [...(summary?.registers || [])]
      .filter((register) => !since || new Date(`${String(register.work_date).slice(0, 10)}T00:00:00`) >= since)
      .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)))
      .map((register) => ({
        label: axisDateLabel(register.work_date),
        total: Number(register.labour_cost || 0) + Number(register.material_cost || 0) + Number(register.equipment_cost || 0) + Number(register.total_expenses || 0),
      }))
      .filter((point) => point.total > 0)
  }, [summary, range])
  const dailyTotal = dailySeries.reduce((sum, point) => sum + point.total, 0)

  const materials = useMemo(() => [...(summary?.materials || [])]
    .map((item) => ({ ...item, cost: Number(item.total_used || 0) * Number(item.rate || 0) }))
    .sort((a, b) => b.cost - a.cost || Number(b.total_used || 0) - Number(a.total_used || 0)), [summary])
  const shownMaterials = allMaterials ? materials : materials.slice(0, 4)

  const recent = notifications.slice(0, 4)

  return (
    <div className="space-y-4">
      {/* Quick Actions first, then the budget figures for the chosen project. */}
      {quickActions}

      {/* Budget figures for the chosen project */}
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
        <Kpi icon={ReceiptText} label={t('dash.engineer.analytics.projectBudget')} value={show(money(budget, country))} sub={td(project?.title || '')}
          tone={{ card: 'border-slate-200 bg-white', chip: 'bg-emerald-50 text-emerald-700' }}>
          {ready && budget > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1"><Bar value={pct} className="bg-brand-700" /></div>
              <span className="text-[11px] font-bold text-brand-700">{t('dash.eng.usedPct', { pct })}</span>
            </div>
          )}
        </Kpi>
        <Kpi icon={Wallet} label={t('dash.engineer.analytics.totalSpent')} value={show(money(spent, country))}
          sub={ready ? (days ? t('dash.engineer.analytics.daysRecorded', { n: days }) : t('dash.engineer.analytics.noExpenses')) : ''}
          tone={{ card: 'border-slate-200 bg-white', chip: 'bg-orange-100 text-orange-600' }} />
        <Kpi icon={PieChart} label={t('dash.engineer.analytics.remainingBudget')} value={show(money(Math.max(0, remaining), country))}
          sub={ready && budget > 0 ? (remaining < 0 ? t('dash.engineer.analytics.budgetExceeded') : t('dash.eng.remainingPct', { pct: Math.round((remaining / budget) * 10000) / 100 })) : ''}
          tone={{ card: 'border-slate-200 bg-white', chip: 'bg-sky-100 text-sky-600' }} />
        <Kpi icon={BarChart3} label={t('dash.engineer.analytics.budgetUtilization')} value={show(`${pct}%`)}
          tone={{ card: 'border-slate-200 bg-white', chip: 'bg-emerald-50 text-emerald-600' }}>
          {ready && <div className="mt-1.5"><Bar value={pct} className={pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-orange-400' : 'bg-amber-400'} /></div>}
        </Kpi>
      </div>
      {!projectId && <Empty>{t('dash.eng.noProject')}</Empty>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Budget Utilization */}
            <section className={panel}>
              <PanelTitle icon={BarChart3} title={t('dash.engineer.analytics.budgetUtilization')} />
              {ready && budget > 0 ? (
                <div className="flex flex-wrap items-center gap-5">
                  <div className="relative">
                    <Ring fraction={spent / budget} />
                    <div className="absolute inset-0 grid place-items-center text-center">
                      <div>
                        <p className="font-display text-2xl font-extrabold text-slate-950">{Math.round((spent / budget) * 100)}%</p>
                        <p className="text-xs font-semibold text-slate-500">{t('dash.eng.used')}</p>
                      </div>
                    </div>
                  </div>
                  <dl className="min-w-[10rem] flex-1 space-y-2.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-2 text-slate-600"><span className="h-3 w-3 rounded-full bg-[#1f7a4d]" />{t('dash.engineer.analytics.spent')}</dt>
                      <dd className="font-semibold text-slate-800">{money(spent, country)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="flex items-center gap-2 text-slate-600"><span className="h-3 w-3 rounded-full bg-amber-400" />{t('dash.engineer.analytics.remaining')}</dt>
                      <dd className="font-semibold text-slate-800">{money(Math.max(0, remaining), country)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
                      <dt className="font-semibold text-slate-700">{t('dash.eng.totalBudget')}</dt>
                      <dd className="font-bold text-slate-900">{money(budget, country)}</dd>
                    </div>
                  </dl>
                </div>
              ) : <Empty>{ready ? t('dash.engineer.analytics.noBudgetYet') : '—'}</Empty>}
            </section>

            {/* Cost Breakdown */}
            <section className={panel}>
              <PanelTitle icon={HandCoins} title={t('dash.engineer.analytics.costBreakdown')} />
              {ready && categoryTotal > 0 ? (
                <div className="space-y-3">
                  {categories.map((item) => {
                    const share = categoryTotal > 0 ? Math.round((item.value / categoryTotal) * 100) : 0
                    return (
                      <div key={item.key} className="flex items-center gap-3">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${item.chip}`}><item.icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                            <span className="truncate text-slate-700">{item.label}</span>
                            <span className="font-semibold text-slate-800">{money(item.value, country)}</span>
                          </div>
                          <Bar value={share} className={item.bar} />
                        </div>
                        <span className="w-9 shrink-0 text-right text-xs font-semibold text-slate-500">{share}%</span>
                      </div>
                    )
                  })}
                </div>
              ) : <Empty>{ready ? t('dash.engineer.analytics.noExpenses') : '—'}</Empty>}
            </section>
          </div>

          {/* Daily Expenditure */}
          <section className={panel}>
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-slate-900">
                  <FileText className="h-[18px] w-[18px] text-brand-700" /> {t('dash.engineer.analytics.dailyExpenditure')}
                </h2>
                {ready && <p className="mt-2 font-display text-2xl font-extrabold text-slate-950">{money(dailyTotal, country)}</p>}
              </div>
              <div className="flex gap-1.5">
                {RANGES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setRange(item)}
                    aria-pressed={range === item}
                    className={`h-8 rounded-lg px-3 text-xs font-semibold transition ${range === item ? 'bg-brand-800 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {t(`dash.eng.range.${item}`)}
                  </button>
                ))}
              </div>
            </div>
            {dailySeries.length ? <DailyLine series={dailySeries} country={country} /> : <Empty>{ready ? t('dash.engineer.analytics.noExpenses') : '—'}</Empty>}
          </section>
        </div>

        <div className="min-w-0 space-y-4">
          {/* Site Activity Overview: the dashboard's existing counts */}
          <section className={panel}>
            <PanelTitle icon={FolderKanban} title={t('dash.eng.siteActivity')} />
            <div className="grid grid-cols-2 gap-2.5">
              {activityTiles.map((tile) => (
                <button
                  key={tile.id}
                  type="button"
                  onClick={tile.onClick}
                  className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tile.tone.card}`}
                >
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tile.tone.chip}`}><tile.icon className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-600">{tile.label}</span>
                    <span className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-xl font-extrabold text-slate-950">{tile.value}</span>
                      {tile.note && <span className="truncate text-[11px] text-slate-500">{tile.note}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Recent Activities: the engineer's latest notifications */}
          <section className={panel}>
            <PanelTitle icon={ClipboardList} title={t('dash.eng.recentActivities')} action={onViewAllActivity && <LinkButton onClick={onViewAllActivity}>{t('dash.eng.viewAll')}</LinkButton>} />
            {recent.length ? (
              <ul className="divide-y divide-slate-100">
                {recent.map((notification) => {
                  const Icon = activityIcon(notification)
                  return (
                    <li key={notification.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">{td(notification.title)}</span>
                        {notification.body && <span className="block truncate text-xs text-slate-500">{td(notification.body)}</span>}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">{formatRelativeTime(notification.created_at)}</span>
                    </li>
                  )
                })}
              </ul>
            ) : <Empty>{t('dash.eng.noActivity')}</Empty>}
          </section>

          {/* Top Materials Usage */}
          <section className={panel}>
            <PanelTitle
              icon={Zap}
              title={t('dash.eng.topMaterials')}
              action={materials.length > 4 && (
                <LinkButton onClick={() => setAllMaterials((value) => !value)}>{allMaterials ? t('dash.eng.showLess') : t('dash.eng.viewAll')}</LinkButton>
              )}
            />
            {materials.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[11px] text-slate-500">
                      <th className="px-2 py-2 text-left font-semibold">{t('dash.engineer.analytics.material')}</th>
                      <th className="px-2 py-2 text-left font-semibold">{t('dash.engineer.analytics.used')}</th>
                      <th className="px-2 py-2 text-left font-semibold">{t('dash.engineer.analytics.remaining')}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t('dash.engineer.analytics.cost')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shownMaterials.map((item) => (
                      <tr key={item.material}>
                        <td className="max-w-[8rem] truncate px-2 py-2 font-semibold text-slate-800">{td(item.material)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-600">{formatQty(item.total_used)} {unitLabel(item.unit)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-600">{formatQty(item.remaining)} {unitLabel(item.unit)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right text-slate-700">{item.cost > 0 ? money(item.cost, country) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>{ready ? t('dash.engineer.analytics.noMaterialRecords') : '—'}</Empty>}
          </section>
        </div>
      </div>
    </div>
  )
}
