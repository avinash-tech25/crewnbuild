import { useEffect, useRef, useState } from 'react'
import QuantityField from '../../shop/components/QuantityField.jsx'
import { quantityProblem } from '../../../shared/utils/quantityUnits.js'
import { Check, ClipboardList, Eye, PackageCheck, ShoppingCart, X } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { approveStoreRequest, fetchStoreRequestPurchaseOptions, issueStoreRequest, rejectStoreRequest } from '../storeManagerApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { formatQty, money } from '../../site-work/components/EngineerAnalyticsSection.jsx'
import { REQUEST_FILTERS, filterRequests, purchaseRef, requestFilterCounts, requestRef, searchRequests } from '../storeHelpers.js'
import { DataTable, DetailModal, FilterChips, Notice, Panel, RequestId, RequestSearch, inputClass, pinnedEnd, primaryButton, refusalText, secondaryButton, tdClass, thClass } from './StoreUi.jsx'

// A request the store cannot cover yet: how much is missing, and the builder's
// suppliers that sell it. Buying opens Buy with the shortfall already in the order.
function ShortagePanel({ request, country, onBuy }) {
  const { t, td } = useLanguage()
  const [options, setOptions] = useState(null)
  const [error, setError] = useState('')
  const shortLines = request.lines.filter((line) => line.shortage > 0)
  // Ordered and not yet received does not count as stock: only what is still to buy is offered.
  const toBuy = shortLines.filter((line) => line.to_procure > 0)
  const pendingApproval = request.status === 'PENDING'
  const load = async () => {
    setError('')
    try {
      setOptions(await fetchStoreRequestPurchaseOptions(request.id))
    } catch (failure) {
      setError(refusalText(failure, td, t('store.saveFailed')))
    }
  }
  return (
    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 text-xs">
      {shortLines.map((line) => (
        <div key={line.id} className="mb-1.5">
          <p className="font-extrabold text-graphite">{td(line.item_name)}{line.variant ? ` · ${td(line.variant)}` : ''}</p>
          {/* Requested, what the store holds now, and what is missing. */}
          <dl className="mt-1 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-md bg-white px-2 py-1"><dt className="text-[10px] font-bold uppercase text-graphite/50">{t('store.requests.requestedLabel')}</dt><dd className="font-extrabold text-graphite">{formatQty(line.remaining)} {td(line.unit)}</dd></div>
            <div className="rounded-md bg-white px-2 py-1"><dt className="text-[10px] font-bold uppercase text-graphite/50">{t('store.requests.availableLabel')}</dt><dd className="font-extrabold text-graphite">{formatQty(line.available)} {td(line.unit)}</dd></div>
            <div className="rounded-md bg-white px-2 py-1"><dt className="text-[10px] font-bold uppercase text-rose-700">{t('store.requests.shortageLabel')}</dt><dd className="font-extrabold text-rose-700">{formatQty(line.shortage)} {td(line.unit)}</dd></div>
          </dl>
          <p role="alert" className="mt-1 font-bold text-rose-800">
            {pendingApproval
              ? t('store.requests.insufficientBuy', { shortage: formatQty(line.shortage), unit: td(line.unit) })
              : t('store.requests.insufficientRest', {
                available: formatQty(line.available), remaining: formatQty(line.remaining), shortage: formatQty(line.shortage), unit: td(line.unit), name: td(line.item_name),
              })}
          </p>
          {line.on_order > 0 && (
            <p className="mt-0.5 font-extrabold text-amber-800">{t('store.requests.procurementPending', { quantity: formatQty(line.on_order), unit: td(line.unit) })}</p>
          )}
        </div>
      ))}
      {options === null ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-graphite/60">{toBuy.length ? t('store.requests.keepPending') : t('store.requests.awaitingDelivery')}</span>
          {toBuy.length > 0 && (
            <button type="button" onClick={load} className={secondaryButton}>
              <ShoppingCart className="h-3.5 w-3.5" />
              {toBuy.length === 1 ? t('store.requests.buyMissingQuantity', { quantity: formatQty(toBuy[0].to_procure), unit: td(toBuy[0].unit) }) : t('store.requests.buyMissing')}
            </button>
          )}
        </div>
      ) : (
        options.lines.filter((line) => line.to_procure > 0).map((line) => (
          <div key={line.line_id} className="mt-2">
            <p className="font-extrabold text-graphite">{td(line.item_name)} · {t('store.requests.toBuy', { quantity: `${formatQty(line.to_procure)} ${td(line.unit)}` })}</p>
            {line.options.length ? (
              <ul className="mt-1 divide-y divide-rose-100 rounded-md bg-white px-2">
                {line.options.map((option) => {
                  // Only what is still to buy, and never more than the supplier has: the server refuses both.
                  const quantity = Math.min(line.to_procure, Number(option.quantity || 0))
                  return (
                    <li key={option.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-graphite">{td(option.store_name || option.supplier_name)}{option.size ? ` · ${td(option.size)}` : ''}</span>
                        <span className="block truncate font-semibold text-graphite/55">
                          {money(option.price, country)} / {td(option.unit)} · {t('store.buy.availableQty', { quantity: formatQty(option.quantity), unit: td(option.unit) })}
                          {!option.can_cover && ` · ${t('store.requests.cannotCover')}`}
                        </span>
                      </span>
                      <button type="button" disabled={quantity <= 0} onClick={() => onBuy({ requestId: request.id, requestRef: requestRef(request), projectId: line.project_id, product: option, quantity })} className={primaryButton}>
                        {t('store.requests.buyQuantity', { quantity: formatQty(quantity), unit: td(option.unit) })}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-1 font-semibold text-graphite/60">{t('store.requests.noSupplierHasIt')}</p>
            )}
          </div>
        ))
      )}
      {error && <p className="mt-1 font-bold text-rose-700">{error}</p>}
    </div>
  )
}

// Issuing an approved request: per product still owed, the quantity handed over now,
// filled in with as much as the store holds and changed by hand when less goes out.
// `focus`: opened from a row's Issue materials, so the form is brought into view.
function IssueForm({ request, busy, onIssue, focus = false }) {
  const { t, td } = useLanguage()
  const formRef = useRef(null)
  useEffect(() => {
    if (focus) formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus])
  const owedLines = request.lines.filter((line) => line.remaining > 0)
  const [quantities, setQuantities] = useState(() => Object.fromEntries(owedLines.map((line) => {
    const most = Math.min(line.remaining, line.available)
    return [line.id, most > 0 ? String(most) : '']
  })))
  const [error, setError] = useState('')
  const submit = () => {
    const chosen = owedLines.filter((line) => String(quantities[line.id] || '').trim())
    const wrong = chosen.find((line) => quantityProblem(quantities[line.id], line.unit))
    if (!chosen.length || wrong) {
      setError(wrong ? `${td(wrong.item_name)}: ${t('store.quantityInvalid')}` : t('store.approvals.enterQuantity'))
      return
    }
    setError('')
    onIssue(chosen.map((line) => ({ line_id: line.id, quantity: String(quantities[line.id]).trim() })))
  }
  return (
    <div ref={formRef} className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 text-xs">
      <p className="font-extrabold text-graphite">{t('store.approvals.issueNow')}</p>
      <ul className="mt-1 space-y-1.5">
        {owedLines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block font-bold text-graphite">{td(line.item_name)}{line.variant ? ` · ${td(line.variant)}` : ''}</span>
              <span className="block font-semibold text-graphite/60">
                {t('store.approvals.owedHeld', { owed: formatQty(line.remaining), held: formatQty(line.available), unit: td(line.unit) })}
              </span>
            </span>
            <QuantityField value={quantities[line.id] || ''} unit={line.unit} label={`${t('store.quantity')} ${td(line.item_name)}`} onChange={(text) => { setQuantities((current) => ({ ...current, [line.id]: text })); setError('') }} />
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 font-bold text-rose-700">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button type="button" disabled={busy || !request.can_issue} onClick={submit} className={primaryButton}><PackageCheck className="h-3.5 w-3.5" />{t(request.status === 'PARTIALLY_ISSUED' ? 'store.approvals.issueRest' : 'store.approvals.issue')}</button>
      </div>
    </div>
  )
}

// One value per request line, stacked, so a request with several products stays
// one row and the lines read across the columns, one text line each.
function PerLine({ request, render, tone = '' }) {
  return (
    <div className="space-y-1">
      {request.lines.map((line) => <p key={line.id} className={`min-h-5 whitespace-nowrap leading-5 ${tone}`}>{render(line)}</p>)}
    </div>
  )
}

// A product and its size on one line, the size quieter.
function ProductName({ line }) {
  const { td } = useLanguage()
  return <>{td(line.item_name)}{line.variant && <span className="font-semibold text-graphite/50"> · {td(line.variant)}</span>}</>
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{label}</dt>
      <dd className="truncate text-xs font-bold text-graphite">{children || '—'}</dd>
    </div>
  )
}

// The whole request: who asked, for which builder and project, every product with
// the stock behind it and what was handed over, the supplier purchases bought for
// it, and its history. `children` holds the actions the page allows.
function RequestDetail({ request, children }) {
  const { t, td } = useLanguage()
  return (
    <div className="space-y-3 pb-1">
      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-4">
        <div className="col-span-2 min-w-0 sm:col-span-4">
          <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{t('store.requests.requestId')}</dt>
          <dd className="text-graphite"><RequestId value={requestRef(request)} className="!text-xs" /></dd>
        </div>
        <Fact label={t('store.col.requestDate')}>{formatDateTime(request.created_at)}</Fact>
        <Fact label={t('store.col.siteEngineer')}>{td(request.engineer_name)}</Fact>
        <Fact label={t('store.requests.builder')}>{td(request.builder_name)}</Fact>
        <Fact label={t('store.col.project')}>{td(request.project_name)}</Fact>
        <Fact label={t('store.col.status')}><StatusPill status={request.stage || request.status} soft /></Fact>
        <Fact label={t('store.col.approvalDate')}>{request.decided_at && request.approved_by ? formatDateTime(request.decided_at) : ''}</Fact>
        <Fact label={t('store.col.approvedBy')}>{td(request.approved_by || '')}</Fact>
        <Fact label={t('store.col.fulfilledDate')}>{request.issued_at ? formatDateTime(request.issued_at) : ''}</Fact>
      </dl>
      {request.note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/75">{td(request.note)}</p>}

      <DataTable
        minWidth="min-w-[760px]"
        head={[
          'store.col.product', 'store.col.variant', 'store.col.requested', 'store.col.approved', 'store.col.delivered',
          'store.col.remaining', 'store.col.available', 'store.col.shortage', 'store.col.onOrder',
        ].map((key) => <th key={key} className={thClass}>{t(key)}</th>)}
      >
        {request.lines.map((line) => (
          <tr key={line.id}>
            <td className={`${tdClass} font-extrabold text-graphite`}>{td(line.item_name)}{line.category ? <span className="block text-[11px] font-semibold text-graphite/50">{td(line.category)}</span> : null}</td>
            <td className={tdClass}>{line.variant ? td(line.variant) : '—'}</td>
            <td className={tdClass}>{formatQty(line.quantity)} {td(line.unit)}</td>
            <td className={tdClass}>{formatQty(line.approved_quantity)}</td>
            <td className={`${tdClass} text-emerald-700`}>{formatQty(line.issued)}</td>
            <td className={`${tdClass} ${line.remaining > 0 ? 'text-amber-700' : ''}`}>{formatQty(line.remaining)}</td>
            <td className={tdClass}>{formatQty(line.available)}</td>
            <td className={`${tdClass} ${line.shortage > 0 ? 'font-extrabold text-rose-700' : ''}`}>{formatQty(line.shortage)}</td>
            <td className={`${tdClass} ${line.on_order > 0 ? 'font-extrabold text-violet-700' : ''}`}>{formatQty(line.on_order)}</td>
          </tr>
        ))}
      </DataTable>

      <div className="grid gap-3 md:grid-cols-2">
        {/* The supplier orders bought for this request, followed until received. */}
        <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <p className="font-extrabold text-graphite">{t('store.procurement.title')}</p>
          {request.purchases?.length ? (
            <ul className="mt-1 space-y-1">
              {request.purchases.map((purchase) => (
                <li key={purchaseRef(purchase)} className="font-semibold text-graphite/70">
                  <RequestId value={purchaseRef(purchase)} className="!text-[10px] text-graphite" />{purchase.supplier_name && ` · ${td(purchase.supplier_name)}`}
                  {' · '}{purchase.lines.map((line) => `${td(line.item_name)} × ${formatQty(line.quantity)} ${td(line.unit)}`).join(', ')}
                  {' · '}<span className="font-extrabold">{t(`store.procurement.status.${purchase.status}`)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 font-semibold text-graphite/50">{t('store.requests.noProcurement')}</p>}
        </div>
        {/* Approval and delivery history, from what the server recorded. */}
        <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs">
          <p className="font-extrabold text-graphite">{t('store.requests.history')}</p>
          {request.timeline?.length > 0 && (
            <ol className="mt-1 space-y-0.5 border-s-2 border-slate-200 ps-3 font-semibold text-graphite/70">
              {request.timeline.map((step, index) => (
                <li key={`${step.event}-${index}`} className={step.at ? '' : 'text-amber-700'}>
                  {t(`store.timeline.${step.event}`)}{step.at ? ` · ${formatDateTime(step.at)}` : ''}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {request.decision_note && <p className="text-xs font-semibold text-graphite/70">{t('store.requests.decisionNote')}: {td(request.decision_note)}</p>}
      {request.status === 'ISSUED' && (
        <p className="text-xs font-semibold text-emerald-700">
          {t('store.approvals.issuedLine', { date: formatDateTime(request.issued_at), by: td(request.approved_by || ''), to: td(request.received_by || '') })}
        </p>
      )}
      {children}
    </div>
  )
}

function ViewButton({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} className={`${secondaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>
      <Eye className="h-3 w-3" />{label}
    </button>
  )
}

// Requests: every Site Engineer request, one short row each, under status filters.
// Stock, shortage, builder, approval, procurement and history are in View details.
function RequestsTable({ requests, onOpen }) {
  const { t, td } = useLanguage()
  return (
    <DataTable
      minWidth="min-w-[880px]"
      head={[
        'store.requests.requestId', 'store.col.requestDate', 'store.col.siteEngineer', 'store.col.project', 'store.col.product',
        'store.col.requested', 'store.col.status', 'store.col.action',
      ].map((key) => <th key={key} className={key === 'store.col.action' ? `${thClass} ${pinnedEnd} bg-slate-50` : thClass}>{t(key)}</th>)}
    >
      {requests.map((request) => (
        <tr key={request.id} onClick={() => onOpen(request.id)} className="group cursor-pointer transition hover:bg-brand-50/40">
          <td className={`${tdClass} w-[150px] min-w-[150px] text-graphite`}><RequestId value={requestRef(request)} /></td>
          <td className={`${tdClass} min-w-[96px]`}>{formatDateTime(request.created_at)}</td>
          <td className={tdClass}>{td(request.engineer_name)}</td>
          <td className={tdClass}>{td(request.project_name)}</td>
          <td className={`${tdClass} font-bold text-graphite`}><PerLine request={request} render={(line) => <ProductName line={line} />} /></td>
          <td className={tdClass}><PerLine request={request} render={(line) => `${formatQty(line.quantity)} ${td(line.unit)}`} /></td>
          <td className={`${tdClass} whitespace-nowrap`}><StatusPill status={request.stage || request.status} soft /></td>
          <td className={`${tdClass} ${pinnedEnd} bg-white group-hover:bg-[#f5faf7]`} onClick={(event) => event.stopPropagation()}>
            <ViewButton onClick={() => onOpen(request.id)} label={t('store.viewDetails')} />
          </td>
        </tr>
      ))}
    </DataTable>
  )
}

// Approvals: approved requests with what was approved, delivered and is still owed.
// `onIssue` (approved requests still owed): the row's Issue materials, opening the
// request at its issue form; disabled while nothing it needs is in stock.
function ApprovalsTable({ requests, onOpen, actionLabel, onIssue = null }) {
  const { t, td } = useLanguage()
  return (
    <DataTable
      minWidth="min-w-[1120px]"
      head={[
        'store.requests.requestId', 'store.col.siteEngineer', 'store.col.project', 'store.col.productVariant', 'store.col.requested',
        'store.col.approved', 'store.col.available', 'store.col.delivered', 'store.col.remaining', 'store.col.approvalDate', 'store.col.status', 'store.col.action',
      ].map((key) => <th key={key} className={key === 'store.col.action' ? `${thClass} ${pinnedEnd} bg-slate-50` : thClass}>{t(key)}</th>)}
    >
      {requests.map((request) => (
        <tr key={request.id} onClick={() => onOpen(request.id)} className="group cursor-pointer transition hover:bg-brand-50/40">
          <td className={`${tdClass} min-w-[150px] text-graphite`}><RequestId value={requestRef(request)} /></td>
          <td className={tdClass}>{td(request.engineer_name)}</td>
          <td className={tdClass}>{td(request.project_name)}</td>
          <td className={`${tdClass} font-bold text-graphite`}><PerLine request={request} render={(line) => <ProductName line={line} />} /></td>
          <td className={tdClass}><PerLine request={request} render={(line) => `${formatQty(line.quantity)} ${td(line.unit)}`} /></td>
          <td className={tdClass}><PerLine request={request} render={(line) => formatQty(line.approved_quantity)} /></td>
          <td className={tdClass}><PerLine request={request} render={(line) => formatQty(line.available)} /></td>
          <td className={tdClass}><PerLine request={request} tone="text-emerald-700" render={(line) => formatQty(line.issued)} /></td>
          <td className={tdClass}><PerLine request={request} render={(line) => <span className={line.remaining > 0 ? 'font-extrabold text-amber-700' : ''}>{formatQty(line.remaining)}</span>} /></td>
          <td className={`${tdClass} min-w-[96px]`}>{request.decided_at && request.approved_by ? formatDateTime(request.decided_at) : '—'}</td>
          <td className={`${tdClass} whitespace-nowrap`}><StatusPill status={request.stage || request.status} soft /></td>
          <td className={`${tdClass} ${pinnedEnd} bg-white group-hover:bg-[#f5faf7]`} onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-col items-stretch gap-1">
              {onIssue && (
                <button type="button" disabled={!request.can_issue} title={request.can_issue ? undefined : t('store.approvals.waitingStock')} onClick={() => onIssue(request.id)} className={`${primaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>
                  <PackageCheck className="h-3 w-3" />{t(request.status === 'PARTIALLY_ISSUED' ? 'store.approvals.issueRest' : 'store.approvals.issueMaterials')}
                </button>
              )}
              <ViewButton onClick={() => onOpen(request.id)} label={actionLabel(request)} />
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  )
}

// Requests: every Site Engineer request under status filters, the finished ones
// included; a pending one is approved or rejected from its details. Approvals: only
// what was approved and is still waiting to be issued (from its Issue materials).
export default function StoreRequestsSection({ mode, requests, country, guard, onChanged, onBuy, loadFailed = false }) {
  const { t, td } = useLanguage()
  const [notes, setNotes] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [filter, setFilter] = useState('ALL')
  // Request ID (UUID) search, applied on top of the status filter.
  const [search, setSearch] = useState('')
  const searching = Boolean(search.trim())
  const found = searchRequests(requests, search)
  // The request whose details are open, by id: it is read from the latest list,
  // so the window shows the request as it stands after an action.
  const [openId, setOpenId] = useState(null)
  const open = requests.find((request) => request.id === openId) || null
  // The request opened from its Issue materials button: its issue form is scrolled to.
  const [issueId, setIssueId] = useState(null)
  const openRequest = (id) => { setIssueId(null); setOpenId(id) }
  const openIssue = (id) => { setIssueId(id); setOpenId(id) }

  // doneKey: the confirmation, or a function choosing it from the saved request.
  const act = async (id, action, doneKey) => {
    if (guard()) return
    setBusyId(id)
    setNotice(null)
    try {
      const saved = await action()
      setNotice({ text: t(typeof doneKey === 'function' ? doneKey(saved) : doneKey) })
      onChanged()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setBusyId(null)
    }
  }
  // An issue answers with the request: all of it handed over, or a part.
  const afterIssue = (saved) => ({ ISSUED: 'store.approvals.issuedAll', PARTIALLY_ISSUED: 'store.approvals.issuedPart' }[saved?.status] || 'store.approvals.issued')
  const buy = (prefill) => { setOpenId(null); onBuy(prefill) }

  const detailTitle = open ? `${t('store.requests.requestId')} ${requestRef(open)}` : ''
  const detailSubtitle = open ? `${td(open.engineer_name)} · ${td(open.project_name)}` : ''

  if (mode === 'requests') {
    const counts = requestFilterCounts(found)
    const shown = filterRequests(found, filter)
    return (
      <div className="space-y-3">
        <Notice message={notice} onClose={() => setNotice(null)} />
        <Panel title={t('store.nav.requests')}>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <FilterChips filters={REQUEST_FILTERS.map((item) => ({ id: item.id, label: t(item.label) }))} counts={counts} active={filter} onChange={setFilter} />
            <RequestSearch value={search} onChange={setSearch} />
          </div>
          {loadFailed ? (
            <Notice message={{ text: t('store.loadFailed'), error: true }} />
          ) : shown.length ? (
            <RequestsTable requests={shown} onOpen={setOpenId} />
          ) : requests.length ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-semibold text-graphite/55">{t(searching ? 'store.requests.noSearchMatch' : 'store.requests.noMatch')}</p>
          ) : (
            <EmptyState icon={ClipboardList} title={t('store.requests.none')} message={t('store.requests.noneSub')} />
          )}
        </Panel>
        {open && (
          <DetailModal placement="right" width="max-w-4xl" badge={t('store.requests.requestBadge')} title={detailTitle} subtitle={detailSubtitle} onClose={() => setOpenId(null)}>
            <RequestDetail request={open}>
              {open.status === 'PENDING' && (
                <>
                  {open.short && <ShortagePanel request={open} country={country} onBuy={buy} />}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input className={inputClass} aria-label={t('store.note')} placeholder={t('store.requests.notePlaceholder')} maxLength={500} value={notes[open.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [open.id]: event.target.value }))} />
                    <div className="flex shrink-0 justify-end gap-2">
                      <button type="button" disabled={busyId === open.id} onClick={() => act(open.id, () => rejectStoreRequest(open.id, notes[open.id] || null), 'store.requests.rejected')} className={secondaryButton}><X className="h-3.5 w-3.5" />{t('store.requests.reject')}</button>
                      {/* Short is no reason to refuse. Approving moves no stock: the request
                          goes to Approvals, where what the store holds is issued. */}
                      <button type="button" disabled={busyId === open.id || open.can_approve === false} onClick={() => act(open.id, () => approveStoreRequest(open.id, notes[open.id] || null), 'store.requests.approvedToIssue')} className={primaryButton}><Check className="h-3.5 w-3.5" />{t('store.requests.approve')}</button>
                    </div>
                  </div>
                  {open.can_approve === false && <p className="text-end text-[11px] font-bold text-rose-700">{t('store.requests.approveAfterReceipt')}</p>}
                </>
              )}
              {['APPROVED', 'PARTIALLY_ISSUED'].includes(open.status) && (
                <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800">{t('store.requests.issueUnderApprovals')}</p>
              )}
              {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
            </RequestDetail>
          </DetailModal>
        )}
      </div>
    )
  }

  // Approved and still owed products (nothing handed over yet, or the rest of it):
  // they stay here until fully issued, then leave for the history under Requests.
  const toIssue = found.filter((request) => ['APPROVED', 'PARTIALLY_ISSUED'].includes(request.status))
  const viewLabel = () => t('store.viewDetails')
  return (
    <div className="space-y-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <div className="flex justify-end">
        <RequestSearch value={search} onChange={setSearch} />
      </div>
      <Panel title={t('store.approvals.toIssue')}>
        {loadFailed ? (
          <Notice message={{ text: t('store.loadFailed'), error: true }} />
        ) : toIssue.length ? (
          <ApprovalsTable requests={toIssue} onOpen={openRequest} onIssue={openIssue} actionLabel={viewLabel} />
        ) : searching ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-semibold text-graphite/55">{t('store.requests.noSearchMatch')}</p>
        ) : (
          <EmptyState icon={PackageCheck} title={t('store.approvals.none')} message={t('store.approvals.noneSub')} />
        )}
        {/* Fulfilled, rejected and cancelled requests are not deleted: they stay under Requests. */}
        <p className="mt-2 text-[11px] font-semibold text-graphite/50">{t('store.approvals.historyUnderRequests')}</p>
      </Panel>
      {open && (
        <DetailModal placement="right" width="max-w-4xl" badge={t('store.requests.requestBadge')} title={detailTitle} subtitle={detailSubtitle} onClose={() => setOpenId(null)}>
          <RequestDetail request={open}>
            {['APPROVED', 'PARTIALLY_ISSUED'].includes(open.status) && (
              <>
                {open.short && <ShortagePanel request={open} country={country} onBuy={buy} />}
                {open.can_issue
                  ? <IssueForm key={open.lines.map((line) => `${line.issued}/${line.available}`).join(',')} request={open} focus={issueId === open.id} busy={busyId === open.id} onIssue={(lines) => act(open.id, () => issueStoreRequest(open.id, lines), afterIssue)} />
                  : <p className="text-xs font-semibold text-amber-700">{t('store.approvals.waitingStock')}</p>}
              </>
            )}
            {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
          </RequestDetail>
        </DetailModal>
      )}
    </div>
  )
}
