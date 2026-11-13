/**
 * My Support Tickets.
 *
 *   /contact-us/tickets              the signed-in person's tickets
 *   /contact-us/tickets/:reference   one ticket: details, status, replies
 *
 * Everything shown comes from the API (app/shared/support). Signed out, the
 * page asks the person to sign in; it never lists anything without a session.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Inbox, Loader2, LogIn, Paperclip, RefreshCw, Send, Ticket } from 'lucide-react'
import { SiteHeader } from '../../public-site/components/landing/SiteHeader.jsx'
import { useLanguage } from '../../public-site/components/landing/useLanguage.js'
import { containerClass } from '../../public-site/components/landing/shared.jsx'
import { fetchMyTicket, fetchMyTickets, myAttachmentPath, openAttachment, replyToMyTicket, supportErrorMessage } from '../supportApi.js'

const focusRing = 'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(18,107,69,.3)]'
const STATUS_ORDER = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']

const STATUS_TONES = {
  OPEN: 'bg-sky-50 text-sky-700 ring-sky-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-800 ring-amber-200',
  WAITING_FOR_USER: 'bg-orange-50 text-orange-700 ring-orange-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function StatusBadge({ status, label }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ${STATUS_TONES[status] || STATUS_TONES.CLOSED}`}>
      {label || status}
    </span>
  )
}

function when(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

function SignInPrompt() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-oc-line bg-white p-8 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-oc-mint text-oc-green"><LogIn size={22} aria-hidden="true" /></span>
      <h2 className="mt-4 text-lg font-extrabold text-oc-ink">Sign in to see your tickets</h2>
      <p className="mt-1 text-sm font-medium text-oc-muted">Your support requests are listed under the account you used to send them.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        <Link to="/login" className={`inline-flex h-11 items-center rounded-xl bg-oc-green px-6 text-sm font-extrabold text-white hover:bg-oc-deep ${focusRing}`}>Sign in</Link>
        <Link to="/contact-us" className={`inline-flex h-11 items-center rounded-xl border border-[rgba(8,62,43,.25)] px-5 text-sm font-extrabold text-oc-deep hover:bg-oc-mint ${focusRing}`}>Contact support</Link>
      </div>
    </div>
  )
}

function useLoader(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const run = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }))
    loader()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error, loading: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(run, [run])
  return { ...state, reload: run, setData: (data) => setState({ data, error: null, loading: false }) }
}

function LoadState({ state, children }) {
  if (state.loading && !state.data) {
    return <p role="status" className="flex items-center gap-2 py-10 text-sm font-semibold text-oc-muted"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Loading…</p>
  }
  const status = state.error?.response?.status
  if (status === 401) return <SignInPrompt />
  if (state.error) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
        {status === 404 ? 'This ticket was not found under your account.' : supportErrorMessage(state.error, 'Your tickets could not be loaded.')}
        {status !== 404 && (
          <button type="button" onClick={state.reload} className={`inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 font-extrabold ring-1 ring-red-200 ${focusRing}`}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    )
  }
  return children
}

function TicketList() {
  const state = useLoader(fetchMyTickets, [])
  return (
    <LoadState state={state}>
      {state.data?.length ? (
        <ul className="divide-y divide-oc-line overflow-hidden rounded-2xl border border-oc-line bg-white">
          {state.data.map((ticket) => (
            <li key={ticket.reference}>
              <Link to={`/contact-us/tickets/${encodeURIComponent(ticket.reference)}`} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 hover:bg-oc-paper ${focusRing}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-bold text-oc-muted">{ticket.reference}</span>
                  <span className="mt-0.5 block truncate text-[15px] font-extrabold text-oc-ink">{ticket.subject}</span>
                  <span className="mt-0.5 block text-xs font-medium text-oc-muted">{ticket.category_label} · Updated {when(ticket.updated_at)}</span>
                </span>
                {ticket.priority === 'URGENT' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-extrabold text-red-700 ring-1 ring-red-200">Urgent</span>}
                <StatusBadge status={ticket.status} label={ticket.status_label} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-oc-line bg-white p-10 text-center">
          <Inbox size={30} className="mx-auto text-oc-faint" aria-hidden="true" />
          <p className="mt-3 text-sm font-bold text-oc-ink">You have not sent any support requests yet.</p>
          <Link to="/contact-us" className={`mt-4 inline-flex h-11 items-center rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white hover:bg-oc-deep ${focusRing}`}>Get help</Link>
        </div>
      )}
    </LoadState>
  )
}

function StatusTrack({ status }) {
  const index = STATUS_ORDER.indexOf(status)
  const labels = { OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING_FOR_USER: 'Waiting for You', RESOLVED: 'Resolved', CLOSED: 'Closed' }
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Ticket status">
      {STATUS_ORDER.map((key, position) => (
        <li key={key} aria-current={position === index ? 'step' : undefined} className="min-w-0">
          <span className={`block h-1.5 rounded-full ${position < index ? 'bg-oc-green' : position === index ? 'bg-oc-amber' : 'bg-oc-line'}`} />
          <span className={`mt-1 block truncate text-[10px] font-bold ${position === index ? 'text-oc-ink' : 'text-oc-faint'}`}>{labels[key]}</span>
        </li>
      ))}
    </ol>
  )
}

function TicketDetail({ reference }) {
  const state = useLoader(() => fetchMyTicket(reference), [reference])
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ticket = state.data

  const send = async (event) => {
    event.preventDefault()
    if (busy || !reply.trim()) return
    setBusy(true)
    setError('')
    try {
      state.setData(await replyToMyTicket(reference, reply.trim()))
      setReply('')
    } catch (failure) {
      setError(supportErrorMessage(failure, 'Your reply could not be sent. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const showAttachment = () => openAttachment(myAttachmentPath(reference)).catch((failure) => setError(supportErrorMessage(failure, 'The attachment could not be opened.')))

  return (
    <LoadState state={state}>
      {ticket && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-2xl border border-oc-line bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-oc-muted">{ticket.reference}</p>
                  <h2 className="mt-1 break-words text-xl font-extrabold text-oc-ink">{ticket.subject}</h2>
                </div>
                <StatusBadge status={ticket.status} label={ticket.status_label} />
              </div>
              <div className="mt-4"><StatusTrack status={ticket.status} /></div>
              <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-oc-ink">{ticket.description}</p>
              {ticket.attachment && (
                <button type="button" onClick={showAttachment} className={`mt-4 inline-flex items-center gap-2 rounded-lg border border-oc-line px-3 py-2 text-sm font-bold text-oc-green hover:bg-oc-mint ${focusRing}`}>
                  <Paperclip size={15} aria-hidden="true" /> {ticket.attachment.name}
                </button>
              )}
            </section>

            <section aria-labelledby="conversation-title" className="rounded-2xl border border-oc-line bg-white p-5 sm:p-6">
              <h3 id="conversation-title" className="text-base font-extrabold text-oc-ink">Replies and updates</h3>
              {ticket.messages.length ? (
                <ol className="mt-4 space-y-3">
                  {ticket.messages.map((message) => (
                    <li
                      key={message.id}
                      className={`rounded-xl px-4 py-3 ${message.author === 'STAFF' ? 'me-6 bg-oc-mint/70' : 'ms-6 bg-oc-paper ring-1 ring-oc-line'}`}
                    >
                      <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-bold">
                        <span className={message.author === 'STAFF' ? 'text-oc-green' : 'text-oc-ink'}>{message.author_label}</span>
                        <span className="font-medium text-oc-muted">{when(message.created_at)}</span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-oc-ink">{message.body}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm font-medium text-oc-muted">No replies yet. We will reply here and by email.</p>
              )}

              {ticket.status === 'CLOSED' ? (
                <p className="mt-5 rounded-xl bg-oc-sunken px-4 py-3 text-sm font-semibold text-oc-muted">
                  This ticket is closed. <Link to="/contact-us" className="font-extrabold text-oc-green underline">Open a new request</Link> if you still need help.
                </p>
              ) : (
                <form onSubmit={send} className="mt-5">
                  <label htmlFor="ticket-reply" className="mb-1.5 block text-xs font-bold text-oc-ink">Add a reply</label>
                  <textarea
                    id="ticket-reply"
                    rows={4}
                    maxLength={2000}
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    className="w-full resize-y rounded-xl border border-[rgba(8,62,43,.15)] bg-white px-3 py-3 text-sm font-semibold text-oc-ink outline-none focus:border-oc-green focus:ring-4 focus:ring-[rgba(18,107,69,.08)]"
                  />
                  {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
                  <button
                    type="submit"
                    disabled={busy || !reply.trim()}
                    className={`mt-3 inline-flex h-11 items-center gap-2 rounded-xl bg-oc-green px-5 text-sm font-extrabold text-white hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                    {busy ? 'Sending…' : 'Send reply'}
                  </button>
                </form>
              )}
            </section>
          </div>

          <aside className="rounded-2xl border border-oc-line bg-white p-5">
            <dl className="space-y-3 text-sm">
              {[
                ['Category', ticket.category_label],
                ['Issue', ticket.issue_label],
                ['Account type', ticket.account_type_label],
                ['Priority', ticket.priority === 'URGENT' ? 'Urgent' : 'Normal'],
                ['Submitted', when(ticket.created_at)],
                ['Last update', when(ticket.updated_at)],
                ...ticket.details.map((detail) => [detail.label, detail.value]),
                ['Contact', [ticket.contact.name, ticket.contact.email, ticket.contact.phone].filter(Boolean).join(' · ')],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-oc-faint">{label}</dt>
                  <dd className="mt-0.5 break-words font-semibold text-oc-ink">{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      )}
    </LoadState>
  )
}

export default function SupportTicketsPage() {
  const { text } = useLanguage()
  const { reference } = useParams()
  return (
    <div className="min-h-screen overflow-x-clip bg-oc-paper font-display text-oc-ink">
      <SiteHeader text={text} brandHref="/" />
      <main className={`${containerClass} pb-20 pt-[calc(58px+2rem)] max-wide:pt-[calc(52px+1.5rem)]`}>
        <Link
          to={reference ? '/contact-us/tickets' : '/contact-us'}
          className={`inline-flex items-center gap-2 rounded-lg text-sm font-bold text-oc-muted hover:text-oc-green ${focusRing}`}
        >
          <ArrowLeft size={16} className="rtl:-scale-x-100" aria-hidden="true" />
          {reference ? 'All my tickets' : 'Contact & Support'}
        </Link>
        <h1 className="mt-3 flex items-center gap-3 text-[clamp(1.5rem,1.2rem+1.2vw,2.1rem)] font-extrabold tracking-[-.02em]">
          <Ticket size={28} className="text-oc-green" aria-hidden="true" />
          {reference ? 'Support ticket' : 'My Support Tickets'}
        </h1>
        <div className="mt-6">{reference ? <TicketDetail reference={reference} /> : <TicketList />}</div>
      </main>
    </div>
  )
}
