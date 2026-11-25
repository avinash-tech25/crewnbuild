/**
 * The compact order list: one row per order, used by the Site Engineer's Orders and the
 * Supplier's Orders and Purchase Requests screens.
 *
 *   Order # | <party> | Project | Date | Items | Amount | Status | Actions
 *
 * - Status filter (All, Pending, Accepted, Fulfilled, Rejected) and sort (date or amount,
 *   either way) are kept in the address (?orderStatus=, ?orderSort=), so Back and a refresh
 *   keep them. The search box is not: what someone types can be a name.
 * - Search matches the order number, the products and the project (plus `searchText`).
 * - 20 rows at a time, then "Load more".
 * - From md up it is a table that scrolls sideways inside its own card; on a phone each
 *   order is a compact stacked row (the same <tr>, displayed as a block), so the page itself
 *   never scrolls sideways.
 * - Skeleton rows while loading; an empty state when there are no orders, and a different
 *   one when the filters hide them all.
 *
 * Each order is { key, number, party, project, date, amount, status, items: [{ name,
 * quantity, unit }], searchText? }. `status` is the screen's own value; `bucketOf(status)`
 * says which filter tab it belongs to and `statusPill(status)` how it is shown. Clicking a
 * row (or View) calls `onOpen(order)`; `actions(order)` adds the screen's own buttons.
 */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, PackageOpen, Search } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext.jsx'
import useUrlState from '../hooks/useUrlState.js'
import { formatDate, formatNumber } from '../utils/formatters.js'
import { formatMoney } from '../utils/countryConfig.js'
import { Skeleton } from './Skeleton.jsx'
import { tdClass, thClass } from './DataTable.jsx'

export const PAGE_SIZE = 20
export const STATUS_FILTERS = ['all', 'pending', 'accepted', 'fulfilled', 'rejected']
const FILTER_LABEL_KEYS = {
  all: 'dash.contractor.filter.all',
  pending: 'ui.status.pending',
  accepted: 'ui.status.accepted',
  fulfilled: 'ui.status.fulfilled',
  rejected: 'ui.status.rejected',
}
const SORTS = ['newest', 'oldest', 'highest', 'lowest']
const SORT_LABEL_KEYS = { newest: 'shop.sortNewest', oldest: 'shop.sortOldest', highest: 'shop.sortHighest', lowest: 'shop.sortLowest' }

/** The usual mapping from an order or line status to a filter tab. */
export function defaultBucket(status) {
  const value = String(status || '').toUpperCase()
  if (value === 'PENDING' || value === 'AWAITING_SUPPLIER_ACCEPTANCE') return 'pending'
  if (value === 'ACCEPTED') return 'accepted'
  if (value === 'FULFILLED' || value === 'COMPLETED') return 'fulfilled'
  if (value === 'REJECTED') return 'rejected'
  return null // PARTIAL and anything else: in All only
}

const time = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/** "ACC PPC Cement · 1 Bag", and "+2 more" for the rest. */
function ItemsCell({ items }) {
  const { t, td } = useLanguage()
  const [first, ...rest] = items
  if (!first) return <span>—</span>
  return (
    <span className="block min-w-0">
      <span className="block truncate font-bold text-graphite">
        {td(first.name)}
        {first.quantity != null && <span className="font-semibold text-graphite/60"> · {formatNumber(Number(first.quantity))} {td(first.unit || '')}</span>}
      </span>
      {rest.length > 0 && <span className="block text-[11px] font-semibold text-graphite/50">{t('shop.eo.moreItems', { count: rest.length })}</span>}
    </span>
  )
}

// On a phone the table's rows become stacked blocks; each cell names itself.
const cell = `${tdClass} max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-0.5 max-md:text-end max-md:before:shrink-0 max-md:before:text-[10px] max-md:before:font-extrabold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-slate-500 max-md:before:content-[attr(data-label)]`

export default function OrderList({
  orders = [],
  partyLabel,
  loading = false,
  error = '',
  onOpen,
  actions,
  statusPill,
  statusLabel,
  bucketOf = defaultBucket,
  emptyTitle,
  emptyHint,
  searchPlaceholder,
  toolbar = null,
  country,
  label,
}) {
  const { t, td } = useLanguage()
  const [filter, setFilter] = useUrlState('orderStatus', 'all', STATUS_FILTERS)
  const [sort, setSort] = useUrlState('orderSort', 'newest', SORTS)
  const [search, setSearch] = useState('')
  const [shownCount, setShownCount] = useState(PAGE_SIZE)

  const counts = useMemo(() => {
    const result = Object.fromEntries(STATUS_FILTERS.map((id) => [id, 0]))
    for (const order of orders) {
      result.all += 1
      const bucket = bucketOf(order.status)
      if (bucket) result[bucket] += 1
    }
    return result
  }, [orders, bucketOf])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matches = (order) => !needle || [order.number, order.project, order.searchText, ...order.items.map((item) => item.name)]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    const byStatus = (order) => filter === 'all' || bucketOf(order.status) === filter
    const compare = {
      newest: (a, b) => time(b.date) - time(a.date),
      oldest: (a, b) => time(a.date) - time(b.date),
      highest: (a, b) => Number(b.amount || 0) - Number(a.amount || 0) || time(b.date) - time(a.date),
      lowest: (a, b) => Number(a.amount || 0) - Number(b.amount || 0) || time(b.date) - time(a.date),
    }[sort]
    return orders.filter((order) => byStatus(order) && matches(order)).sort(compare)
  }, [orders, search, filter, sort, bucketOf])

  const page = visible.slice(0, shownCount)
  const changeFilter = (next) => { setFilter(next); setShownCount(PAGE_SIZE) }
  const changeSearch = (next) => { setSearch(next); setShownCount(PAGE_SIZE) }
  // A column heading toggles its own sort; the other column's sort switches to this one.
  const sortBy = (column) => setSort(column === 'date' ? (sort === 'newest' ? 'oldest' : 'newest') : (sort === 'highest' ? 'lowest' : 'highest'))
  const ariaSort = (column) => {
    if (column === 'date' && (sort === 'newest' || sort === 'oldest')) return sort === 'newest' ? 'descending' : 'ascending'
    if (column === 'amount' && (sort === 'highest' || sort === 'lowest')) return sort === 'highest' ? 'descending' : 'ascending'
    return 'none'
  }
  const sortIcon = (column) => {
    const direction = ariaSort(column)
    if (direction === 'none') return null
    const Icon = direction === 'descending' ? ArrowDown : ArrowUp
    return <Icon aria-hidden="true" className="h-3 w-3" />
  }
  const sortHead = (column, text, end = false) => (
    <th key={column} aria-sort={ariaSort(column)} className={`${thClass} ${end ? 'text-end' : 'text-start'}`}>
      <button type="button" onClick={() => sortBy(column)} className={`inline-flex items-center gap-1 uppercase hover:text-graphite ${end ? 'flex-row-reverse' : ''}`}>
        {text} {sortIcon(column)}
      </button>
    </th>
  )

  const head = [
    <th key="number" className={`${thClass} text-start`}>{t('shop.list.orderNumber')}</th>,
    <th key="party" className={`${thClass} text-start`}>{partyLabel}</th>,
    <th key="project" className={`${thClass} text-start`}>{t('dash.common.project')}</th>,
    sortHead('date', t('dash.common.date')),
    <th key="items" className={`${thClass} text-start`}>{t('shop.eo.products')}</th>,
    sortHead('amount', t('shop.eo.amount'), true),
    <th key="status" className={`${thClass} text-start`}>{t('dash.common.status')}</th>,
    <th key="actions" className={`${thClass} text-end`}>{t('shop.eo.actions')}</th>,
  ]

  return (
    <section className="space-y-3" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Status filter: the same tab strip the supplier screens already use. */}
        <div role="group" aria-label={t('dash.common.status')} className="flex max-w-full gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
          {STATUS_FILTERS.map((id) => {
            const active = filter === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => changeFilter(id)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-extrabold transition ${active ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/70 hover:bg-slate-50 hover:text-graphite'}`}
              >
                {t(FILTER_LABEL_KEYS[id])}
                <span className={`inline-block min-w-[1.375rem] rounded-full px-1.5 py-0.5 text-center text-[10px] font-extrabold tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{counts[id]}</span>
              </button>
            )
          })}
        </div>
        <div className="flex min-w-0 flex-1 basis-[22rem] flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <span className="sr-only">{searchPlaceholder}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white ps-9 pe-3 text-sm text-graphite placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>
          {toolbar}
          <label className="flex items-center gap-2 text-xs font-bold text-graphite/70">
            <span className="whitespace-nowrap">{t('shop.eo.sortBy')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-graphite focus:border-brand-400 focus:outline-none">
              {SORTS.map((id) => <option key={id} value={id}>{t(SORT_LABEL_KEYS[id])}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

      {loading ? (
        <div role="status" aria-busy="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <span className="sr-only">{t('loader.label')}</span>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-3 py-3 last:border-0">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20 max-md:hidden" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      ) : !error && !orders.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <PackageOpen aria-hidden="true" className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-extrabold text-graphite">{emptyTitle}</p>
          {emptyHint && <p className="mt-1 text-xs text-graphite/70">{emptyHint}</p>}
        </div>
      ) : !error && !visible.length ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-graphite/70">{t('shop.noMatchingOrders')}</p>
      ) : !error && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="dash-scroll overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-start max-md:block max-md:min-w-0">
              <thead className="max-md:hidden">
                <tr className="border-b border-slate-200 bg-slate-50/90 text-start">{head}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 max-md:block">
                {page.map((order) => (
                  <tr
                    key={order.key}
                    data-testid="order-row"
                    onClick={(event) => { if (!event.target.closest('button, a, input, select')) onOpen(order) }}
                    className="cursor-pointer transition hover:bg-slate-50 max-md:block max-md:space-y-0.5 max-md:px-3 max-md:py-3"
                  >
                    <td data-label={t('shop.list.orderNumber')} className={`${cell} whitespace-nowrap font-extrabold text-graphite`}>{order.number}</td>
                    <td data-label={partyLabel} className={`${cell} min-w-[140px] font-extrabold text-graphite`}>{td(order.party) || '—'}</td>
                    <td data-label={t('dash.common.project')} className={`${cell} min-w-[120px]`}>{td(order.project) || '—'}</td>
                    <td data-label={t('dash.common.date')} className={`${cell} whitespace-nowrap`}>{order.date ? formatDate(order.date) : '—'}</td>
                    <td data-label={t('shop.eo.products')} className={`${cell} max-w-[240px] max-md:max-w-none`}><ItemsCell items={order.items} /></td>
                    <td data-label={t('shop.eo.amount')} className={`${cell} whitespace-nowrap text-end font-extrabold text-graphite`}>{formatMoney(order.amount, country)}</td>
                    <td data-label={t('dash.common.status')} className={cell}>
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${statusPill(order.status)}`}>{statusLabel(order.status)}</span>
                    </td>
                    <td className={`${tdClass} max-md:px-0 max-md:pt-2`}>
                      <span className="flex flex-wrap justify-end gap-1.5 max-md:justify-start">
                        <button
                          type="button"
                          onClick={() => onOpen(order)}
                          aria-label={`${t('shop.eo.view')} ${order.number}`}
                          className="inline-flex h-8 items-center gap-0.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-brand-700 transition hover:border-brand-300 hover:bg-brand-50"
                        >
                          {t('shop.eo.view')} <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 rtl:-scale-x-100" />
                        </button>
                        {actions?.(order)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5 text-xs font-semibold text-graphite/70">
            <span>{t('shop.list.showing', { shown: page.length, total: visible.length })}</span>
            {page.length < visible.length && (
              <button type="button" onClick={() => setShownCount((count) => count + PAGE_SIZE)} className="inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-xs font-extrabold text-graphite hover:bg-slate-200">
                {t('shop.list.loadMore')}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
