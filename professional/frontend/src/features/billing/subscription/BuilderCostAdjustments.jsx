import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardEdit } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { fetchCostAdjustments, saveCostAdjustment } from '../subscriptionApi.js'
import LockedFeature from './LockedFeature.jsx'
import useBuilderSubscription from './useBuilderSubscription.js'
import { formatPlanDate, hasFeature, lockedReason, subscriptionErrorMessage } from './subscriptionFormat.js'

const FIELDS = [
  ['labour_cost', 'se.labourCost'],
  ['material_cost', 'se.materialCost'],
  ['equipment_cost', 'se.equipmentCost'],
  ['total_expenses', 'se.otherExpenses'],
]

// The builder's audited corrections for one closed daily record. The engineer's
// figures are shown as recorded and never change; a correction is a separate row
// with its reason, and the server enforces plan, ownership and the closed-day rule.
export default function BuilderCostAdjustments({ registerId, money }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { status } = useBuilderSubscription()
  const [record, setRecord] = useState(null)
  const [form, setForm] = useState({ fieldName: 'labour_cost', adjustedValue: '', reason: '' })
  const [message, setMessage] = useState(null)
  const [locked, setLocked] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!registerId) return
    try { setRecord(await fetchCostAdjustments(registerId)) } catch { setRecord(null) }
  }, [registerId])
  useEffect(() => { load() }, [load])

  if (!registerId || !record) return null
  const entitled = hasFeature(status, 'bill_adjustments')
  const viewPlans = () => navigate('/contractor/subscription')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      setRecord(await saveCostAdjustment(registerId, form))
      setForm((current) => ({ ...current, adjustedValue: '', reason: '' }))
      setMessage({ tone: 'success', text: t('subscription.adjust.saved') })
    } catch (error) {
      const reason = lockedReason(error)
      if (reason) setLocked(reason)
      else setMessage({ tone: 'error', text: subscriptionErrorMessage(error, t('subscription.panel.failed')) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="md:col-span-2 overflow-hidden rounded-xl border border-emerald-200">
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-3">
        <ClipboardEdit className="h-4 w-4 text-emerald-700" aria-hidden="true" />
        <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">{t('subscription.adjust.title')}</p>
      </div>
      <div className="grid gap-3 bg-white p-4">
        <p className="text-xs font-semibold text-slate-500">{t('subscription.adjust.hint')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map(([field, labelKey]) => {
            const values = record.fields[field]
            const changed = values.effective !== values.original
            return (
              <div key={field} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-bold text-slate-600">{t(labelKey)}</p>
                <p className="text-sm font-extrabold text-slate-900">{money(values.effective)}</p>
                {changed && <p className="text-[11px] font-semibold text-slate-500">{t('subscription.adjust.recorded')}: {money(values.original)}</p>}
              </div>
            )
          })}
        </div>

        {!record.locked && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{t('subscription.adjust.openDay')}</p>}
        {record.locked && (locked || !entitled) && <LockedFeature compact reason={locked || { kind: status?.status === 'EXPIRED' ? 'expired' : 'required', requiredPlan: 'PROFESSIONAL' }} onViewPlans={viewPlans} />}
        {record.locked && entitled && !locked && (
          <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('subscription.adjust.field')}</span>
              <select value={form.fieldName} onChange={(event) => setForm({ ...form, fieldName: event.target.value })} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold">
                {FIELDS.map(([field, labelKey]) => <option key={field} value={field}>{t(labelKey)}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('subscription.adjust.newAmount')}</span>
              <input type="number" min="0" step="0.01" required value={form.adjustedValue} onChange={(event) => setForm({ ...form, adjustedValue: event.target.value })} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold" />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              <span>{t('subscription.adjust.reason')}</span>
              <textarea required minLength={3} maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="min-h-16 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" />
            </label>
            <div className="sm:col-span-2 flex justify-end">
              <button type="submit" disabled={busy} className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-5 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60">
                {busy ? t('subscription.panel.processing') : t('subscription.adjust.save')}
              </button>
            </div>
          </form>
        )}
        {message && <p role="status" className={`rounded-lg px-3 py-2 text-xs font-bold ${message.tone === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message.text}</p>}

        {record.adjustments.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-extrabold text-slate-700">{t('subscription.adjust.history')}</p>
            <ul className="grid gap-1.5">
              {record.adjustments.map((row) => (
                <li key={row.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
                  <p className="font-bold text-slate-900">{t(FIELDS.find(([field]) => field === row.field_name)?.[1] || 'se.otherExpenses')}: {money(row.original_value)} → {money(row.adjusted_value)}</p>
                  <p className="text-slate-600">{row.reason}</p>
                  <p className="text-[11px] text-slate-400">{t('subscription.adjust.by', { name: row.builder_name, date: formatPlanDate(`${row.created_at}Z`, activeLocale()) })}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
