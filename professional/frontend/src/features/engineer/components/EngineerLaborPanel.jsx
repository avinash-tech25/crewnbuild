/**
 * The Site Engineer's Labor tab.
 *
 * Shows ONLY the Labor Supplier(s) the Builder assigned to this engineer on the
 * selected project -- read from the existing GET /projects/{id}/suppliers, the
 * same feed the Suppliers tab uses -- never a marketplace. The supplier of a
 * request is fixed to that assignment; the backend refuses any other.
 *
 * Flow: Request Labor -> supplier accepts/rejects -> an accepted request is the
 * project's labor assignment -> daily attendance (counts only) -> Complete.
 * No quotation, negotiation or payment.
 */
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, HardHat, History, Loader2, Pencil, Send, UserRound, XCircle } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchProjectSuppliers } from '../../engineers/engineersApi.js'
import {
  cancelLaborRequest, completeLaborRequest, createLaborRequest, fetchLaborDailyRecords, fetchLaborTrades,
  fetchProjectLaborRequests, fetchProjectLaborSupplierServices, LABOR_SUPPLIER_CATEGORY, laborErrorMessage, localIsoDate, saveLaborDailyRecord,
} from '../../labour/labourApi.js'
import { formatLaborDate, LaborDailyRecordsTable, LaborDialog, LaborStatusBadge } from '../../labour/components/SupplierLaborSections.jsx'
import { allocationSummary, availableCount, MAX_WORKERS, offeredServices, workersRequestError } from '../../labour/laborRequestRules.js'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'

const inputClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
const labelClass = 'mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-graphite/55'

const isLaborSupplier = (supplier) => supplier?.supplier_category === LABOR_SUPPLIER_CATEGORY

function Notice({ notice }) {
  if (!notice?.text) return null
  return <p className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
}

// ------------------------------------------------------------ request form

function RequestLaborDialog({ projectId, supplier, services, trades, tradesError = '', onClose, onSent, onStale }) {
  const { t } = useLanguage()
  // The dropdown follows the backend's trade list, narrowed to what this
  // supplier actually offers (and has active). If that list failed to load,
  // the supplier's own trades are still offered and the failure is shown.
  const offered = useMemo(() => offeredServices(services, trades), [services, trades])
  const today = localIsoDate()
  const [form, setForm] = useState({ trade: offered[0]?.trade || '', workers_required: '', start_date: today, end_date: '', work_description: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  // The dropdown shows its first option whenever form.trade matches none of
  // them (e.g. the trade list arrived after the dialog opened); keep the form
  // value equal to what is displayed.
  useEffect(() => {
    if (offered.length && !offered.some((service) => service.trade === form.trade)) {
      setForm((current) => ({ ...current, trade: offered[0].trade }))
    }
  }, [offered, form.trade])
  const selected = offered.find((service) => service.trade === form.trade)
  const available = availableCount(selected)
  const supplierName = supplier.store_name || supplier.name
  // Checked as the engineer types, against the selected trade's own free
  // workers only. The backend re-checks on submit, so a stale figure cannot
  // slip a request through.
  const workersError = form.workers_required === '' ? null : workersRequestError(form.workers_required, selected)
  const noneAvailable = Boolean(selected) && available < 1

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const workers = Number(form.workers_required)
    if (!form.trade) { setError(t('labor.error.chooseTrade')); return }
    const invalid = workersRequestError(form.workers_required, selected)
    if (invalid) { setError(t(invalid.key, invalid.params)); return }
    if (!form.start_date) { setError(t('labor.error.startDate')); return }
    if (form.end_date && form.end_date < form.start_date) { setError(t('labor.error.endBeforeStart')); return }
    // The request has one free-text field; notes travel inside it, labelled.
    const description = [form.work_description.trim(), form.notes.trim() ? `${t('labor.field.notes')}: ${form.notes.trim()}` : ''].filter(Boolean).join('\n\n')
    setBusy(true)
    try {
      await createLaborRequest(projectId, {
        supplier_id: supplier.user_id,
        trade: form.trade,
        workers_required: workers,
        start_date: form.start_date,
        end_date: form.end_date || null,
        work_description: description || null,
      })
      onSent({ tone: 'success', text: t('labor.msg.requestSent', { name: supplierName }) })
    } catch (failure) {
      setError(laborErrorMessage(failure, t('labor.error.requestSend')))
      setBusy(false)
      // Availability moved since this screen loaded: show the current figure.
      if (failure?.response?.status === 409) onStale?.()
    }
  }

  return (
    <LaborDialog title={t('labor.engineer.requestLabor')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className={labelClass}>{t('labor.engineer.laborSupplier')}</span>
          {/* Fixed to the Builder's assignment; there is nothing to choose. */}
          <input className={`${inputClass} bg-slate-50`} value={supplierName} readOnly disabled />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>{t('labor.field.trade')}</span>
            <select className={inputClass} value={form.trade} onChange={set('trade')} required>
              {offered.map((service) => <option key={service.trade} value={service.trade}>{service.trade}</option>)}
            </select>
            {selected && (noneAvailable
              ? <span className="mt-1 block text-[11px] font-bold text-amber-700">{t('labor.engineer.noneAvailable', { trade: selected.trade })}</span>
              : <span className="mt-1 block text-[11px] font-bold text-emerald-700">{t('labor.engineer.availableWorkers', { count: available })}</span>)}
          </label>
          <label className="block">
            <span className={labelClass}>{t('labor.field.workersRequired')}</span>
            <input className={inputClass} type="number" min="1" max={Math.min(Math.max(available, 1), MAX_WORKERS)} step="1" inputMode="numeric" value={form.workers_required} onChange={set('workers_required')} disabled={noneAvailable} aria-invalid={Boolean(workersError)} required />
            {workersError && !noneAvailable && <span className="mt-1 block text-[11px] font-bold text-rose-700" role="alert">{t(workersError.key, workersError.params)}</span>}
          </label>
          <label className="block">
            <span className={labelClass}>{t('labor.field.startDate')}</span>
            <input className={inputClass} type="date" min={today} value={form.start_date} onChange={set('start_date')} required />
          </label>
          <label className="block">
            <span className={labelClass}>{t('labor.field.endDate')}</span>
            <input className={inputClass} type="date" min={form.start_date || today} value={form.end_date} onChange={set('end_date')} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>{t('labor.field.workDescription')}</span>
          <input className={inputClass} value={form.work_description} onChange={set('work_description')} placeholder={t('labor.field.activityPh')} />
        </label>
        <label className="block">
          <span className={labelClass}>{t('labor.field.notes')}</span>
          <textarea className={`${inputClass} h-16 py-2`} value={form.notes} onChange={set('notes')} />
        </label>
        {tradesError && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{tradesError}</p>}
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-extrabold text-graphite/70 hover:bg-slate-50">{t('labor.action.cancel')}</button>
          <button type="submit" disabled={busy || !offered.length || noneAvailable || Boolean(workersError)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t('labor.engineer.sendRequest')}
          </button>
        </div>
      </form>
    </LaborDialog>
  )
}

// ------------------------------------------------------- daily attendance

const EMPTY_COUNTS = { present_count: 0, absent_count: 0, half_day_count: 0, overtime_workers: 0, overtime_hours: 0, activity: '', notes: '' }

function DailyAttendance({ request, refreshKey, onSaved }) {
  const { t } = useLanguage()
  const today = localIsoDate()
  const lastAllowed = request.end_date && request.end_date < today ? request.end_date : today
  const editable = request.status === 'ACCEPTED'
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [workDate, setWorkDate] = useState(lastAllowed)
  const [form, setForm] = useState(EMPTY_COUNTS)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ tone: '', text: '' })

  useEffect(() => {
    let current = true
    fetchLaborDailyRecords(request.id)
      .then((list) => { if (current) { setRecords(list); setLoadError('') } })
      .catch((failure) => { if (current) setLoadError(laborErrorMessage(failure, t('labor.error.attendanceLoad'))) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, refreshKey])

  // The form shows the saved record for the chosen date, or a blank one.
  const savedForDate = records.find((record) => String(record.work_date).slice(0, 10) === workDate)
  useEffect(() => {
    setForm(savedForDate ? {
      present_count: savedForDate.present_count,
      absent_count: savedForDate.absent_count,
      half_day_count: savedForDate.half_day_count,
      overtime_workers: savedForDate.overtime_workers,
      overtime_hours: savedForDate.overtime_hours,
      activity: savedForDate.activity || '',
      notes: savedForDate.notes || '',
    } : EMPTY_COUNTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDate, savedForDate?.id, savedForDate?.updated_at])

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const allocated = Number(request.workers_allocated || 0)

  const save = async (event) => {
    event.preventDefault()
    setNotice({ tone: '', text: '' })
    const counts = ['present_count', 'absent_count', 'half_day_count', 'overtime_workers'].map((field) => Number(form[field] || 0))
    const [present, absent, halfDay, overtimeWorkers] = counts
    const overtimeHours = Number(form.overtime_hours || 0)
    if (counts.some((value) => !Number.isInteger(value) || value < 0) || Number.isNaN(overtimeHours) || overtimeHours < 0) {
      setNotice({ tone: 'error', text: t('labor.error.counts') }); return
    }
    if (present + absent + halfDay > allocated) {
      setNotice({ tone: 'error', text: t('labor.error.countsExceed', { total: present + absent + halfDay, allocated }) }); return
    }
    if (overtimeWorkers > present + halfDay) {
      setNotice({ tone: 'error', text: t('labor.error.overtimeExceed') }); return
    }
    setBusy(true)
    try {
      await saveLaborDailyRecord(request.id, workDate, {
        present_count: present, absent_count: absent, half_day_count: halfDay,
        overtime_workers: overtimeWorkers, overtime_hours: overtimeHours,
        activity: form.activity || null, notes: form.notes || null,
      })
      setNotice({ tone: 'success', text: t('labor.msg.attendanceSaved', { date: formatLaborDate(workDate) }) })
      onSaved()
    } catch (failure) {
      setNotice({ tone: 'error', text: laborErrorMessage(failure, t('labor.error.attendanceSave')) })
    } finally {
      setBusy(false)
    }
  }

  const numberField = (field, label, extra = {}) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input className={inputClass} type="number" min="0" step={extra.step || '1'} inputMode={extra.step ? 'decimal' : 'numeric'} value={form[field]} onChange={set(field)} disabled={!editable} />
    </label>
  )

  return (
    <div className="space-y-3">
      {editable && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-display text-sm font-extrabold text-graphite">{workDate === today ? t('labor.attendance.today') : t('labor.attendance.onDate', { date: formatLaborDate(workDate) })}</p>
              <p className="text-xs font-semibold text-graphite/60">
                {t('labor.attendance.allocated')} <span className="font-extrabold text-graphite">{allocated}</span> · {savedForDate ? t('labor.attendance.editingSaved') : t('labor.attendance.notRecorded')}
              </p>
            </div>
            <label className="block w-full sm:w-44">
              <span className={labelClass}>{t('labor.field.date')}</span>
              <input className={inputClass} type="date" min={request.start_date} max={lastAllowed} value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {numberField('present_count', t('labor.field.present'))}
            {numberField('absent_count', t('labor.field.absent'))}
            {numberField('half_day_count', t('labor.field.halfDay'))}
            {numberField('overtime_workers', t('labor.field.otWorkers'))}
            {numberField('overtime_hours', t('labor.field.otHours'), { step: '0.5' })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>{t('labor.field.activity')}</span>
              <input className={inputClass} value={form.activity} onChange={set('activity')} maxLength={255} placeholder={t('labor.field.activityPh')} />
            </label>
            <label className="block">
              <span className={labelClass}>{t('labor.field.notes')}</span>
              <input className={inputClass} value={form.notes} onChange={set('notes')} />
            </label>
          </div>
          <Notice notice={notice} />
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-5 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {savedForDate ? t('labor.attendance.update') : t('labor.attendance.save')}
            </button>
          </div>
        </form>
      )}
      <div>
        <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-graphite/50">{t('labor.attendance.history')}</p>
        {loading ? (
          <p className="flex items-center gap-2 py-3 text-xs font-semibold text-graphite/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('labor.attendance.loading')}</p>
        ) : loadError ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{loadError}</p>
        ) : (
          <>
            <LaborDailyRecordsTable records={records} />
            {editable && records.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {records.slice(0, 7).map((record) => (
                  <button key={record.id} type="button" onClick={() => setWorkDate(String(record.work_date).slice(0, 10))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-extrabold text-graphite/70 hover:bg-slate-50">
                    <Pencil className="h-3 w-3" /> {formatLaborDate(record.work_date)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- requests

function RequestCard({ request, refreshKey, onChanged, setNotice }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (action) => {
    if (action === 'complete' && !window.confirm(t('labor.confirm.complete', { trade: request.trade, count: request.workers_allocated }))) return
    if (action === 'cancel' && !window.confirm(t('labor.confirm.cancel'))) return
    setBusy(true)
    setNotice({ tone: '', text: '' })
    try {
      if (action === 'cancel') await cancelLaborRequest(request.id)
      else await completeLaborRequest(request.id)
      setNotice({ tone: 'success', text: action === 'cancel' ? t('labor.msg.cancelled') : t('labor.msg.completed') })
      onChanged()
    } catch (failure) {
      setNotice({ tone: 'error', text: laborErrorMessage(failure, t('labor.error.requestUpdate')) })
    } finally {
      setBusy(false)
    }
  }

  const accepted = request.status === 'ACCEPTED'
  const allocation = allocationSummary(request)
  const heading = accepted ? t('labor.engineer.assigned') : request.status === 'COMPLETED' ? t('labor.engineer.completedAssignment') : t('labor.requests.label')
  return (
    <article className={`rounded-2xl border bg-white p-4 ${accepted ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-800">
            <HardHat className="h-3.5 w-3.5" /> {heading}
          </p>
          <p className="truncate text-base font-extrabold text-graphite">{request.trade} · {request.supplier_name}</p>
        </div>
        <LaborStatusBadge status={request.status} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-4">
        <div><dt className="font-bold text-graphite/50">{t('labor.field.workersRequired')}</dt><dd className="font-extrabold text-graphite">{request.workers_required}</dd></div>
        <div><dt className="font-bold text-graphite/50">{t('labor.field.allocatedWorkers')}</dt><dd className="font-extrabold text-emerald-700">{request.workers_allocated ?? '—'}</dd></div>
        <div><dt className="font-bold text-graphite/50">{t('labor.field.startDate')}</dt><dd className="font-extrabold text-graphite">{formatLaborDate(request.start_date)}</dd></div>
        <div><dt className="font-bold text-graphite/50">{t('labor.field.endDate')}</dt><dd className="font-extrabold text-graphite">{formatLaborDate(request.end_date)}</dd></div>
      </dl>
      {allocation.partial && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          {t('labor.allocation.partial', { allocated: allocation.allocated, required: allocation.required, shortfall: allocation.shortfall })}
        </p>
      )}
      {request.work_description && <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/70">{request.work_description}</p>}
      {request.status === 'REJECTED' && (
        <p className="mt-2 text-xs font-bold text-rose-700">{request.decision_note ? t('labor.engineer.rejectedNote', { note: request.decision_note }) : t('labor.engineer.rejected')}</p>
      )}
      {accepted && request.decision_note && <p className="mt-2 text-[11px] font-bold text-graphite/55">{t('labor.engineer.supplierNote', { note: request.decision_note })}</p>}
      {request.status === 'COMPLETED' && request.completed_at && (
        <p className="mt-2 text-[11px] font-bold text-sky-800">{t('labor.engineer.completedOn', { date: formatLaborDate(request.completed_at) })}</p>
      )}
      {accepted && !request.supplier_assignment_active && (
        <p className="mt-2 text-[11px] font-bold text-amber-700">{t('labor.engineer.unassignedContinues')}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {request.status === 'PENDING' && (
          <button type="button" disabled={busy} onClick={() => act('cancel')} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
            <XCircle className="h-3.5 w-3.5" /> {t('labor.action.cancelRequest')}
          </button>
        )}
        {(accepted || request.status === 'COMPLETED') && (
          <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-extrabold text-graphite/75 hover:bg-slate-50">
            <CalendarDays className="h-3.5 w-3.5" /> {accepted ? (open ? t('labor.engineer.hideAttendance') : t('labor.engineer.dailyAttendance')) : (open ? t('labor.engineer.hideRecords') : t('labor.engineer.dailyRecords'))}
          </button>
        )}
        {accepted && (
          <button type="button" disabled={busy} onClick={() => act('complete')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t('labor.action.completeAssignment')}
          </button>
        )}
      </div>
      {open && <div className="mt-3"><DailyAttendance request={request} refreshKey={refreshKey} onSaved={onChanged} /></div>}
    </article>
  )
}

// ------------------------------------------------------------------ panel

export default function EngineerLaborPanel({ projects = [], activeProjectId = null, onProjectChange }) {
  const { t } = useLanguage()
  const projectId = activeProjectId ?? projects[0]?.id ?? null
  const [suppliers, setSuppliers] = useState([])
  const [servicesBySupplier, setServicesBySupplier] = useState({})
  const [requests, setRequests] = useState([])
  const [trades, setTrades] = useState([])
  const [tradesError, setTradesError] = useState('')
  // Per supplier: why its trades could not be loaded (shown instead of "no trades").
  const [serviceErrors, setServiceErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [requesting, setRequesting] = useState(null)
  const [notice, setNotice] = useState({ tone: '', text: '' })
  const [tab, setTab] = useState('active')
  const [refreshKey, setRefreshKey] = useState(0)
  const guard = useLatestOnly()

  const load = async () => {
    if (!projectId) { setLoading(false); return }
    const isLatest = guard()
    try {
      const [assigned, labor] = await Promise.all([fetchProjectSuppliers(projectId), fetchProjectLaborRequests(projectId)])
      const laborSuppliers = assigned.filter(isLaborSupplier)
      const serviceLists = await Promise.all(laborSuppliers.map((supplier) => (
        fetchProjectLaborSupplierServices(projectId, supplier.user_id)
          .then((list) => ({ list: Array.isArray(list) ? list : [], error: '' }))
          .catch((failure) => ({ list: [], error: laborErrorMessage(failure, t('labor.error.tradesLoad')) }))
      )))
      if (!isLatest()) return
      setSuppliers(laborSuppliers)
      setServicesBySupplier(Object.fromEntries(laborSuppliers.map((supplier, index) => [supplier.user_id, serviceLists[index].list])))
      setServiceErrors(Object.fromEntries(laborSuppliers.map((supplier, index) => [supplier.user_id, serviceLists[index].error])))
      setRequests(labor)
      setLoadError('')
      setRefreshKey((key) => key + 1)
    } catch (failure) {
      if (isLatest()) setLoadError(laborErrorMessage(failure, t('labor.error.panelLoad')))
    } finally {
      if (isLatest()) setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); load() }, [projectId])
  useEffect(() => {
    fetchLaborTrades()
      .then((list) => { setTrades(Array.isArray(list) ? list : []); setTradesError('') })
      .catch((failure) => { setTrades([]); setTradesError(laborErrorMessage(failure, t('labor.error.tradeListLoad'))) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Supplier's accept/reject, and our own changes, arrive through the existing hint.
  useLiveRefresh(load)

  const groups = {
    active: requests.filter((request) => request.status === 'ACCEPTED'),
    pending: requests.filter((request) => request.status === 'PENDING'),
    history: requests.filter((request) => ['REJECTED', 'CANCELLED', 'COMPLETED'].includes(request.status)),
  }
  const tabs = [
    { id: 'active', label: t('labor.engineer.tab.active'), list: groups.active },
    { id: 'pending', label: t('labor.status.PENDING'), list: groups.pending },
    { id: 'history', label: t('labor.tab.history'), list: groups.history },
  ]
  const shown = tabs.find((item) => item.id === tab) || tabs[0]

  if (!projects.length) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-4"><EmptyState icon={HardHat} title={t('labor.engineer.noProjectsTitle')} message={t('labor.engineer.noProjectsMessage')} /></div>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <h2 className="font-display text-base font-extrabold text-graphite">{t('labor.engineer.title')}</h2>
          <p className="text-xs font-semibold text-graphite/55">{t('labor.engineer.subtitle')}</p>
        </div>
        {projects.length > 1 && (
          <label className="block w-full sm:w-64">
            <span className="sr-only">{t('labor.project')}</span>
            <select className={inputClass} value={projectId ?? ''} onChange={(event) => onProjectChange?.(event.target.value || null)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm font-semibold text-graphite/50"><Loader2 className="h-4 w-4 animate-spin" /> {t('labor.engineer.loading')}</p>
      ) : loadError ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{loadError}</p>
      ) : (
        <>
          {suppliers.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {suppliers.map((supplier) => {
                const services = servicesBySupplier[supplier.user_id] || []
                const servicesError = serviceErrors[supplier.user_id] || ''
                return (
                  <article key={supplier.user_id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><UserRound className="h-5 w-5" /></span>
                        <div className="min-w-0">
                          <p className="truncate text-base font-extrabold text-graphite">{supplier.store_name || supplier.name}</p>
                          <p className="truncate text-xs font-semibold text-graphite/55">{t('labor.engineer.assignedSupplier')}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800">{t('labor.assigned')}</span>
                    </div>
                    {services.length ? (
                      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
                        {services.map((service) => (
                          <li key={service.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                            <span className="min-w-0 truncate font-extrabold text-graphite">{service.trade}{service.skill_level ? <span className="font-semibold text-graphite/50"> · {service.skill_level}</span> : null}</span>
                            <span className={`shrink-0 font-bold ${availableCount(service) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{t('labor.engineer.availableCount', { count: availableCount(service) })}</span>
                          </li>
                        ))}
                      </ul>
                    ) : servicesError ? (
                      <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700" role="alert">{servicesError}</p>
                    ) : (
                      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/55">{t('labor.engineer.noTrades')}</p>
                    )}
                    <div className="mt-auto pt-3">
                      <button
                        type="button"
                        disabled={!services.length}
                        onClick={() => { setNotice({ tone: '', text: '' }); setRequesting(supplier) }}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-xs font-extrabold text-white hover:bg-brand-800 disabled:opacity-50 sm:w-auto"
                      >
                        <Send className="h-3.5 w-3.5" /> {t('labor.engineer.requestLabor')}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <EmptyState icon={HardHat} title={t('labor.engineer.noSupplierTitle')} message={t('labor.engineer.noSupplierMessage')} />
            </div>
          )}

          <Notice notice={notice} />

          <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
            {tabs.map((item) => {
              const isActive = shown.id === item.id
              return (
                <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'}`}>
                  {item.id === 'history' && <History className="h-3.5 w-3.5" />}
                  {item.label}
                  {item.list.length > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{item.list.length}</span>}
                </button>
              )
            })}
          </div>
          {shown.list.length ? (
            <div className="space-y-3">
              {shown.list.map((request) => (
                <RequestCard key={request.id} request={request} refreshKey={refreshKey} onChanged={load} setNotice={setNotice} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <EmptyState
                icon={HardHat}
                title={t(`labor.engineer.empty.${shown.id}.title`)}
                message={t(`labor.engineer.empty.${shown.id}.message`)}
              />
            </div>
          )}
        </>
      )}

      {requesting && (
        <RequestLaborDialog
          projectId={projectId}
          supplier={requesting}
          services={servicesBySupplier[requesting.user_id] || []}
          trades={trades}
          tradesError={tradesError}
          onClose={() => setRequesting(null)}
          onStale={load}
          onSent={(result) => { setRequesting(null); setNotice(result); setTab('pending'); load() }}
        />
      )}
    </div>
  )
}
