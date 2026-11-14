// The Project Analysis tab of an owner's project: budget, recorded spending,
// work-item progress, material usage and schedule for this one project.
//
// Read-only. Everything comes from the project payload and, for the builder,
// the cost summary (GET /cost-tool/projects/{id}/summary); for the House Owner,
// its owner-safe subset (GET /owners/projects/{id}/analysis), which the backend
// returns only to this project's owner. Nothing here estimates or fills in a value:
// a figure the records do not hold is shown as "Not set" / "Not available".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, CalendarCheck, CalendarDays, CheckCircle2, Clock3, Loader2, Package,
  PiggyBank, Receipt, RotateCcw, TrendingUp, Wallet,
} from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchCostToolSummary, fetchOwnerProjectAnalysis } from '../../projects/costToolApi.js'
import { formatPercent, scheduleText } from '../../../shared/utils/projectProgress.js'
import { formatProjectDate, money } from '../ownerHelpers.js'
import {
  MISSING_ANALYSIS, analysisError, analysisFigures, budgetRows, materialRows, recentExpenses, spendingTrend, workItemProgress,
} from '../ownerProjectAnalysis.js'

// Series colours, one per spending category, fixed in this order. Validated
// with the dataviz checks: the light steps on the light surface, the dark
// steps (same hues, re-stepped) on the dark surface.
const PALETTE_VARS = '[--pa-1:#126b45] [--pa-2:#1683E8] [--pa-3:#F58A00] [--pa-4:#9146D8] '
  + 'dark:[--pa-1:#2fa26e] dark:[--pa-2:#3b8fe6] dark:[--pa-3:#d97706] dark:[--pa-4:#a160e0]'
const CATEGORY_COLOR = {
  material_cost: 'var(--pa-1)',
  labour_cost: 'var(--pa-2)',
  machinery_cost: 'var(--pa-3)',
  expenses: 'var(--pa-4)',
}

// Compact money for chart axes (₹12L, ₹1.2Cr), full money elsewhere.
function compactMoney(value, _country) {
  const formatted = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  return `₹${formatted}`
}

function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const update = () => setWidth(node.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function Panel({ icon: Icon, title, subtitle, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-oc-line bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <header className="flex items-start gap-3">
        {Icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-oc-mint text-oc-deep">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold text-oc-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs font-medium leading-5 text-oc-muted">{subtitle}</p>}
        </div>
      </header>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function EmptyNote({ children }) {
  return <p className="rounded-xl border border-dashed border-oc-line bg-oc-paper px-4 py-6 text-center text-xs font-semibold text-oc-muted">{children}</p>
}

function SummaryCard({ icon: Icon, label, value, note, tone = 'neutral' }) {
  const noteTone = { neutral: 'text-oc-muted', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-600' }[tone]
  return (
    <div className="min-w-0 rounded-xl border border-oc-line bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-center gap-1.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-oc-mint text-oc-deep">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="truncate text-[11px] font-bold text-oc-muted">{label}</p>
      </div>
      <p className={`mt-1.5 truncate text-center font-display text-base font-extrabold leading-6 ${tone === 'bad' ? 'text-red-600' : 'text-oc-ink'}`} title={value}>{value}</p>
      {note && (
        <p className={`flex items-center justify-center gap-1 truncate text-[10px] font-semibold leading-4 ${noteTone}`}>
          {tone === 'bad' || tone === 'warn' ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          <span className="min-w-0 truncate" title={note}>{note}</span>
        </p>
      )}
    </div>
  )
}

// Chart A: where the recorded money went, by category.
function SpendingDonut({ categories, spent, country, t }) {
  const [active, setActive] = useState(null)
  const size = 168
  const stroke = 22
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  // A 2px surface gap between segments, measured along the ring.
  const gap = categories.length > 1 ? 2 : 0
  let offset = 0
  const segments = categories.map((category) => {
    const length = (category.value / spent) * circumference
    const segment = { ...category, dash: Math.max(0, length - gap), offset }
    offset += length
    return segment
  })
  const shown = segments.find((segment) => segment.key === active)
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" role="img" aria-label={segments.map((segment) => `${t(segment.labelKey)} ${money(segment.value, country)}`).join(', ')}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-slate-800" />
          {segments.map((segment) => (
            <circle
              key={segment.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={CATEGORY_COLOR[segment.key]}
              strokeWidth={active === segment.key ? stroke + 4 : stroke}
              strokeDasharray={`${segment.dash} ${circumference}`}
              strokeDashoffset={-segment.offset}
              className="cursor-pointer transition-[stroke-width] duration-150"
              onMouseEnter={() => setActive(segment.key)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${t(segment.labelKey)}: ${money(segment.value, country)}`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-oc-faint rtl:tracking-normal">{shown ? t(shown.labelKey) : t('owner.pa.totalSpent')}</p>
            <p className="mt-0.5 font-display text-sm font-extrabold text-oc-ink">{money(shown ? shown.value : spent, country)}</p>
            {shown && <p className="text-[10px] font-semibold text-oc-muted">{formatPercent(Math.round((shown.value / spent) * 1000) / 10)}</p>}
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {segments.map((segment) => (
          <li
            key={segment.key}
            onMouseEnter={() => setActive(segment.key)}
            onMouseLeave={() => setActive(null)}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition ${active === segment.key ? 'bg-oc-paper' : ''}`}
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[segment.key] }} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-oc-ink">{t(segment.labelKey)}</span>
            <span className="text-xs font-extrabold text-oc-ink">{money(segment.value, country)}</span>
            <span className="w-12 text-end text-[11px] font-semibold text-oc-muted">{formatPercent(Math.round((segment.value / spent) * 1000) / 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const ITEM_STATUS = {
  completed: { labelKey: 'owner.pa.statusCompleted', bar: 'var(--pa-1)', text: 'text-emerald-700', Icon: CheckCircle2 },
  ongoing: { labelKey: 'owner.pa.statusOngoing', bar: 'var(--pa-2)', text: 'text-oc-ink', Icon: Clock3 },
  notStarted: { labelKey: 'owner.pa.statusNotStarted', bar: 'transparent', text: 'text-oc-muted', Icon: Clock3 },
}
const MAX_ITEMS = 8

// Chart B: progress per BOQ work item, as horizontal bars from one baseline.
function WorkItemBars({ items, t }) {
  const shown = items.slice(0, MAX_ITEMS)
  return (
    <div>
      <ul className="space-y-3">
        {shown.map((item) => {
          const status = ITEM_STATUS[item.status]
          const quantityText = `${item.completed.toLocaleString()} / ${item.planned.toLocaleString()}${item.unit ? ` ${item.unit}` : ''}`
          return (
            <li key={item.reference} title={`${item.label} (${item.reference}): ${quantityText}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-xs font-bold text-oc-ink">
                  {item.label}
                  <span className="ms-1.5 font-semibold text-oc-faint">{item.reference}</span>
                </p>
                <p className="shrink-0 text-xs font-extrabold text-oc-ink">{formatPercent(item.percent)}</p>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-e-[4px]" style={{ width: `${item.percent}%`, backgroundColor: status.bar }} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[10px] font-semibold">
                <span className={`inline-flex items-center gap-1 ${status.text}`}>
                  <status.Icon className="h-3 w-3" aria-hidden="true" />{t(status.labelKey)}
                </span>
                <span className="text-oc-muted">{quantityText}</span>
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > MAX_ITEMS && <p className="mt-3 text-[11px] font-semibold text-oc-muted">{t('owner.pa.moreItems', { count: items.length - MAX_ITEMS })}</p>}
    </div>
  )
}

// Chart C: cumulative recorded spending over work dates, with a hover readout.
function SpendingTrend({ points, country, t }) {
  const [containerRef, width] = useElementWidth()
  const [hoverIndex, setHoverIndex] = useState(null)
  const height = 220
  const pad = { top: 16, right: 20, bottom: 30, left: 64 }
  const plotWidth = Math.max(0, width - pad.left - pad.right)
  const plotHeight = height - pad.top - pad.bottom
  const times = points.map((point) => Date.parse(`${point.date}T00:00:00`))
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const maxValue = Math.max(...points.map((point) => point.cumulative), 1)
  const x = (index) => (maxTime === minTime ? pad.left + plotWidth / 2 : pad.left + ((times[index] - minTime) / (maxTime - minTime)) * plotWidth)
  const y = (value) => pad.top + plotHeight - (value / maxValue) * plotHeight
  const ticks = [0, maxValue / 2, maxValue]
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.cumulative).toFixed(1)}`).join(' ')
  const area = points.length > 1 ? `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : ''
  const dateTicks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, index) => index)
  const last = points.length - 1
  const hovered = hoverIndex === null ? null : points[hoverIndex]

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - box.left
    let nearest = 0
    points.forEach((_, index) => { if (Math.abs(x(index) - pointerX) < Math.abs(x(nearest) - pointerX)) nearest = index })
    setHoverIndex(nearest)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('owner.pa.spendTrend')}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverIndex(null)}
          className="block"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
              <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-oc-muted text-[10px] font-semibold">{compactMoney(tick, country)}</text>
            </g>
          ))}
          {dateTicks.map((index) => (
            <text key={points[index].date} x={x(index)} y={height - 8} textAnchor={index === 0 && points.length > 1 ? 'start' : index === last && points.length > 1 ? 'end' : 'middle'} className="fill-oc-muted text-[10px] font-semibold">
              {formatProjectDate(points[index].date, t)}
            </text>
          ))}
          {area && <path d={area} fill="var(--pa-2)" opacity="0.1" />}
          <path d={path} fill="none" stroke="var(--pa-2)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hovered && (
            <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={pad.top} y2={pad.top + plotHeight} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1" />
          )}
          <circle cx={x(hovered ? hoverIndex : last)} cy={y((hovered || points[last]).cumulative)} r="4.5" fill="var(--pa-2)" className="stroke-white dark:stroke-slate-900" strokeWidth="2" />
          {!hovered && (
            <text x={x(last)} y={y(points[last].cumulative) - 10} textAnchor={points.length > 1 ? 'end' : 'middle'} className="fill-oc-ink text-[11px] font-extrabold">
              {money(points[last].cumulative, country)}
            </text>
          )}
        </svg>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-44 rounded-xl border border-oc-line bg-white px-3 py-2 text-xs shadow-lg"
          style={x(hoverIndex) > width / 2 ? { left: Math.max(0, x(hoverIndex) - 188) } : { left: x(hoverIndex) + 12 }}
        >
          <p className="font-extrabold text-oc-ink">{formatProjectDate(hovered.date, t)}</p>
          <p className="mt-1 flex justify-between gap-2 text-oc-muted"><span>{t('owner.pa.dailySpend')}</span><b className="text-oc-ink">{money(hovered.daily, country)}</b></p>
          <p className="flex justify-between gap-2 text-oc-muted"><span>{t('owner.pa.cumulative')}</span><b className="text-oc-ink">{money(hovered.cumulative, country)}</b></p>
        </div>
      )}
    </div>
  )
}

const STOCK_STATUS = {
  IN_STOCK: { labelKey: 'owner.pa.stockIn', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  LOW_STOCK: { labelKey: 'owner.pa.stockLow', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  OUT_OF_STOCK: { labelKey: 'owner.pa.stockOut', className: 'bg-red-50 text-red-700 ring-red-100' },
}

const th = 'px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-oc-muted rtl:tracking-normal'
const td = 'px-3 py-2.5 text-xs'

// `viewer` only words the budget card: the House Owner's own budget, or the
// owner's budget as the builder sees it. Every figure is the same.
export default function OwnerProjectAnalysisView({ project, viewer = 'owner' }) {
  const { t, translateMessage } = useLanguage()
  const country = project.project_country || 'India'
  const notAvailable = t('progress.notAvailable')
  const notSet = t('dash.common.notSet')
  const [state, setState] = useState({ status: 'loading' })

  const load = useCallback(() => {
    let alive = true
    setState({ status: 'loading' })
    const request = viewer === 'owner' ? fetchOwnerProjectAnalysis(project.id) : fetchCostToolSummary(project.id)
    request
      .then((data) => { if (alive) setState({ status: 'ready', data }) })
      .catch((error) => { if (alive) setState({ status: 'error', error: analysisError(error) }) })
    return () => { alive = false }
  }, [project.id, viewer])
  useEffect(() => load(), [load])

  const data = state.status === 'ready' ? state.data : null
  const figures = useMemo(() => analysisFigures(data?.dashboard), [data])
  const trend = useMemo(() => spendingTrend(data?.registers), [data])
  const workItems = useMemo(() => workItemProgress(data?.registers), [data])
  const budget = useMemo(() => budgetRows(project, data?.dashboard), [project, data])
  const materials = useMemo(() => materialRows(data?.materials), [data])
  const expenses = useMemo(() => recentExpenses(data?.expenses), [data])

  if (state.status === 'loading') {
    return <p className="flex items-center justify-center gap-2 py-16 text-sm font-semibold text-oc-muted"><Loader2 className="h-4 w-4 animate-spin" />{t('owner.analysis.loading')}</p>
  }
  if (state.status === 'error' || !figures) {
    const failure = state.status === 'error' ? state.error : MISSING_ANALYSIS
    return (
      <div className="py-16 text-center" role="alert">
        <p className="text-sm font-semibold text-oc-muted">{t(`owner.analysis.err.${failure.kind}`)}</p>
        {failure.message && <p className="mx-auto mt-1 max-w-md text-xs font-medium text-oc-muted">{translateMessage(failure.message)}</p>}
        {failure.status && failure.status !== 200 && <p className="mt-1 text-[10px] font-semibold text-oc-faint">{`HTTP ${failure.status}${failure.code ? ` · ${failure.code}` : ''}`}</p>}
        <button type="button" onClick={load} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-ink hover:bg-oc-paper">
          <RotateCcw className="h-3.5 w-3.5" /> {t('owner.analysis.retry')}
        </button>
      </div>
    )
  }

  const completion = data.dashboard?.project_completion
  const lowStock = materials.filter((item) => item.status !== 'IN_STOCK').length
  const trendTotal = trend.length ? trend[trend.length - 1].cumulative : 0
  const trendPartial = trend.length > 0 && Math.abs(trendTotal - figures.spent) > 1
  const itemCounts = workItems.reduce((counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }), { completed: 0, ongoing: 0, notStarted: 0 })
  const schedule = scheduleText(project, t)
  const daysLeft = project.schedule_status === 'in_progress'
    ? t('owner.pa.daysLeftValue', { days: Math.max(0, Number(project.schedule_total_days) - Number(project.schedule_elapsed_days)) })
    : project.schedule_status === 'end_date_passed'
      ? t('owner.pa.endPassed')
      : project.schedule_status === 'not_started'
        ? t('owner.pa.notStartedYet')
        : notAvailable
  const plannedTotal = figures.budget
  // The full analysis (materials, budget breakdown, expenses) is for whoever
  // runs the site: the builder, or the House Owner on a self-construction
  // project. On a builder-managed project the owner sees the basic figures.
  const detailed = viewer === 'builder' || project.construction_type === 'SELF_CONSTRUCTION'
  const actualTotal = figures.spent

  return (
    <div className={`space-y-4 ${PALETTE_VARS}`}>
      {/* Summary */}
      <div className={`grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 ${detailed ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <SummaryCard
          icon={Wallet}
          label={t('owner.pa.totalBudget')}
          value={figures.budget === null ? notSet : money(figures.budget, country)}
          note={project.contract_amount != null ? t('owner.pa.contractValue') : t(viewer === 'builder' ? 'owner.pa.ownerBudget' : 'owner.pa.yourBudget')}
        />
        <SummaryCard
          icon={Receipt}
          label={t('owner.pa.amountSpent')}
          value={money(figures.spent, country)}
          note={figures.utilization === null ? null : t('owner.pa.ofBudget', { percent: formatPercent(figures.utilization) })}
        />
        <SummaryCard
          icon={PiggyBank}
          label={t('owner.pa.remainingBudget')}
          value={figures.remaining === null ? notAvailable : figures.overrun ? `-${money(figures.overrun, country)}` : money(figures.remaining, country)}
          note={figures.remaining === null ? null : figures.overrun ? t('owner.pa.overBudget') : t('owner.pa.leftToSpend')}
          tone={figures.overrun ? 'bad' : 'neutral'}
        />
        <SummaryCard
          icon={TrendingUp}
          label={t('owner.pa.overallProgress')}
          value={completion == null ? notAvailable : formatPercent(completion)}
          note={completion == null ? t('owner.pa.completionUnavailable') : null}
        />
        {detailed && (
          <SummaryCard
            icon={Package}
            label={t('owner.pa.materials')}
            value={materials.length ? t('owner.pa.materialsTracked', { count: materials.length }) : t('owner.pa.noneRecorded')}
            note={!materials.length ? null : lowStock ? t('owner.pa.lowStock', { count: lowStock }) : t('owner.pa.allInStock')}
            tone={lowStock ? 'warn' : materials.length ? 'good' : 'neutral'}
          />
        )}
      </div>

      {/* Two columns on wide screens: spending by category with the
          cumulative spending graph under it on the left, so the shorter donut
          card leaves no empty space; progress by work item on the right,
          stretched to the same height. One column on smaller screens. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel icon={Wallet} title={t('owner.pa.spendByCategory')} subtitle={t('owner.pa.spendByCategorySub')}>
            {figures.categories.length
              ? <SpendingDonut categories={figures.categories} spent={figures.spent} country={country} t={t} />
              : <EmptyNote>{t('owner.analysis.noSpend')}</EmptyNote>}
          </Panel>
          <Panel icon={TrendingUp} title={t('owner.pa.spendTrend')} subtitle={t('owner.pa.spendTrendSub')}>
            {trend.length ? (
              <>
                <SpendingTrend points={trend} country={country} t={t} />
                {trendPartial && <p className="mt-2 text-[11px] font-semibold text-oc-muted">{t('owner.pa.trendPartial')}</p>}
              </>
            ) : <EmptyNote>{t('owner.pa.noTrend')}</EmptyNote>}
          </Panel>
        </div>
        <Panel icon={BarChart3} title={t('owner.pa.phaseProgress')} subtitle={t('owner.pa.phaseProgressSub')}>
          {workItems.length ? <WorkItemBars items={workItems} t={t} /> : <EmptyNote>{t('owner.pa.noPhaseProgress')}</EmptyNote>}
        </Panel>
      </div>

      {detailed && (
      <>
      {/* Material usage */}
      <Panel icon={Package} title={t('owner.pa.materialUsage')} subtitle={t('owner.pa.materialUsageSub')}>
        {materials.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-start">
              <thead>
                <tr className="border-b border-oc-line text-start">
                  <th className={`${th} text-start`}>{t('owner.pa.colMaterial')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colReceived')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colUsed')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colInStock')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colUsedPct')}</th>
                  <th className={`${th} text-start`}>{t('owner.pa.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-oc-line">
                {materials.map((item) => {
                  const status = STOCK_STATUS[item.status] || STOCK_STATUS.IN_STOCK
                  const unit = item.unit ? ` ${item.unit}` : ''
                  return (
                    <tr key={item.key}>
                      <td className={`${td} font-bold text-oc-ink`}>{item.material}</td>
                      <td className={`${td} text-end text-oc-ink`}>{`${item.received.toLocaleString()}${unit}`}</td>
                      <td className={`${td} text-end text-oc-ink`}>{`${item.used.toLocaleString()}${unit}`}</td>
                      <td className={`${td} text-end font-bold text-oc-ink`}>{`${item.remaining.toLocaleString()}${unit}`}</td>
                      <td className={`${td} text-end text-oc-muted`}>{item.percentUsed === null ? '—' : formatPercent(item.percentUsed)}</td>
                      <td className={td}>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ring-1 ${status.className}`}>{t(status.labelKey)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyNote>{t('owner.pa.noMaterials')}</EmptyNote>}
      </Panel>

      {/* Budget breakdown and recent expenses */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel icon={PiggyBank} title={t('owner.pa.budgetBreakdown')} subtitle={t('owner.pa.budgetBreakdownSub')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse">
              <thead>
                <tr className="border-b border-oc-line">
                  <th className={`${th} text-start`}>{t('owner.pa.colCategory')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colPlanned')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colActual')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colRemaining')}</th>
                  <th className={`${th} text-end`}>{t('owner.pa.colSpentPct')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-oc-line">
                {budget.map((row) => (
                  <tr key={row.key}>
                    <td className={`${td} font-bold text-oc-ink`}>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[row.key] }} />
                        {t(row.labelKey)}
                      </span>
                    </td>
                    <td className={`${td} text-end ${row.planned === null ? 'text-oc-faint' : 'text-oc-ink'}`}>{row.planned === null ? notSet : money(row.planned, country)}</td>
                    <td className={`${td} text-end font-bold text-oc-ink`}>{money(row.actual, country)}</td>
                    <td className={`${td} text-end ${row.remaining !== null && row.remaining < 0 ? 'font-bold text-red-600' : 'text-oc-ink'}`}>{row.remaining === null ? '—' : money(row.remaining, country)}</td>
                    <td className={`${td} text-end text-oc-muted`}>{row.percent === null ? '—' : formatPercent(row.percent)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-oc-line bg-oc-paper">
                  <td className={`${td} font-extrabold text-oc-ink`}>{t('owner.pa.total')}</td>
                  <td className={`${td} text-end font-extrabold text-oc-ink`}>{plannedTotal === null ? notSet : money(plannedTotal, country)}</td>
                  <td className={`${td} text-end font-extrabold text-oc-ink`}>{money(actualTotal, country)}</td>
                  <td className={`${td} text-end font-extrabold ${figures.overrun ? 'text-red-600' : 'text-oc-ink'}`}>{figures.remaining === null ? '—' : money(figures.remaining, country)}</td>
                  <td className={`${td} text-end font-extrabold text-oc-ink`}>{figures.utilization === null ? '—' : formatPercent(figures.utilization)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel icon={Receipt} title={t('owner.pa.recentExpenses')} subtitle={t('owner.pa.recentExpensesSub')}>
          {expenses.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse">
                <thead>
                  <tr className="border-b border-oc-line">
                    <th className={`${th} text-start`}>{t('owner.pa.colDate')}</th>
                    <th className={`${th} text-start`}>{t('owner.pa.colDescription')}</th>
                    <th className={`${th} text-start`}>{t('owner.pa.colCategory')}</th>
                    <th className={`${th} text-end`}>{t('owner.pa.colAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oc-line">
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className={`${td} whitespace-nowrap text-oc-muted`}>{formatProjectDate(expense.expense_date, t)}</td>
                      <td className={`${td} max-w-[14rem] truncate text-oc-ink`} title={expense.description || ''}>{expense.description || '—'}</td>
                      <td className={`${td} text-oc-muted`}>{expense.category || '—'}</td>
                      <td className={`${td} text-end font-bold ${Number(expense.amount) < 0 ? 'text-red-600' : 'text-oc-ink'}`}>{money(expense.amount, country)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyNote>{t('owner.pa.noExpenses')}</EmptyNote>}
        </Panel>
      </div>
      </>
      )}

      {/* Remaining work and schedule */}
      <Panel icon={CalendarCheck} title={t('owner.pa.workStatus')}>
        <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {[
            [CalendarDays, t('owner.pa.plannedStart'), formatProjectDate(project.start_date, t)],
            [CalendarCheck, t('owner.pa.plannedEnd'), formatProjectDate(project.end_date, t)],
            [Clock3, t('owner.pa.daysLeft'), daysLeft, schedule ? `${t('progress.schedule')}: ${schedule}` : null],
            [BarChart3, t('owner.pa.workItems'), workItems.length
              ? t('owner.pa.workItemsValue', { done: itemCounts.completed, ongoing: itemCounts.ongoing, pending: itemCounts.notStarted })
              : t('owner.pa.noneRecorded')],
          ].map(([Icon, label, value, note]) => (
            <div key={label} className="min-w-0 rounded-xl border border-oc-line bg-oc-paper px-3.5 py-3">
              <dt className="flex items-center gap-1.5 text-[11px] font-bold text-oc-muted">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}
              </dt>
              <dd className="mt-1 text-sm font-extrabold leading-5 text-oc-ink">{value}</dd>
              {note && <dd className="mt-0.5 text-[11px] font-semibold leading-4 text-oc-muted">{note}</dd>}
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] font-semibold text-oc-muted">{t('owner.pa.delayedUnavailable')}</p>
      </Panel>
    </div>
  )
}
