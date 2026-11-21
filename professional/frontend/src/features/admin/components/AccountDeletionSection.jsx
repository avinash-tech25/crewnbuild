/**
 * Admin > Account Deletion: the accounts their holders have deleted.
 *
 * One row per deleted account. The reason stays hidden until the eye button on
 * that row is pressed, and only for that row. A row (or its name) opens the
 * full record: the details kept when the account was deleted, what was removed
 * and what was retained. Read only; who may look is the server's decision
 * (deletions.view), and a refusal shows the server's own reason.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, RefreshCw, Search } from 'lucide-react'
import { DetailDialog, DetailSection } from '../../../shared/ui/DetailDialog.jsx'
import { fetchDeletedAccount, fetchDeletedAccounts } from '../adminApi.js'
import { SkeletonList } from '../../../shared/ui/Skeleton.jsx'

function when(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function day(value) {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function refusal(error) {
  const detail = error?.response?.data?.detail
  if (detail && typeof detail === 'object') return detail.message || 'The request was refused.'
  return detail || 'The details could not be loaded.'
}

function reasonText(row) {
  const parts = [row.reason_label, row.reason_details].filter(Boolean)
  return parts.length ? parts.join(' — ') : 'No reason recorded'
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{children || '—'}</dd>
    </div>
  )
}

function DeletedAccountDetails({ id, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setData(null)
    setError('')
    fetchDeletedAccount(id).then(setData).catch((failure) => setError(refusal(failure)))
  }, [id])

  return (
    <DetailDialog
      title={data?.name || 'Deleted account'}
      onClose={onClose}
      closeLabel="Close"
      status={data && <span className="font-mono">{data.reference}</span>}
    >
          {!data && <p className="text-sm text-slate-500">{error || 'Loading…'}</p>}
          {data && (
            <>
              <DetailSection className="text-sm">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name">{data.name}</Field>
                <Field label="User role">{data.role_label}</Field>
                <Field label="Registered mobile number">{data.phone}</Field>
                <Field label="Registered email">{data.email || 'No email on the account'}</Field>
                <Field label="Account joining date">{when(data.joined_at)}</Field>
                <Field label="Account deletion date">{when(data.deleted_at)}</Field>
                <div className="sm:col-span-2"><Field label="Deletion reason">{reasonText(data)}</Field></div>
              </dl>
              </DetailSection>
              <DetailSection title="Deletion history" className="text-sm">
                <ul className="space-y-1 text-slate-700">
                  <li>Account joined: {when(data.joined_at)}</li>
                  {data.confirmed_at && <li>Deletion confirmed by the account holder: {when(data.confirmed_at)}</li>}
                  <li>Account deleted: {when(data.deleted_at)} by {data.deleted_by}</li>
                  <li>Personal files removed: {data.personal_files_removed}{data.personal_files_kept_shared ? ` · kept because shared: ${data.personal_files_kept_shared}` : ''}</li>
                  <li>Financial records retained: {Object.values(data.retained_records || {}).reduce((sum, count) => sum + count, 0)}
                    {Object.keys(data.retained_records || {}).length > 0 && ` (${Object.entries(data.retained_records).map(([table, count]) => `${table.split('.')[0]}: ${count}`).join(', ')})`}</li>
                  {data.stored_objects_not_removed?.length > 0 && (
                    <li className="font-bold text-amber-700">Stored files not removed from storage: {data.stored_objects_not_removed.join(', ')}</li>
                  )}
                </ul>
              </DetailSection>
              <DetailSection className="text-sm">
              <dl className="grid gap-4 sm:grid-cols-2">
                <Field label="Original user ID"><span className="font-mono text-xs">{data.user_id}</span></Field>
                <Field label="Record reference"><span className="font-mono text-xs">{data.reference}</span></Field>
              </dl>
              </DetailSection>
            </>
          )}
    </DetailDialog>
  )
}

export function AccountDeletionPage({ Panel, useAsync }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  // Ids whose reason is shown; each row toggles only its own.
  const [revealed, setRevealed] = useState(() => new Set())
  const { data, error, loading, reload } = useAsync(() => fetchDeletedAccounts(query), [query])
  const rows = data || []

  const toggleReason = (id) => setRevealed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="mx-auto max-w-page space-y-4 p-4">
      <Panel
        title="Account deletion"
        subtitle="Accounts deleted by their holders from Profile Settings. Read only."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()) }} className="flex items-center gap-1">
              <input type="search" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} placeholder="Name, mobile or email"
                className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm" aria-label="Search deleted accounts" />
              <button type="submit" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200" aria-label="Search"><Search className="h-4 w-4" /></button>
            </form>
            <button type="button" onClick={reload} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200" aria-label="Refresh"><RefreshCw className="h-4 w-4" /></button>
          </div>
        )}
      >
        {error && <p className="px-6 py-4 text-sm font-semibold text-rose-700">{error}</p>}
        {!error && loading && !rows.length && <SkeletonList rows={5} rowClassName="h-12" className="grid gap-2.5 px-6 py-4" />}
        {!error && !loading && !rows.length && (
          <p className="flex items-center gap-2 px-6 py-6 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4" />No deleted accounts{query ? ` matching “${query}”` : ''}.</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-bold">User name</th>
                  <th scope="col" className="px-4 py-3 font-bold">User role</th>
                  <th scope="col" className="px-4 py-3 font-bold">Registered phone number</th>
                  <th scope="col" className="px-4 py-3 font-bold">Registered email ID</th>
                  <th scope="col" className="px-4 py-3 font-bold">Account joining date</th>
                  <th scope="col" className="px-4 py-3 font-bold">Account deletion date</th>
                  <th scope="col" className="px-4 py-3 font-bold">Reason</th>
                  <th scope="col" className="px-4 py-3 font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const shown = revealed.has(row.id)
                  const reasonId = `deleted-reason-${row.id}`
                  return (
                    <tr key={row.id} onClick={() => setOpenId(row.id)} className="cursor-pointer align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); setOpenId(row.id) }} className="text-left font-bold text-graphite hover:underline">
                          {row.name || '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3">{row.role_label}</td>
                      <td className="px-4 py-3">{row.phone || '—'}</td>
                      <td className="px-4 py-3 break-all">{row.email || '—'}</td>
                      <td className="px-4 py-3">{day(row.joined_at)}</td>
                      <td className="px-4 py-3">{when(row.deleted_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); toggleReason(row.id) }}
                            aria-pressed={shown}
                            aria-controls={reasonId}
                            aria-label={`${shown ? 'Hide' : 'Show'} the deletion reason for ${row.name || 'this account'}`}
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                          <span id={reasonId} className="max-w-[16rem] pt-1.5 text-slate-700">{shown ? reasonText(row) : ''}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); setOpenId(row.id) }}
                          className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-bold text-graphite hover:bg-slate-100">
                          View details
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {openId && <DeletedAccountDetails id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
