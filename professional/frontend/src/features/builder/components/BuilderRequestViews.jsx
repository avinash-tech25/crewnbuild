import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Building2, CalendarDays, Check, ChevronDown, FileText, HardHat, Store, Home, Inbox, IndianRupee, LayoutGrid, LayoutList, MapPin, Maximize2, Search, SlidersHorizontal, Sparkles, User, X } from 'lucide-react'
import { buildingTypeText, inr } from '../builderHelpers.js'
import { constructionTypeLabel } from '../../../shared/utils/roleLabels.js'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { defaultAvatarFor, userAvatarSrc } from '../../../shared/ui/avatars.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import AwardPanel from '../../requests/components/AwardPanel.jsx'
import { FLOW_TONES, hasAssignmentFlow, requestFlowStatus, useRequestAwards } from '../../requests/requestAwards.js'
import { formatDate } from '../../../shared/utils/formatters.js'

// The request's workflow status (quotation / assignment / negotiation /
// contract), shown wherever the request's plain status would otherwise be.
function RequestFlowBadge({ flow }) {
  const { t } = useLanguage()
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ring-1 ${FLOW_TONES[flow.tone]}`}>
      {flow.actionRequired && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {t(flow.key)}
    </span>
  )
}

const STATUS_TONES = {
  pending: 'bg-brand-50 text-brand-700 ring-brand-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sent: 'bg-sky-50 text-sky-700 ring-sky-200',
  rejected: 'bg-rose-50 text-rose-600 ring-rose-200',
  withdrawn: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const STATUS_LABELS = {
  pending: 'dash.contractor.status.newRequest',
  accepted: 'ui.status.accepted',
  sent: 'dash.contractor.status.proposalSent',
  rejected: 'dash.contractor.status.declined',
  // Taken back by its sender -- not Declined, which is the receiver's answer.
  withdrawn: 'ui.shared.statusWithdrawn',
}

// Row tints (with hover variants that keep the status colour) so each
// status stays distinguishable at a glance even while hovering.
const ROW_TONES = {
  pending: 'bg-brand-50/40 hover:bg-brand-50/70',
  accepted: 'bg-emerald-50/40 hover:bg-emerald-50/70',
  sent: 'bg-sky-50/40 hover:bg-sky-50/70',
  rejected: 'bg-rose-50/30 hover:bg-rose-50/60',
  withdrawn: 'bg-slate-50/60 hover:bg-slate-100/70',
}

// House Owner requests and Supplier requests are the same stored rows, the same
// statuses and the same table. Only two things differ -- who the counterparty is,
// and how a request is accepted -- so they differ as configuration here rather
// than as a second board that would have to be kept in step with this one.
//
// A House Owner request is answered with a price, so Accept opens the amount box
// first. A supplier request carries no quote from the builder: it is accepted or
// rejected as it stands, which is exactly what the supplier cards did before.
const BOARD_VARIANTS = {
  owner: {
    role: 'OWNER',
    counterpartyLabel: 'dash.contractor.homeowner',
    fallbackName: 'role.owner',
    quoteOnAccept: true,
    statusLabels: STATUS_LABELS,
    rowNote: {
      pending: 'dash.contractor.row.incoming',
      sent: 'dash.contractor.row.proposalSent',
      accepted: 'dash.contractor.row.quoteApproved',
      rejected: 'dash.contractor.row.declined',
      withdrawn: 'ui.shared.statusWithdrawn',
    },
    empty: {
      all: { title: 'dash.contractor.empty.allTitle', body: 'dash.contractor.empty.allBody', hint: 'dash.contractor.empty.allHint' },
      pending: { title: 'dash.contractor.empty.pendingTitle', body: 'dash.contractor.empty.pendingBody', hint: 'dash.contractor.empty.pendingHint' },
      accepted: { title: 'dash.contractor.empty.acceptedTitle', body: 'dash.contractor.empty.acceptedBody' },
      sent: { title: 'dash.contractor.empty.sentTitle', body: 'dash.contractor.empty.sentBody' },
      rejected: { title: 'dash.contractor.empty.rejectedTitle', body: 'dash.contractor.empty.rejectedBody' },
      withdrawn: { title: 'dash.contractor.empty.withdrawnTitle', body: 'dash.contractor.empty.withdrawnBody' },
    },
  },
  supplier: {
    role: 'SUPPLIER',
    counterpartyLabel: 'role.supplier',
    fallbackName: 'role.supplier',
    quoteOnAccept: false,
    // "Proposal Sent" is the House Owner word for a quote this builder priced.
    // Nothing is priced towards a supplier, so that one status is renamed; the
    // other four already read correctly for either counterparty.
    statusLabels: { ...STATUS_LABELS, sent: 'dash.common.requestSent' },
    rowNote: {
      pending: 'dash.contractor.row.incoming',
      sent: 'dash.common.requestSent',
      accepted: 'ui.status.accepted',
      rejected: 'dash.contractor.row.declined',
      withdrawn: 'ui.shared.statusWithdrawn',
    },
    // One card under every filter. The House Owner copy talks about homeowners
    // and winning projects, which is wrong here, and there is no supplier
    // wording for the individual filters -- so this is the card the Supplier
    // tab already showed when it held nothing, and it stays true under each.
    empty: {
      all: { title: 'ce.noSupplierRequests', body: 'ce.noSupplierRequestsSub' },
    },
  },
}

// Each status keeps one colour across its filter chip, its card tint and its
// badge, so a card's state reads at a glance.
const CHIP_TONES = {
  // Every chip is a flat fill in its own colour, no outline. The selected one
  // is one step deeper -- clearly active, never dark.
  all: { idle: 'bg-brand-100 text-brand-800', on: 'bg-brand-200 text-brand-900', count: 'bg-brand-900/10', countOn: 'bg-brand-900/15' },
  pending: { idle: 'bg-sky-50 text-sky-700', on: 'bg-sky-100 text-sky-800', count: 'bg-sky-900/10', countOn: 'bg-sky-900/15' },
  accepted: { idle: 'bg-emerald-50 text-emerald-700', on: 'bg-emerald-100 text-emerald-800', count: 'bg-emerald-900/10', countOn: 'bg-emerald-900/15' },
  sent: { idle: 'bg-violet-50 text-violet-700', on: 'bg-violet-100 text-violet-800', count: 'bg-violet-900/10', countOn: 'bg-violet-900/15' },
  rejected: { idle: 'bg-rose-50 text-rose-600', on: 'bg-rose-100 text-rose-700', count: 'bg-rose-900/10', countOn: 'bg-rose-900/15' },
  withdrawn: { idle: 'bg-slate-100 text-slate-600', on: 'bg-slate-200 text-slate-700', count: 'bg-slate-900/10', countOn: 'bg-slate-900/15' },
}

// The order the cards are listed in. "Newest" is the order the server sends.
const SORTS = [
  { id: 'newest', label: 'shop.sortNewest' },
  { id: 'oldest', label: 'shop.sortOldest' },
  { id: 'budgetHigh', label: 'req.board.budgetHigh' },
  { id: 'budgetLow', label: 'req.board.budgetLow' },
]

// The day an instant falls on where the reader is. The API sends ISO 8601 with
// an offset; text from before that ("06 Oct 2026, 11:20 AM") still reads as its
// own leading date.
const dateOnly = (value) => formatDate(value, String(value || '').split(',')[0].trim())

const FILTERS = [
  { id: 'all', label: 'dash.contractor.filter.all', dot: null },
  { id: 'pending', label: 'dash.contractor.filter.newRequests', dot: 'bg-brand-500' },
  { id: 'accepted', label: 'dash.contractor.filter.accepted', dot: 'bg-emerald-500' },
  { id: 'sent', label: 'dash.contractor.filter.sent', dot: 'bg-sky-500' },
  { id: 'rejected', label: 'dash.contractor.filter.declined', dot: 'bg-rose-500' },
  { id: 'withdrawn', label: 'ui.shared.statusWithdrawn', dot: 'bg-slate-400' },
]

/**
 * The requester's own avatar: their uploaded picture, else the default for
 * the role the request itself records. A picture that fails to load falls
 * back to that same default rather than to initials, so the row never shows
 * two different things for one person.
 */
function HomeownerAvatar({ name, request, role = 'OWNER', size = 'h-9 w-9' }) {
  const [imageFailed, setImageFailed] = useState(false)
  const fallback = defaultAvatarFor(request?.sender_role || role)
  return (
    <img
      src={imageFailed ? fallback : userAvatarSrc(request, role)}
      alt={name}
      className={`${size} shrink-0 rounded-full object-cover ring-1 ring-slate-200`}
      onError={() => setImageFailed(true)}
    />
  )
}

function categorizeRequest(request) {
  if (request.status === 'accepted') return 'accepted'
  if (request.status === 'rejected') return 'rejected'
  if (request.status === 'withdrawn') return 'withdrawn'
  if (request.is_sender && request.status === 'pending') return 'sent'
  return 'pending'
}

function RequestStatusBadge({ status, labels = STATUS_LABELS }) {
  const { t } = useLanguage()
  const tone = STATUS_TONES[status] || STATUS_TONES.pending
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ring-1 ${tone}`}>
      {!['accepted', 'sent'].includes(status) && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {t(labels[status] || status)}
    </span>
  )
}

function EmptyState({ filter, variant = 'owner' }) {
  const { t } = useLanguage()
  const board = BOARD_VARIANTS[variant] || BOARD_VARIANTS.owner
  // A variant that names no copy for this filter falls back to its 'all' card.
  const copy = board.empty[filter] || board.empty.all
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center"
    >
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-white text-slate-300 ring-1 ring-slate-200">
        <Inbox className="h-4 w-4" />
      </span>
      <p className="mt-2.5 text-sm font-extrabold text-slate-900">{t(copy.title)}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs font-medium leading-5 text-slate-500">{t(copy.body)}</p>
      {copy.hint && (
        <p className="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[11px] font-bold text-brand-800 ring-1 ring-brand-100">
          <Sparkles className="h-3 w-3" /> {t(copy.hint)}
        </p>
      )}
    </motion.div>
  )
}

function RequestDetailsDrawer({ request, onClose, variant = 'owner', award = null, onAwardChanged }) {
  const { t, td } = useLanguage()
  const board = BOARD_VARIANTS[variant] || BOARD_VARIANTS.owner
  const category = categorizeRequest(request)
  const title = td(request.project_title) || t('dash.contractor.homeownerProject')
  const ownerName = td(request.sender_name || request.profile_title) || t(board.fallbackName)
  const location = td(request.project_address || request.sender_address) || request.project_pincode || t('dash.owner.estimates.locationNotSet')
  const flow = variant === 'owner' ? requestFlowStatus(request, award, 'builder') : null
  // A request with an assignment / negotiation opens as a full workspace; every
  // other request keeps the compact window. Layout only -- same data, same panel.
  const negotiation = variant === 'owner' && hasAssignmentFlow(request)
  // What the panel loaded (its existing onLoaded notice), for the builder's name
  // and the assignment type in this layout. Nothing is fetched for it.
  const [loadedAward, setLoadedAward] = useState(null)
  const receivedLine = request.created_at
    ? t(request.is_sender ? 'req.board.sentOn' : 'req.board.receivedOn', { date: dateOnly(request.created_at) })
    : ''

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    // A centred window over the board (it used to slide in from the right).
    <div className="fixed inset-0 z-[130] grid place-items-center p-3 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${negotiation ? 'max-h-[92vh] max-w-5xl' : 'max-h-[88vh] max-w-md'}`}
      >
        {negotiation ? (
          <>
            {/* Heading: project, assignment type and when the request came in. */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('dash.contractor.requestDetails')}</p>
                <h3 className="truncate text-slate-950">{title}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                  {loadedAward && <span>{t(loadedAward.assigned === false ? 'award.titleNegotiation' : 'award.title')}</span>}
                  {loadedAward && receivedLine && <span className="hidden text-slate-300 sm:inline" aria-hidden="true">|</span>}
                  {receivedLine && <span>{receivedLine}</span>}
                  {flow ? <RequestFlowBadge flow={flow} /> : <RequestStatusBadge status={category} labels={board.statusLabels} />}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('dash.contractor.closeDetails')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/50 p-3 sm:p-5">
              <AwardPanel
                projectId={request.project_id}
                requestId={request.id}
                onChanged={onAwardChanged}
                onLoaded={(response) => setLoadedAward(response?.award || null)}
                showParties={false}
                framed={false}
                details={(
                  <section className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 sm:px-4">
                    <h4 className="text-slate-950">{t('dash.contractor.projectDetails')}</h4>
                    {/* Compact label-over-value tiles: one row on wide screens. The
                        amounts (budget, quotation) are in the amount card below. */}
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-6">
                      {[
                        [User, t(board.counterpartyLabel), ownerName],
                        loadedAward?.builder_name ? [HardHat, t('award.builder'), td(loadedAward.builder_name)] : null,
                        [MapPin, t('dash.msg.location'), location],
                        [Home, t('dash.common.buildingType'), buildingTypeText(request.building_type, t)],
                        [Maximize2, t('dash.contractor.area'), request.land_area ? `${request.land_area} ${t('dash.contractor.sqft')}` : ''],
                        [Building2, t('dash.common.construction'), constructionTypeLabel(request.construction_type, t)],
                      ].filter(Boolean).map(([Icon, label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Icon className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                            <span className="truncate">{label}</span>
                          </dt>
                          <dd className="truncate text-[13px] font-semibold leading-5 text-slate-800" title={value || undefined}>{value || t('dash.common.notSet')}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              />
              {request.project_description && (
                <section className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
                  <h4 className="flex items-center gap-2 text-slate-950">
                    <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {t('ps.owner.projectDescription')}
                  </h4>
                  <p className="mt-1.5 text-[13px] leading-5 text-slate-600">{td(request.project_description)}</p>
                </section>
              )}
            </div>
          </>
        ) : (
          <>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.contractor.requestDetails')}</p>
            <h3 className="truncate font-display text-sm font-extrabold text-slate-950">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('dash.contractor.closeDetails')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
          <div>
            {flow ? <RequestFlowBadge flow={flow} /> : <RequestStatusBadge status={category} labels={board.statusLabels} />}
          </div>
          {/* A plain list: small label, value on the right. The project and
              status are already in the header and badge above. */}
          <dl className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {[
              [t(board.counterpartyLabel), ownerName],
              [t('dash.msg.location'), location],
              [variant === 'owner' ? t('dash.common.originalBudget') : t('dash.common.budget'), request.budget ? inr(request.budget) : ''],
              Number(request.quotation_amount || 0) > 0 ? [t('request.flow.builderQuotation'), inr(request.quotation_amount)] : null,
              [t('dash.contractor.area'), request.land_area ? `${request.land_area} ${t('dash.contractor.sqft')}` : ''],
              [t('dash.common.buildingType'), buildingTypeText(request.building_type, t)],
              [t('dash.common.construction'), constructionTypeLabel(request.construction_type, t)],
            ].filter(Boolean).map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 px-3 py-1.5 text-xs">
                <dt className="shrink-0 text-slate-400">{label}</dt>
                <dd className="min-w-0 text-right font-semibold text-slate-800">{value || t('dash.common.notSet')}</dd>
              </div>
            ))}
          </dl>
          {/* A request with an assignment opens in the full layout above. */}
          {request.project_description && (
            <div>
              <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.common.description')}</p>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                {td(request.project_description)}
              </p>
            </div>
          )}
        </div>
          </>
        )}
      </motion.aside>
    </div>
  )
}

export function ContractorRequestsBoard({ requestList, onAccept, onReject, onWithdraw, variant = 'owner' }) {
  const { t, td, country } = useLanguage()
  const board = BOARD_VARIANTS[variant] || BOARD_VARIANTS.owner
  const [activeFilter, setActiveFilter] = useState('all')
  const [quotationAmounts, setQuotationAmounts] = useState({})
  const [actionError, setActionError] = useState('')
  const [detailsRequest, setDetailsRequest] = useState(null)
  const [quotingRequestId, setQuotingRequestId] = useState(null)
  // Assignment state per accepted owner/builder request (homeowner board only).
  const [awards, reloadAwards] = useRequestAwards(variant === 'owner' ? requestList : [])
  const [searchParams, setSearchParams] = useSearchParams()

  // Opened straight from a link (?request=<id>, e.g. a chat card) or from an
  // assignment notification (the project it names).
  useEffect(() => {
    if (variant !== 'owner' || !requestList.length) return
    const linkedId = searchParams.get('request')
    let target = linkedId ? requestList.find((request) => String(request.id) === linkedId) : null
    if (!target) {
      let hint = ''
      try { hint = sessionStorage.getItem('crewnbuild_open_request_hint') || '' } catch { hint = '' }
      if (hint) {
        target = requestList.find((request) => hasAssignmentFlow(request) && request.project_title && hint.includes(request.project_title))
        try { sessionStorage.removeItem('crewnbuild_open_request_hint') } catch { /* storage unavailable */ }
      }
    }
    if (target) setDetailsRequest(target)
    // Only when the list or the link changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestList, searchParams, variant])

  const closeDetails = () => {
    setDetailsRequest(null)
    if (searchParams.get('request')) {
      searchParams.delete('request')
      setSearchParams(searchParams, { replace: true })
    }
  }

  const counts = useMemo(() => {
    const totals = { all: requestList.length, pending: 0, accepted: 0, sent: 0, rejected: 0, withdrawn: 0 }
    requestList.forEach((request) => {
      totals[categorizeRequest(request)] += 1
    })
    return totals
  }, [requestList])

  const visibleRequests = useMemo(
    () => (activeFilter === 'all' ? requestList : requestList.filter((request) => categorizeRequest(request) === activeFilter)),
    [requestList, activeFilter],
  )

  const toggleDetails = (request) => {
    setDetailsRequest((currentRequest) => (currentRequest?.id === request.id ? null : request))
  }

  const startQuoting = (requestId) => {
    setActionError('')
    setQuotingRequestId(requestId)
  }

  const confirmQuote = (request) => {
    const quotationAmount = quotationAmounts[request.id] || ''
    if (Number(quotationAmount || 0) <= 0) {
      setActionError(t('ui.requests.quoteRequired'))
      return
    }
    setQuotingRequestId(null)
    onAccept(request.id, quotationAmount)
  }

  // Cards or the table; the builder's last choice, kept in this browser only.
  const [viewMode, setViewModeState] = useState(() => {
    try { return localStorage.getItem('crewnbuild_builder_requests_view') === 'table' ? 'table' : 'cards' } catch { return 'cards' }
  })
  const setViewMode = (mode) => {
    setViewModeState(mode)
    try { localStorage.setItem('crewnbuild_builder_requests_view', mode) } catch { /* storage unavailable */ }
  }
  const [searchText, setSearchText] = useState('')
  const [sortOrder, setSortOrder] = useState('newest')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  // The cards shown: the status filter, then the search, then the order.
  const shownRequests = useMemo(() => {
    const needle = searchText.trim().toLowerCase()
    let list = needle
      ? visibleRequests.filter((request) => [request.sender_name, request.profile_title, request.project_title, request.project_address, request.sender_address, request.project_pincode]
        .some((value) => String(value || '').toLowerCase().includes(needle)))
      : visibleRequests
    if (sortOrder !== 'newest') {
      list = [...list]
      if (sortOrder === 'oldest') list.reverse()
      if (sortOrder === 'budgetHigh') list.sort((a, b) => Number(b.budget || 0) - Number(a.budget || 0))
      if (sortOrder === 'budgetLow') list.sort((a, b) => Number(a.budget || 0) - Number(b.budget || 0))
    }
    return list
  }, [visibleRequests, searchText, sortOrder])

  const outlineButton = 'inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-extrabold text-slate-800 transition hover:bg-slate-50'
  // Every card's "view" action -- View request or View details -- is this one
  // button: same size, same style, same case.
  const viewButton = 'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-brand-700 bg-white px-2.5 text-xs font-extrabold text-brand-800 transition hover:bg-brand-50'
  const solidButton = 'inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-brand-800 px-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-brand-900'

  return (
    <div className="contractor-board-dark space-y-3">
      {/* Status chips, search and order */}
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 lg:flex-row lg:items-center">
        <div className="dash-scroll flex min-w-0 items-center gap-1.5 overflow-x-auto p-0.5">
          {FILTERS.map((filter) => {
            const on = filter.id === activeFilter
            return (
              <button
                key={filter.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setActiveFilter(filter.id)
                  setQuotingRequestId(null)
                  setActionError('')
                }}
                className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-extrabold transition ${on ? CHIP_TONES[filter.id].on : `${CHIP_TONES[filter.id].idle} hover:brightness-95`}`}
              >
                {t(filter.label)}
                <span className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ${on ? CHIP_TONES[filter.id].countOn : CHIP_TONES[filter.id].count}`}>
                  {counts[filter.id] || 0}
                </span>
              </button>
            )
          })}
        </div>
        {/* shrink-0 on the wide row: the status chips scroll, so they are what
            gives way -- these controls were squeezed past their own content (and
            the page) at 1024px in the longer languages. */}
        <div className="flex items-center gap-2 lg:ml-auto lg:shrink-0">
          <div className="flex h-10 shrink-0 items-center rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label={`${t('dash.supplier.table')} / ${t('dash.supplier.cards')}`}>
            {[
              { id: 'cards', icon: LayoutGrid, label: t('dash.supplier.cards') },
              { id: 'table', icon: LayoutList, label: t('dash.supplier.table') },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setViewMode(option.id)}
                aria-pressed={viewMode === option.id}
                title={option.label}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-extrabold transition ${viewMode === option.id ? 'bg-brand-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <option.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 lg:w-72 lg:flex-none">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={t('req.board.searchPh')}
              aria-label={t('req.board.searchPh')}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 outline-none placeholder:text-slate-400"
            />
          </label>
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSortMenuOpen((open) => !open)}
              aria-expanded={sortMenuOpen}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-extrabold text-slate-700 transition hover:bg-slate-50"
            >
              <SlidersHorizontal className="h-4 w-4" /> {t('req.board.filters')} <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {sortMenuOpen && (
              <>
                <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setSortMenuOpen(false)} />
                <div className="absolute right-0 z-40 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{t('shop.eo.sortBy')}</p>
                  {SORTS.map((sort) => (
                    <button
                      key={sort.id}
                      type="button"
                      onClick={() => { setSortOrder(sort.id); setSortMenuOpen(false) }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition hover:bg-slate-50 ${sortOrder === sort.id ? 'text-brand-800' : 'text-slate-700'}`}
                    >
                      {t(sort.label)} {sortOrder === sort.id && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Request cards */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeFilter}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          {visibleRequests.length === 0 ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <EmptyState filter={activeFilter} variant={variant} />
            </div>
          ) : shownRequests.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">{t('req.board.noMatch')}</p>
          ) : viewMode === 'table' ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="dash-scroll overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/90">
                    <th className="px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{t(board.counterpartyLabel)}</th>
                    <th className="px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.common.project')}</th>
                    {/* A supplier request carries no budget of its own. */}
                    {variant !== 'supplier' && <th className="px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.common.budget')}</th>}
                    <th className="px-2.5 py-1.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.common.status')}</th>
                    <th className="px-2.5 py-1.5 text-right text-[9px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.common.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRequests.map((request) => {
                    const category = categorizeRequest(request)
                    const pendingIncoming = category === 'pending'
                    const quotationAmount = quotationAmounts[request.id] || ''
                    const isQuoting = quotingRequestId === request.id
                    const title = td(request.project_title) || t('dash.contractor.homeownerProject')
                    const ownerName = td(request.sender_name || request.profile_title) || t(board.fallbackName)
                    const location = td(request.project_address || request.sender_address) || request.project_pincode || t('dash.owner.estimates.locationNotSet')
                    const rowTone = ROW_TONES[category] || ROW_TONES.pending
                    const flow = variant === 'owner' ? requestFlowStatus(request, awards[request.id], 'builder') : null
                    return (
                      <tr key={request.id} className={`group border-b border-slate-100 transition-colors last:border-b-0 ${rowTone}`}>
                        {/* Counterparty */}
                        <td className="px-2.5 py-2 align-middle">
                          <div className="flex items-center gap-2">
                            <HomeownerAvatar name={ownerName} request={request} role={board.role} size="h-7 w-7" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-800">{ownerName}</p>
                              {variant !== 'supplier' && <p className="text-[11px] text-slate-500">{t(board.rowNote[category])}</p>}
                            </div>
                          </div>
                        </td>
                        {/* Project */}
                        <td className="px-2.5 py-2 align-middle">
                          <div className="flex min-w-0 items-center gap-2">
                            <Home className="h-3 w-3 shrink-0 text-brand-600/80" strokeWidth={2} />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-slate-950">{title}</p>
                              <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">
                                <MapPin className="h-3 w-3 shrink-0 text-slate-400" /> {location}
                              </p>
                            </div>
                          </div>
                        </td>
                        {/* Budget -- not for a supplier request */}
                        {variant !== 'supplier' && (
                        <td className="px-2.5 py-2 align-middle">
                          <p className="font-extrabold text-slate-900">{request.budget ? inr(request.budget) : '—'}</p>
                          {request.land_area ? <p className="text-[11px] text-slate-500">{request.land_area} {t('dash.contractor.sqft')}</p> : null}
                          {Number(request.quotation_amount || 0) > 0 && (
                            <p className="mt-0.5 whitespace-nowrap text-[11px] font-bold text-slate-700">{t('request.flow.builderQuotation')}: {inr(request.quotation_amount)}</p>
                          )}
                        </td>
                        )}
                        {/* Status */}
                        <td className="px-2.5 py-2 align-middle">
                          {flow ? <RequestFlowBadge flow={flow} /> : <RequestStatusBadge status={category} labels={board.statusLabels} />}
                        </td>
                        {/* Actions */}
                        <td className="px-2.5 py-2 text-right align-middle">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {pendingIncoming && !board.quoteOnAccept ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onAccept(request.id)}
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 text-[11px] font-extrabold text-white transition hover:bg-emerald-700"
                                >
                                  <Check className="h-3 w-3" /> {t('ce.accept')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onReject(request.id)}
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-extrabold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                >
                                  <X className="h-3 w-3" /> {t('ce.reject')}
                                </button>
                              </>
                            ) : pendingIncoming && isQuoting ? (
                              <>
                                <div>
                                <input
                                  type="number"
                                  min="1"
                                  autoFocus
                                  value={quotationAmount}
                                  onChange={(event) => {
                                    setActionError('')
                                    setQuotationAmounts((currentAmounts) => ({ ...currentAmounts, [request.id]: event.target.value }))
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') confirmQuote(request)
                                    if (event.key === 'Escape') setQuotingRequestId(null)
                                  }}
                                  placeholder={t('dash.contractor.amount')}
                                  className="h-7 w-28 rounded-lg border border-brand-300 bg-white px-2.5 text-xs font-bold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-50"
                                />
                                {/* The request feed carries no project country,
                                    so the builder's own market is used rather
                                    than defaulting silently to rupees. */}
                                <BudgetInWords value={quotationAmount} country={country} className="w-28 text-end" />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => confirmQuote(request)}
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 text-[11px] font-extrabold text-white transition hover:bg-emerald-700"
                                >
                                  <Check className="h-3 w-3" /> {t('dash.common.accept')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setQuotingRequestId(null)}
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-extrabold text-slate-600 transition hover:bg-slate-50"
                                >
                                  <X className="h-3 w-3" /> {t('dash.common.cancel')}
                                </button>
                              </>
                            ) : pendingIncoming ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startQuoting(request.id)}
                                  className="inline-flex h-7 items-center justify-center gap-1 rounded-lg bg-brand-600 px-2 text-[11px] font-extrabold text-white transition hover:bg-brand-700"
                                >
                                  {t('dash.contractor.quoteAccept')} <ArrowRight className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onReject(request.id)}
                                  className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-extrabold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                                >
                                  {t('dash.contractor.notInterested')}
                                </button>
                              </>
                            ) : null}
                            {/* The sender's own request, still unanswered, can be taken back. */}
                            {onWithdraw && request.is_sender && request.status === 'pending' && !String(request.id).startsWith('sent-') && (
                              <button
                                type="button"
                                onClick={() => onWithdraw(request.id)}
                                className="inline-flex h-7 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-extrabold text-slate-600 transition hover:bg-slate-50"
                              >
                                {t('property.action.withdraw')}
                              </button>
                            )}
                            {/* View request and View details: one button, same size and style. */}
                            <button
                              type="button"
                              onClick={() => toggleDetails(request)}
                              className="inline-flex h-6 items-center gap-0.5 rounded-md border border-brand-700 bg-white px-1.5 text-[10px] font-bold text-brand-800 transition hover:bg-brand-50"
                            >
                              {flow ? t('req.board.viewRequest') : t('dash.contractor.viewDetails')}
                              <ArrowRight className="h-2.5 w-2.5" />
                            </button>
                          </div>
                          {actionError && pendingIncoming && isQuoting && (
                            <p className="mt-1.5 text-right text-[11px] font-bold text-red-600">{actionError}</p>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
              {shownRequests.map((request) => {
                const category = categorizeRequest(request)
                const pendingIncoming = category === 'pending'
                const quotationAmount = quotationAmounts[request.id] || ''
                const isQuoting = quotingRequestId === request.id
                const title = td(request.project_title) || t('dash.contractor.homeownerProject')
                const ownerName = td(request.sender_name || request.profile_title) || t(board.fallbackName)
                const location = td(request.project_address || request.sender_address) || request.project_pincode || t('dash.owner.estimates.locationNotSet')
                const flow = variant === 'owner' ? requestFlowStatus(request, awards[request.id], 'builder') : null
                const canWithdraw = onWithdraw && request.is_sender && request.status === 'pending' && !String(request.id).startsWith('sent-')
                const hasQuote = Number(request.quotation_amount || 0) > 0
                const dateLine = hasQuote && request.quotation_created_at
                  ? t('req.board.quotedOn', { date: dateOnly(request.quotation_created_at) })
                  : request.created_at
                    ? t(request.is_sender ? 'req.board.sentOn' : 'req.board.receivedOn', { date: dateOnly(request.created_at) })
                    : ''
                return (
                  <article key={request.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.45)]">
                    {/* Counterparty, status and the card menu */}
                    <div className="flex items-start gap-2">
                      <HomeownerAvatar name={ownerName} request={request} role={board.role} size="h-9 w-9" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-extrabold text-slate-900">{ownerName}</p>
                        {/* A supplier's company (store) name, under their own name,
                            when the two differ. */}
                        {variant === 'supplier' && td(request.profile_title) && td(request.profile_title) !== ownerName && (
                          <p className="flex min-w-0 items-center gap-1 text-[11px] text-slate-600" title={td(request.profile_title)}><Store className="h-3 w-3 shrink-0 text-brand-700" /> <span className="truncate">{td(request.profile_title)}</span></p>
                        )}
                        {/* For a supplier request the status is the badge alone. */}
                        {variant !== 'supplier' && <p className="truncate text-[11px] text-slate-500">{t(board.rowNote[category])}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {flow ? <RequestFlowBadge flow={flow} /> : <RequestStatusBadge status={category} labels={board.statusLabels} />}
                      </div>
                    </div>

                    {/* Project */}
                    {variant === 'supplier' ? (
                      // A supplier card is compact: its buttons sit beside the
                      // title, and there is no bottom row.
                      <div className="mt-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {/* A supplier request with no project shows no title
                              (the server's "General" stand-in); one tied to a
                              project shows that project's name. */}
                          {/* The project, if the request has one. */}
                          {request.project_id && <p className="truncate text-xs font-bold text-slate-700" title={title}>{title}</p>}
                          {dateLine && (
                            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-slate-500"><CalendarDays className="h-3 w-3 shrink-0 text-slate-400" /> <span className="truncate">{dateLine}</span></p>
                          )}
                          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500" title={location}>
                            <MapPin className="h-3 w-3 shrink-0 text-slate-400" /> {location}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {canWithdraw && (
                            <button type="button" onClick={() => onWithdraw(request.id)} className={outlineButton}>
                              {t('property.action.withdraw')}
                            </button>
                          )}
                          <button type="button" onClick={() => toggleDetails(request)} className={viewButton}>
                            {t('dash.contractor.viewDetails')} <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="mt-2 truncate text-sm font-extrabold text-slate-950" title={title}>{title}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500" title={location}>
                          <MapPin className="h-3 w-3 shrink-0 text-slate-400" /> {location}
                        </p>
                      </>
                    )}

                    {/* Quotation and date on the left; for a request already
                        answered or sent, its button on the right of the same row. */}
                    {variant !== 'supplier' && (
                    <div className="mt-auto flex items-end gap-2 pt-2">
                      <div className="min-w-0 flex-1 space-y-0.5 text-[11px] text-slate-600">
                        {/* The owner's budget, on one small line; a supplier request has none. */}
                        {variant !== 'supplier' && <p className="flex items-center gap-1.5"><IndianRupee className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="truncate"><b className="text-slate-800">{t('dash.common.budget')}:</b> {request.budget ? inr(request.budget) : '—'}</span></p>}
                        {hasQuote && (
                          <p className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="truncate"><b className="text-slate-800">{t('request.flow.builderQuotation')}:</b> {inr(request.quotation_amount)}</span></p>
                        )}
                        {dateLine && variant !== 'supplier' && <p className="flex min-w-0 items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" /> <span className="truncate">{dateLine}</span></p>}
                      </div>
                      {pendingIncoming ? (
                        // A new request's buttons are Accept / Not interested,
                        // so its details open from here.
                        <button type="button" onClick={() => toggleDetails(request)} className={viewButton}>
                          {t('dash.contractor.viewDetails')} <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1.5">
                          {/* The sender's own request, still unanswered, can be taken back. */}
                          {canWithdraw && (
                            <button type="button" onClick={() => onWithdraw(request.id)} className={outlineButton}>
                              {t('property.action.withdraw')}
                            </button>
                          )}
                          {/* The request is where an assignment is decided; an
                              action waiting on the builder is the filled button. */}
                          <button
                            type="button"
                            onClick={() => toggleDetails(request)}
                            className={viewButton}
                          >
                            {flow ? t('req.board.viewRequest') : t('dash.contractor.viewDetails')} <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    )}

                    {/* A new request's answer -- the same handlers the table uses */}
                    {pendingIncoming && (
                    <div className="pt-2.5">
                      {!board.quoteOnAccept ? (
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => onReject(request.id)} className={outlineButton}>
                            <X className="h-3.5 w-3.5" /> {t('ce.reject')}
                          </button>
                          <button type="button" onClick={() => onAccept(request.id)} className={solidButton}>
                            <Check className="h-3.5 w-3.5" /> {t('ce.accept')}
                          </button>
                        </div>
                      ) : isQuoting ? (
                        <div className="space-y-2">
                          <div>
                            <input
                              type="number"
                              min="1"
                              autoFocus
                              value={quotationAmount}
                              onChange={(event) => {
                                setActionError('')
                                setQuotationAmounts((currentAmounts) => ({ ...currentAmounts, [request.id]: event.target.value }))
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') confirmQuote(request)
                                if (event.key === 'Escape') setQuotingRequestId(null)
                              }}
                              placeholder={t('dash.contractor.amount')}
                              className="h-8 w-full rounded-lg border border-brand-300 bg-white px-2.5 text-xs font-bold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-50"
                            />
                            {/* The request feed carries no project country,
                                so the builder's own market is used rather
                                than defaulting silently to rupees. */}
                            <BudgetInWords value={quotationAmount} country={country} />
                          </div>
                          {actionError && <p className="text-[11px] font-bold text-red-600">{actionError}</p>}
                          <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setQuotingRequestId(null)} className={outlineButton}>
                              <X className="h-3.5 w-3.5" /> {t('dash.common.cancel')}
                            </button>
                            <button type="button" onClick={() => confirmQuote(request)} className={solidButton}>
                              <Check className="h-3.5 w-3.5" /> {t('dash.common.accept')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => onReject(request.id)} className={outlineButton}>
                            {t('dash.contractor.notInterested')}
                          </button>
                          <button type="button" onClick={() => startQuoting(request.id)} className={solidButton}>
                            {t('dash.contractor.quoteAccept')} <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Request details slide-in panel */}
      <AnimatePresence>
        {detailsRequest && (
          <RequestDetailsDrawer
            request={detailsRequest}
            variant={variant}
            award={awards[detailsRequest.id] || null}
            onAwardChanged={reloadAwards}
            onClose={closeDetails}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
