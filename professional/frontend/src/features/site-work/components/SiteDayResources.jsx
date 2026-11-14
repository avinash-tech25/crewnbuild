// Labour crews, equipment rentals, received stock and recorded payments for one
// date of the Site Engineer calendar. Everything comes from the existing supply
// flows; writes go to their existing endpoints, which enforce the same rules
// (own request, ACCEPTED, inside the request period, not in the future).
import { useEffect, useMemo, useState } from 'react'
import { Loader2, PackageCheck, Truck, Wallet } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { formatDate } from '../../../shared/utils/formatters.js'
import { laborErrorMessage, saveLaborDailyRecord } from '../../labour/labourApi.js'
import { equipmentErrorMessage, ratePer, saveEquipmentUsage } from '../../equipment/equipmentApi.js'
import { attendanceProblem, recordForDate, rentalChargeForDate, splitPayments } from '../siteResources.js'

const formatQty = (value) => { const number = Number(value || 0); return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(3))) }
const EMPTY_ATTENDANCE = { present_count: 0, absent_count: 0, half_day_count: 0, overtime_workers: 0, overtime_hours: 0, activity: '', notes: '' }
const attendanceFrom = (record) => (record ? {
  present_count: record.present_count, absent_count: record.absent_count, half_day_count: record.half_day_count,
  overtime_workers: record.overtime_workers, overtime_hours: record.overtime_hours, activity: record.activity || '', notes: record.notes || '',
} : EMPTY_ATTENDANCE)
const sameForm = (first, second) => JSON.stringify(first) === JSON.stringify(second)
const NUMBER_CLASS = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-right text-sm font-extrabold tabular-nums outline-none focus:border-brand-500 disabled:bg-slate-50'
const TEXT_CLASS = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold outline-none focus:border-brand-500 disabled:bg-slate-50'

export function Tag({ tone = 'slate', children }) {
  const tones = { slate: 'bg-slate-100 text-slate-700', calc: 'bg-sky-100 text-sky-800', entered: 'bg-amber-100 text-amber-800', ok: 'bg-emerald-100 text-emerald-800', warn: 'bg-rose-100 text-rose-700' }
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold ${tones[tone] || tones.slate}`}>{children}</span>
}

const periodText = (request, t) => (request.end_date
  ? `${formatDate(request.start_date, request.start_date)} – ${formatDate(request.end_date, request.end_date)}`
  : t('se.res.openEnded', { start: formatDate(request.start_date, request.start_date) }))

function CardShell({ title, subtitle, aside, children }) {
  return <div className="rounded-lg border border-slate-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
      <div className="min-w-0"><p className="font-extrabold text-slate-900">{title}</p>{subtitle && <p className="text-[11px] font-semibold text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap items-center gap-1.5">{aside}</div>
    </div>
    <div className="p-3">{children}</div>
  </div>
}

function CardFooter({ editable, dirty, saving, onSave, label, notice }) {
  if (!editable && !notice?.text) return null
  return <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
    <p role={notice?.tone === 'error' ? 'alert' : 'status'} className={`text-xs font-bold ${notice?.tone === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>{notice?.text || ''}</p>
    {editable && <button type="button" onClick={onSave} disabled={saving || !dirty} className="inline-flex h-9 items-center gap-2 rounded-lg border-2 border-brand-600 bg-brand-500 px-4 text-xs font-extrabold text-slate-950 disabled:opacity-40">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{label}</button>}
  </div>
}

// One accepted labour request on one date: attendance, saved to
// PUT /labor-requests/{id}/daily-records/{date}.
function LabourCard({ request, date, records, editable, onSaved, onDirtyChange, resetSignal }) {
  const { t, td } = useLanguage()
  const saved = recordForDate(records, date)
  const [form, setForm] = useState(() => attendanceFrom(saved))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const baseline = attendanceFrom(saved)
  // Reload when the date, the saved record or a discard changes it.
  useEffect(() => { setForm(attendanceFrom(saved)); setNotice(null) }, [date, saved?.id, saved?.updated_at, resetSignal])
  const dirty = editable && !sameForm(normalize(form), normalize(baseline))
  useEffect(() => { onDirtyChange(`labour:${request.id}`, dirty); return () => onDirtyChange(`labour:${request.id}`, false) }, [dirty])
  const set = (field) => (event) => { setForm((current) => ({ ...current, [field]: event.target.value })); setNotice(null) }
  const allocated = Number(request.workers_allocated || 0)
  const save = async () => {
    const problem = attendanceProblem(form, allocated)
    if (problem) { setNotice({ tone: 'error', text: t(problem.key, problem.values) }); return }
    setSaving(true)
    try {
      const payload = normalize(form)
      await saveLaborDailyRecord(request.id, date, { ...payload, activity: payload.activity || null, notes: payload.notes || null })
      await onSaved(request.id)
      setNotice({ tone: 'ok', text: t('labor.msg.attendanceSaved', { date: formatDate(date, date) }) })
    } catch (error) {
      setNotice({ tone: 'error', text: laborErrorMessage(error, t('labor.error.attendanceSave')) })
    } finally { setSaving(false) }
  }
  const field = (key, label, step = '1') => <label className="grid gap-1 text-[11px] font-bold text-slate-600">{label}<input type="number" min="0" step={step} inputMode={step === '1' ? 'numeric' : 'decimal'} value={form[key]} onChange={set(key)} onFocus={(event) => event.target.select()} disabled={!editable} className={NUMBER_CLASS} /></label>
  return <CardShell
    title={`${td(request.supplier_name || '')} · ${td(request.trade)}`}
    subtitle={`${t('labor.field.allocatedWorkers')}: ${allocated} · ${periodText(request, t)}`}
    aside={<>{request.status === 'COMPLETED' && <Tag>{t('labor.status.COMPLETED')}</Tag>}{saved ? <Tag tone="ok">{t('se.res.recorded')}</Tag> : <Tag>{t('labor.attendance.notRecorded')}</Tag>}{dirty && <Tag tone="entered">{t('se.res.unsavedCard')}</Tag>}</>}
  >
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {field('present_count', t('labor.field.present'))}
      {field('absent_count', t('labor.field.absent'))}
      {field('half_day_count', t('labor.field.halfDay'))}
      {field('overtime_workers', t('labor.field.otWorkers'))}
      {field('overtime_hours', t('labor.field.otHours'), '0.5')}
    </div>
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-[11px] font-bold text-slate-600">{t('labor.field.activity')}<input value={form.activity} maxLength={255} onChange={set('activity')} disabled={!editable} placeholder={editable ? t('labor.field.activityPh') : ''} className={TEXT_CLASS} /></label>
      <label className="grid gap-1 text-[11px] font-bold text-slate-600">{t('labor.field.notes')}<input value={form.notes} onChange={set('notes')} disabled={!editable} className={TEXT_CLASS} /></label>
    </div>
    {/* No agreed rate exists on labour requests, so no amount is shown here
        rather than a guessed one. */}
    <p className="mt-2 text-[11px] font-semibold text-slate-500">{t('se.res.noRate')}</p>
    <CardFooter editable={editable} dirty={dirty} saving={saving} onSave={save} label={saved ? t('labor.attendance.update') : t('labor.attendance.save')} notice={notice} />
  </CardShell>
}

const normalize = (form) => ({
  present_count: Number(form.present_count || 0), absent_count: Number(form.absent_count || 0), half_day_count: Number(form.half_day_count || 0),
  overtime_workers: Number(form.overtime_workers || 0), overtime_hours: Number(form.overtime_hours || 0),
  activity: String(form.activity || '').trim(), notes: String(form.notes || '').trim(),
})

export function LabourCards({ requests, date, recordsById, canRecord, onSaved, onDirtyChange, resetSignal }) {
  const { t } = useLanguage()
  if (!requests.length) return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-bold text-slate-400">{t('se.res.noLabour')}</p>
  return <div className="grid gap-3 xl:grid-cols-2">
    {requests.map((request) => <LabourCard key={request.id} request={request} date={date} records={recordsById[request.id] || []} editable={canRecord(request)} onSaved={onSaved} onDirtyChange={onDirtyChange} resetSignal={resetSignal} />)}
  </div>
}

// One supplier rental on one date: the agreed terms, the day's charge under
// them, and the hours logged (PUT /equipment-requests/{id}/usage/{date}).
function RentalCard({ rental, date, logs, editable, country, onSaved, onDirtyChange, resetSignal }) {
  const { t, td } = useLanguage()
  const saved = recordForDate(logs, date, 'usage_date')
  const savedHours = saved ? String(saved.hours_used) : ''
  const [hours, setHours] = useState(savedHours)
  const [notes, setNotes] = useState(saved?.notes || '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  useEffect(() => { setHours(savedHours); setNotes(saved?.notes || ''); setNotice(null) }, [date, saved?.id, saved?.updated_at, resetSignal])
  const dirty = editable && (String(hours) !== savedHours || String(notes || '') !== String(saved?.notes || ''))
  useEffect(() => { onDirtyChange(`rental:${rental.id}`, dirty); return () => onDirtyChange(`rental:${rental.id}`, false) }, [dirty])
  const charge = rentalChargeForDate(rental, date, saved ? saved.hours_used : null)
  const save = async () => {
    const value = Number(hours)
    if (hours === '' || !Number.isFinite(value) || value < 0) { setNotice({ tone: 'error', text: t('equipment.error.hours') }); return }
    if (value > 24 * Number(rental.quantity || 1)) { setNotice({ tone: 'error', text: t('se.res.errHoursCap', { max: 24 * Number(rental.quantity || 1) }) }); return }
    setSaving(true)
    try {
      await saveEquipmentUsage(rental.id, date, { hours_used: value, notes: String(notes || '').trim() || null })
      await onSaved(rental.id)
      setNotice({ tone: 'ok', text: t('se.res.hoursSaved') })
    } catch (error) {
      setNotice({ tone: 'error', text: equipmentErrorMessage(error, t('equipment.error.usageSave')) })
    } finally { setSaving(false) }
  }
  return <CardShell
    title={`${td(rental.item_name || '')}${rental.item_category ? ` · ${td(rental.item_category)}` : ''}`}
    subtitle={`${td(rental.supplier_name || '')} · ${t('se.res.units', { count: rental.quantity })} · ${periodText(rental, t)}`}
    aside={<>{rental.status === 'COMPLETED' && <Tag>{t('se.res.returned')}</Tag>}{dirty && <Tag tone="entered">{t('se.res.unsavedCard')}</Tag>}</>}
  >
    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="font-bold text-slate-500">{t('equipment.field.rate')}</dt>
        <dd className="text-right font-extrabold tabular-nums text-slate-900">{t('se.res.ratePer', { amount: formatMoney(rental.unit_price, country), unit: ratePer(rental.rate_unit) })}</dd>
        <dt className="font-bold text-slate-500">{t('equipment.field.hoursUsed')}</dt>
        <dd className="text-right font-extrabold tabular-nums text-slate-900">{saved ? formatQty(saved.hours_used) : '—'}</dd>
        <dt className="font-bold text-slate-500">{t('se.res.dayCharge')}</dt>
        <dd className="text-right font-extrabold tabular-nums text-slate-900">{charge.amount != null ? <span className="inline-flex items-center gap-1.5"><Tag tone="calc">{t('se.res.calculated')}</Tag>{formatMoney(charge.amount, country)}</span> : <Tag tone="warn">{t('se.res.notPriced')}</Tag>}</dd>
      </dl>
      {editable && <div className="grid grid-cols-2 gap-2 sm:w-64">
        <label className="grid gap-1 text-[11px] font-bold text-slate-600">{t('equipment.field.hoursUsed')}<input type="number" min="0" step="0.5" inputMode="decimal" value={hours} onChange={(event) => { setHours(event.target.value); setNotice(null) }} className={NUMBER_CLASS} /></label>
        <label className="grid gap-1 text-[11px] font-bold text-slate-600">{t('labor.field.notes')}<input value={notes} onChange={(event) => { setNotes(event.target.value); setNotice(null) }} className={TEXT_CLASS} /></label>
      </div>}
    </div>
    <p className="mt-2 text-[11px] font-semibold text-slate-500">{t(`se.res.basis.${charge.basis}`)}</p>
    <CardFooter editable={editable} dirty={dirty} saving={saving} onSave={save} label={t('se.res.saveHours')} notice={notice} />
  </CardShell>
}

export function RentalCards({ rentals, date, logsById, canRecord, country, onSaved, onDirtyChange, resetSignal }) {
  const { t } = useLanguage()
  if (!rentals.length) return <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-bold text-slate-400">{t('se.res.noRentals')}</p>
  return <div className="grid gap-3 xl:grid-cols-2">
    {rentals.map((rental) => <RentalCard key={rental.id} rental={rental} date={date} logs={logsById[rental.id] || []} editable={canRecord(rental)} country={country} onSaved={onSaved} onDirtyChange={onDirtyChange} resetSignal={resetSignal} />)}
  </div>
}

// Bought equipment: reference only, never a daily charge.
export function PurchasedEquipment({ purchases, country }) {
  const { t, td } = useLanguage()
  if (!purchases.length) return null
  return <details className="group rounded-lg border border-slate-200">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-extrabold text-slate-700"><span className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" />{t('se.res.purchases')} ({purchases.length})</span><Tag>{t('se.res.notInTotal')}</Tag></summary>
    <ul className="divide-y divide-slate-100 border-t border-slate-200 text-xs">
      {purchases.map((purchase) => <li key={purchase.id} className="flex items-center justify-between gap-2 px-3 py-2"><span className="font-bold text-slate-800">{td(purchase.item_name || '')} × {purchase.quantity} <span className="font-semibold text-slate-500">· {td(purchase.supplier_name || '')}</span></span><span className="tabular-nums font-extrabold text-slate-700">{formatMoney(Number(purchase.unit_price || 0) * Number(purchase.quantity || 0), country)}</span></li>)}
    </ul>
    <p className="px-3 pb-2 text-[11px] font-semibold text-slate-500">{t('se.res.purchasesHint')}</p>
  </details>
}

// Fulfilled order lines delivered on this date: reference only.
export function ReceivedMaterials({ orders = [], country, unitLabel }) {
  const { t, td } = useLanguage()
  return <details className="group mt-3 rounded-lg border border-slate-200">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-extrabold text-slate-700"><span className="inline-flex items-center gap-1.5"><PackageCheck className="h-3.5 w-3.5" />{t('se.res.received')} ({orders.length})</span><Tag>{t('se.res.notInTotal')}</Tag></summary>
    <div className="border-t border-slate-200">
      {orders.length ? <ul className="divide-y divide-slate-100 text-xs">
        {orders.map((order) => <li key={order.id} className="flex items-start justify-between gap-2 px-3 py-2"><span><b className="text-slate-800">{td(order.material_name)}</b><span className="block text-[11px] font-semibold text-slate-500">{[td(order.supplier_name || ''), order.request_code].filter(Boolean).join(' · ')}</span></span><span className="text-right tabular-nums"><b className="text-slate-800">{formatQty(order.quantity)} {unitLabel(order.unit)}</b>{order.amount != null && <span className="block text-[11px] font-semibold text-slate-500">{formatMoney(order.amount, country)}</span>}</span></li>)}
      </ul> : <p className="px-3 py-3 text-center text-xs font-bold text-slate-400">{t('se.res.noReceived')}</p>}
      <p className="px-3 pb-2 text-[11px] font-semibold text-slate-500">{t('se.res.receivedHint')}</p>
    </div>
  </details>
}

// Payments recorded on the day's records. site_payments has no supplier link,
// so rows show the party name as typed and are never matched to a supplier.
export function PaymentsList({ payments = [], country }) {
  const { t, td } = useLanguage()
  const { paidOut, receivedIn, paidOutTotal, receivedInTotal } = useMemo(() => splitPayments(payments), [payments])
  return <details className="group mt-3 rounded-lg border border-slate-200">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-extrabold text-slate-700"><span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" />{t('se.res.payments')} ({paidOut.length + receivedIn.length})</span><Tag>{t('se.res.notInTotal')}</Tag></summary>
    <div className="border-t border-slate-200">
      {paidOut.length + receivedIn.length ? <ul className="divide-y divide-slate-100 text-xs">
        {[...paidOut, ...receivedIn].map((payment) => <li key={payment.id} className="flex items-start justify-between gap-2 px-3 py-2"><span><b className="text-slate-800">{td(payment.payment_type || '')}</b><span className="block text-[11px] font-semibold text-slate-500">{[payment.party_name ? td(payment.party_name) : '', payment.remarks ? td(payment.remarks) : ''].filter(Boolean).join(' · ')}</span></span><span className={`tabular-nums font-extrabold ${String(payment.direction).toUpperCase() === 'IN' ? 'text-emerald-700' : 'text-slate-800'}`}>{String(payment.direction).toUpperCase() === 'IN' ? '+' : '−'}{formatMoney(payment.amount, country)}</span></li>)}
      </ul> : <p className="px-3 py-3 text-center text-xs font-bold text-slate-400">{t('se.res.noPayments')}</p>}
      {(paidOutTotal > 0 || receivedInTotal > 0) && <p className="px-3 pt-2 text-xs font-bold text-slate-600">{t('se.res.paidOutTotal', { amount: formatMoney(paidOutTotal, country) })}{receivedInTotal > 0 ? ` · ${t('se.res.receivedInTotal', { amount: formatMoney(receivedInTotal, country) })}` : ''}</p>}
      <p className="px-3 pb-2 text-[11px] font-semibold text-slate-500">{t('se.res.paymentsHint')}</p>
    </div>
  </details>
}
