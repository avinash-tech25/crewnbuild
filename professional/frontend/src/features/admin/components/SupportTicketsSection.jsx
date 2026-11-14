/**
 * Admin > Support Tickets: the requests sent from the Contact & Support page.
 *
 * A list (filter by status, search by reference, name, email or subject) and a
 * ticket panel with the conversation, where support.manage can reply and move
 * the ticket through Open -> In Progress -> Waiting for User -> Resolved ->
 * Closed. Within the administrator's own country; the server decides, and a
 * refusal shows its own reason.
 */
import { useEffect, useState } from 'react'
import { Loader2, Paperclip, RefreshCw, Search, Send, X } from 'lucide-react'
import {
  fetchStaffTicket, fetchStaffTickets, openAttachment, replyAsStaff, staffAttachmentPath, supportErrorMessage,
} from '../../support/supportApi.js'
import { StatusBadge } from '../../support/pages/SupportTicketsPage.jsx'

const STATUSES = [
  ['', 'All statuses'],
  ['OPEN', 'Open'],
  ['IN_PROGRESS', 'In Progress'],
  ['WAITING_FOR_USER', 'Waiting for User'],
  ['RESOLVED', 'Resolved'],
  ['CLOSED', 'Closed'],
]

function when(value) {
  return value ? new Date(value).toLocaleString() : '—'
}

function TicketPanel({ id, canManage, onClose, onChanged }) {
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTicket(null)
    setError('')
    fetchStaffTicket(id)
      .then((data) => { setTicket(data); setStatus(data.status) })
      .catch((failure) => setError(supportErrorMessage(failure, 'The ticket could not be loaded.')))
  }, [id])

  const save = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await replyAsStaff(id, { body: body.trim(), status: status !== ticket.status ? status : null })
      setTicket(updated)
      setStatus(updated.status)
      setBody('')
      onChanged()
    } catch (failure) {
      setError(supportErrorMessage(failure, 'The reply could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-900/40 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="support-ticket-title">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div className="min-w-0">
            <h3 id="support-ticket-title" className="break-words text-lg font-extrabold text-graphite">{ticket?.subject || 'Support ticket'}</h3>
            {ticket && <p className="font-mono text-xs text-slate-500">{ticket.reference} · {ticket.category_label} · {ticket.issue_label}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          {!ticket && !error && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
          {ticket && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={ticket.status} label={ticket.status_label} />
                {ticket.priority === 'URGENT' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-extrabold text-red-700 ring-1 ring-red-200">Urgent</span>}
                <span className="text-xs text-slate-500">{ticket.account_type_label}{ticket.signed_in ? '' : ' · not signed in'} · {ticket.locality}</span>
              </div>
              <dl className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                <div><dt className="text-xs font-bold uppercase text-slate-400">Contact</dt><dd className="break-words text-slate-800">{ticket.contact.name}<br />{ticket.contact.email}{ticket.contact.phone && <><br />{ticket.contact.phone}</>}</dd></div>
                <div><dt className="text-xs font-bold uppercase text-slate-400">Submitted</dt><dd className="text-slate-800">{when(ticket.created_at)}</dd></div>
                {ticket.details.map((detail) => (
                  <div key={detail.key}><dt className="text-xs font-bold uppercase text-slate-400">{detail.label}</dt><dd className="break-words text-slate-800">{detail.value}</dd></div>
                ))}
              </dl>
              <p className="whitespace-pre-wrap break-words leading-6 text-slate-800">{ticket.description}</p>
              {ticket.attachment && (
                <button
                  type="button"
                  onClick={() => openAttachment(staffAttachmentPath(id)).catch((failure) => setError(supportErrorMessage(failure, 'The attachment could not be opened.')))}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 font-bold text-ocbrand-700 hover:bg-slate-50"
                >
                  <Paperclip className="h-4 w-4" /> {ticket.attachment.name}
                </button>
              )}
              <div>
                <h4 className="text-xs font-bold uppercase text-slate-400">Conversation</h4>
                {ticket.messages.length ? (
                  <ol className="mt-2 space-y-2">
                    {ticket.messages.map((message) => (
                      <li key={message.id} className={`rounded-xl px-4 py-3 ${message.author === 'STAFF' ? 'ms-8 bg-ocbrand-50' : 'me-8 bg-slate-50'}`}>
                        <p className="text-xs font-bold text-slate-500">{message.author === 'STAFF' ? 'Support' : ticket.contact.name} · {when(message.created_at)}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{message.body}</p>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-2 text-slate-500">No replies yet.</p>}
              </div>
            </>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 font-semibold text-red-700">{error}</p>}
        </div>
        {ticket && canManage && (
          <form onSubmit={save} className="space-y-3 border-t border-slate-100 p-5">
            <label className="block text-xs font-bold text-slate-600" htmlFor="staff-reply">Reply to {ticket.contact.name}</label>
            <textarea id="staff-reply" rows={3} maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-ocbrand-500 focus:ring-2 focus:ring-ocbrand-100" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm">
                  {STATUSES.slice(1).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="submit" disabled={busy || (!body.trim() && status === ticket.status)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-ocbrand-600 px-4 text-sm font-bold text-white hover:bg-ocbrand-700 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {body.trim() ? 'Send reply' : 'Update status'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export function SupportTicketsAdminPage({ identity, Panel, useAsync }) {
  const [status, setStatus] = useState('')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const { data, error, loading, reload } = useAsync(() => fetchStaffTickets({ status, q: query }), [status, query])
  const canManage = Boolean(identity?.permissions?.includes('support.manage'))
  const tickets = data || []

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Panel
        title="Support Tickets"
        subtitle="Requests sent from the Contact & Support page."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm">
              {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <form onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()) }} className="flex h-9 items-center rounded-lg border border-slate-200 px-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input aria-label="Search tickets" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reference, name, email" className="w-44 bg-transparent px-2 text-sm outline-none" />
            </form>
            <button type="button" onClick={reload} aria-label="Refresh" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /></button>
          </div>
        )}
      >
        {error ? (
          <p role="alert" className="px-6 py-8 text-sm font-semibold text-red-700">{typeof error === 'string' ? error : 'Could not load support tickets.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !tickets.length ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
                ) : tickets.length ? tickets.map((ticket) => (
                  <tr key={ticket.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(ticket.id)}>
                    <td className="px-4 py-3 font-mono text-xs">
                      <button type="button" className="font-bold text-ocbrand-700 hover:underline" onClick={(event) => { event.stopPropagation(); setOpenId(ticket.id) }}>{ticket.reference}</button>
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 font-semibold text-slate-800">
                      {ticket.priority === 'URGENT' && <span className="me-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-extrabold text-red-700">URGENT</span>}
                      {ticket.subject}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{ticket.category_label}</td>
                    <td className="px-4 py-3"><StatusBadge status={ticket.status} label={ticket.status_label} /></td>
                    <td className="px-4 py-3 text-slate-500">{when(ticket.updated_at)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No support tickets match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {openId && <TicketPanel id={openId} canManage={canManage} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  )
}
