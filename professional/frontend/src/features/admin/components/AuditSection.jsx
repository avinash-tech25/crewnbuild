/**
 * The audit log.
 *
 * One line per entry, so a day can be scanned quickly. The icon and its colour
 * carry the kind of action, which means a suspension is distinguishable from an
 * approval before reading a word.
 *
 * The filters live in their own bar under the header rather than crowded into
 * it: six controls squeezed beside a title wrap badly and read as decoration.
 */

import { useState } from 'react'
import {
  CheckCircle2,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { fetchAuditLog } from '../adminApi.js'
import { PAGE_SIZE, Pagination } from './AdminPagination.jsx'

// How each action reads and looks. Anything unrecognised falls back to neutral
// rather than being hidden, so an action added later still appears.
const ACTIONS = {
  'admin.created': { icon: UserPlus, tone: 'brand', label: 'Administrator created' },
  'admin.deactivated': { icon: UserMinus, tone: 'red', label: 'Administrator deactivated' },
  'admin.reactivated': { icon: UserPlus, tone: 'green', label: 'Administrator reactivated' },
  'user.suspended': { icon: UserMinus, tone: 'red', label: 'Account suspended' },
  'user.reactivated': { icon: UserPlus, tone: 'green', label: 'Account reactivated' },
  'verification.approved': { icon: ShieldCheck, tone: 'green', label: 'Verification approved' },
  'verification.rejected': { icon: ShieldX, tone: 'red', label: 'Verification rejected' },
  'report.resolved': { icon: CheckCircle2, tone: 'green', label: 'Dispute resolved' },
  'report.rejected': { icon: XCircle, tone: 'red', label: 'Dispute rejected' },
  'report.under_review': { icon: RefreshCw, tone: 'amber', label: 'Dispute picked up' },
  'announcement.sent': { icon: Megaphone, tone: 'brand', label: 'Announcement sent' },
}

const TONES = {
  brand: 'bg-brand-50 text-brand-600',
  green: 'bg-ocbrand-50 text-ocbrand-700',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-500',
}

const SCOPE_NAMES = { GLOBAL: 'Global', IN: 'India', KU: 'Kuwait' }
const today = () => new Date().toISOString().slice(0, 10)

export function AuditPage({ Panel, useAsync }) {
  const [offset, setOffset] = useState(0)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data, error, loading, reload } = useAsync(
    () =>
      fetchAuditLog({
        limit: PAGE_SIZE,
        offset,
        action: action || undefined,
        actor: actor || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    [offset, action, actor, dateFrom, dateTo],
  )

  // Any filter change returns to the first page; staying on page four of a
  // narrower result shows an empty table for no visible reason.
  const apply = (setter) => (value) => {
    setOffset(0)
    setter(value)
  }

  const filtered = Boolean(dateFrom || dateTo || action || actor)
  // Compact and on one row: the filters are a tool bar, not a form, and giving
  // each control a stacked caption made the bar taller than the rows it filters.
  const field =
    'h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-bold text-graphite outline-none focus:border-ocbrand-400'
  const caption = 'shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400'

  return (
    <Panel
      title="Audit Log"
      subtitle={
        data
          ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'}${
              filtered ? ' matching' : ''
            }. Nothing here can be edited or deleted.`
          : 'Every administrative action. Nothing here can be edited or deleted.'
      }
      right={
        <button
          type="button"
          onClick={reload}
          className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {/* One row, always. flex-wrap let the four controls break onto a second
          line whenever the panel was narrow, which is what made the bar taller
          than the rows it filters. It scrolls sideways instead — the table below
          already does, so the behaviour is not new to this screen. */}
      <div className="flex flex-nowrap items-center gap-x-3 overflow-x-auto border-b border-slate-200/80 bg-slate-50/60 px-6 py-2">
        <label className="flex shrink-0 items-center gap-1.5">
          <span className={caption}>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || today()}
            onChange={(event) => apply(setDateFrom)(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex shrink-0 items-center gap-1.5">
          <span className={caption}>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            max={today()}
            onChange={(event) => apply(setDateTo)(event.target.value)}
            className={field}
          />
        </label>
        <label className="flex shrink-0 items-center gap-1.5">
          <span className={caption}>Action</span>
          {/* Only actions present in this log are offered, so a filter can never
              be chosen that returns nothing. */}
          <select
            value={action}
            onChange={(event) => apply(setAction)(event.target.value)}
            className={field}
          >
            <option value="">All</option>
            {(data?.actions || []).map((value) => (
              <option key={value} value={value}>
                {ACTIONS[value]?.label || value.replace(/[._]/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex shrink-0 items-center gap-1.5">
          <span className={caption}>By</span>
          <select
            value={actor}
            onChange={(event) => apply(setActor)(event.target.value)}
            className={field}
          >
            <option value="">Anyone</option>
            {(data?.actors || []).map((value) => (
              <option key={value} value={value}>
                {value.split('@')[0]}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setOffset(0)
              setDateFrom('')
              setDateTo('')
              setAction('')
              setActor('')
            }}
            className="h-7 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-extrabold text-amber-800 hover:bg-amber-100"
          >
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">What happened</th>
              <th className="px-4 py-2.5">Who</th>
              <th className="px-4 py-2.5">Scope</th>
              <th className="px-4 py-2.5">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  {error}
                </td>
              </tr>
            )}
            {!error && loading && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!error && !loading && !data?.entries.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                  {filtered ? 'Nothing matches those filters.' : 'Nothing has been recorded yet.'}
                </td>
              </tr>
            )}
            {!error &&
              !loading &&
              data?.entries.map((entry) => {
                const meta = ACTIONS[entry.action] || {
                  icon: CheckCircle2,
                  tone: 'slate',
                  label: entry.action.replace(/[._]/g, ' '),
                }
                const Icon = meta.icon
                return (
                  <tr key={entry.id} className="hover:bg-brand-50/40">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-500">
                      {new Date(entry.created_at).toLocaleString(undefined, {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {/* Colour before words: red takes something away, green
                          gives or restores, amber is picked up but unfinished. */}
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${TONES[meta.tone]}`}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        <span className="text-xs font-bold text-graphite">{meta.label}</span>
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-slate-600">
                      <span className="block truncate" title={entry.summary}>
                        {entry.summary}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-graphite">
                      {entry.actor_email.split('@')[0]}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="rounded-md bg-oc-mint px-2 py-0.5 text-[11px] font-bold text-oc-deep">
                        {SCOPE_NAMES[entry.scope] || entry.scope}
                      </span>
                    </td>
                    {/* Wrapped rather than cropped. The reason is what explains
                        the decision months later, and half of it is no use. */}
                    <td className="w-72 px-4 py-2.5 align-top text-xs italic leading-relaxed text-slate-500">
                      {entry.reason || <span className="not-italic text-slate-300">—</span>}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      <Pagination data={data} offset={offset} onChange={setOffset} loading={loading} />
    </Panel>
  )
}
