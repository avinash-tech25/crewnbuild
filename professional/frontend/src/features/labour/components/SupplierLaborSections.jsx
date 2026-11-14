/**
 * Labor Supplier screens: workforce stats, Labor Services, incoming labor
 * Requests and active Assignments.
 *
 * Every number shown comes from the backend: worker capacity, allocated
 * (deployed) and available workers are read from GET /labor/services, never
 * re-derived here. The backend also has the last word on every action; a
 * refusal is shown exactly as it was sent.
 *
 * There is no quotation, negotiation or payment in this flow.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, CheckCircle2, ChevronRight, ClipboardList, HardHat, Loader2, Pencil, Plus, Power, UserCheck, Users, Wrench, X, XCircle,
} from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { translate } from '../../../i18n/translate.js'
import { formatCalendarDate } from '../../../shared/utils/formatters.js'
import {
  acceptLaborRequest, createLaborService, fetchSupplierLaborDailyRecords, laborErrorMessage, rejectLaborRequest, updateLaborService,
} from '../labourApi.js'
import { allocationSummary } from '../laborRequestRules.js'

export const LABOR_STATUS_STYLE = {
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
  COMPLETED: 'bg-sky-100 text-sky-800',
}
const STATUS_KEYS = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED']

export function LaborStatusBadge({ status }) {
  const { t } = useLanguage()
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${LABOR_STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}`}>
      {STATUS_KEYS.includes(status) ? t(`labor.status.${status}`) : status}
    </span>
  )
}

// A calendar date (or the date part of a timestamp) in the selected language.
export const formatLaborDate = (value) => (value ? formatCalendarDate(String(value).slice(0, 10), '—') : '—')

function Notice({ notice }) {
  if (!notice?.text) return null
  return (
    <p className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
  )
}

// A compact centred dialog, same surface as the dashboard's cards.
export function LaborDialog({ title, onClose, children }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="font-display text-base font-extrabold text-graphite">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t('labor.close')} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-graphite/50 hover:bg-slate-100 hover:text-graphite">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const labelClass = 'mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-graphite/55'

// ------------------------------------------------------------------ stats

/** Workforce totals, summed from the backend's per-trade figures. */
export function laborWorkforceTotals(services = [], requests = []) {
  const active = services.filter((service) => service.is_active)
  return {
    total: active.reduce((sum, service) => sum + Number(service.worker_capacity || 0), 0),
    available: active.reduce((sum, service) => sum + Number(service.available_workers || 0), 0),
    deployed: services.reduce((sum, service) => sum + Number(service.allocated_workers || 0), 0),
    pending: requests.filter((request) => request.status === 'PENDING').length,
    active: requests.filter((request) => request.status === 'ACCEPTED').length,
    completed: requests.filter((request) => request.status === 'COMPLETED').length,
  }
}

export function LaborSupplierStatsGrid({ services, requests, onSelect }) {
  const { t } = useLanguage()
  const totals = laborWorkforceTotals(services, requests)
  const stats = [
    { id: 'total', label: t('labor.stats.totalWorkers'), value: totals.total, icon: Users, tone: { card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', arrow: 'bg-blue-100 text-blue-700' }, sectionId: 'laborServices' },
    { id: 'available', label: t('labor.stats.availableWorkers'), value: totals.available, icon: UserCheck, tone: { card: 'border-green-200 bg-green-50', chip: 'bg-green-100 text-green-700', arrow: 'bg-green-100 text-green-700' }, sectionId: 'laborServices' },
    { id: 'deployed', label: t('labor.stats.deployedWorkers'), value: totals.deployed, icon: HardHat, tone: { card: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-600', arrow: 'bg-orange-100 text-orange-600' }, sectionId: 'laborAssignments' },
    { id: 'pending', label: t('labor.stats.pendingRequests'), value: totals.pending, icon: ClipboardList, tone: { card: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-700', arrow: 'bg-amber-100 text-amber-700' }, sectionId: 'incomingRequests' },
    { id: 'active', label: t('labor.stats.activeAssignments'), value: totals.active, icon: Wrench, tone: { card: 'border-purple-200 bg-purple-50', chip: 'bg-purple-100 text-purple-700', arrow: 'bg-purple-100 text-purple-700' }, sectionId: 'laborAssignments' },
    { id: 'completed', label: t('labor.stats.completedAssignments'), value: totals.completed, icon: CheckCircle2, tone: { card: 'border-sky-200 bg-sky-50', chip: 'bg-sky-100 text-sky-700', arrow: 'bg-sky-100 text-sky-700' }, sectionId: 'laborAssignments' },
  ]
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {stats.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect?.(item.sectionId)}
          className={`group flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-start shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${item.tone.card}`}
        >
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${item.tone.chip}`}>
            <item.icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-graphite/65">{item.label}</span>
            <span className="block truncate font-display text-2xl font-extrabold leading-tight text-graphite">{item.value}</span>
          </span>
          <span className={`hidden h-8 w-8 shrink-0 place-items-center rounded-full transition group-hover:translate-x-0.5 sm:grid ${item.tone.arrow}`}>
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        </button>
      ))}
    </section>
  )
}

// --------------------------------------------------------------- services

function ServiceForm({ trades, service, onSaved, onCancel }) {
  const { t } = useLanguage()
  const editing = Boolean(service)
  const [form, setForm] = useState({
    trade: service?.trade || '',
    skill_level: service?.skill_level || '',
    worker_capacity: service ? String(service.worker_capacity) : '',
    notes: service?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const capacity = Number(form.worker_capacity)
    if (!editing && !form.trade) { setError(t('labor.error.chooseTrade')); return }
    if (form.worker_capacity === '' || !Number.isInteger(capacity) || capacity < 0) { setError(t('labor.error.capacity')); return }
    setBusy(true)
    try {
      const payload = { skill_level: form.skill_level, worker_capacity: capacity, notes: form.notes }
      const saved = editing ? await updateLaborService(service.id, payload) : await createLaborService({ ...payload, trade: form.trade })
      onSaved(saved, editing)
    } catch (failure) {
      setError(laborErrorMessage(failure, t('labor.error.serviceSave')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t('labor.field.trade')}</span>
          {editing ? (
            <input className={`${inputClass} bg-slate-50`} value={service.trade} disabled />
          ) : (
            <select className={inputClass} value={form.trade} onChange={set('trade')} required>
              <option value="">{t('labor.field.selectTrade')}</option>
              {trades.map((trade) => <option key={trade} value={trade}>{trade}</option>)}
            </select>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>{t('labor.field.skillLevel')}</span>
          <input className={inputClass} value={form.skill_level} onChange={set('skill_level')} maxLength={20} placeholder={t('labor.field.skillLevelPh')} />
        </label>
        <label className="block">
          <span className={labelClass}>{t('labor.field.workerCapacity')}</span>
          <input className={inputClass} type="number" min="0" step="1" inputMode="numeric" value={form.worker_capacity} onChange={set('worker_capacity')} required />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClass}>{t('labor.field.notes')}</span>
          <textarea className={`${inputClass} h-20 py-2`} value={form.notes} onChange={set('notes')} />
        </label>
      </div>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
        <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {editing ? t('labor.action.saveChanges') : t('labor.action.addService')}
        </button>
      </div>
    </form>
  )
}

export function LaborServicesSection({ services, trades, onChanged }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(null) // null | 'new' | service
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const [busyId, setBusyId] = useState(null)
  const offeredTrades = new Set(services.map((service) => service.trade))
  const addableTrades = trades.filter((trade) => !offeredTrades.has(trade))

  const toggleActive = async (service) => {
    setBusyId(service.id)
    setNotice({ tone: '', text: '' })
    try {
      await updateLaborService(service.id, { is_active: !service.is_active })
      setNotice({ tone: 'success', text: t(service.is_active ? 'labor.msg.deactivated' : 'labor.msg.activated', { name: service.trade }) })
      onChanged()
    } catch (failure) {
      setNotice({ tone: 'error', text: laborErrorMessage(failure, t('labor.error.serviceUpdate')) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <h2 className="font-display text-base font-extrabold text-graphite">{t('labor.services.title')}</h2>
          <p className="text-xs font-semibold text-graphite/55">{t('labor.services.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => { setNotice({ tone: '', text: '' }); setEditing('new') }}
          disabled={!addableTrades.length}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#1f2937] px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-brand-950 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> {t('labor.action.addService')}
        </button>
      </div>
      <Notice notice={notice} />
      {services.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => (
            <article key={service.id} className={`flex min-w-0 flex-col rounded-2xl border bg-white p-4 ${service.is_active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-75'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-extrabold text-graphite">{service.trade}</p>
                  <p className="truncate text-xs font-semibold text-graphite/55">{service.skill_level || t('labor.services.skillNotSet')}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${service.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                  {service.is_active ? t('labor.active') : t('labor.inactive')}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                <div><dt className="text-[10px] font-bold text-graphite/50">{t('labor.services.capacity')}</dt><dd className="font-display text-lg font-extrabold text-graphite">{service.worker_capacity}</dd></div>
                <div><dt className="text-[10px] font-bold text-graphite/50">{t('labor.services.available')}</dt><dd className="font-display text-lg font-extrabold text-emerald-700">{service.available_workers}</dd></div>
                <div><dt className="text-[10px] font-bold text-graphite/50">{t('labor.services.deployed')}</dt><dd className="font-display text-lg font-extrabold text-orange-600">{service.allocated_workers}</dd></div>
              </dl>
              {service.notes && <p className="mt-2 line-clamp-2 text-xs font-semibold text-graphite/60">{service.notes}</p>}
              <div className="mt-auto flex gap-2 pt-3">
                <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setEditing(service) }} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-xs font-extrabold text-graphite/75 hover:bg-slate-50">
                  <Pencil className="h-3.5 w-3.5" /> {t('labor.action.edit')}
                </button>
                <button type="button" disabled={busyId === service.id} onClick={() => toggleActive(service)} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-extrabold disabled:opacity-50 ${service.is_active ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-brand-700 text-white hover:bg-brand-800'}`}>
                  {busyId === service.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />} {service.is_active ? t('labor.action.deactivate') : t('labor.action.activate')}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={Wrench} title={t('labor.services.emptyTitle')} message={t('labor.services.emptyMessage')} />
      )}
      {editing && (
        <LaborDialog title={editing === 'new' ? t('labor.services.addTitle') : t('labor.services.editTitle', { name: editing.trade })} onClose={() => setEditing(null)}>
          <ServiceForm
            trades={addableTrades}
            service={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(saved, wasEdit) => {
              setEditing(null)
              setNotice({ tone: 'success', text: t(wasEdit ? 'labor.msg.updated' : 'labor.msg.added', { name: saved.trade }) })
              onChanged()
            }}
          />
        </LaborDialog>
      )}
    </section>
  )
}

// --------------------------------------------------------------- requests

function RequestFacts({ request, showAllocated = false }) {
  const { t } = useLanguage()
  const allocation = allocationSummary(request)
  return (
    <>
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
      <div><dt className="font-bold text-graphite/50">{t('labor.field.trade')}</dt><dd className="font-extrabold text-graphite">{request.trade}</dd></div>
      <div><dt className="font-bold text-graphite/50">{t('labor.field.workersRequired')}</dt><dd className="font-extrabold text-graphite">{request.workers_required}</dd></div>
      {showAllocated && <div><dt className="font-bold text-graphite/50">{t('labor.field.allocated')}</dt><dd className="font-extrabold text-emerald-700">{request.workers_allocated ?? '—'}</dd></div>}
      <div><dt className="font-bold text-graphite/50">{t('labor.field.start')}</dt><dd className="font-extrabold text-graphite">{formatLaborDate(request.start_date)}</dd></div>
      <div><dt className="font-bold text-graphite/50">{t('labor.field.end')}</dt><dd className="font-extrabold text-graphite">{formatLaborDate(request.end_date)}</dd></div>
    </dl>
    {showAllocated && allocation.partial && (
      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
        {t('labor.allocation.partial', { allocated: allocation.allocated, required: allocation.required, shortfall: allocation.shortfall })}
      </p>
    )}
    </>
  )
}

function availabilityText(t, request, service) {
  if (!service) return t('labor.requests.notOffered', { trade: request.trade })
  if (!service.is_active) return t('labor.requests.serviceInactive', { trade: request.trade })
  return t('labor.requests.availableWorkers', { trade: request.trade, count: service.available_workers })
}

function AcceptDialog({ request, service, onClose, onDone }) {
  const { t } = useLanguage()
  const available = service?.is_active ? Number(service.available_workers || 0) : 0
  const maxAllocatable = Math.min(Number(request.workers_required), available)
  const [workers, setWorkers] = useState(String(Math.max(maxAllocatable, 0) || ''))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const project = request.project_title || t('labor.theProject')

  const submit = async (event) => {
    event.preventDefault()
    const value = Number(workers)
    if (!Number.isInteger(value) || value < 1) { setError(t('labor.error.allocateOne')); return }
    if (value > request.workers_required) { setError(t('labor.error.allocateMax', { count: request.workers_required })); return }
    if (value > available) { setError(t('labor.error.allocateAvailable', { count: available, trade: request.trade })); return }
    setBusy(true)
    setError('')
    try {
      await acceptLaborRequest(request.id, { workers_allocated: value, decision_note: note || null })
      onDone({ tone: 'success', text: t('labor.msg.accepted', { count: value, trade: request.trade, project }) })
    } catch (failure) {
      setError(laborErrorMessage(failure, t('labor.error.accept')))
      setBusy(false)
    }
  }

  return (
    <LaborDialog title={t('labor.requests.acceptTitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs font-semibold text-graphite/65">
          {request.project_title} · {request.trade} · {t('labor.requests.requiredCount', { count: request.workers_required })}
        </p>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-graphite/70">{availabilityText(t, request, service)}</p>
        <label className="block">
          <span className={labelClass}>{t('labor.field.workersToAllocate')}</span>
          <input className={inputClass} type="number" min="1" max={Math.max(maxAllocatable, 1)} step="1" inputMode="numeric" value={workers} onChange={(event) => setWorkers(event.target.value)} required />
          {Number.isInteger(Number(workers)) && Number(workers) >= 1 && Number(workers) < Number(request.workers_required) && (
            <span className="mt-1 block text-[11px] font-bold text-amber-700">
              {t('labor.allocation.willBePartial', { allocated: Number(workers), required: request.workers_required, shortfall: Number(request.workers_required) - Number(workers) })}
            </span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>{t('labor.field.noteOptional')}</span>
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="submit" disabled={busy || maxAllocatable < 1} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t('labor.action.accept')}
          </button>
        </div>
      </form>
    </LaborDialog>
  )
}

function RejectDialog({ request, onClose, onDone }) {
  const { t } = useLanguage()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await rejectLaborRequest(request.id, note)
      onDone({ tone: 'success', text: t('labor.msg.rejected', { name: request.engineer_name || t('labor.theSiteEngineer') }) })
    } catch (failure) {
      setError(laborErrorMessage(failure, t('labor.error.reject')))
      setBusy(false)
    }
  }
  return (
    <LaborDialog title={t('labor.requests.rejectTitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs font-semibold text-graphite/65">{request.project_title} · {request.trade} · {t('labor.requests.workersCount', { count: request.workers_required })}</p>
        <label className="block">
          <span className={labelClass}>{t('labor.field.reasonOptional')}</span>
          <textarea className={`${inputClass} h-20 py-2`} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} {t('labor.action.reject')}
          </button>
        </div>
      </form>
    </LaborDialog>
  )
}

// Request filter tabs, shared with the equipment requests list.
export const REQUEST_FILTERS = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'ALL']
export const requestFilterLabel = (id) => (id === 'ALL' ? translate('labor.filter.all') : translate(`labor.status.${id}`))

export function LaborRequestsSection({ requests, services, onChanged, compact = false }) {
  const { t } = useLanguage()
  const [filter, setFilter] = useState('PENDING')
  const [accepting, setAccepting] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const serviceByTrade = useMemo(() => Object.fromEntries(services.map((service) => [service.trade, service])), [services])
  const visible = compact
    ? requests.filter((request) => request.status === 'PENDING').slice(0, 4)
    : requests.filter((request) => filter === 'ALL' || request.status === filter)

  const finish = (result) => {
    setAccepting(null)
    setRejecting(null)
    setNotice(result)
    onChanged()
  }

  return (
    <section className="space-y-3">
      {!compact && (
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
          {REQUEST_FILTERS.map((option) => {
            const count = option === 'ALL' ? requests.length : requests.filter((request) => request.status === option).length
            const isActive = filter === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'}`}
              >
                {requestFilterLabel(option)}
                {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{count}</span>}
              </button>
            )
          })}
        </div>
      )}
      <Notice notice={notice} />
      {visible.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((request) => {
            const service = serviceByTrade[request.trade]
            return (
              <article key={request.id} className={`flex min-w-0 flex-col rounded-2xl border bg-white p-4 ${request.status === 'PENDING' ? 'border-oc-amber shadow-[0_0_0_3px_rgba(244,183,64,0.18)]' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-800">
                    <HardHat className="h-3.5 w-3.5" /> {request.status === 'PENDING' ? t('labor.requests.newLabel') : t('labor.requests.label')}
                  </p>
                  <LaborStatusBadge status={request.status} />
                </div>
                <p className="mt-2 text-base font-extrabold text-graphite">{request.project_title || t('labor.project')}</p>
                <p className="text-xs font-semibold text-graphite/60">
                  {t('labor.siteEngineerName', { name: request.engineer_name || '—' })}
                  {request.contractor_name ? ` · ${t('labor.builderName', { name: request.contractor_name })}` : ''}
                </p>
                <RequestFacts request={request} showAllocated={request.workers_allocated != null} />
                {request.work_description && <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/70">{request.work_description}</p>}
                {request.decision_note && <p className="mt-2 text-[11px] font-bold text-graphite/55">{t('labor.noteLine', { note: request.decision_note })}</p>}
                {request.status === 'PENDING' && (
                  <>
                    <p className="mt-2 text-[11px] font-bold text-graphite/55">
                      {availabilityText(t, request, service)}
                      {!request.supplier_assignment_active && ` · ${t('labor.requests.unassigned')}`}
                    </p>
                    <div className="mt-auto flex gap-2 pt-3">
                      <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setAccepting(request) }} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-700 text-xs font-extrabold text-white hover:bg-brand-800">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t('labor.action.accept')}
                      </button>
                      <button type="button" onClick={() => { setNotice({ tone: '', text: '' }); setRejecting(request) }} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-extrabold text-rose-700 hover:bg-rose-100">
                        <XCircle className="h-3.5 w-3.5" /> {t('labor.action.reject')}
                      </button>
                    </div>
                  </>
                )}
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={compact || filter === 'PENDING' ? t('labor.requests.emptyPending') : t('labor.requests.emptyFiltered')}
          message={t('labor.requests.emptyMessage')}
        />
      )}
      {accepting && <AcceptDialog request={accepting} service={serviceByTrade[accepting.trade]} onClose={() => setAccepting(null)} onDone={finish} />}
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={finish} />}
    </section>
  )
}

// ------------------------------------------------------------ assignments

export function LaborDailyRecordsTable({ records }) {
  const { t } = useLanguage()
  if (!records.length) return <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs font-semibold text-graphite/50">{t('labor.attendance.none')}</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[560px] text-start text-xs">
        <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-graphite/50">
          <tr>
            <th className="px-3 py-2 text-start">{t('labor.field.date')}</th><th className="px-2 py-2 text-center">{t('labor.field.present')}</th><th className="px-2 py-2 text-center">{t('labor.field.absent')}</th>
            <th className="px-2 py-2 text-center">{t('labor.field.halfDay')}</th><th className="px-2 py-2 text-center">{t('labor.field.otWorkers')}</th><th className="px-2 py-2 text-center">{t('labor.field.otHours')}</th>
            <th className="px-3 py-2 text-start">{t('labor.field.activity')}</th><th className="px-3 py-2 text-start">{t('labor.field.notes')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-semibold text-graphite/80">
          {records.map((record) => (
            <tr key={record.id}>
              <td className="whitespace-nowrap px-3 py-2 font-extrabold text-graphite">{formatLaborDate(record.work_date)}</td>
              <td className="px-2 py-2 text-center">{record.present_count}</td>
              <td className="px-2 py-2 text-center">{record.absent_count}</td>
              <td className="px-2 py-2 text-center">{record.half_day_count}</td>
              <td className="px-2 py-2 text-center">{record.overtime_workers}</td>
              <td className="px-2 py-2 text-center">{record.overtime_hours}</td>
              <td className="px-3 py-2">{record.activity || '—'}</td>
              <td className="px-3 py-2">{record.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Re-read whenever the dashboard reloads (refreshKey), so attendance the
// engineer saves shows up through the same live refresh as everything else.
function SupplierAttendance({ requestId, refreshKey }) {
  const { t } = useLanguage()
  const [state, setState] = useState({ loading: true, records: [], error: '' })
  useEffect(() => {
    let current = true
    fetchSupplierLaborDailyRecords(requestId)
      .then((records) => { if (current) setState({ loading: false, records, error: '' }) })
      .catch((failure) => { if (current) setState({ loading: false, records: [], error: laborErrorMessage(failure, translate('labor.error.attendanceLoad')) }) })
    return () => { current = false }
  }, [requestId, refreshKey])
  if (state.loading) return <p className="flex items-center gap-2 py-3 text-xs font-semibold text-graphite/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('labor.attendance.loading')}</p>
  if (state.error) return <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{state.error}</p>
  return <LaborDailyRecordsTable records={state.records} />
}

export function LaborAssignmentsSection({ requests, services, refreshKey = 0 }) {
  const { t } = useLanguage()
  const [showHistory, setShowHistory] = useState(false)
  const [openId, setOpenId] = useState(null)
  const active = requests.filter((request) => request.status === 'ACCEPTED')
  const history = requests.filter((request) => request.status === 'COMPLETED')
  const list = showHistory ? history : active
  const totals = laborWorkforceTotals(services, requests)

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { id: 'deployed', label: t('labor.stats.deployedWorkers'), value: totals.deployed, tone: 'text-orange-600' },
          { id: 'available', label: t('labor.stats.availableWorkers'), value: totals.available, tone: 'text-emerald-700' },
          { id: 'active', label: t('labor.stats.activeAssignments'), value: totals.active, tone: 'text-graphite' },
        ].map((item) => (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold text-graphite/55">{item.label}</p>
            <p className={`font-display text-2xl font-extrabold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {[{ id: false, key: 'active', label: t('labor.tab.active'), count: active.length }, { id: true, key: 'completed', label: t('labor.tab.completed'), count: history.length }].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setShowHistory(tab.id); setOpenId(null) }}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${showHistory === tab.id ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'}`}
          >
            {tab.label}
            {tab.count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${showHistory === tab.id ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{tab.count}</span>}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="space-y-3">
          {list.map((request) => (
            <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-extrabold text-graphite">{request.project_title || t('labor.project')}</p>
                  <p className="text-xs font-semibold text-graphite/60">{t('labor.siteEngineerName', { name: request.engineer_name || '—' })}</p>
                </div>
                <LaborStatusBadge status={request.status} />
              </div>
              <RequestFacts request={request} showAllocated />
              {!request.supplier_assignment_active && request.status === 'ACCEPTED' && (
                <p className="mt-2 text-[11px] font-bold text-amber-700">{t('labor.assignments.unassignedContinues')}</p>
              )}
              <button
                type="button"
                onClick={() => setOpenId(openId === request.id ? null : request.id)}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite/75 hover:bg-slate-50"
              >
                <CalendarDays className="h-3.5 w-3.5" /> {openId === request.id ? t('labor.attendance.hide') : t('labor.attendance.view')}
              </button>
              {openId === request.id && <div className="mt-3"><SupplierAttendance requestId={request.id} refreshKey={refreshKey} /></div>}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={HardHat}
          title={showHistory ? t('labor.assignments.emptyCompletedTitle') : t('labor.assignments.emptyActiveTitle')}
          message={showHistory ? t('labor.assignments.emptyCompletedMessage') : t('labor.assignments.emptyActiveMessage')}
        />
      )}
    </section>
  )
}
