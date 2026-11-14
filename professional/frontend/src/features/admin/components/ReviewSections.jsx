/**
 * Verification and Reports — the two screens where an administrator decides
 * something rather than merely looking.
 *
 * Both are built around the same idea: the decision needs its evidence beside it.
 * A verification shows the documents on the same screen as the Approve button, and
 * a report shows the complaint in full next to the resolution box, so nobody has
 * to act on a summary.
 */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, ExternalLink, FileText, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { PAGE_SIZE, Pagination } from './AdminPagination.jsx'
import {
  decideVerification,
  fetchAdminReports,
  fetchVerificationQueue,
  updateReport,
} from '../adminApi.js'
import { can } from '../adminAccess.js'

const VERIFICATION_TABS = [
  ['PENDING', 'Pending'],
  ['APPROVED', 'Verified'],
  ['REJECTED', 'Rejected'],
  ['MORE_INFO_REQUESTED', 'More info asked'],
]

const REPORT_TABS = [
  // "Open" is what the dashboard counts, so it is the tab you land on from it.
  ['OPEN', 'Open'],
  ['', 'All'],
  ['NEW', 'New'],
  ['UNDER_REVIEW', 'Under review'],
  ['RESOLVED', 'Resolved'],
  ['REJECTED', 'Rejected'],
]

export function VerifiedBadge({ verified }) {
  // Deliberately not the same shape or colour as anything used for paid or
  // featured accounts: verified means somebody checked the documents, and it must
  // never be readable as "this account pays us".
  if (!verified) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ocbrand-50 px-2 py-0.5 text-[11px] font-extrabold text-ocbrand-700">
      <ShieldCheck className="h-3 w-3" /> Verified
    </span>
  )
}

function DocumentList({ documents }) {
  if (!documents?.length) {
    return <p className="text-xs font-medium text-oc-faint">No documents submitted.</p>
  }
  return (
    <ul className="grid gap-1.5">
      {documents.map((document) => (
        <li key={`${document.label}-${document.url}`}>
          <a
            href={imageUrl(document.url)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-oc-ink hover:border-ocbrand-400"
          >
            <FileText className="h-3.5 w-3.5 text-oc-muted" />
            {document.label}
            <ExternalLink className="h-3 w-3 text-oc-faint" />
          </a>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------- Verification */

export function VerificationPage({ identity, Panel, useAsync }) {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('state') || 'PENDING')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')
  const [notes, setNotes] = useState('')
  const [expiry, setExpiry] = useState('')

  const { data, error, loading, reload } = useAsync(() => fetchVerificationQueue(tab), [tab])
  const canDecide = can(identity, 'verification.decide')

  const decide = async (account, status) => {
    if (status !== 'APPROVED' && !notes.trim()) {
      setMessage('Explain what is wrong, so they know what to fix.')
      return
    }
    setBusyId(account.user_id)
    setMessage('')
    try {
      await decideVerification(account.user_id, {
        status,
        notes: notes.trim() || null,
        expires_on: expiry || null,
      })
      setNotes('')
      setExpiry('')
      setOpenId(null)
      reload()
    } catch (requestError) {
      setMessage(requestError.response?.data?.detail || 'Could not record that decision.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Panel
      title="Verification"
      subtitle="Checking documents. This is separate from whether an account pays."
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          {VERIFICATION_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value)
                setOpenId(null)
              }}
              className={`h-8 rounded-lg px-3 text-xs font-extrabold ${
                tab === value ? 'bg-oc-deep text-white' : 'border border-slate-200 bg-white text-oc-muted'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={reload}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-oc-muted"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {message && (
        <p className="border-b border-oc-line bg-red-50 px-5 py-2 text-xs font-bold text-red-600">
          {message}
        </p>
      )}

      <div className="divide-y divide-slate-100">
        {error && <p className="px-5 py-10 text-center text-sm text-slate-500">{error}</p>}
        {!error && loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading…</p>}
        {!error && !loading && !data?.accounts.length && (
          <p className="px-5 py-10 text-center text-sm font-medium text-slate-500">
            {tab === 'PENDING' ? 'Nothing is waiting for review.' : 'Nothing here yet.'}
          </p>
        )}

        {!error &&
          !loading &&
          data?.accounts.map((account) => {
            const open = openId === account.user_id
            return (
              <div key={account.user_id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-display text-sm font-bold text-graphite">
                      {account.company || account.name}
                      <VerifiedBadge verified={account.verified} />
                    </p>
                    <p className="mt-0.5 text-xs text-oc-muted">
                      {account.name} · {account.role} · {account.country || '—'}
                      {account.licence_number && ` · Licence ${account.licence_number}`}
                    </p>
                    <p className="mt-0.5 text-[11px] text-oc-faint">
                      {account.documents.length} document
                      {account.documents.length === 1 ? '' : 's'} submitted
                      {account.reviewer_email && ` · reviewed by ${account.reviewer_email}`}
                    </p>
                    {account.notes && (
                      <p className="mt-1 text-xs font-medium text-oc-amber">{account.notes}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(open ? null : account.user_id)
                      setNotes('')
                      setExpiry('')
                      setMessage('')
                    }}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-oc-ink hover:bg-oc-sunken"
                  >
                    {open ? 'Close' : 'Review'}
                  </button>
                </div>

                {open && (
                  <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                        Documents submitted
                      </p>
                      <div className="mt-1.5">
                        <DocumentList documents={account.documents} />
                      </div>
                    </div>

                    <div className="grid content-start gap-2">
                      <label className="grid gap-1">
                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                          Notes — required unless approving
                        </span>
                        <textarea
                          value={notes}
                          onChange={(event) => setNotes(event.target.value)}
                          rows={3}
                          placeholder="What is missing or wrong?"
                          className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-ocbrand-400"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                          Expires on (optional)
                        </span>
                        <input
                          type="date"
                          value={expiry}
                          onChange={(event) => setExpiry(event.target.value)}
                          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-ocbrand-400"
                        />
                        <span className="text-[11px] text-oc-faint">
                          A licence that expires means a verification that expires with it.
                        </span>
                      </label>

                      {canDecide && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId === account.user_id}
                            onClick={() => decide(account, 'APPROVED')}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-3.5 text-sm font-extrabold text-white hover:bg-oc-deep disabled:opacity-60"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === account.user_id}
                            onClick={() => decide(account, 'MORE_INFO_REQUESTED')}
                            className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-extrabold text-oc-ink hover:bg-white disabled:opacity-60"
                          >
                            Ask for more
                          </button>
                          <button
                            type="button"
                            disabled={busyId === account.user_id}
                            onClick={() => decide(account, 'REJECTED')}
                            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 text-sm font-extrabold text-red-600 hover:bg-red-100 disabled:opacity-60"
                          >
                            <XCircle className="h-4 w-4" /> Reject
                          </button>
                        </div>
                      )}
                      {!canDecide && (
                        <p className="text-xs font-medium text-oc-muted">
                          You can review these documents but not decide on them.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </Panel>
  )
}

/* ----------------------------------------------------------------- Reports */

export function ReportsPage({ identity, Panel, useAsync }) {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('status') || '')
  const [openId, setOpenId] = useState(null)
  const [note, setNote] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')

  const [offset, setOffset] = useState(0)
  const { data, error, loading, reload } = useAsync(
    () => fetchAdminReports({ ...(tab ? { status: tab } : {}), limit: PAGE_SIZE, offset }),
    [tab, offset],
  )
  const canResolve = can(identity, 'reports.resolve')

  const act = async (report, status) => {
    if (['RESOLVED', 'REJECTED'].includes(status) && !note.trim()) {
      setMessage('Say how this was settled — that note is the record of the decision.')
      return
    }
    setBusyId(report.id)
    setMessage('')
    try {
      await updateReport(report.id, { status, note: note.trim() || null })
      setNote('')
      setOpenId(null)
      reload()
    } catch (requestError) {
      setMessage(requestError.response?.data?.detail || 'Could not update that report.')
    } finally {
      setBusyId(null)
    }
  }

  const statusColour = (status) =>
    ({
      NEW: 'bg-oc-amber/20 text-oc-deep',
      UNDER_REVIEW: 'bg-oc-mint text-oc-deep',
      RESOLVED: 'bg-ocbrand-50 text-ocbrand-700',
      REJECTED: 'bg-red-50 text-red-600',
    })[status] || 'bg-oc-sunken text-oc-muted'

  return (
    <Panel
      title="Reports & Disputes"
      subtitle="Complaints raised about accounts and projects in your scope."
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_TABS.map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => {
                setTab(value)
                setOffset(0)
                setOpenId(null)
              }}
              className={`h-8 rounded-lg px-3 text-xs font-extrabold ${
                tab === value ? 'bg-oc-deep text-white' : 'border border-slate-200 bg-white text-oc-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {message && (
        <p className="border-b border-oc-line bg-red-50 px-5 py-2 text-xs font-bold text-red-600">
          {message}
        </p>
      )}

      <div className="divide-y divide-slate-100">
        {error && <p className="px-5 py-10 text-center text-sm text-slate-500">{error}</p>}
        {!error && loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading…</p>}
        {!error && !loading && !data?.reports.length && (
          <p className="px-5 py-10 text-center text-sm font-medium text-slate-500">
            No reports here. That is good news.
          </p>
        )}

        {!error &&
          !loading &&
          data?.reports.map((report) => {
            const open = openId === report.id
            return (
              <div key={report.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-oc-ink">
                      #{report.id} · {report.category.replace('_', ' ')}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${statusColour(
                          report.status,
                        )}`}
                      >
                        {report.status.replace('_', ' ')}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-oc-muted">
                      About {report.subject_type} · {report.subject_name || 'since deleted'} ·
                      raised by {report.reporter_name || 'unknown'}
                    </p>
                    <p className="mt-1.5 max-w-3xl text-sm text-oc-ink">{report.description}</p>
                    {report.resolution_note && (
                      <p className="mt-1.5 text-xs font-medium text-ocbrand-700">
                        Settled: {report.resolution_note}
                      </p>
                    )}
                  </div>
                  {canResolve && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(open ? null : report.id)
                        setNote('')
                        setMessage('')
                      }}
                      className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-oc-ink hover:bg-oc-sunken"
                    >
                      {open ? 'Close' : 'Handle'}
                    </button>
                  )}
                </div>

                {open && (
                  <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <label className="grid gap-1">
                      <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                        How was this settled? Required to resolve or reject.
                      </span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-ocbrand-400"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => act(report, 'UNDER_REVIEW')}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-extrabold text-oc-ink disabled:opacity-60"
                      >
                        Take it up
                      </button>
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => act(report, 'RESOLVED')}
                        className="h-9 rounded-lg bg-oc-green px-3.5 text-sm font-extrabold text-white hover:bg-oc-deep disabled:opacity-60"
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => act(report, 'REJECTED')}
                        className="h-9 rounded-lg border border-red-200 bg-red-50 px-3.5 text-sm font-extrabold text-red-600 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
      </div>
      <Pagination data={data} offset={offset} onChange={setOffset} loading={loading} />
    </Panel>
  )
}
