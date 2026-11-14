/**
 * Builder subscription coupons.
 *
 * A coupon is a fixed discount in its country's currency on the builder plans
 * (older coupons may name one plan and billing period). Every rule is the server's:
 * an India administrator only ever sees and changes India coupons, and a Global
 * administrator every coupon. This screen merely
 * hides controls the caller cannot use -- the API refuses them anyway.
 */

import { useState } from 'react'
import { Pencil, Plus, Power, TicketPercent, X } from 'lucide-react'
import { createCoupon, fetchCoupons, setCouponActive, updateCoupon } from '../adminApi.js'
import { canManageCoupons, couponCodeError, couponViewState, messageOf, normalizeCouponCode } from '../couponsView.js'

const COUNTRY_NAMES = { IN: 'India' }
const CURRENCY_FOR = { IN: 'INR' }
// The two offered builder plans, as the server identifies them.
const OFFERS = [
  { value: 'PROFESSIONAL:MONTHLY', label: 'Professional Pro — Monthly' },
  { value: 'BUSINESS:ANNUAL', label: 'Premium Annual — 12 months' },
]
const offerLabel = (plan, duration) => (!plan ? 'All plans'
  : OFFERS.find((offer) => offer.value === `${plan}:${duration}`)?.label || `${plan} / ${duration}`)
const STATE_TONES = {
  ACTIVE: 'bg-ocbrand-50 text-ocbrand-700',
  SCHEDULED: 'bg-sky-50 text-sky-700',
  EXPIRED: 'bg-slate-100 text-slate-500',
  EXHAUSTED: 'bg-amber-50 text-amber-700',
  INACTIVE: 'bg-red-50 text-red-600',
}
const todayIso = () => new Date().toISOString().slice(0, 10)
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

const detailOf = (error, fallback) => messageOf(error?.response?.data?.detail, fallback)

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1 text-xs font-bold text-slate-600">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] font-medium text-slate-400">{hint}</span>}
    </label>
  )
}

const inputClass = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-graphite outline-none focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-400'

function CouponForm({ identity, initial, onClose, onSaved }) {
  const editing = Boolean(initial)
  const isGlobal = identity.scope === 'GLOBAL'
  const [draft, setDraft] = useState(() => (initial ? {
    code: initial.code, country: initial.country, discount: initial.discount_amount,
    starts: initial.starts_on, expires: initial.expires_on,
  } : {
    code: '', country: isGlobal ? 'IN' : identity.scope, discount: '', starts: todayIso(), expires: inDays(30),
  }))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const set = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }))
  const setCode = (event) => setDraft((current) => ({ ...current, code: normalizeCouponCode(event.target.value) }))
  const codeError = !editing && draft.code ? couponCodeError(draft.code) : ''
  const currency = CURRENCY_FOR[draft.country] || ''

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    if (!editing && couponCodeError(draft.code)) {
      setBusy(false)
      return
    }
    if (draft.expires < draft.starts) {
      setMessage('The expiry date cannot be before the start date.')
      setBusy(false)
      return
    }
    // Only the five fields: the plan, limits and status of an existing coupon are left as they are.
    const common = { discount_amount: String(draft.discount), starts_on: draft.starts, expires_on: draft.expires }
    try {
      const saved = editing
        ? await updateCoupon(initial.id, common)
        : await createCoupon({ code: draft.code, country: draft.country, ...common })
      onSaved(saved)
    } catch (error) {
      setMessage(detailOf(error, 'The coupon could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 border-b border-slate-200 bg-slate-50/60 px-6 py-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold text-graphite">{editing ? `Edit ${initial.code}` : 'New coupon'}</p>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Coupon code" hint={codeError ? null : 'Capital letters, digits, - or _.'}>
          <input className={`${inputClass} ${codeError ? 'border-red-400 focus:border-red-500' : ''}`} required maxLength={40}
            value={draft.code} onChange={setCode} disabled={editing} aria-invalid={Boolean(codeError)}
            aria-describedby={codeError ? 'coupon-code-error' : undefined} />
          {codeError && <span id="coupon-code-error" role="alert" className="text-[11px] font-bold text-red-600">{codeError}</span>}
        </Field>
        <Field label="Country" hint={isGlobal ? 'Fixed once created.' : 'Your administrative country.'}>
          <select className={inputClass} value={draft.country} onChange={set('country')} disabled={editing || !isGlobal}>
            {Object.entries(COUNTRY_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Field>
        <Field label="Starts on" hint={`A day in ${COUNTRY_NAMES[draft.country] || 'the coupon country'}.`}>
          <input type="date" className={inputClass} required value={draft.starts} onChange={set('starts')} />
        </Field>
        <Field label="Expires on" hint="Valid through the end of this day.">
          <input type="date" className={inputClass} required min={draft.starts} value={draft.expires} onChange={set('expires')} />
        </Field>
        <Field label={`Fixed discount (${currency})`} hint="Taken off the plan price at checkout.">
          <input className={inputClass} required inputMode="decimal" pattern="\d+(\.\d+)?" value={draft.discount} onChange={set('discount')} />
        </Field>
      </div>
      {message && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{message}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={busy || Boolean(codeError)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create coupon'}
        </button>
      </div>
    </form>
  )
}

export function CouponsPage({ identity, Panel, useAsync }) {
  const canManage = canManageCoupons(identity)
  const { data, error, loading, reload } = useAsync(fetchCoupons, [])
  const view = couponViewState({ data, error, loading })
  const coupons = data?.coupons || []
  const [form, setForm] = useState(null)        // null | 'new' | coupon
  const [message, setMessage] = useState('')

  const toggle = async (coupon) => {
    setMessage('')
    try {
      await setCouponActive(coupon.id, !coupon.is_active)
      reload()
    } catch (failure) {
      setMessage(detailOf(failure, 'The coupon could not be changed.'))
    }
  }

  return (
    <Panel
      title={<><TicketPercent className="h-4 w-4 text-brand-600" /> Builder subscription coupons</>}
      subtitle={identity.scope === 'GLOBAL' ? 'India coupons.' : `Coupons for ${COUNTRY_NAMES[identity.scope] || identity.scope}.`}
      right={canManage && !form ? (
        <button type="button" onClick={() => setForm('new')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-xs font-bold text-white hover:bg-brand-700">
          <Plus className="h-3.5 w-3.5" /> New coupon
        </button>
      ) : null}
    >
      {form && (
        <CouponForm identity={identity} initial={form === 'new' ? null : form} onClose={() => setForm(null)}
          onSaved={() => { setForm(null); reload() }} />
      )}
      {message && <p role="alert" className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{message}</p>}
      {view === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-6 py-6">
          <p className="text-sm font-semibold text-red-600">{messageOf(error, 'Could not load coupons. Try again.')}</p>
          <button type="button" onClick={reload} className="h-9 rounded-lg border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50">
            Retry
          </button>
        </div>
      )}
      {view === 'loading' && <p className="px-6 py-6 text-sm font-semibold text-slate-400">Loading…</p>}
      {view === 'empty' && <p className="px-6 py-8 text-center text-sm font-semibold text-slate-500">No coupons yet.</p>}
      {view === 'list' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Code</th>
                <th className="px-3 py-3">Country</th>
                <th className="px-3 py-3">Discount</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Valid</th>
                <th className="px-3 py-3">Used</th>
                <th className="px-3 py-3">State</th>
                <th className="px-3 py-3">Changed by</th>
                {canManage && <th className="px-6 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td className="px-6 py-3 font-mono text-xs font-bold text-graphite">{coupon.code}</td>
                  <td className="px-3 py-3 text-slate-600">{COUNTRY_NAMES[coupon.country]}</td>
                  <td className="px-3 py-3 font-bold text-graphite">{coupon.discount_amount} {coupon.currency}</td>
                  <td className="px-3 py-3 text-slate-600">{offerLabel(coupon.plan_code, coupon.duration_code)}</td>
                  <td className="px-3 py-3 text-xs text-slate-600">{coupon.starts_on} → {coupon.expires_on}</td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    {coupon.redeemed_count}{coupon.max_redemptions ? ` / ${coupon.max_redemptions}` : ''}
                    {coupon.in_progress_count ? <span className="block text-[11px] text-slate-400">{coupon.in_progress_count} in checkout</span> : null}
                    {coupon.max_per_builder ? <span className="block text-[11px] text-slate-400">max {coupon.max_per_builder} per builder</span> : null}
                  </td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATE_TONES[coupon.state] || STATE_TONES.EXPIRED}`}>{coupon.state}</span></td>
                  <td className="px-3 py-3 text-[11px] text-slate-500">{coupon.updated_by || coupon.created_by || '—'}</td>
                  {canManage && (
                    <td className="px-6 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setForm(coupon)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={`Edit ${coupon.code}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => toggle(coupon)} className={`grid h-8 w-8 place-items-center rounded-lg border ${coupon.is_active ? 'border-red-200 text-red-600 hover:bg-red-50' : 'border-ocbrand-200 text-ocbrand-700 hover:bg-ocbrand-50'}`}
                          aria-label={coupon.is_active ? `Deactivate ${coupon.code}` : `Activate ${coupon.code}`} title={coupon.is_active ? 'Deactivate' : 'Activate'}>
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
