/**
 * Builder subscription payments -- read-only history and collections.
 *
 * Every figure is the server's (GET /admin/subscription-payments and /summary):
 * money counts as collected only once the backend has verified the payment, refunds
 * are reported apart, and local MOCK payments are listed but never counted. Which
 * country's payments appear is decided by the server from the signed-in
 * administrator; this screen only passes the Global country switch along.
 *
 * Payment history is not the same thing as a subscription in force: a payment made
 * last year may have bought a period that has since ended or was refunded.
 */

import { useState } from 'react'
import { Receipt, Search } from 'lucide-react'
import { fetchSubscriptionPayments, fetchSubscriptionPaymentsSummary } from '../adminApi.js'
import { messageOf } from '../couponsView.js'
import { PAGE_SIZE, Pagination } from './AdminPagination.jsx'
import {
  MONTH_NAMES, PAYMENT_STATUSES, PLAN_OPTIONS, STATUS_TONES, countryName, formatMinor, formatWhen, paymentQuery,
  paymentsViewState, periodText, planLabel, statusLabel, yearOptions,
} from '../subscriptionPaymentsView.js'

const COUNTRY_NAMES = { IN: 'India' }
const selectClass = 'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-graphite outline-none focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-400'

function Card({ label, value, hint, tone = 'text-graphite' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] font-medium text-slate-400">{hint}</p>}
    </div>
  )
}

function ErrorBox({ error, fallback, onRetry }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-6 py-6">
      <p className="text-sm font-semibold text-red-600">{messageOf(error, fallback)}</p>
      <button type="button" onClick={onRetry} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50">
        Retry
      </button>
    </div>
  )
}

function Summary({ summary, currency }) {
  const totals = summary.totals
  const money = (minor) => formatMinor(minor, currency)
  return (
    <div className="grid gap-3 px-6 py-5 sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Gross collected" value={money(totals.gross_minor)} hint={`${totals.successful_count} verified payment${totals.successful_count === 1 ? '' : 's'}`} />
      <Card label="Refunds" value={money(totals.refunds_minor)} hint={`${totals.refunded_count} refunded or dispute lost`} tone={totals.refunds_minor ? 'text-amber-700' : 'text-graphite'} />
      <Card label="Net collected" value={money(totals.net_minor)} hint="Gross minus refunds" tone="text-ocbrand-700" />
      <Card label="Active paid subscriptions" value={summary.active_subscription_count} hint="In force right now, not filtered by date" />
      <Card label="Payments" value={totals.payment_count} hint="Every order in the selected period" />
      <Card label="Successful" value={totals.successful_count} hint={totals.disputed_count ? `${totals.disputed_count} under dispute` : 'Verified by the server'} />
      <Card label="Failed" value={totals.failed_count} tone={totals.failed_count ? 'text-red-600' : 'text-graphite'} />
      <Card label="Pending / not completed" value={totals.pending_count} hint="Order created, never paid" />
    </div>
  )
}

function MonthlyTable({ monthly, currency }) {
  return (
    <div className="overflow-x-auto border-t border-slate-200">
      <table className="w-full min-w-[640px] text-left text-xs">
        <caption className="px-6 pb-2 pt-4 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Monthly totals, {monthly.year} (India time)
        </caption>
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-6 py-2">Month</th>
            <th className="px-3 py-2 text-right">Payments</th>
            <th className="px-3 py-2 text-right">Successful</th>
            <th className="px-3 py-2 text-right">Failed</th>
            <th className="px-3 py-2 text-right">Pending</th>
            <th className="px-3 py-2 text-right">Gross</th>
            <th className="px-3 py-2 text-right">Refunds</th>
            <th className="px-6 py-2 text-right">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {monthly.months.map((row) => (
            <tr key={row.month} className={row.payment_count ? '' : 'text-slate-400'}>
              <td className="px-6 py-2 font-semibold">{MONTH_NAMES[row.month - 1]}</td>
              <td className="px-3 py-2 text-right">{row.payment_count}</td>
              <td className="px-3 py-2 text-right">{row.successful_count}</td>
              <td className="px-3 py-2 text-right">{row.failed_count}</td>
              <td className="px-3 py-2 text-right">{row.pending_count}</td>
              <td className="px-3 py-2 text-right">{formatMinor(row.gross_minor, currency)}</td>
              <td className="px-3 py-2 text-right">{formatMinor(row.refunds_minor, currency)}</td>
              <td className="px-6 py-2 text-right font-bold">{formatMinor(row.net_minor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentsTable({ payments }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-left text-sm">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-6 py-3">Builder</th>
            <th className="px-3 py-3">Plan</th>
            <th className="px-3 py-3 text-right">Price</th>
            <th className="px-3 py-3">Coupon</th>
            <th className="px-3 py-3 text-right">Paid</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Date (IST)</th>
            <th className="px-3 py-3">Razorpay reference</th>
            <th className="px-6 py-3">Subscription period</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payments.map((payment) => (
            <tr key={payment.id} className="align-top">
              <td className="px-6 py-3">
                <p className="font-bold text-graphite">{payment.builder.name}</p>
                <p className="text-xs text-slate-500">{payment.builder.email}</p>
                <p className="text-[11px] text-slate-400">
                  Lives in {payment.builder.country}
                  {payment.payment_country ? ` · ${countryName(payment.payment_country)} payment` : ''}
                </p>
              </td>
              <td className="px-3 py-3 text-xs text-slate-600">{planLabel(payment.plan_code, payment.duration_code)}</td>
              <td className="px-3 py-3 text-right text-xs tabular-nums text-slate-600">{formatMinor(payment.original_amount_minor, payment.currency)}</td>
              <td className="px-3 py-3 text-xs">
                {payment.coupon_code ? (
                  <>
                    <span className="font-mono font-bold text-graphite">{payment.coupon_code}</span>
                    <span className="block text-ocbrand-700">− {formatMinor(payment.discount_minor, payment.currency)}</span>
                  </>
                ) : <span className="text-slate-400">—</span>}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                <span className="font-extrabold text-graphite">{formatMinor(payment.amount_minor, payment.currency)}</span>
                <span className="block text-[11px] text-slate-400">{payment.currency}</span>
                {payment.refunded && (
                  <span className="block text-[11px] font-bold text-amber-700">Refunded {formatMinor(payment.refund_amount_minor, payment.currency)}</span>
                )}
              </td>
              <td className="px-3 py-3">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONES[payment.status] || STATUS_TONES.CREATED}`}>
                  {statusLabel(payment.status)}
                </span>
                {payment.gateway_mode === 'mock' && (
                  <span className="mt-1 block text-[10px] font-extrabold uppercase tracking-wide text-amber-700" title="Local demo checkout: not counted in totals">Mock</span>
                )}
                {payment.failure_code && <span className="mt-1 block text-[11px] text-red-500">{payment.failure_code}</span>}
              </td>
              <td className="px-3 py-3 text-xs text-slate-600">
                {payment.paid_at ? formatWhen(payment.paid_at) : <>Ordered {formatWhen(payment.created_at)}</>}
                {payment.refunded_at && <span className="block text-[11px] text-amber-700">Refunded {formatWhen(payment.refunded_at)}</span>}
              </td>
              <td className="px-3 py-3 font-mono text-[11px] text-slate-500">
                <span className="block">{payment.razorpay_order_id}</span>
                {payment.razorpay_payment_id && <span className="block">{payment.razorpay_payment_id}</span>}
              </td>
              <td className="px-6 py-3 text-xs text-slate-600">{periodText(payment.period)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SubscriptionPaymentsPage({ identity, Panel, useAsync }) {
  const [filters, setFilters] = useState({ year: '', month: '', plan: '', status: '', email: '' })
  const [emailDraft, setEmailDraft] = useState('')
  const [offset, setOffset] = useState(0)
  const filterKey = JSON.stringify(filters)

  const summary = useAsync(
    () => fetchSubscriptionPaymentsSummary(paymentQuery(filters, 0, null)),
    [filterKey],
  )
  const list = useAsync(
    () => fetchSubscriptionPayments(paymentQuery(filters, offset, PAGE_SIZE)),
    [filterKey, offset],
  )
  const view = paymentsViewState(list)
  const currency = summary.data?.currency || 'INR'

  const change = (field) => (event) => {
    const value = event.target.value
    setFilters((current) => ({ ...current, [field]: value, ...(field === 'year' && !value ? { month: '' } : {}) }))
    setOffset(0)
  }
  const searchEmail = (event) => {
    event.preventDefault()
    setFilters((current) => ({ ...current, email: emailDraft.trim() }))
    setOffset(0)
  }
  const filtered = Object.values(filters).some(Boolean)

  return (
    <Panel
      title={<><Receipt className="h-4 w-4 text-brand-600" /> Builder subscription payments</>}
      subtitle={identity.scope === 'GLOBAL'
        ? 'India payments. Read-only.'
        : `Payments in ${COUNTRY_NAMES[identity.scope] || identity.scope}. Read-only.`}
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-6 py-4">
        <label className="grid gap-1 text-[11px] font-bold text-slate-500">
          Year
          <select value={filters.year} onChange={change('year')} className={selectClass}>
            <option value="">All years</option>
            {yearOptions().map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-slate-500">
          Month
          <select value={filters.month} onChange={change('month')} disabled={!filters.year} className={selectClass}>
            <option value="">All months</option>
            {MONTH_NAMES.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-slate-500">
          Plan
          <select value={filters.plan} onChange={change('plan')} className={selectClass}>
            <option value="">All plans</option>
            {PLAN_OPTIONS.map((plan) => <option key={plan.value} value={plan.value}>{plan.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-slate-500">
          Status
          <select value={filters.status} onChange={change('status')} className={selectClass}>
            <option value="">All statuses</option>
            {PAYMENT_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </label>
        <form onSubmit={searchEmail} className="grid gap-1 text-[11px] font-bold text-slate-500">
          <label htmlFor="subscription-payments-email">Builder email</label>
          <div className="flex gap-1.5">
            <input id="subscription-payments-email" type="search" value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)}
              maxLength={255} placeholder="name@example.com" className={`${selectClass} w-56`} />
            <button type="submit" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Search by email">
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
        {filtered && (
          <button type="button" onClick={() => { setFilters({ year: '', month: '', plan: '', status: '', email: '' }); setEmailDraft(''); setOffset(0) }}
            className="h-9 rounded-lg px-3 text-xs font-bold text-slate-500 hover:bg-slate-50">
            Clear filters
          </button>
        )}
      </div>

      {summary.error && <ErrorBox error={summary.error} fallback="Could not load the totals. Try again." onRetry={summary.reload} />}
      {!summary.error && !summary.data && summary.loading && <p className="px-6 py-5 text-sm font-semibold text-slate-400">Loading totals…</p>}
      {!summary.error && summary.data && (
        <>
          <Summary summary={summary.data} currency={currency} />
          {summary.data.mock_payment_count > 0 && (
            <p className="mx-6 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {summary.data.mock_payment_count} local mock payment{summary.data.mock_payment_count === 1 ? '' : 's'} (demo checkout, no Razorpay) listed below but not counted in these totals.
            </p>
          )}
          <MonthlyTable monthly={summary.data.monthly} currency={currency} />
        </>
      )}

      <div className="border-t border-slate-200">
        <h3 className="px-6 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wide text-slate-500">Payment history</h3>
        {view === 'error' && <ErrorBox error={list.error} fallback="Could not load payments. Try again." onRetry={list.reload} />}
        {view === 'loading' && <p className="px-6 py-6 text-sm font-semibold text-slate-400">Loading…</p>}
        {view === 'empty' && (
          <p className="px-6 py-8 text-center text-sm font-semibold text-slate-500">
            {filtered ? 'No payments match these filters.' : 'No builder subscription payments yet.'}
          </p>
        )}
        {view === 'list' && <PaymentsTable payments={list.data.payments} />}
        <Pagination data={list.data} offset={offset} onChange={setOffset} loading={list.loading} />
      </div>
    </Panel>
  )
}
