/**
 * Leads / Marketplace — whether the marketplace is actually working.
 *
 * Every introduction on the platform is one row here: an owner approaching a
 * builder, a supplier pitching a contractor. The summary answers the question an
 * administrator is really asking — are approaches turning into work, and is
 * anything sitting unanswered?
 *
 * Read-only. There are no Accept or Reject buttons, deliberately: this is a
 * negotiation between two businesses, and the platform watches it rather than
 * taking part.
 */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { fetchMarketplaceActivity } from '../adminApi.js'
import { PAGE_SIZE, Pagination } from './AdminPagination.jsx'

const STATUS_TABS = [
  ['', 'All'],
  ['pending', 'Pending'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
]

const CATEGORY_COLOURS = {
  Hiring: 'bg-oc-mint text-oc-deep',
  Materials: 'bg-ocaccent-50 text-oc-deep',
  Expertise: 'bg-ocbrand-50 text-ocbrand-700',
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-white px-5 py-3.5">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-oc-faint">{label}</p>
      <p
        className={`mt-1 font-display text-xl font-extrabold tabular-nums ${
          tone === 'warn' ? 'text-oc-amber' : 'text-oc-ink'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

export function LeadsPage({ Panel, useAsync }) {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [offset, setOffset] = useState(0)
  const { data, error, loading, reload } = useAsync(
    () => fetchMarketplaceActivity({ ...(status ? { status } : {}), limit: PAGE_SIZE, offset }),
    [status, offset],
  )

  const chooseStatus = (value) => {
    setOffset(0)
    setStatus(value)
  }

  const summary = data?.summary

  return (
    <div className="grid gap-5">
      <Panel
        title="Marketplace activity"
        subtitle="Introductions between accounts in your scope, and what came of them."
        right={
          <button
            type="button"
            onClick={reload}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-oc-muted hover:bg-oc-sunken"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        <div className="grid gap-px bg-oc-line sm:grid-cols-2 lg:grid-cols-6">
          <Stat label="Pending" value={summary?.pending ?? '…'} />
          <Stat label="Accepted" value={summary?.accepted ?? '…'} />
          <Stat label="Rejected" value={summary?.rejected ?? '…'} />
          {/* Taken back by the sender -- not a rejection, and not in the acceptance rate. */}
          <Stat label="Withdrawn" value={summary?.withdrawn ?? '…'} />
          <Stat label="Stalled 7+ days" value={summary?.stalled ?? '…'} tone="warn" />
          {/* Null until something has actually been decided — a confident 0%
              that only means "too early to tell" would be worse than a dash. */}
          <Stat
            label="Acceptance rate"
            value={summary?.acceptance_rate == null ? '—' : `${summary.acceptance_rate}%`}
          />
        </div>
      </Panel>

      <Panel
        title="Requests"
        subtitle="Newest first. A request is read-only here — the two parties settle it themselves."
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map(([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => chooseStatus(value)}
                className={`h-8 rounded-lg px-3 text-xs font-extrabold ${
                  status === value
                    ? 'bg-oc-deep text-white'
                    : 'border border-slate-200 bg-white text-oc-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5">Direction</th>
                <th className="px-4 py-2.5">From</th>
                <th className="px-4 py-2.5">To</th>
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5 text-right">Quotation</th>
                <th className="px-4 py-2.5">Age</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {error && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    {error}
                  </td>
                </tr>
              )}
              {!error && loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!error && !loading && !data?.requests.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                    No requests in your scope yet.
                  </td>
                </tr>
              )}
              {!error &&
                !loading &&
                data?.requests.map((request) => (
                  <tr key={request.id} className="hover:bg-brand-50/40">
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                          CATEGORY_COLOURS[request.category] || 'bg-oc-sunken text-oc-muted'
                        }`}
                      >
                        {request.category}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs font-bold text-oc-ink">
                      {request.direction}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-oc-ink">{request.from_name || '—'}</span>
                      <span className="block text-[11px] text-oc-faint">{request.from_role}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-oc-ink">{request.to_name || '—'}</span>
                      <span className="block text-[11px] text-oc-faint">{request.to_role}</span>
                    </td>
                    <td className="max-w-52 px-4 py-2.5">
                      <span className="block truncate text-oc-muted">
                        {request.project_title || 'General enquiry'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-oc-ink">
                      {request.quotation_amount
                        ? request.quotation_amount.toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 text-xs tabular-nums ${
                          request.stalled ? 'font-extrabold text-oc-amber' : 'text-oc-muted'
                        }`}
                      >
                        {request.stalled && <AlertTriangle className="h-3 w-3" />}
                        {request.age_days == null ? '—' : `${request.age_days}d`}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase ${
                          request.status === 'accepted'
                            ? 'bg-ocbrand-50 text-ocbrand-700'
                            : request.status === 'rejected'
                              ? 'bg-red-50 text-red-600'
                              : request.status === 'withdrawn'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-oc-amber/20 text-oc-deep'
                        }`}
                      >
                        {request.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination data={data} offset={offset} onChange={setOffset} loading={loading} />
      </Panel>
    </div>
  )
}
