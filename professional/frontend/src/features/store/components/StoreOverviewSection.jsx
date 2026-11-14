import { useMemo, useState } from 'react'
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, BarChart3, Boxes, ChevronRight, ClipboardCheck, ClipboardList, HardHat, History, Package, ShoppingBag, ShoppingCart, Wallet, Zap } from 'lucide-react'
import { avatarFromPath } from '../../../shared/ui/avatars.js'
import DashboardHero from '../../../shared/dashboard/DashboardHero.jsx'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatDate, formatDateTime } from '../../../shared/utils/formatters.js'
import { DailyLine, formatQty, money } from '../../site-work/components/EngineerAnalyticsSection.jsx'
import { MOVEMENT_KEYS, PURCHASE_RANGES, purchaseOverview, purchaseRef } from '../storeHelpers.js'
import { Panel } from './StoreUi.jsx'

// Presentation only, after the Supplier dashboard: tinted metric cards with an
// icon and an arrow, and panels whose rows share one rhythm.
const TONES = {
  stock: { card: 'border-emerald-200 bg-emerald-50', chip: 'bg-emerald-100 text-emerald-700' },
  value: { card: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-700' },
  team: { card: 'border-violet-200 bg-violet-50', chip: 'bg-violet-100 text-violet-700' },
  total: { card: 'border-sky-200 bg-sky-50', chip: 'bg-sky-100 text-sky-700' },
}
const panelClass = 'flex h-full min-w-0 flex-col !p-4'
const listClass = '-my-1 divide-y divide-slate-100'
// The shared empty state, less tall here, filling what is left of its panel.
const emptyFit = 'flex flex-1 [&>div]:w-full [&>div]:py-7'

// "45 Bag · 15 kg": quantities add up only within a unit.
const perUnit = (rows, td) => rows.map((row) => `${formatQty(row.quantity)} ${td(row.unit)}`).join(' · ')

// A period's label on the chart's axis, in the selected language.
function periodLabel(date, range) {
  if (range === 'day' || range === 'week') return formatDate(date, '', { day: 'numeric', month: 'short' })
  if (range === 'month') return formatDate(date, '', { month: 'short' })
  return String(date.getFullYear())
}

function PanelTitle({ icon: Icon, children }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[15px]">
      <Icon className="h-[18px] w-[18px] shrink-0 text-brand-700" />
      {children}
    </span>
  )
}

export default function StoreOverviewSection({ overview, requests, purchases = [], country, onNav, userShell }) {
  const { t, td } = useLanguage()
  const [range, setRange] = useState('day')
  const pending = requests.filter((request) => request.status === 'PENDING').slice(0, 6)
  const totalStock = overview?.total_stock || []
  // What was paid to suppliers in the chosen period (see purchaseOverview).
  const spending = useMemo(() => purchaseOverview(purchases, range), [purchases, range])
  const chartSeries = spending.buckets.map((bucket) => ({ label: periodLabel(bucket.start, range), total: bucket.spent }))
  // The dashboard shows four figures; the others stay in the overview for the pages that use them.
  const cards = [
    { key: 'products', label: t('store.overview.products'), value: overview?.item_count ?? 0, icon: Package, tone: TONES.stock, to: 'catalog' },
    { key: 'stockValue', label: t('store.overview.stockValue'), value: money(overview?.stock_value ?? 0, country), icon: Wallet, tone: TONES.value, to: 'catalog' },
    { key: 'builders', label: t('store.overview.builders'), value: overview?.builder_count ?? 0, icon: HardHat, tone: TONES.team, to: 'builders' },
    // Stock adds up only within a unit, so it is one figure per unit.
    { key: 'totalStock', label: t('store.overview.totalStock'), value: perUnit(totalStock, td) || '0', small: totalStock.length > 1, icon: Boxes, tone: TONES.total, to: 'catalog' },
  ]
  // Only places the dashboard already opens (its cards, and the side menu).
  const quickActions = [
    { id: 'catalog', label: t('store.quick.catalog'), icon: Boxes, tone: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100' },
    { id: 'buy', label: t('store.quick.buy'), icon: ShoppingCart, tone: 'bg-orange-50 text-orange-800 hover:bg-orange-100' },
    { id: 'requests', label: t('store.quick.requests'), icon: ClipboardList, tone: 'bg-sky-50 text-sky-800 hover:bg-sky-100' },
    { id: 'approvals', label: t('store.quick.approvals'), icon: ClipboardCheck, tone: 'bg-blue-50 text-blue-800 hover:bg-blue-100' },
    { id: 'payments', label: t('store.quick.payments'), icon: Wallet, tone: 'bg-rose-50 text-rose-800 hover:bg-rose-100' },
    { id: 'builders', label: t('store.quick.builders'), icon: HardHat, tone: 'bg-violet-50 text-violet-800 hover:bg-violet-100' },
  ]
  const chips = [
    { key: 'purchases', icon: ShoppingCart, value: spending.purchases, label: t('store.overview.supplierPurchases') },
    { key: 'quantity', icon: Boxes, value: perUnit(spending.quantity, td) || '0', label: t('store.overview.quantityPurchased') },
  ]
  const storeManager = t('ui.profile.engCat.storeManager')
  return (
    <div className="space-y-4">
      {/* The welcome banner every role dashboard shares, as the Supplier's uses it. */}
      <DashboardHero
        avatar={{ image: avatarFromPath(userShell?.profileImageUrl, 'ENGINEER'), name: userShell?.initials || storeManager.trim().slice(0, 1) }}
        title={t('dash.engineer.hero.welcome', { name: userShell?.name || storeManager })}
        subtitle={t('store.overview.heroSub')}
        variant="cream"
        tint="mist"
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onNav(card.to)}
            className={`group flex h-full min-h-[84px] items-center gap-3 rounded-2xl border px-3 py-3 text-start shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500/50 sm:px-3.5 ${card.tone.card}`}
          >
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl sm:h-11 sm:w-11 ${card.tone.chip}`}>
              <card.icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold leading-snug text-graphite/65 sm:text-[13px]">{card.label}</span>
              <span className={`block break-words font-display font-extrabold tabular-nums text-graphite ${card.small ? 'text-sm leading-snug' : 'text-xl leading-tight xl:text-2xl'}`}>{card.value}</span>
            </span>
            <span className={`hidden h-8 w-8 shrink-0 place-items-center rounded-full transition group-hover:translate-x-0.5 xl:grid ${card.tone.chip}`}>
              <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
            </span>
          </button>
        ))}
      </section>

      {/* Purchase Overview beside the requests waiting and Quick Actions, as the
          Supplier dashboard leads with its activity, then the two recent lists. */}
      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <Panel
            className={panelClass}
            title={<PanelTitle icon={BarChart3}>{t('store.overview.purchaseOverview')}</PanelTitle>}
            action={(
              // The Supplier's Day/Week/Month/Year switch; it scrolls inside the card on a narrow phone.
              <div className="dash-scroll flex max-w-full overflow-x-auto rounded-lg border border-slate-200 p-0.5">
                {PURCHASE_RANGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setRange(item.id)}
                    aria-pressed={range === item.id}
                    className={`h-7 shrink-0 rounded-md px-3 text-xs font-semibold transition ${range === item.id ? 'bg-brand-800 text-white' : 'text-graphite/60 hover:text-graphite'}`}
                  >
                    {t(`shop.range.${item.id}`)}
                  </button>
                ))}
              </div>
            )}
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-display text-3xl font-extrabold tabular-nums text-graphite">{money(spending.spent, country)}</p>
                <p className="text-[11px] font-semibold text-graphite/55">{t(`store.overview.paidWindow.${range}`)}</p>
                {spending.change != null && (
                  <p className={`mt-0.5 flex items-center gap-1 text-xs font-semibold ${spending.change >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {spending.change >= 0 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                    {t('dash.sup.vsPrevious', { pct: Math.abs(spending.change), range: t(`shop.range.${range}`) })}
                  </p>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                {chips.map((chip) => (
                  <div key={chip.key} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-orange-50 text-orange-500"><chip.icon className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-extrabold tabular-nums text-graphite">{chip.value}</span>
                      <span className="block text-[11px] text-graphite/55">{chip.label}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-1 flex-col justify-end">
              {spending.spent > 0
                ? <DailyLine series={chartSeries} country={country} />
                : <div className={emptyFit}><EmptyState icon={BarChart3} title={t('store.overview.noPaidPurchases')} message={t('store.overview.noPaidPurchasesSub')} /></div>}
            </div>
          </Panel>
        </div>
        <Panel className={panelClass} title={<PanelTitle icon={ClipboardList}>{t('store.overview.latestRequests')}</PanelTitle>}>
          {pending.length ? (
            <ul className={listClass}>
              {pending.map((request) => (
                <li key={request.id} className="flex items-center gap-3 py-2.5">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-extrabold uppercase text-brand-700">{String(td(request.engineer_name) || '?').trim().charAt(0)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[13px] font-bold text-graphite" title={td(request.engineer_name)}>{td(request.engineer_name)}</span>
                    <span className="block break-words text-[11px] font-semibold text-graphite/55" title={td(request.project_name)}>{td(request.project_name)}</span>
                  </span>
                  <StatusPill status={request.status} soft />
                </li>
              ))}
            </ul>
          ) : (
            <div className={emptyFit}><EmptyState icon={ClipboardList} title={t('store.requests.none')} message={t('store.requests.noneSub')} /></div>
          )}
        </Panel>
        <Panel className={panelClass} title={<PanelTitle icon={Zap}>{t('dash.engineer.quickActions')}</PanelTitle>}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onNav(action.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-start text-[13px] font-bold transition ${action.tone}`}
              >
                <action.icon className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0 flex-1">{action.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
              </button>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel className={panelClass} title={<PanelTitle icon={History}>{t('store.overview.recentMovements')}</PanelTitle>}>
          {overview?.recent_movements?.length ? (
            <ul className={listClass}>
              {overview.recent_movements.map((row) => (
                // On a phone the quantity and date sit under the name, so nothing is cut short.
                <li key={row.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <span aria-hidden="true" className={`grid h-8 w-8 place-items-center rounded-lg ${row.change < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {row.change < 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-[13px] font-bold text-graphite" title={td(row.item_name)}>{td(row.item_name)}</span>
                    <span className="block break-words text-[11px] font-semibold text-graphite/55">{t(MOVEMENT_KEYS[row.reason])}{row.reference ? ` · ${row.reference}` : ''}</span>
                  </span>
                  <span className="col-start-2 flex flex-wrap items-baseline justify-between gap-x-3 sm:col-start-auto sm:block sm:text-end">
                    <span className="block whitespace-nowrap text-xs font-semibold tabular-nums text-graphite/55">
                      <span className={`text-sm font-extrabold ${row.change < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{row.change > 0 ? '+' : ''}{formatQty(row.change)}</span>
                      {' '}({formatQty(row.balance_before)} → {formatQty(row.balance_after)} {td(row.unit)})
                    </span>
                    <span className="block whitespace-nowrap text-[11px] font-semibold text-graphite/45">{formatDateTime(row.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className={emptyFit}><EmptyState icon={History} title={t('store.overview.noMovements')} message={t('store.overview.noMovementsSub')} /></div>
          )}
        </Panel>
        <Panel className={panelClass} title={<PanelTitle icon={ShoppingBag}>{t('store.overview.recentPurchases')}</PanelTitle>}>
          {overview?.recent_purchases?.length ? (
            <ul className={listClass}>
              {overview.recent_purchases.map((order) => (
                // The whole Purchase ID gets its own line on a phone; beside the amount from sm up.
                <li key={order.request_code} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5">
                  <span dir="ltr" className="col-span-2 block break-all font-mono text-[11px] font-bold text-graphite sm:col-span-1">{purchaseRef(order)}</span>
                  <span className="min-w-0 break-words text-[11px] font-semibold text-graphite/55" title={td(order.supplier_name)}>{td(order.supplier_name)}</span>
                  <span className="text-end sm:col-start-2 sm:row-span-2 sm:row-start-1">
                    <span className="block text-sm font-extrabold tabular-nums text-graphite">{money(order.total, country)}</span>
                    <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold ${order.received ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {order.received ? t('store.buy.inStock') : t('store.overview.awaitingReceipt')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className={emptyFit}><EmptyState icon={ShoppingBag} title={t('store.buy.noPurchases')} message={t('store.buy.noPurchasesSub')} /></div>
          )}
        </Panel>
      </section>
    </div>
  )
}
