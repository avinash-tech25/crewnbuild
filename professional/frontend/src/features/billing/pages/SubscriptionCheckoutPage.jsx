/**
 * Plan checkout for a builder who signed up for Professional Pro or Premium:
 * Sign up -> verify e-mail -> PIN code -> THIS PAGE -> dashboard.
 *
 * Every figure is the server's: the plan price (GET /subscriptions/plans), the
 * coupon quote for the selected plan (POST /subscriptions/coupons/validate) and
 * the amount Checkout opens with (POST /subscriptions/orders). The plan becomes
 * active only when the server verifies the payment; until then the server
 * refuses the dashboard's routes, so leaving this page opens nothing.
 *
 * A refresh, another tab or a closed Checkout lands back here. The last order is
 * remembered in this browser only so that a payment completed while the page was
 * closed can be recovered (POST /subscriptions/orders/{id}/reconcile), which asks
 * Razorpay and never charges again.
 */
import { useCallback, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Navigate, useNavigate } from 'react-router-dom'
import { CreditCard, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatRupees } from '../receiptFormat.js'
import { setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { verifySession } from '../../auth/authApi.js'
import { postAuthPath, subscriptionCheckoutPending } from '../../../shared/auth/accountPaths.js'
import {
  announceSubscriptionChange, changeSignupPlan, createSubscriptionOrder, fetchSubscriptionPlans, reconcileSubscriptionOrder,
  reportSubscriptionFailure, simulateSubscriptionCheckout, validateSubscriptionCoupon, verifySubscriptionPayment,
} from '../subscriptionApi.js'
import { loadRazorpayCheckout, openSubscriptionCheckout } from '../subscription/subscriptionCheckout.js'
import { clearPendingPlan } from '../subscription/pendingPlan.js'
import { findOffer, offerPrice } from '../subscription/subscriptionOffers.js'
import { checkoutOffers } from '../subscription/signupPlanFlow.js'
import { durationKey, subscriptionErrorMessage } from '../subscription/subscriptionFormat.js'

const LAST_ORDER_KEY = 'crewnbuild_checkout_order'
const readLastOrder = () => { try { return window.localStorage.getItem(LAST_ORDER_KEY) } catch { return null } }
const rememberOrder = (id) => { try { window.localStorage.setItem(LAST_ORDER_KEY, id) } catch { /* storage unavailable */ } }
const forgetOrder = () => { try { window.localStorage.removeItem(LAST_ORDER_KEY) } catch { /* storage unavailable */ } }

export default function SubscriptionCheckoutPage() {
  const { t } = useLanguage()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { user } = useSelector((state) => state.auth)
  const pending = user?.subscription_checkout
  const offer = pending ? findOffer(pending.plan_code, pending.duration_code) : null
  const [catalogue, setCatalogue] = useState(null)
  const [couponInput, setCouponInput] = useState('')
  const [quote, setQuote] = useState(null)
  const [couponError, setCouponError] = useState('')
  const [busy, setBusy] = useState('')            // '' | 'coupon' | 'plan' | 'pay' | 'recover'
  const [notice, setNotice] = useState(null)
  const [mockOrder, setMockOrder] = useState(null)

  // The server's account (and so its subscription_checkout) after anything that may change it.
  const refreshAccount = useCallback(async () => {
    const session = await verifySession()
    dispatch(setAuthenticatedUser({ user: session.user }))
    return session.user
  }, [dispatch])

  const finish = useCallback(async () => {
    forgetOrder()
    clearPendingPlan()
    announceSubscriptionChange()
    const account = await refreshAccount()
    navigate(postAuthPath(account), { replace: true })
  }, [navigate, refreshAccount])

  useEffect(() => {
    fetchSubscriptionPlans().then(setCatalogue).catch(() => setCatalogue({ plans: [] }))
  }, [])

  // Back after a closed browser / another tab: recover a payment already made.
  useEffect(() => {
    const lastOrder = readLastOrder()
    if (!lastOrder || !pending) return
    setBusy('recover')
    reconcileSubscriptionOrder(lastOrder)
      .then((result) => (result.status === 'ACTIVATED' ? finish() : forgetOrder()))
      .catch(() => { /* nothing to recover now; paying again is safe */ })
      .finally(() => setBusy(''))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!subscriptionCheckoutPending(user)) return <Navigate to={postAuthPath(user)} replace />

  const price = offer && catalogue ? offerPrice(catalogue, offer) : null
  const planName = offer ? t(`subscription.offer.${offer.id}.name`) : ''

  const switchPlan = async (next) => {
    if (busy || (next && next.id === offer?.id)) return
    setBusy('plan'); setNotice(null)
    try {
      if (next) await changeSignupPlan(next.planCode, next.durationCode)
      else await changeSignupPlan('FREE')
      setQuote(null); setCouponError('')
      const account = await refreshAccount()
      if (!next) { clearPendingPlan(); navigate(postAuthPath(account), { replace: true }) }
    } catch (failure) {
      setNotice({ tone: 'error', text: subscriptionErrorMessage(failure, t('subscription.panel.failed')) })
    } finally { setBusy('') }
  }

  const applyCoupon = async (event) => {
    event.preventDefault()
    if (!couponInput.trim() || !offer) return
    setBusy('coupon'); setCouponError('')
    try {
      setQuote(await validateSubscriptionCoupon(couponInput.trim(), offer.planCode, offer.durationCode))
    } catch (failure) {
      setQuote(null)
      setCouponError(subscriptionErrorMessage(failure, t('subscription.coupon.invalid')))
    } finally { setBusy('') }
  }
  const removeCoupon = () => { setQuote(null); setCouponInput(''); setCouponError('') }

  const verify = async (order, response) => {
    try {
      await verifySubscriptionPayment({
        subscriptionPaymentId: order.subscription_payment_id, razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature,
      })
      await finish()
    } catch (failure) {
      setBusy('')
      setNotice({ tone: 'error', text: subscriptionErrorMessage(failure, t('subscription.panel.failed')) })
    }
  }

  const fail = async (order, details) => {
    try { await reportSubscriptionFailure({ subscriptionPaymentId: order.subscription_payment_id, ...details }) } catch { /* informational */ }
    forgetOrder()
    setBusy('')
    setNotice({ tone: 'error', text: t('subscription.panel.failed') })
  }

  const pay = async () => {
    setBusy('pay'); setNotice(null)
    let order
    try {
      order = await createSubscriptionOrder(offer.planCode, offer.durationCode, quote?.code || null)
    } catch (failure) {
      setBusy('')
      setNotice({ tone: 'error', text: subscriptionErrorMessage(failure, t('subscription.panel.failed')) })
      return
    }
    rememberOrder(order.subscription_payment_id)
    if (order.gateway_mode === 'mock') { setMockOrder(order); return }
    if (!(await loadRazorpayCheckout())) {
      setBusy('')
      setNotice({ tone: 'error', text: t('subscription.panel.checkoutUnavailable') })
      return
    }
    openSubscriptionCheckout(order, {
      description: `${planName} · ${t(durationKey(order.duration_code))}`,
      onSuccess: (response) => verify(order, response),
      onFailure: ({ code, description, paymentId }) => fail(order, { code, description, razorpayPaymentId: paymentId }),
      onDismiss: () => { setBusy(''); setNotice({ tone: 'info', text: t('subscription.panel.cancelled') }) },
    })
  }

  const simulate = async (outcome) => {
    const order = mockOrder
    setMockOrder(null)
    if (outcome === 'cancel') { setBusy(''); setNotice({ tone: 'info', text: t('subscription.panel.cancelled') }); return }
    try {
      const result = await simulateSubscriptionCheckout(order.subscription_payment_id, outcome)
      if (outcome === 'success') await verify(order, result)
      else await fail(order, { code: result.error_code, description: result.error_description, razorpayPaymentId: result.razorpay_payment_id })
    } catch (failure) {
      setBusy('')
      setNotice({ tone: 'error', text: subscriptionErrorMessage(failure, t('subscription.panel.failed')) })
    }
  }

  const tones = { error: 'border-rose-200 bg-rose-50 text-rose-800', info: 'border-slate-200 bg-slate-50 text-slate-700' }
  const original = quote ? quote.original_amount_paise : price
  const discount = quote ? quote.discount_paise : 0
  const payable = quote ? quote.final_amount_paise : price

  return (
    <main className="min-h-screen bg-oc-sunken px-4 py-10">
      <div className="mx-auto grid max-w-xl gap-5">
        <header>
          <p className="text-xs font-extrabold uppercase tracking-wide text-emerald-700">{t('subscription.price.testBadge')}</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">{t('subscription.checkout.title')}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-600">{t('subscription.checkout.subtitle')}</p>
        </header>

        {busy === 'recover' && <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">{t('subscription.checkout.checking')}</p>}
        {notice && <p role="alert" className={`rounded-xl border px-4 py-3 text-sm font-bold ${tones[notice.tone]}`}>{notice.text}</p>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-950">{t('subscription.checkout.plan')}</h2>
          {/* Only the plan chosen at sign-up: this page confirms that purchase, it does
              not offer the other paid plan. "Continue with Free" below stays the way out. */}
          <div className="mt-3 grid gap-2">
            {checkoutOffers(pending).map((item) => (
              <div key={item.id} className="rounded-xl border border-emerald-500 bg-emerald-50 p-3 ring-1 ring-emerald-500">
                <span className="block text-sm font-extrabold text-slate-950">{t(`subscription.offer.${item.id}.name`)}</span>
                <span className="block text-xs font-semibold text-slate-600">
                  {t(durationKey(item.durationCode))} · {catalogue && offerPrice(catalogue, item) !== null ? formatRupees(offerPrice(catalogue, item)) : '—'}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-600">
            {t('subscription.checkout.billing')}: <span className="font-extrabold text-slate-900">{offer ? t(durationKey(offer.durationCode)) : '—'}</span>
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <form onSubmit={applyCoupon} className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[12rem] flex-1 gap-1 text-xs font-bold text-slate-600">
              <span>{t('subscription.coupon.label')}</span>
              <input value={couponInput} onChange={(event) => setCouponInput(event.target.value)} maxLength={60} disabled={Boolean(quote)}
                placeholder={t('subscription.coupon.placeholder')}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold uppercase tracking-wide outline-none focus:border-emerald-500 disabled:bg-slate-100" />
            </label>
            {quote ? (
              <button type="button" onClick={removeCoupon} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                {t('subscription.coupon.remove')}
              </button>
            ) : (
              <button type="submit" disabled={Boolean(busy) || !couponInput.trim()} className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                {busy === 'coupon' ? t('subscription.coupon.checking') : t('subscription.coupon.apply')}
              </button>
            )}
            {couponError && <p role="alert" className="w-full text-xs font-bold text-rose-700">{couponError}</p>}
          </form>

          <dl className="mt-4 grid gap-1.5 text-sm">
            <div className="flex justify-between"><dt className="font-semibold text-slate-600">{t('subscription.coupon.original')}</dt>
              <dd className={`font-bold ${discount ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{original !== null && original !== undefined ? formatRupees(original) : '—'}</dd></div>
            {discount > 0 && (
              <div className="flex justify-between"><dt className="font-semibold text-slate-600">{t('subscription.coupon.discount')} ({quote.code})</dt>
                <dd className="font-bold text-emerald-700">− {formatRupees(discount)}</dd></div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2"><dt className="font-extrabold text-slate-900">{t('subscription.coupon.final')}</dt>
              <dd className="text-lg font-extrabold text-slate-950">{payable !== null && payable !== undefined ? formatRupees(payable) : '—'}</dd></div>
          </dl>
          {catalogue && price === null && <p role="alert" className="mt-3 text-xs font-bold text-rose-700">{t('subscription.checkout.priceUnavailable')}</p>}

          <button type="button" onClick={pay} disabled={Boolean(busy) || price === null || !catalogue}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            {busy === 'pay' ? t('subscription.panel.processing') : t('subscription.checkout.proceed')}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('subscription.panel.activationNote')}
          </p>
        </section>

        <button type="button" onClick={() => switchPlan(null)} disabled={Boolean(busy)} className="justify-self-center text-xs font-bold text-slate-600 underline-offset-2 hover:underline disabled:opacity-50">
          {t('subscription.checkout.continueFree')}
        </button>
      </div>

      {mockOrder && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">{t('payments.mockTitle')}</p>
            <p className="mt-2 text-sm text-slate-700">{t('payments.mockExplain')}</p>
            <p className="mt-3 text-lg font-extrabold">{formatRupees(mockOrder.amount_paise)}</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => simulate('success')} className="h-9 rounded-lg bg-emerald-600 text-sm font-extrabold text-white">{t('payments.mockSuccess')}</button>
              <button type="button" onClick={() => simulate('failure')} className="h-9 rounded-lg border border-red-300 text-sm font-bold text-red-700">{t('payments.mockFailure')}</button>
              <button type="button" onClick={() => simulate('cancel')} className="h-9 rounded-lg text-sm font-bold text-slate-500">{t('payments.mockCancel')}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
