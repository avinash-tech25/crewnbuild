/**
 * Supplier dashboard: Sales Overview, Top Products and Quick Actions.
 *
 * Everything is derived from the orders the supplier has already received, so
 * no new API is needed. Revenue counts orders the supplier accepted or
 * fulfilled — a pending order is not money yet, and a rejected one never will be.
 * Quick Actions open sections the dashboard already has.
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, BarChart3, Boxes, ChevronRight, ClipboardList, IndianRupee, Package, ShoppingCart, Tags, Users, Zap } from 'lucide-react'
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { formatDate, formatNumber } from '../../../shared/utils/formatters.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { DailyLine } from '../../site-work/components/EngineerAnalyticsSection.jsx'

const EARNED = new Set(['ACCEPTED', 'FULFILLED'])
//test git
const RANGES = [
  { id: 'day', labelKey: 'shop.range.day', buckets: 14 },
  { id: 'week', labelKey: 'shop.range.week', buckets: 12 },
  { id: 'month', labelKey: 'shop.range.month', buckets: 12 },
  { id: 'year', labelKey: 'shop.range.year', buckets: 5 },
]

function startOfDay(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}
//test jkljljkln
function bucketStart(date, range) {
  const day = startOfDay(date)
  if (range === 'day') return day
  if (range === 'week') {
    const shifted = new Date(day)
    shifted.setDate(shifted.getDate() - shifted.getDay())
    return shifted
  }
  if (range === 'month') return new Date(day.getFullYear(), day.getMonth(), 1)
  return new Date(day.getFullYear(), 0, 1)
}

function stepBack(date, range, steps) {
  const copy = new Date(date)
  if (range === 'day') copy.setDate(copy.getDate() - steps)
  else if (range === 'week') copy.setDate(copy.getDate() - steps * 7)
  else if (range === 'month') copy.setMonth(copy.getMonth() - steps)
  else copy.setFullYear(copy.getFullYear() - steps)
  return copy
}

// Axis labels in the selected language. A bare `toLocaleDateString()` follows
// the browser's language instead, so a Hindi interface on an American laptop
// labelled its own chart in English.
function bucketLabel(date, range) {
  if (range === 'day' || range === 'week') return formatDate(date, '', { day: 'numeric', month: 'short' })
  if (range === 'month') return formatDate(date, '', { month: 'short' })
  return String(date.getFullYear())
}

const panel = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]'

function PanelTitle({ icon: Icon, title, action }) {
  return (
    // Wraps: on a phone (or with a long translated title) the action -- the
    // Day/Week/Month/Year switch -- goes under the title instead of past the card.
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <p className="flex min-w-0 items-center gap-2 font-display text-[15px] font-extrabold text-graphite">
        <Icon className="h-[18px] w-[18px] shrink-0 text-brand-700" /> {title}
      </p>
      {action}
    </div>
  )
}

// parts: which panels to draw ('sales', 'top', 'actions'); the dashboard lays them out.
export default function SupplierAnalyticsDashboard({ orders = [], onNavigate, onAddProduct, parts = ['sales', 'top', 'actions'] }) {
  const { t, td } = useLanguage()
  const [range, setRange] = useState('day')

  const money = (value) => countryFormatMoney(value)
  const lineValue = (row) => Number(row.price || 0) * Number(row.quantity || 0)

  const series = useMemo(() => {
    const config = RANGES.find((item) => item.id === range) || RANGES[0]
    const now = new Date()
    const buckets = []
    for (let step = config.buckets - 1; step >= 0; step -= 1) {
      const start = bucketStart(stepBack(now, range, step), range)
      buckets.push({ start, key: start.getTime(), label: bucketLabel(start, range), orders: 0, revenue: 0, quantity: 0 })
    }
    const index = new Map(buckets.map((bucket) => [bucket.key, bucket]))
    orders.forEach((row) => {
      if (!row.created_at) return
      const bucket = index.get(bucketStart(new Date(row.created_at), range).getTime())
      if (!bucket) return
      bucket.orders += 1
      bucket.quantity += Number(row.quantity || 0)
      if (EARNED.has(row.status)) bucket.revenue += lineValue(row)
    })
    return buckets
  }, [orders, range])

  const totals = useMemo(() => {
    const current = series[series.length - 1] || { revenue: 0 }
    const previous = series[series.length - 2] || { revenue: 0 }
    return {
      windowRevenue: series.reduce((sum, bucket) => sum + bucket.revenue, 0),
      windowOrders: series.reduce((sum, bucket) => sum + bucket.orders, 0),
      windowQuantity: series.reduce((sum, bucket) => sum + bucket.quantity, 0),
      allRevenue: orders.filter((row) => EARNED.has(row.status)).reduce((sum, row) => sum + lineValue(row), 0),
      // This period's revenue against the one before it.
      change: previous.revenue > 0 ? Math.round(((current.revenue - previous.revenue) / previous.revenue) * 100) : null,
    }
  }, [series, orders])

  // The best-selling products by order value: what accepted and fulfilled
  // orders earned, the same rule as revenue. Value compares fairly across
  // units, where raw quantity would rank kilograms of steel above bags of cement.
  const topProducts = useMemo(() => {
    const byProduct = new Map()
    orders.forEach((row) => {
      if (!EARNED.has(row.status)) return
      const key = row.product_id || row.material_name
      const entry = byProduct.get(key) || { key, name: row.material_name, unit: row.unit, image: row.image_url, quantity: 0, value: 0 }
      entry.quantity += Number(row.quantity || 0)
      entry.value += lineValue(row)
      byProduct.set(key, entry)
    })
    const list = [...byProduct.values()].filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 4)
    const top = list[0]?.value || 1
    return list.map((item) => ({ ...item, share: Math.round((item.value / top) * 100) }))
  }, [orders])

  const chartSeries = series.map((bucket) => ({ label: bucket.label, total: bucket.revenue }))
  const hasSales = series.some((bucket) => bucket.revenue > 0)
  const rangeLabel = t(`shop.range.${range}`)
  const barColors = ['bg-orange-400', 'bg-emerald-600', 'bg-sky-500', 'bg-violet-500']

  const quickActions = [
    { id: 'add', label: t('dash.sup.addProduct'), icon: Package, tone: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100', onClick: onAddProduct || (() => onNavigate?.('products')) },
    { id: 'categories', label: t('dash.sup.manageCategories'), icon: Tags, tone: 'bg-orange-50 text-orange-700 hover:bg-orange-100', onClick: () => onNavigate?.('products') },
    { id: 'clients', label: t('dash.sup.findClients'), icon: Users, tone: 'bg-blue-50 text-blue-800 hover:bg-blue-100', onClick: () => onNavigate?.('findClients') },
    { id: 'requests', label: t('dash.sup.viewRequests'), icon: ClipboardList, tone: 'bg-violet-50 text-violet-800 hover:bg-violet-100', onClick: () => onNavigate?.('incomingRequests') },
  ]

  const chips = [
    { icon: ShoppingCart, value: totals.windowOrders, label: t('shop.orders'), onClick: () => onNavigate?.('orders') },
    { icon: IndianRupee, value: money(totals.allRevenue), label: t('dash.sup.totalRevenue') },
    { icon: Boxes, value: totals.windowQuantity, label: t('dash.sup.totalQuantity') },
  ]

  return (
    <>
      {/* Sales Overview */}
      {parts.includes('sales') && (
        <div className={panel}>
          <PanelTitle
            icon={BarChart3}
            title={t('dash.sup.salesOverview')}
            action={(
              // Scrolls inside the card when the four labels are wider than a
              // phone screen (Malayalam, Tamil at 320px).
              <div className="dash-scroll flex max-w-full overflow-x-auto rounded-lg border border-slate-200 p-0.5">
                {RANGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRange(item.id)}
                    aria-pressed={range === item.id}
                    className={`h-7 shrink-0 rounded-md px-3 text-xs font-semibold transition ${range === item.id ? 'bg-brand-800 text-white' : 'text-graphite/60 hover:text-graphite'}`}
                  >
                    {t(item.labelKey)}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-display text-3xl font-extrabold text-graphite">{money(totals.windowRevenue)}</p>
              {totals.change != null && (
                <p className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${totals.change >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {totals.change >= 0 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                  {t('dash.sup.vsPrevious', { pct: Math.abs(totals.change), range: rangeLabel })}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={chip.onClick}
                  disabled={!chip.onClick}
                  className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-left enabled:hover:bg-slate-50 disabled:cursor-default"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-orange-50 text-orange-500"><chip.icon className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-sm font-extrabold text-graphite">{chip.value}</span>
                    <span className="block text-[11px] text-graphite/55">{chip.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2">
            {hasSales
              ? <DailyLine series={chartSeries} />
              : <EmptyState title={t('shop.noOrders')} message={t('shop.noOrdersHint')} />}
          </div>
        </div>
      )}

      {/* Top Products */}
      {parts.includes('top') && (
        <div className={panel}>
          <PanelTitle
            icon={Package}
            title={t('dash.sup.topProducts')}
            action={(
              <button type="button" onClick={() => onNavigate?.('products')} className="inline-flex items-center gap-1 text-xs font-extrabold text-brand-700 hover:text-brand-800">
                {t('dash.viewAll')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </button>
            )}
          />
          {topProducts.length ? (
            <ul className="space-y-3">
              {topProducts.map((item, index) => (
                <li key={item.key} className="flex items-center gap-3">
                  <SmartImage src={item.image ? imageUrl(item.image) : ''} alt={td(item.name)} className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-graphite">{td(item.name)}</p>
                    <p className="truncate text-[11px] text-graphite/55">
                      <span className="font-semibold text-graphite/80">{money(item.value)}</span> · {formatNumber(item.quantity)} {td(item.unit || '')}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${barColors[index % barColors.length]}`} style={{ width: `${item.share}%` }} />
                      </div>
                      <span className="w-9 shrink-0 text-right text-[11px] text-graphite/55">{item.share}%</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title={t('dash.sup.topProducts')} message={t('dash.sup.noTopProducts')} />}
        </div>
      )}

      {/* Quick Actions */}
      {parts.includes('actions') && (
        <div className={panel}>
          <PanelTitle icon={Zap} title={t('dash.engineer.quickActions')} />
          <div className="space-y-2.5">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                className={`group flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[13px] font-bold transition ${action.tone}`}
              >
                <action.icon className="h-[18px] w-[18px] shrink-0" />
                <span className="flex-1 truncate">{action.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
