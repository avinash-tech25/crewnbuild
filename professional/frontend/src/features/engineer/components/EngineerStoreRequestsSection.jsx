/**
 * Store Requests: the Site Engineer's requests to the Store Manager and what
 * happened to each. Moved here from the bottom of the Store (EngineerStorePanel),
 * which now only browses and sends; the same records, the same endpoint
 * (/store/site-requests/mine, every project) and the same Cancel.
 *
 * Laid out as the Store Manager's Requests table: one row per request with its
 * products reading across the columns, and View details opening the whole
 * request (lines, supplier purchases, history) in a panel on the right.
 */
import { useEffect, useState } from 'react'
import { ClipboardList, Eye } from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { cancelSiteRequest, fetchMySiteRequests } from '../../store/storeManagerApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { REQUEST_FILTERS, filterRequests, purchaseRef, requestFilterCounts, requestRef, searchRequests } from '../../store/storeHelpers.js'
import { DataTable, DetailModal, FilterChips, Notice, Panel, RequestId, RequestSearch, pinnedEnd, refusalText, secondaryButton, tdClass, thClass } from '../../store/components/StoreUi.jsx'
import { formatQty } from '../../site-work/components/EngineerAnalyticsSection.jsx'

// One value per product line, stacked in the request's row so the lines read
// across the columns, as on the Store Manager's table.
function PerLine({ request, render, tone = '' }) {
  return (
    <div className="space-y-1">
      {request.lines.map((line) => <p key={line.id} className={`min-h-5 whitespace-nowrap leading-5 ${tone}`}>{render(line)}</p>)}
    </div>
  )
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-extrabold uppercase tracking-wide text-graphite/50 rtl:tracking-normal">{label}</dt>
      <dd className="truncate text-xs font-bold text-graphite">{children || '—'}</dd>
    </div>
  )
}

// The whole request, from the record as the server sent it: who and what, every
// product with what was approved, delivered, still owed and bought from a
// supplier, the supplier purchases (nothing financial) and the history.
function RequestDetails({ request, cancelling, onCancel }) {
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
        <Fact label={t('ui.profile.engCat.storeManager')}>{td(request.store_manager_name)}</Fact>
        <Fact label={t('store.requests.builder')}>{td(request.builder_name)}</Fact>
        <Fact label={t('store.col.project')}>{td(request.project_name)}</Fact>
        <Fact label={t('store.col.approvalDate')}>{request.decided_at && request.approved_by ? formatDateTime(request.decided_at) : ''}</Fact>
        <Fact label={t('store.col.fulfilledDate')}>{request.issued_at ? formatDateTime(request.issued_at) : ''}</Fact>
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-graphite/60">
        <StatusPill status={request.stage || request.status} soft />
        {request.procurement_status && request.procurement_status !== 'NONE' && <span>{t(`store.procurement.summary.${request.procurement_status}`)}</span>}
      </div>
      {request.note && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-graphite/75">{td(request.note)}</p>}

      <DataTable
        minWidth="min-w-[820px]"
        head={[
          'store.col.product', 'store.col.variant', 'store.col.requested', 'store.col.approved', 'store.col.delivered',
          'store.col.remaining', 'store.col.orderedFromSupplier', 'store.col.receivedByStore',
        ].map((key) => <th key={key} className={`${thClass} text-start`}>{t(key)}</th>)}
      >
        {request.lines.map((line) => (
          <tr key={line.id}>
            <td className={`${tdClass} font-extrabold text-graphite`}>{td(line.item_name)}{line.category ? <span className="block text-[11px] font-semibold text-graphite/50">{td(line.category)}</span> : null}</td>
            <td className={tdClass}>{line.variant ? td(line.variant) : '—'}</td>
            <td className={`${tdClass} whitespace-nowrap`}>{formatQty(line.quantity)} {td(line.unit)}</td>
            <td className={`${tdClass} whitespace-nowrap`}>{formatQty(line.approved_quantity)} {td(line.unit)}</td>
            <td className={`${tdClass} whitespace-nowrap text-emerald-700`}>{formatQty(line.issued)} {td(line.unit)}</td>
            <td className={`${tdClass} whitespace-nowrap ${line.remaining > 0 ? 'text-amber-700' : ''}`}>{formatQty(line.remaining)} {td(line.unit)}</td>
            <td className={`${tdClass} whitespace-nowrap`}>{line.ordered > 0 ? `${formatQty(line.ordered)} ${td(line.unit)}` : '—'}</td>
            <td className={`${tdClass} whitespace-nowrap`}>{line.ordered > 0 ? `${formatQty(line.received)} ${td(line.unit)}` : '—'}</td>
          </tr>
        ))}
      </DataTable>

      <div className="grid gap-3 md:grid-cols-2">
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
      {request.can_cancel && (
        <div className="flex justify-end">
          <button type="button" disabled={cancelling} onClick={onCancel} className={secondaryButton}>{t('store.engineer.cancel')}</button>
        </div>
      )}
    </div>
  )
}

// One short row per request; builder, approved quantities, procurement and the
// delivery history are in View details.
function RequestsTable({ requests, onOpen }) {
  const { t, td } = useLanguage()
  return (
    <DataTable
      minWidth="min-w-[860px]"
      head={[
        'store.requests.requestId', 'store.col.requestDate', 'store.col.project', 'store.col.productVariant',
        'store.col.requested', 'store.col.delivered', 'store.col.status', 'store.col.action',
      ].map((key) => <th key={key} className={key === 'store.col.action' ? `${thClass} ${pinnedEnd} bg-slate-50 text-start` : `${thClass} text-start`}>{t(key)}</th>)}
    >
      {requests.map((request) => (
        <tr key={request.id} onClick={() => onOpen(request.id)} className="group cursor-pointer transition hover:bg-brand-50/40">
          <td className={`${tdClass} w-[150px] min-w-[150px] text-graphite`}><RequestId value={requestRef(request)} /></td>
          <td className={`${tdClass} min-w-[96px]`}>{formatDateTime(request.created_at)}</td>
          <td className={tdClass}>{td(request.project_name) || '—'}</td>
          <td className={`${tdClass} font-bold text-graphite`}>
            <PerLine request={request} render={(line) => <>{td(line.item_name)}{line.variant && <span className="font-semibold text-graphite/50"> · {td(line.variant)}</span>}</>} />
          </td>
          <td className={tdClass}><PerLine request={request} render={(line) => `${formatQty(line.quantity)} ${td(line.unit)}`} /></td>
          <td className={tdClass}><PerLine request={request} tone="text-emerald-700" render={(line) => `${formatQty(line.issued)} ${td(line.unit)}`} /></td>
          <td className={`${tdClass} whitespace-nowrap`}><StatusPill status={request.stage || request.status} soft /></td>
          <td className={`${tdClass} ${pinnedEnd} bg-white group-hover:bg-[#f5faf7]`} onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => onOpen(request.id)} className={`${secondaryButton} !h-7 whitespace-nowrap !px-2 !text-[11px]`}>
              <Eye className="h-3 w-3" />{t('store.viewDetails')}
            </button>
          </td>
        </tr>
      ))}
    </DataTable>
  )
}

export default function EngineerStoreRequestsSection() {
  const { t, td } = useLanguage()
  const [requests, setRequests] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState(null)
  // The Store Manager's Requests filters (All / Pending / Approved), shared as is.
  const [historyGroup, setHistoryGroup] = useState('ALL')
  // Request ID (UUID) search, applied on top of the status filter.
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState(null)

  const reload = () => {
    fetchMySiteRequests()
      .then((list) => { setRequests(list); setLoaded(true) })
      .catch(() => setNotice({ text: t('store.engineer.historyLoadFailed'), error: true }))
  }
  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // A Store Manager's approval, issue or purchase arrives as the existing live hint.
  useLiveRefresh(reload)

  const [cancellingId, setCancellingId] = useState(null)
  const cancel = async (id, ref) => {
    setCancellingId(id)
    setNotice(null)
    try {
      await cancelSiteRequest(id)
      setNotice({ text: t('store.engineer.cancelled', { id: ref }) })
      reload()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('store.saveFailed')), error: true })
    } finally {
      setCancellingId(null)
    }
  }

  const found = searchRequests(requests, search)
  const groupCounts = requestFilterCounts(found)
  const shownRequests = filterRequests(found, historyGroup)
  // Read from the latest list, so a refresh while the panel is open shows the update.
  const open = openId ? requests.find((request) => request.id === openId) : null

  return (
    <div className="space-y-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <Panel title={t('store.engineer.myRequests')}>
        {requests.length ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <FilterChips filters={REQUEST_FILTERS.map((item) => ({ id: item.id, label: t(item.label) }))} counts={groupCounts} active={historyGroup} onChange={setHistoryGroup} />
              <RequestSearch value={search} onChange={setSearch} />
            </div>
            {shownRequests.length ? (
              <RequestsTable requests={shownRequests} onOpen={setOpenId} />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm font-semibold text-graphite/55">{t(search.trim() ? 'store.requests.noSearchMatch' : 'store.engineer.historyEmpty')}</p>
            )}
          </div>
        ) : loaded ? (
          <EmptyState icon={ClipboardList} title={t('store.engineer.noRequests')} message={t('store.engineer.noRequestsSub')} />
        ) : null}
      </Panel>
      {open && (
        <DetailModal
          placement="right"
          width="max-w-4xl"
          title={`${t('store.requests.requestId')} ${requestRef(open)}`}
          subtitle={[open.builder_name, open.project_name].filter(Boolean).map((value) => td(value)).join(' · ')}
          onClose={() => setOpenId(null)}
        >
          {notice && <div className="mb-2"><Notice message={notice} onClose={() => setNotice(null)} /></div>}
          <RequestDetails request={open} cancelling={cancellingId === open.id} onCancel={() => cancel(open.id, requestRef(open))} />
        </DetailModal>
      )}
    </div>
  )
}
