/**
 * Notifications — what the platform is telling people, and announcements.
 *
 * The feed is the clearest picture of whether the product is doing anything, and
 * the fastest way to notice something firing far too often.
 *
 * Announcing is treated as an action rather than a message box: the audience
 * size is shown before sending, the send is confirmed, and it cannot be undone.
 */

import { useState } from 'react'
import { Megaphone, RefreshCw, Send } from 'lucide-react'
import { fetchAdminNotifications, sendAnnouncement } from '../adminApi.js'
import { PAGE_SIZE, Pagination } from './AdminPagination.jsx'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { can } from '../adminAccess.js'

export function NotificationsPage({ identity, Panel, useAsync }) {
  const [offset, setOffset] = useState(0)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState({ audience: '', title: '', body: '' })
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const { data, error, loading, reload } = useAsync(
    () => fetchAdminNotifications({ limit: PAGE_SIZE, offset }),
    [offset],
  )

  // Announcing writes to every recipient's list, so it is an action on those
  // accounts rather than a way of reading them — hence the stronger permission.
  const canAnnounce = can(identity, 'users.suspend')
  const audiences = data?.audiences || {}
  const chosen = draft.audience ? audiences[draft.audience] : null

  const send = async (event) => {
    event.preventDefault()
    if (!chosen) return
    const confirmed = window.confirm(
      `Send "${draft.title}" to ${chosen.size} ${chosen.label.toLowerCase()}?\n\n` +
        'This cannot be undone — it appears in their notifications immediately.',
    )
    if (!confirmed) return

    setSending(true)
    setMessage('')
    try {
      const result = await sendAnnouncement(draft)
      setDraft({ audience: '', title: '', body: '' })
      setComposing(false)
      setOffset(0)
      setMessage(`Sent to ${result.recipients} account${result.recipients === 1 ? '' : 's'}.`)
      reload()
    } catch (requestError) {
      setMessage(requestError.response?.data?.detail || 'Could not send that announcement.')
    } finally {
      setSending(false)
    }
  }

  const field =
    'w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-ocbrand-400'

  return (
    <Panel
      title="Notifications"
      subtitle={
        data
          ? `${data.total} sent in your scope · ${data.unread} still unread`
          : 'What the platform has been telling people.'
      }
      right={
        <div className="flex items-center gap-2">
          {canAnnounce && !composing && (
            <button
              type="button"
              onClick={() => {
                setComposing(true)
                setMessage('')
              }}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-3.5 text-sm font-extrabold text-white hover:bg-oc-deep"
            >
              <Megaphone className="h-3.5 w-3.5" /> Announce
            </button>
          )}
          <button
            type="button"
            onClick={reload}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-oc-muted hover:bg-oc-sunken"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {composing && (
        <form onSubmit={send} className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
            <label className="grid gap-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                Who receives this
              </span>
              <select
                value={draft.audience}
                onChange={(event) => setDraft({ ...draft, audience: event.target.value })}
                className={`${field} h-9`}
                required
              >
                <option value="">Choose…</option>
                {Object.entries(audiences).map(([key, info]) => (
                  <option key={key} value={key} disabled={info.size === 0}>
                    {info.label} ({info.size})
                  </option>
                ))}
              </select>
              {/* The number people need in order to think twice. */}
              {chosen && (
                <span className="text-[11px] font-bold text-oc-amber">
                  This will reach {chosen.size} account{chosen.size === 1 ? '' : 's'}.
                </span>
              )}
            </label>

            <div className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                  Title
                </span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Scheduled maintenance this Sunday"
                  className={`${field} h-9`}
                  required
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">
                  Message
                </span>
                <textarea
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  rows={3}
                  placeholder="What people need to know, and what if anything they should do."
                  className={`${field} p-2.5`}
                  required
                />
              </label>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={sending || !chosen}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-4 text-sm font-extrabold text-white hover:bg-oc-deep disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send announcement'}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-oc-muted"
            >
              Cancel
            </button>
            <span className="text-[11px] font-medium text-oc-faint">
              Announcements cannot be recalled once sent.
            </span>
          </div>
        </form>
      )}

      {message && (
        <p className="border-b border-oc-line bg-oc-mint px-5 py-2 text-xs font-bold text-oc-deep">
          {message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">To</th>
              <th className="px-4 py-2.5">Title</th>
              <th className="px-4 py-2.5">Message</th>
              <th className="px-4 py-2.5">Read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {error && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  {error}
                </td>
              </tr>
            )}
            {!error && loading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!error && !loading && !data?.notifications.length && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm font-medium text-slate-500">
                  Nothing has been sent to accounts in your scope yet.
                </td>
              </tr>
            )}
            {!error &&
              !loading &&
              data?.notifications.map((item) => (
                <tr key={item.id} className="hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-oc-muted">
                    {formatDateTime(item.created_at, '—')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-oc-ink">{item.recipient_name || '—'}</span>
                    <span className="block text-[11px] text-oc-faint">{item.recipient_role}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-graphite">{item.title}</td>
                  <td className="max-w-md px-4 py-3 text-slate-500">
                    <span className="block truncate">{item.body}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                        item.is_read
                          ? 'bg-ocbrand-50 text-ocbrand-700'
                          : 'bg-oc-amber/20 text-oc-deep'
                      }`}
                    >
                      {item.is_read ? 'Read' : 'Unread'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <Pagination data={data} offset={offset} onChange={setOffset} loading={loading} />
    </Panel>
  )
}
