import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Printer, ReceiptText, RotateCw, X } from 'lucide-react'
import { Card, EmptyState } from '../../owner/components/OwnerPanels.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import {
  createPaymentOrder,
  fetchPaymentReceipt,
  fetchTechnicianBookingPayments,
  paymentErrorCode,
  paymentErrorMessage,
  reportPaymentFailure,
  simulateMockCheckout,
  verifyPayment,
} from '../technicianPaymentsApi.js'
import { loadRazorpayCheckout, openRazorpayCheckout } from '../razorpayCheckout.js'
import { formatReceiptDate, formatRupees, printReceipt, receiptRows } from '../receiptFormat.js'

const TEST_NOTICE = 'TEST PAYMENT — NO REAL MONEY TRANSFERRED'

/**
 * Technician bookings · Payments (House Owner dashboard).
 *
 * Only the signed-in House Owner's COMPLETED bookings are listed (the backend
 * decides which, and at what price). Pay opens a Razorpay TEST order; nothing is
 * paid until the backend has verified the signature and the payment. While the
 * backend has no TEST keys it answers with a local mock, shown as such.
 */
export default function TechnicianPaymentsSection() {
  const { t } = useLanguage()
  const [bookings, setBookings] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [messages, setMessages] = useState({})       // bookingId -> {tone, text}
  const [mockOrder, setMockOrder] = useState(null)    // order awaiting the simulated checkout
  const [receipt, setReceipt] = useState(null)

  const load = useCallback(() => {
    setLoadError('')
    fetchTechnicianBookingPayments()
      .then(setBookings)
      .catch((error) => {
        setBookings([])
        setLoadError(paymentErrorMessage(error, t('payments.loadFailed')))
      })
  }, [t])

  useEffect(() => { load() }, [load])

  // The technician completes the job on another phone, and the owner usually comes
  // back from Partner's tracking tab: refetch from the backend when this tab is seen
  // again, and every 15 s while it is open. Paused during a payment or an open dialog.
  const paused = Boolean(busyId || mockOrder || receipt)
  useEffect(() => {
    if (paused) return undefined
    const refresh = () => { if (document.visibilityState === 'visible') load() }
    const timer = window.setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [paused, load])

  const say = (bookingId, tone, text) => setMessages((current) => ({ ...current, [bookingId]: { tone, text } }))

  const finishVerified = async (bookingId, order, checkoutResult) => {
    try {
      const result = await verifyPayment({
        paymentOrderId: order.payment_order_id,
        razorpayOrderId: checkoutResult.razorpay_order_id,
        razorpayPaymentId: checkoutResult.razorpay_payment_id,
        razorpaySignature: checkoutResult.razorpay_signature,
      })
      say(bookingId, 'success', t('payments.success'))
      setReceipt(result.receipt)
    } catch (error) {
      say(bookingId, 'error', paymentErrorMessage(error, t('payments.failed')))
    } finally {
      setBusyId(null)
      load()
    }
  }

  const finishFailed = async (bookingId, order, failure) => {
    try {
      await reportPaymentFailure({
        paymentOrderId: order.payment_order_id, razorpayPaymentId: failure.paymentId,
        code: failure.code, description: failure.description,
      })
    } catch { /* recording a failure is best effort; it never marks anything paid */ }
    say(bookingId, 'error', t('payments.failed'))
    setBusyId(null)
    load()
  }

  const pay = async (booking) => {
    setBusyId(booking.booking_id)
    say(booking.booking_id, 'info', '')
    let order
    try {
      order = await createPaymentOrder(booking.booking_id)
    } catch (error) {
      if (paymentErrorCode(error) === 'BOOKING_ALREADY_PAID') load()
      say(booking.booking_id, 'error', paymentErrorMessage(error, t('payments.orderFailed')))
      setBusyId(null)
      return
    }
    if (order.gateway_mode === 'mock') {
      setMockOrder({ booking, order })
      return
    }
    if (!(await loadRazorpayCheckout())) {
      say(booking.booking_id, 'error', t('payments.checkoutUnavailable'))
      setBusyId(null)
      return
    }
    openRazorpayCheckout(order, {
      onSuccess: (result) => finishVerified(booking.booking_id, order, result),
      onFailure: (failure) => finishFailed(booking.booking_id, order, failure),
      onDismiss: () => {
        say(booking.booking_id, 'info', t('payments.closed'))
        setBusyId(null)
      },
    })
  }

  const simulate = async (outcome) => {
    const { booking, order } = mockOrder
    setMockOrder(null)
    if (outcome === 'cancel') {
      say(booking.booking_id, 'info', t('payments.closed'))
      setBusyId(null)
      return
    }
    try {
      const result = await simulateMockCheckout(order.payment_order_id, outcome)
      if (result.succeeded) {
        await finishVerified(booking.booking_id, order, result)
      } else {
        await finishFailed(booking.booking_id, order, {
          code: result.error_code, description: result.error_description, paymentId: result.razorpay_payment_id,
        })
      }
    } catch (error) {
      say(booking.booking_id, 'error', paymentErrorMessage(error, t('payments.failed')))
      setBusyId(null)
    }
  }

  const viewReceipt = async (booking) => {
    try {
      setReceipt(await fetchPaymentReceipt(booking.receipt_number))
    } catch (error) {
      say(booking.booking_id, 'error', paymentErrorMessage(error, t('payments.receiptFailed')))
    }
  }

  return (
    <Card
      id="technician-payments"
      title={t('payments.title')}
      icon={CreditCard}
      className="mt-6 h-auto"
      action={<span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-amber-800">{t('payments.testBadge')}</span>}
    >
      {loadError && <p className="mb-3 text-sm text-red-600">{loadError}</p>}
      {bookings === null ? (
        <p className="text-sm text-oc-muted">{t('payments.loading')}</p>
      ) : bookings.length === 0 ? (
        <EmptyState title={t('payments.emptyTitle')} message={t('payments.emptyMessage')} />
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const message = messages[booking.booking_id]
            const busy = busyId === booking.booking_id
            return (
              <div key={booking.booking_id} className="rounded-xl border border-oc-line p-4" data-testid="technician-payment-row">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-oc-muted">{t('payments.summary')} · {booking.booking_reference}</p>
                    <p className="mt-1 font-display text-sm font-bold text-oc-ink">
                      {t('payments.service')}: {booking.technician_role} → {booking.service_name || '—'}
                    </p>
                    <p className="text-xs text-oc-muted">
                      {booking.technician_name ? `${booking.technician_name} · ` : ''}{t('payments.completed')} {formatReceiptDate(booking.completed_at)}
                    </p>
                  </div>
                  {booking.payment_status === 'PAID' && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-extrabold text-emerald-700">{t('payments.paid')}</span>
                  )}
                  {booking.payment_status === 'NOT_PAYABLE' && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-extrabold text-slate-600">{t('payments.notPayable')}</span>
                  )}
                </div>

                {booking.payment_status !== 'NOT_PAYABLE' && (
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 border-t border-oc-line pt-3 text-sm">
                    <dt className="text-oc-muted">{t('payments.serviceAmount')}</dt>
                    <dd className="text-right font-semibold text-oc-ink">{formatRupees(booking.amount_paise)}</dd>
                    <dt className="font-bold text-oc-ink">{t('payments.total')}</dt>
                    <dd className="text-right font-display text-base font-extrabold text-oc-ink">{formatRupees(booking.amount_paise)}</dd>
                  </dl>
                )}
                {booking.payment_status === 'NOT_PAYABLE' && (
                  <p className="mt-3 text-xs text-oc-muted">{t('payments.notPayableHelp')}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {booking.payment_status === 'UNPAID' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pay(booking)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-4 text-sm font-extrabold text-white shadow-sm transition hover:bg-oc-deep disabled:opacity-60"
                    >
                      {message?.tone === 'error' ? <RotateCw className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                      {busy ? t('payments.processing')
                        : message?.tone === 'error' ? t('payments.retry')
                          : `${t('payments.pay')} ${formatRupees(booking.amount_paise)}`}
                    </button>
                  )}
                  {booking.payment_status === 'PAID' && (
                    <button type="button" onClick={() => viewReceipt(booking)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-oc-line px-3 text-sm font-bold text-oc-ink hover:border-oc-green">
                      <ReceiptText className="h-4 w-4" /> {t('payments.viewReceipt')}
                    </button>
                  )}
                </div>
                {message?.text && (
                  <p className={`mt-2 text-sm ${message.tone === 'error' ? 'text-red-600' : message.tone === 'success' ? 'text-emerald-700' : 'text-oc-muted'}`}>
                    {message.text}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mockOrder && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-700">{t('payments.mockTitle')}</p>
            <p className="mt-2 text-sm text-oc-ink">{t('payments.mockExplain')}</p>
            <p className="mt-3 font-display text-lg font-extrabold">{formatRupees(mockOrder.order.amount_paise)}</p>
            <p className="text-xs text-oc-muted">{mockOrder.order.service_name} · {mockOrder.order.booking_reference}</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => simulate('success')} className="h-9 rounded-lg bg-oc-green text-sm font-extrabold text-white">{t('payments.mockSuccess')}</button>
              <button type="button" onClick={() => simulate('failure')} className="h-9 rounded-lg border border-red-300 text-sm font-bold text-red-700">{t('payments.mockFailure')}</button>
              <button type="button" onClick={() => simulate('cancel')} className="h-9 rounded-lg text-sm font-bold text-oc-muted">{t('payments.mockCancel')}</button>
            </div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" data-testid="payment-receipt">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-display text-lg font-extrabold tracking-wide text-oc-ink">CREWNBUILD</p>
                <p className="text-xs font-bold uppercase tracking-wide text-oc-muted">{t('payments.receiptTitle')}</p>
              </div>
              <button type="button" onClick={() => setReceipt(null)} aria-label={t('payments.close')} className="rounded-lg p-1 text-oc-muted hover:text-oc-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <dl className="mt-4 divide-y divide-oc-line text-sm">
              {receiptRows(receipt).map(([label, value]) => (
                <div key={label} className="grid grid-cols-2 gap-2 py-1.5">
                  <dt className="text-oc-muted">{label}</dt>
                  <dd className="break-all text-right font-semibold text-oc-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-lg border-2 border-dashed border-amber-500 p-3 text-center text-xs font-extrabold tracking-wide text-amber-700">
              TEST MODE<br />{receipt.notice || TEST_NOTICE}
            </div>
            <button type="button" onClick={() => printReceipt(receipt)}
              className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-oc-green text-sm font-extrabold text-white hover:bg-oc-deep">
              <Printer className="h-4 w-4" /> {t('payments.printReceipt')}
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
