import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, CreditCard, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { activeLocale } from '../../../shared/utils/formatters.js'
import { formatRupees } from '../receiptFormat.js'
import {
  announceSubscriptionChange,
  createSubscriptionOrder,
  fetchSubscriptionPlans,
  reportSubscriptionFailure,
  simulateSubscriptionCheckout,
  validateSubscriptionCoupon,
  verifySubscriptionPayment,
} from '../subscriptionApi.js'
import { loadRazorpayCheckout, openSubscriptionCheckout } from './subscriptionCheckout.js'
import PlanCards from './PlanCards.jsx'
import PremiumBadge from './PremiumBadge.jsx'
import { clearPendingPlan, readPendingPlan } from './pendingPlan.js'
import { OFFERS, PAID_PLAN_BUTTON, offerNameKey, quoteForOffer, quoteMatchesOffer } from './subscriptionOffers.js'
import {
  durationKey, formatSubscriptionDate, isEndingSoon, paymentStatusKey, planAction, planNameKey, statusKey, subscriptionErrorMessage,
} from './subscriptionFormat.js'

// The builder's Plan & billing page. Everything shown comes from the server; a
// plan becomes active only after the server has verified the payment.
export default function BuilderSubscriptionPanel({ subscription }) {
  const { t } = useLanguage()
  const { status, loading, error, refresh } = subscription
  const [catalogue, setCatalogue] = useState(null)
  // The plan chosen on the landing page before signing up / in, if any. Only a
  // remembered choice: kept through a failed or cancelled payment so the builder
  // can retry, cleared only once a payment is verified or the builder dismisses it.
  const [pending, setPending] = useState(() => readPendingPlan())
  const [busyPlan, setBusyPlan] = useState('')       // "PLAN:DURATION" being paid
  const [notice, setNotice] = useState(null)        // {tone, text}
  const [mockOrder, setMockOrder] = useState(null)
  // Coupon: what the builder typed, and the SERVER's quote for it (original,
  // discount, payable, and which plan it is for). The quote is only shown; the
  // order sends just the code and the server prices it again.
  const [couponInput, setCouponInput] = useState('')
  const [couponQuote, setCouponQuote] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [couponBusy, setCouponBusy] = useState(false)
  const locale = activeLocale()
  // Every date on this page is India's date (as the backend and the expiry popup).
  const date = (iso) => formatSubscriptionDate(iso, locale)

  useEffect(() => {
    let live = true
    fetchSubscriptionPlans()
      .then((data) => { if (live) setCatalogue(data) })
      .catch((failure) => {
        if (!live) return
        setCatalogue({ plans: [] })
        setNotice({ tone: 'error', text: subscriptionErrorMessage(failure, t('subscription.plans.loadFailed')) })
      })
    return () => { live = false }
  }, [])

  const finish = async (tone, text) => {
    setBusyPlan('')
    setMockOrder(null)
    setNotice({ tone, text })
    await refresh()
    announceSubscriptionChange()
  }

  const verify = async (order, response) => {
    try {
      const result = await verifySubscriptionPayment({
        subscriptionPaymentId: order.subscription_payment_id,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      })
      clearPendingPlan()
      setPending(null)
      setCouponQuote(null)
      setCouponInput('')
      const active = result?.subscription
      await finish('success', active?.coverage_end
        ? t('subscription.panel.activatedUntil', { plan: t(offerNameKey(active.plan_code, active.current_period?.duration_code)), date: date(active.coverage_end) })
        : t('subscription.panel.activated'))
    } catch (failure) {
      await finish('error', subscriptionErrorMessage(failure, t('subscription.panel.failed')))
    }
  }

  const fail = async (order, details) => {
    try {
      await reportSubscriptionFailure({ subscriptionPaymentId: order.subscription_payment_id, ...details })
    } catch { /* informational only */ }
    await finish('error', t('subscription.panel.failed'))
  }

  const purchase = async (planCode, durationCode) => {
    setNotice(null)
    setBusyPlan(`${planCode}:${durationCode}`)
    let order
    try {
      // The coupon goes only with the plan it is for; the server re-validates it and
      // computes the amount, which is what Checkout is opened with (order.amount_paise).
      const code = quoteMatchesOffer(couponQuote, planCode, durationCode) ? couponQuote.code : null
      order = await createSubscriptionOrder(planCode, durationCode, code)
    } catch (failure) {
      setBusyPlan('')
      setNotice({ tone: 'error', text: subscriptionErrorMessage(failure, t('subscription.panel.failed')) })
      return
    }
    if (order.gateway_mode === 'mock') {
      setMockOrder(order)
      return
    }
    const loaded = await loadRazorpayCheckout()
    if (!loaded) {
      setBusyPlan('')
      setNotice({ tone: 'error', text: t('subscription.panel.checkoutUnavailable') })
      return
    }
    openSubscriptionCheckout(order, {
      description: `${t(offerNameKey(order.plan_code, order.duration_code))} · ${t(durationKey(order.duration_code))}`,
      onSuccess: (response) => verify(order, response),
      onFailure: ({ code, description, paymentId }) => fail(order, { code, description, razorpayPaymentId: paymentId }),
      onDismiss: () => finish('info', t('subscription.panel.cancelled')),
    })
  }

  const simulate = async (outcome) => {
    const order = mockOrder
    if (outcome === 'cancel') { await finish('info', t('subscription.panel.cancelled')); return }
    try {
      const result = await simulateSubscriptionCheckout(order.subscription_payment_id, outcome)
      if (outcome === 'success') await verify(order, result)
      else await fail(order, { code: result.error_code, description: result.error_description, razorpayPaymentId: result.razorpay_payment_id })
    } catch (failure) {
      await finish('error', subscriptionErrorMessage(failure, t('subscription.panel.failed')))
    }
  }

  const tones = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-slate-200 bg-slate-50 text-slate-700',
  }
  const inForce = status && ['ACTIVE', 'GRACE'].includes(status.status)
  const current = status?.current_period
  const pendingPlan = pending && catalogue?.plans?.find((plan) => plan.code === pending.planCode)
  const pendingPrice = pendingPlan?.prices?.[pending.durationCode]
  const pendingAction = pendingPlan ? planAction(pendingPlan.code, status, pendingPrice) : null
  const dismissPending = () => { clearPendingPlan(); setPending(null) }

  const applyCoupon = async (event) => {
    event.preventDefault()
    if (!couponInput.trim()) return
    setCouponBusy(true)
    setCouponError('')
    try {
      setCouponQuote(await validateSubscriptionCoupon(couponInput.trim()))
    } catch (failure) {
      setCouponQuote(null)
      setCouponError(subscriptionErrorMessage(failure, t('subscription.coupon.invalid')))
    } finally {
      setCouponBusy(false)
    }
  }
  const removeCoupon = () => { setCouponQuote(null); setCouponInput(''); setCouponError('') }
  // The offers the applied coupon covers, by name ("Professional Pro Monthly, Premium Annual").
  const quoteOffers = OFFERS.filter((offer) => quoteMatchesOffer(couponQuote, offer.planCode, offer.durationCode))

  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden="true"><CreditCard className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-slate-950">{t('subscription.panel.title')}</h2>
            <p className="text-xs font-semibold text-slate-500">{t('payments.testBadge')} · {t('subscription.plans.testMode')}</p>
          </div>
          <PremiumBadge status={status} />
          <button type="button" onClick={refresh} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={t('subscription.panel.refresh')}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && !status && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{subscriptionErrorMessage(error, t('subscription.panel.loadFailed'))}</p>}

        {status && (
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{t('subscription.panel.currentPlan')}</p>
              <p className="mt-1 text-base font-extrabold text-slate-950">{t(inForce ? offerNameKey(status.plan_code, current?.duration_code) : planNameKey('FREE'))}</p>
              <p className={`mt-1 text-xs font-extrabold ${inForce ? 'text-emerald-700' : status.status === 'EXPIRED' ? 'text-rose-700' : 'text-slate-500'}`}>{t(statusKey(status.status))}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{t('subscription.panel.billingPeriod')}</p>
              <p className="mt-1 text-base font-extrabold text-slate-950">{current ? t(durationKey(current.duration_code)) : '—'}</p>
              {current && <p className="mt-1 text-xs font-semibold text-slate-500">{t('subscription.panel.started', { date: date(current.period_start) })}</p>}
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{t('subscription.panel.validity')}</p>
              <p className="mt-1 flex items-center gap-1.5 text-base font-extrabold text-slate-950">
                <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                {status.status === 'EXPIRED' ? t('subscription.panel.expiredOn', { date: date(status.coverage_end) })
                  : inForce ? t('subscription.panel.validUntil', { date: date(status.coverage_end) }) : '—'}
              </p>
              {status.status === 'GRACE' && <p className="mt-1 text-xs font-semibold text-amber-700">{t('subscription.panel.graceUntil', { date: date(status.grace_until) })}</p>}
              {(status.queued_periods || []).map((period) => (
                <p key={period.id} className="mt-1 text-xs font-semibold text-slate-500">{t('subscription.panel.renewalQueued', { date: date(period.period_start) })}</p>
              ))}
            </div>
          </div>
        )}

        {status?.status === 'EXPIRED' && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('subscription.panel.expiredMessage')}
          </p>
        )}
        {isEndingSoon(status) && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t('subscription.panel.expiringSoon', { date: date(status.coverage_end) })}
          </p>
        )}
        {notice && <p role="status" className={`mt-4 rounded-xl border px-4 py-3 text-sm font-bold ${tones[notice.tone]}`}>{notice.text}</p>}
      </section>

      {pendingPlan && status && (
        // The plan chosen before signing up: offered as the next step, never applied
        // on its own. Paying is one more click, and the server decides the amount.
        <section className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/60 p-5 shadow-sm">
          <p className="text-sm font-extrabold text-emerald-900">{t('subscription.pending.title')}</p>
          <p className="mt-1 text-sm font-semibold text-emerald-900">
            {t('subscription.pending.body', {
              plan: t(offerNameKey(pendingPlan.code, pending.durationCode)),
              duration: t(durationKey(pending.durationCode)),
              price: pendingPrice ? formatRupees(pendingPrice) : t('subscription.price.notSet'),
            })}
          </p>
          {pendingAction === 'unavailable' && (
            <p className="mt-2 text-xs font-bold text-slate-700">
              {status.region_supported === false ? t('subscription.panel.regionUnavailable') : t('subscription.cta.unavailable')}
            </p>
          )}
          {pendingAction === 'blocked' && <p className="mt-2 text-xs font-bold text-slate-700">{t('subscription.panel.changeRestriction')}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {(pendingAction === 'choose' || pendingAction === 'renew') && (
              <button type="button" disabled={Boolean(busyPlan)} onClick={() => purchase(pendingPlan.code, pending.durationCode)}
                className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-5 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:opacity-60">
                {busyPlan ? t('subscription.panel.processing') : t('subscription.pending.continue')}
              </button>
            )}
            <button type="button" onClick={dismissPending} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
              {t('subscription.pending.dismiss')}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-extrabold text-slate-950">{t('subscription.panel.choosePlan')}</h3>
        {status?.region_supported === false && (
          <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{t('subscription.panel.regionUnavailable')}</p>
        )}
        <p className="mt-3 text-xs font-semibold text-slate-600">{t('subscription.panel.activationNote')}</p>
        {inForce && <p className="mt-2 text-xs font-bold text-slate-600">{t('subscription.panel.changeRestriction')}</p>}
        {status?.region_supported !== false && (
          <form onSubmit={applyCoupon} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
            <label className="grid min-w-[min(100%,12rem)] flex-1 grid-cols-1 gap-1 text-xs font-bold text-slate-600">
              <span>{t('subscription.coupon.label')}</span>
              <input value={couponInput} onChange={(event) => setCouponInput(event.target.value)} maxLength={60}
                placeholder={t('subscription.coupon.placeholder')} disabled={Boolean(couponQuote)}
                className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold uppercase tracking-wide outline-none focus:border-emerald-500 disabled:bg-slate-100" />
            </label>
            {couponQuote ? (
              <button type="button" onClick={removeCoupon} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                {t('subscription.coupon.remove')}
              </button>
            ) : (
              <button type="submit" disabled={couponBusy || !couponInput.trim()} className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {couponBusy ? t('subscription.coupon.checking') : t('subscription.coupon.apply')}
              </button>
            )}
            {couponError && <p role="alert" className="w-full text-xs font-bold text-rose-700">{couponError}</p>}
            {couponQuote && quoteOffers.length > 0 && (
              <p role="status" className="w-full text-xs font-bold text-emerald-800">
                {t('subscription.coupon.applied', { code: couponQuote.code, plan: quoteOffers.map((offer) => t(`subscription.offer.${offer.id}.name`)).join(', ') })}
              </p>
            )}
          </form>
        )}
        <div className="mt-4">
          {!catalogue ? <p className="text-sm font-bold text-slate-400">{t('subscription.panel.loading')}</p> : (
            <PlanCards
              catalogue={catalogue}
              status={status}
              renderFreeAction={() => <p className="rounded-lg bg-slate-50 py-3 text-center text-xs font-bold text-slate-500">{t('subscription.included')}</p>}
              renderAction={(offer, action) => {
                const key = `${offer.planCode}:${offer.durationCode}`
                const name = t(`subscription.offer.${offer.id}.name`)
                const disabled = action === 'unavailable' || action === 'blocked' || Boolean(busyPlan)
                const label = busyPlan === key ? t('subscription.panel.processing')
                  : action === 'renew' ? t('subscription.cta.renewOption', { duration: name })
                    : action === 'blocked' ? t('subscription.cta.afterCurrent')
                      : action === 'unavailable' ? t('subscription.cta.unavailable')
                        : t('subscription.cta.chooseNamed', { plan: name })
                const coupon = quoteForOffer(couponQuote, offer.planCode, offer.durationCode)
                return (
                  <div className="grid gap-2">
                    {coupon && (
                      // The server's figures for this plan with the applied coupon.
                      <dl className="grid gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                        <div className="flex justify-between"><dt className="font-semibold text-slate-600">{t('subscription.coupon.original')}</dt><dd className="font-bold text-slate-500 line-through">{formatRupees(coupon.original_amount_paise)}</dd></div>
                        <div className="flex justify-between"><dt className="font-semibold text-slate-600">{t('subscription.coupon.discount')} ({coupon.code})</dt><dd className="font-bold text-emerald-700">− {formatRupees(coupon.discount_paise)}</dd></div>
                        <div className="flex justify-between border-t border-emerald-200 pt-1"><dt className="font-extrabold text-slate-900">{t('subscription.coupon.final')}</dt><dd className="text-sm font-extrabold text-slate-950">{formatRupees(coupon.final_amount_paise)}</dd></div>
                      </dl>
                    )}
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => purchase(offer.planCode, offer.durationCode)}
                      className={`inline-flex h-11 w-full items-center justify-center rounded-lg px-2 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 ${PAID_PLAN_BUTTON}`}
                    >
                      {label}
                    </button>
                  </div>
                )
              }}
            />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-extrabold text-slate-950">{t('subscription.panel.history')}</h3>
        {!status?.history?.length ? <p className="mt-3 text-sm font-semibold text-slate-500">{t('subscription.panel.noHistory')}</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pe-3">{t('subscription.panel.currentPlan')}</th>
                  <th className="py-2 pe-3">{t('subscription.panel.billingPeriod')}</th>
                  <th className="py-2 pe-3">{t('subscription.panel.validity')}</th>
                  <th className="py-2 pe-3">{t('subscription.panel.amount')}</th>
                  <th className="py-2">{t('subscription.panel.paymentStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {status.history.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pe-3 font-bold text-slate-900">{t(offerNameKey(row.plan_code, row.duration_code))}</td>
                    <td className="py-2 pe-3 text-slate-600">{t(durationKey(row.duration_code))}</td>
                    <td className="py-2 pe-3 text-slate-600">{date(row.period_start)} – {date(row.period_end)}</td>
                    <td className="py-2 pe-3 text-slate-900">{formatRupees(row.amount_paise)}</td>
                    <td className="py-2 text-slate-600">{t(paymentStatusKey(row.status === 'REVOKED' ? 'REFUNDED' : row.payment_status))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {mockOrder && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">{t('payments.mockTitle')}</p>
            <p className="mt-2 text-sm text-slate-700">{t('payments.mockExplain')}</p>
            <p className="mt-3 text-lg font-extrabold">{formatRupees(mockOrder.amount_paise)}</p>
            <p className="text-xs text-slate-500">{t(offerNameKey(mockOrder.plan_code, mockOrder.duration_code))} · {t(durationKey(mockOrder.duration_code))}</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => simulate('success')} className="h-9 rounded-lg bg-emerald-600 text-sm font-extrabold text-white">{t('payments.mockSuccess')}</button>
              <button type="button" onClick={() => simulate('failure')} className="h-9 rounded-lg border border-red-300 text-sm font-bold text-red-700">{t('payments.mockFailure')}</button>
              <button type="button" onClick={() => simulate('cancel')} className="h-9 rounded-lg text-sm font-bold text-slate-500">{t('payments.mockCancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
