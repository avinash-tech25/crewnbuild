/**
 * Supplier -> Requests -> Purchase Requests: what buyers have bought from THIS
 * supplier with "Buy", shown the moment it arrives.
 *
 * Source: GET /supplier/material-requests -- the existing orders endpoint,
 * which the server limits to the signed-in supplier (supplier_id = them).
 * One Buy arrives as one row per product sharing a request_code; the rows are
 * grouped back into one purchase request here. Accept Order / Reject Order
 * decide the whole request at once (POST /supplier/purchase-requests/{code}/
 * respond): the server locks a decided request, and saves the status and the
 * notifications -- to the buyer ("Your order has been accepted. Your delivery
 * is on the way." / "Your order has been rejected by the supplier.") and the
 * supplier's own confirmation -- together. Fulfilment remains in Orders.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, MapPin, XCircle } from 'lucide-react'
import { fetchSupplierMaterialRequests, respondPurchaseRequest } from '../../shop/materialRequestsApi.js'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import useUrlDialog from '../../../shared/hooks/useUrlDialog.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import OrderList from '../../../shared/ui/OrderList.jsx'
import OrderDetailCard from '../../shop/components/OrderDetailCard.jsx'
import { isOrderCode } from './SupplierMaterialRequests.jsx'

const REFRESH_MS = 30000
const STATUS_STYLE = {
  PENDING: 'bg-oc-amber/25 text-graphite',
  ACCEPTED: 'bg-sky-100 text-sky-800',
  FULFILLED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-700',
}
const ROLE_LABEL = { OWNER: 'House Owner', ENGINEER: 'Site Engineer' }

/** One purchase request's overall status, from its lines. */
function requestStatus(lines) {
  const states = lines.map((line) => line.status)
  if (states.some((state) => state === 'PENDING')) return 'PENDING'
  if (states.every((state) => state === 'REJECTED')) return 'REJECTED'
  if (states.every((state) => state === 'FULFILLED')) return 'FULFILLED'
  return 'ACCEPTED'
}

/** Rows sharing a request_code are one purchase request. */
export function groupPurchaseRequests(rows = []) {
  const byCode = new Map()
  for (const row of rows) {
    const key = row.request_code || `row-${row.id}`
    if (!byCode.has(key)) byCode.set(key, [])
    byCode.get(key).push(row)
  }
  return [...byCode.entries()]
    .map(([code, lines]) => {
      const first = lines[0]
      return {
        code,
        lines,
        status: requestStatus(lines),
        buyer: first.engineer_name,
        buyerRole: first.engineer_role,
        project: first.project_name,
        pincode: first.project_pincode,
        city: first.project_city,
        createdAt: first.created_at,
        total: lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0), 0),
      }
    })
    .sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

/** How many purchase requests still wait for this supplier's answer. */
export const pendingPurchaseCount = (rows = []) => groupPurchaseRequests(rows).filter((request) => request.status === 'PENDING').length

export default function SupplierPurchaseRequests({ country, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { t } = useLanguage()
  // The open request is in the address (?order=<code>), so Back closes its dialog.
  const [openCode, showRequest, closeRequest] = useUrlDialog('order', isOrderCode)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ tone: '', text: '' })

  const load = useCallback(async () => {
    try {
      const list = await fetchSupplierMaterialRequests()
      setRows(list || [])
      setError('')
      onChanged?.(list || [])
    } catch (failure) {
      setError(failure.response?.data?.detail || 'Purchase requests could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [onChanged])

  // On open, and every 30 s while the list is on screen, so a new Buy shows up
  // without a reload.
  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])
  // A new Buy, or an answer to one, also shows at once through the same load.
  useLiveRefresh(load)

  const requests = useMemo(() => groupPurchaseRequests(rows), [rows])
  const open = requests.find((request) => request.code === openCode) || null

  const { requireCompleteProfile } = useProfileGate()

  // Decide the whole request in one call; the server saves the status and
  // notifies the buyer in the same transaction, or does neither. Accepting
  // needs a complete profile; rejecting does not.
  const respond = async (request, action) => {
    if (action === 'ACCEPT' && requireCompleteProfile('respondPurchaseRequest', { code: request.code, buyer: request.buyer, action })) return
    setBusy(true)
    setNotice({ tone: '', text: '' })
    try {
      await respondPurchaseRequest(request.code, action)
      setNotice({
        tone: 'success',
        text: `${action === 'ACCEPT' ? 'Order accepted successfully.' : 'Order rejected successfully.'} ${request.buyer || 'The buyer'} has been notified.`,
      })
    } catch (failure) {
      setNotice({ tone: 'error', text: failure.response?.data?.detail || 'The order could not be updated. Nothing was changed.' })
    }
    // The bell picks up the new confirmation straight away (a refresh hiccup
    // must never turn a saved decision into an error notice).
    try { window.dispatchEvent(new window.Event('crewnbuild_notifications_refresh')) } catch { /* bell polls anyway */ }
    await load()
    setBusy(false)
  }

  useResumeGatedAction({
    respondPurchaseRequest: ({ code, buyer, action }) => code && respond({ code, buyer }, action),
  })

  const notify = notice.text && (
    <p role="status" className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
  )
  const decisionButtons = (request, size = 'small') => request.status === 'PENDING' && (
    size === 'small' ? (
      <>
        <button type="button" disabled={busy} onClick={() => respond(request, 'ACCEPT')} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-brand-700 px-3 text-[11px] font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
          <CheckCircle2 className="h-3.5 w-3.5" /> Accept
        </button>
        <button type="button" disabled={busy} onClick={() => respond(request, 'REJECT')} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
          <XCircle className="h-3.5 w-3.5" /> Reject
        </button>
      </>
    ) : (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => respond(request, 'ACCEPT')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Accept Order
        </button>
        <button type="button" disabled={busy} onClick={() => respond(request, 'REJECT')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 text-sm font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
          <XCircle className="h-4 w-4" /> Reject Order
        </button>
      </div>
    )
  )

  const listRows = requests.map((request) => ({
    key: request.code,
    request,
    number: `#${String(request.code).replace(/^row-/, '').slice(0, 8).toUpperCase()}`,
    party: request.buyer || 'Buyer',
    project: request.project,
    date: request.createdAt,
    amount: request.total,
    status: request.status,
    searchText: [request.code, request.buyer, ROLE_LABEL[request.buyerRole], request.pincode, request.city].filter(Boolean).join(' '),
    items: request.lines.map((line) => ({ name: [line.material_name, line.brand, line.size].filter(Boolean).join(' · '), quantity: line.quantity, unit: line.unit })),
  }))

  return (
    <div className="space-y-3">
      {!open && notify}
      <OrderList
        label="Purchase requests"
        orders={listRows}
        partyLabel={t('dash.supplier.requester')}
        loading={loading}
        error={error}
        country={country}
        onOpen={(row) => showRequest(row.key)}
        actions={(row) => decisionButtons(row.request)}
        statusPill={(status) => STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}
        statusLabel={(status) => status}
        emptyTitle="No purchase requests yet"
        emptyHint="When a buyer clicks Buy on your products, the request appears here."
        searchPlaceholder={t('shop.searchOrders')}
      />
      {open && (
        <OrderDetailCard
          order={{ code: open.code, placedAt: open.createdAt, project: open.project, status: open.status, items: open.lines }}
          counterpartyLabel={`${t('shop.orderedBy')} · ${ROLE_LABEL[open.buyerRole] || open.buyerRole || ''}`.replace(/ · $/, '')}
          counterparty={open.buyer || 'Buyer'}
          extraFacts={[{ icon: MapPin, label: 'Delivery location', value: [open.pincode, open.city].filter(Boolean).join(', ') || '—' }]}
          onClose={() => { closeRequest(); setNotice({ tone: '', text: '' }) }}
          actions={(
            <div className="space-y-3">
              {notify}
              {open.status === 'PENDING' ? decisionButtons(open, 'large') : (
                <p className="text-xs font-semibold text-graphite/70">
                  {open.status === 'REJECTED' ? 'Order rejected. House Owner notified.' : `Order accepted. ${ROLE_LABEL[open.buyerRole] || 'Buyer'} notified. Fulfil accepted orders from Orders.`}
                </p>
              )}
            </div>
          )}
        />
      )}
    </div>
  )
}
