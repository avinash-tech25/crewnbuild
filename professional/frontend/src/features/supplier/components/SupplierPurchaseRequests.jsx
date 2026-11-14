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
import { ArrowLeft, CheckCircle2, ImageOff, Loader2, MapPin, PackageOpen, XCircle } from 'lucide-react'
import { fetchSupplierMaterialRequests, respondPurchaseRequest } from '../../shop/materialRequestsApi.js'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { formatMoney } from '../../../shared/utils/countryConfig.js'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { DataTable, tdClass, thClass } from '../../store/components/StoreUi.jsx'

const REFRESH_MS = 30000
const STATUS_STYLE = {
  PENDING: 'bg-oc-amber/25 text-graphite',
  ACCEPTED: 'bg-sky-100 text-sky-800',
  FULFILLED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-700',
}
const ROLE_LABEL = { OWNER: 'House Owner', ENGINEER: 'Site Engineer', STORE_MANAGER: 'Store Manager' }

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
        // A builder's Store Manager buys for the store: named as such, not as a Site Engineer.
        buyerRole: first.buyer_is_store_manager ? 'STORE_MANAGER' : first.engineer_role,
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

const when = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function LineImage({ src }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-300"><ImageOff className="h-5 w-5" /></span>
  return <img src={imageUrl(src)} alt="" onError={() => setBroken(true)} className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1" />
}

function ProductLines({ lines, country, detailed = false }) {
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((line) => {
        const subtotal = Number(line.price || 0) * Number(line.quantity || 0)
        return (
          <li key={line.id} className="flex items-center gap-3 py-2.5">
            {detailed && <LineImage src={line.image_url} />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-graphite">{line.material_name}</p>
              <p className="truncate text-[11px] font-semibold text-graphite/55">
                {[line.brand, line.subcategory_name, line.size].filter(Boolean).join(' · ')}
              </p>
              <p className="text-xs font-bold text-graphite/70">
                Qty {Number(line.quantity).toLocaleString('en-IN')} {line.unit} × {formatMoney(line.price, country)}{line.unit ? ` / ${line.unit}` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-extrabold text-graphite">{formatMoney(subtotal, country)}</p>
              {detailed && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-extrabold ${STATUS_STYLE[line.status] || 'bg-slate-100 text-slate-600'}`}>{line.status}</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function SupplierPurchaseRequests({ country, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openCode, setOpenCode] = useState(null)
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

  if (loading) {
    return <p className="flex items-center gap-2 py-8 text-sm font-semibold text-graphite/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading purchase requests…</p>
  }
  if (error) return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>

  // ---- one request, in full
  if (open) {
    return (
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <button type="button" onClick={() => { setOpenCode(null); setNotice({ tone: '', text: '' }) }} className="inline-flex items-center gap-1.5 text-xs font-extrabold text-brand-800 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> All purchase requests
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-graphite/45">Purchase request {open.code.slice(0, 8).toUpperCase()}</p>
            <h3 className="font-display text-lg font-extrabold text-graphite">{open.buyer || 'Buyer'}</h3>
            <p className="text-xs font-semibold text-graphite/60">{ROLE_LABEL[open.buyerRole] || open.buyerRole}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${STATUS_STYLE[open.status]}`}>{open.status}</span>
        </div>
        <dl className="grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div><dt className="text-[11px] font-bold text-graphite/50">Project</dt><dd className="font-extrabold text-graphite">{open.project || '—'}</dd></div>
          <div><dt className="text-[11px] font-bold text-graphite/50">Delivery location</dt><dd className="flex items-center gap-1 font-extrabold text-graphite"><MapPin className="h-3.5 w-3.5 text-brand-700" />{[open.pincode, open.city].filter(Boolean).join(', ') || '—'}</dd></div>
          <div><dt className="text-[11px] font-bold text-graphite/50">Requested</dt><dd className="font-extrabold text-graphite">{when(open.createdAt)}</dd></div>
        </dl>
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-graphite/45">Products</p>
          <ProductLines lines={open.lines} country={country} detailed />
          <div className="flex items-center justify-between border-t border-slate-200 pt-3">
            <span className="text-sm font-bold text-graphite/60">Total</span>
            <span className="font-display text-xl font-extrabold text-graphite">{formatMoney(open.total, country)}</span>
          </div>
        </div>
        {notice.text && (
          <p className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
        )}
        {open.status === 'PENDING' ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => respond(open, 'ACCEPT')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Accept Order
            </button>
            <button type="button" disabled={busy} onClick={() => respond(open, 'REJECT')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-5 text-sm font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
              <XCircle className="h-4 w-4" /> Reject Order
            </button>
          </div>
        ) : (
          <p className="text-xs font-semibold text-graphite/55">
            {open.status === 'REJECTED' ? 'Order rejected. House Owner notified.' : `Order accepted. ${ROLE_LABEL[open.buyerRole] || 'Buyer'} notified. Fulfil accepted orders from Orders.`}
          </p>
        )}
      </section>
    )
  }

  // ---- the list
  if (!requests.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
        <PackageOpen className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-2 text-sm font-extrabold text-graphite">No purchase requests yet</p>
        <p className="mt-1 text-xs text-graphite/55">When a buyer clicks Buy on your products, the request appears here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
    {notice.text && (
      <p className={`rounded-xl px-3 py-2 text-xs font-bold ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>{notice.text}</p>
    )}
    {/* One aligned row per request, in the Store Manager Requests table. A
        pending request keeps its amber accent and its Accept / Reject. */}
    <DataTable
      minWidth="min-w-[1360px]"
      head={['Request ID', 'Request Date', 'Requester', 'Requester Role', 'Project', 'Requested Products', 'Quantity', 'Total Amount', 'Delivery Location', 'Status', 'Action'].map((label) => (
        <th key={label} className={`${thClass} ${label === 'Action' ? 'text-end' : 'text-start'}`}>{label}</th>
      ))}
    >
      {requests.map((request) => (
        <tr key={request.code} className={request.status === 'PENDING' ? 'bg-oc-amber/10' : ''}>
          <td className={`${tdClass} whitespace-nowrap font-extrabold text-graphite`}>
            <span className="inline-flex items-center gap-1.5">
              {request.status === 'PENDING' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-oc-amber" aria-label="New" />}
              {request.code.slice(0, 8).toUpperCase()}
            </span>
          </td>
          <td className={`${tdClass} min-w-[110px]`}>{when(request.createdAt)}</td>
          <td className={`${tdClass} min-w-[140px] font-extrabold text-graphite`}>{request.buyer || 'Buyer'}</td>
          <td className={`${tdClass} whitespace-nowrap`}>{ROLE_LABEL[request.buyerRole] || request.buyerRole || '—'}</td>
          <td className={tdClass}>{request.project || '—'}</td>
          <td className={`${tdClass} min-w-[200px]`}>
            {request.lines.map((line) => (
              <span key={line.id} className="block leading-5">
                <span className="font-bold text-graphite">{line.material_name}</span>
                {(line.brand || line.size) && <span className="whitespace-nowrap text-graphite/55"> · {[line.brand, line.size].filter(Boolean).join(' · ')}</span>}
              </span>
            ))}
          </td>
          <td className={`${tdClass} whitespace-nowrap`}>
            {request.lines.map((line) => (
              <span key={line.id} className="block leading-5">{Number(line.quantity).toLocaleString('en-IN')} {line.unit}</span>
            ))}
          </td>
          <td className={`${tdClass} whitespace-nowrap font-extrabold text-graphite`}>{formatMoney(request.total, country)}</td>
          <td className={tdClass}>{[request.pincode, request.city].filter(Boolean).join(', ') || '—'}</td>
          <td className={tdClass}><span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${STATUS_STYLE[request.status]}`}>{request.status}</span></td>
          <td className={tdClass}>
            <span className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setOpenCode(request.code)} className="h-8 whitespace-nowrap rounded-lg bg-graphite px-3 text-[11px] font-extrabold text-white hover:bg-brand-950">View Request</button>
              {request.status === 'PENDING' && (
                <>
                  <button type="button" disabled={busy} onClick={() => respond(request, 'ACCEPT')} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-brand-700 px-3 text-[11px] font-extrabold text-white hover:bg-brand-800 disabled:opacity-50">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                  </button>
                  <button type="button" disabled={busy} onClick={() => respond(request, 'REJECT')} className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-extrabold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </button>
                </>
              )}
            </span>
          </td>
        </tr>
      ))}
    </DataTable>
    </div>
  )
}
