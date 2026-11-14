/**
 * Requests between a Builder and a Store Manager on that Builder's team, either
 * way round. The same panel serves both: the server says which side the reader is
 * on (`side`), who they can write to (`counterparts`, read from the team) and,
 * per request, whether they sent it, may answer it or may withdraw it.
 *
 * Its own records and endpoints (/store-builder-requests): never mixed with Site
 * Engineer store requests, supplier purchases or House Owner / Supplier requests.
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, Eye, Inbox, Plus, Send, Undo2, X } from 'lucide-react'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { createStoreBuilderRequest, fetchStoreBuilderRequests, respondStoreBuilderRequest, withdrawStoreBuilderRequest } from '../storeManagerApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { DataTable, DetailModal, FilterChips, Notice, Panel, inputClass, labelClass, primaryButton, refusalText, secondaryButton, tdClass, thClass } from './StoreUi.jsx'

export const BUILDER_REQUEST_CATEGORIES = ['GENERAL', 'MATERIAL', 'DELIVERY', 'PAYMENT', 'SCHEDULE', 'OTHER']

// The words each side reads: a Store Manager writes to Builders, a Builder to Store Managers.
const SIDE_TEXT = {
  STORE_MANAGER: {
    received: 'store.sbr.incomingBuilder', sent: 'store.sbr.sentToBuilder', counterpart: 'store.requests.builder',
    newRequest: 'store.sbr.newToBuilder', noCounterpart: 'store.sbr.noBuilder',
  },
  BUILDER: {
    received: 'store.sbr.fromStoreManager', sent: 'store.sbr.sentToStoreManager', counterpart: 'ui.profile.engCat.storeManager',
    newRequest: 'store.sbr.newToStoreManager', noCounterpart: 'store.sbr.noStoreManager',
  },
}

/** Loads this reader's requests and keeps them current (live hints and a slow poll). */
export function useStoreBuilderRequests() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const latest = useLatestOnly()
  const reload = useCallback(() => {
    const isLatest = latest()
    return fetchStoreBuilderRequests()
      .then((result) => { if (isLatest()) { setData(result); setFailed(false) } })
      .catch(() => { if (isLatest()) setFailed(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLiveRefresh(reload)
  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 30000)
    return () => window.clearInterval(timer)
  }, [reload])
  return { data, failed, reload }
}

function NewRequestForm({ text, counterparts, guard, onDone, onCancel }) {
  const { t, td } = useLanguage()
  const [form, setForm] = useState({ counterpart_id: counterparts.length === 1 ? String(counterparts[0].id) : '', category: 'GENERAL', title: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const update = (field) => (event) => { setForm((current) => ({ ...current, [field]: event.target.value })); setError('') }
  const submit = async (event) => {
    event.preventDefault()
    if (guard?.()) return
    if (!form.counterpart_id || form.title.trim().length < 3 || form.description.trim().length < 3) {
      setError(t('store.sbr.fillAll'))
      return
    }
    setSaving(true)
    try {
      await createStoreBuilderRequest({ ...form, title: form.title.trim(), description: form.description.trim() })
      onDone()
    } catch (failure) {
      setError(refusalText(failure, td, t('store.saveFailed')))
      setSaving(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3 pb-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t(text.counterpart)}</span>
          <select className={`mt-1 ${inputClass}`} value={form.counterpart_id} onChange={update('counterpart_id')}>
            <option value="">{t('store.sbr.choose')}</option>
            {counterparts.map((person) => <option key={person.id} value={person.id}>{td(person.name)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>{t('store.sbr.type')}</span>
          <select className={`mt-1 ${inputClass}`} value={form.category} onChange={update('category')}>
            {BUILDER_REQUEST_CATEGORIES.map((category) => <option key={category} value={category}>{t(`store.sbr.category.${category}`)}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>{t('store.sbr.title')}</span>
        <input className={`mt-1 ${inputClass}`} maxLength={160} value={form.title} onChange={update('title')} placeholder={t('store.sbr.titlePh')} />
      </label>
      <label className="block">
        <span className={labelClass}>{t('store.sbr.description')}</span>
        <textarea className={`mt-1 ${inputClass} !h-28 py-2`} maxLength={2000} value={form.description} onChange={update('description')} placeholder={t('store.sbr.descriptionPh')} />
      </label>
      {error && <p role="alert" className="text-xs font-bold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>{t('store.cancel')}</button>
        <button type="submit" disabled={saving} className={primaryButton}><Send className="h-3.5 w-3.5" />{saving ? t('dash.common.saving') : t('store.sbr.send')}</button>
      </div>
    </form>
  )
}

function RequestDetail({ request, text, guard, onChanged }) {
  const { t, td } = useLanguage()
  const [response, setResponse] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const act = async (action, doneKey) => {
    if (guard?.()) return
    setBusy(true)
    setNotice(null)
    try {
      await action()
      setNotice({ text: t(doneKey) })
      onChanged()
    } catch (failure) {
      setNotice({ text: refusalText(failure, td, t('store.saveFailed')), error: true })
    } finally {
      setBusy(false)
    }
  }
  const counterpartName = text === SIDE_TEXT.STORE_MANAGER ? request.builder_name : request.store_manager_name
  return (
    <div className="space-y-3 pb-1">
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-4">
        {[
          ['store.requests.requestId', `#${request.id}`],
          ['store.sbr.direction', t(request.sent_by_me ? 'store.sbr.youSent' : 'store.sbr.youReceived')],
          [text.counterpart, td(counterpartName)],
          ['store.sbr.type', t(`store.sbr.category.${request.category}`)],
          ['store.col.requestDate', formatDateTime(request.created_at)],
          ['store.sbr.respondedOn', request.responded_at ? formatDateTime(request.responded_at) : ''],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t(label)}</dt>
            <dd className="truncate text-xs font-bold text-graphite">{value || '—'}</dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t('store.col.status')}</dt>
          <dd><StatusPill status={request.status} soft /></dd>
        </div>
      </dl>
      <div className="rounded-xl border border-slate-200 px-3 py-2">
        <p className="text-sm font-extrabold text-graphite">{td(request.title)}</p>
        <p className="mt-1 whitespace-pre-line text-xs font-semibold text-graphite/75">{td(request.description)}</p>
      </div>
      <div className="rounded-xl border border-slate-200 px-3 py-2">
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t('store.sbr.response')}</p>
        <p className="mt-1 whitespace-pre-line text-xs font-semibold text-graphite/75">
          {request.response ? td(request.response) : t(request.status === 'PENDING' ? 'store.sbr.awaitingResponse' : 'store.sbr.noResponseText')}
        </p>
      </div>
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      {request.can_respond && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <label className="block">
            <span className={labelClass}>{t('store.sbr.yourResponse')}</span>
            <textarea className={`mt-1 ${inputClass} !h-20 py-2`} maxLength={1000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder={t('store.sbr.responsePh')} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => act(() => respondStoreBuilderRequest(request.id, 'REJECT', response.trim()), 'store.sbr.rejected')} className={secondaryButton}><X className="h-3.5 w-3.5" />{t('store.requests.reject')}</button>
            <button type="button" disabled={busy} onClick={() => act(() => respondStoreBuilderRequest(request.id, 'ACCEPT', response.trim()), 'store.sbr.accepted')} className={primaryButton}><Check className="h-3.5 w-3.5" />{t('store.sbr.accept')}</button>
          </div>
        </div>
      )}
      {request.can_withdraw && (
        <div className="flex justify-end">
          <button type="button" disabled={busy} onClick={() => act(() => withdrawStoreBuilderRequest(request.id), 'store.sbr.withdrawn')} className={secondaryButton}><Undo2 className="h-3.5 w-3.5" />{t('store.sbr.withdraw')}</button>
        </div>
      )}
    </div>
  )
}

export default function StoreBuilderRequestsPanel({ data, failed, reload, guard }) {
  const { t, td } = useLanguage()
  const [tab, setTab] = useState('received')
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState(null)
  if (!data) {
    return <Panel><p className="text-xs font-semibold text-graphite/55">{t(failed ? 'store.sbr.loadFailed' : 'store.sbr.loading')}</p></Panel>
  }
  const text = SIDE_TEXT[data.side] || SIDE_TEXT.BUILDER
  const received = data.requests.filter((request) => !request.sent_by_me)
  const sent = data.requests.filter((request) => request.sent_by_me)
  const shown = tab === 'received' ? received : sent
  const open = data.requests.find((request) => request.id === openId) || null
  const counterpartName = (request) => td(data.side === 'STORE_MANAGER' ? request.builder_name : request.store_manager_name)
  return (
    <div className="contractor-board-dark space-y-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <Panel
        title={t(tab === 'received' ? text.received : text.sent)}
        action={(
          <button type="button" onClick={() => setCreating(true)} disabled={!data.counterparts.length} title={data.counterparts.length ? undefined : t(text.noCounterpart)} className={primaryButton}>
            <Plus className="h-3.5 w-3.5" />{t(text.newRequest)}
          </button>
        )}
      >
        <div className="mb-3">
          <FilterChips
            filters={[{ id: 'received', label: t(text.received) }, { id: 'sent', label: t(text.sent) }]}
            counts={{ received: received.length, sent: sent.length }}
            active={tab}
            onChange={setTab}
          />
        </div>
        {!data.counterparts.length && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{t(text.noCounterpart)}</p>}
        {shown.length ? (
          <DataTable
            minWidth="min-w-[860px]"
            head={['store.requests.requestId', 'store.col.requestDate', text.counterpart, 'store.sbr.type', 'store.sbr.title', 'store.col.status', 'store.sbr.response', 'store.col.action'].map((key) => <th key={key} className={thClass}>{t(key)}</th>)}
          >
            {shown.map((request) => (
              <tr key={request.id} onClick={() => setOpenId(request.id)} className="cursor-pointer transition hover:bg-brand-50/40">
                <td className={`${tdClass} font-extrabold text-graphite`}>#{request.id}</td>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(request.created_at)}</td>
                <td className={tdClass}>{counterpartName(request)}</td>
                <td className={tdClass}>{t(`store.sbr.category.${request.category}`)}</td>
                <td className={`${tdClass} max-w-[240px] truncate font-bold text-graphite`}>{td(request.title)}</td>
                <td className={tdClass}><StatusPill status={request.status} soft /></td>
                <td className={`${tdClass} max-w-[220px] truncate`}>{request.response ? td(request.response) : '—'}</td>
                <td className={tdClass} onClick={(event) => event.stopPropagation()}>
                  <button type="button" onClick={() => setOpenId(request.id)} className={`${secondaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>
                    <Eye className="h-3 w-3" />{t(request.can_respond ? 'store.sbr.respond' : 'store.viewDetails')}
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
            <Inbox className="mx-auto mb-2 h-6 w-6 text-slate-400" />
            <p className="text-sm font-semibold text-graphite/55">{t(tab === 'received' ? 'store.sbr.noneReceived' : 'store.sbr.noneSent')}</p>
          </div>
        )}
      </Panel>
      {open && (
        <DetailModal title={td(open.title)} subtitle={`${t('store.requests.requestId')} #${open.id} · ${counterpartName(open)}`} onClose={() => setOpenId(null)}>
          <RequestDetail key={open.id} request={open} text={text} guard={guard} onChanged={reload} />
        </DetailModal>
      )}
      {creating && (
        <DetailModal title={t(text.newRequest)} onClose={() => setCreating(false)}>
          <NewRequestForm
            text={text}
            counterparts={data.counterparts}
            guard={guard}
            onCancel={() => setCreating(false)}
            onDone={() => { setCreating(false); setTab('sent'); setNotice({ text: t('store.sbr.sent') }); reload() }}
          />
        </DetailModal>
      )}
    </div>
  )
}
