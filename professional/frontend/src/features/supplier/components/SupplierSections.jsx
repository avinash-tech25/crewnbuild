import { useState } from 'react'
import {
  Briefcase, Building2, CheckCircle2, ChevronRight, Clock, Eye, FileText, Home, MapPin, Package, Search, Send, Star, Tags, Users,
} from 'lucide-react'
import { Card, EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar, EntityPill } from '../../../shared/ui/EntityPill.jsx'
import { formatDate } from '../../../shared/utils/formatters.js'
import { isPartyRequest, memberSinceLabel, partyDetailRows, partyLocation } from '../../requests/counterparty.js'
import { constructionTypeLabel } from '../../../shared/utils/roleLabels.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { SERVICE_OPTION_KEYS, optionLabel } from '../../../i18n/optionKeys.js'
import { BuilderTierBadge } from '../../billing/subscription/TierBadge.jsx'
import { DataTable, tdClass, thClass } from '../../store/components/StoreUi.jsx'

// The bucket the dashboard groups products with no category of their own into.
// It is a display grouping built on the fly, never a stored `category`, so it
// has its own key rather than borrowing one of the stored-category keys (which
// include the quite different stored value "Other Construction Materials").
export const UNCATEGORISED = 'Other'

// Card metrics follow the Contractor dashboard's StatCard, which is the
// reference scale for every role: 12px gap, 10px/12px padding, a 14px icon in a
// 32px tile, an 18px display value and a 10px uppercase label. Those cards carry
// a third sub-line this one has no data for, so the height they measure at is
// set explicitly rather than left to differ by a line.
// Records created in the last seven days, from the stored `created_at`.
const createdThisWeek = (list) => {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000
  return list.filter((item) => item.created_at && new Date(item.created_at).getTime() >= since).length
}

export function SupplierStatsGrid({ requestList, clientList, productList, onSelect }) {
  const { t } = useLanguage()
  const stats = [
    { label: t('dash.supplier.statRequests'), value: requestList.length, note: t('dash.sup.newThisWeek', { count: createdThisWeek(requestList) }), icon: FileText, tone: { card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', arrow: 'bg-blue-100 text-blue-700' }, sectionId: 'requests' },
    { label: t('dash.supplier.statClients'), value: clientList.length, icon: Users, tone: { card: 'border-purple-200 bg-purple-50', chip: 'bg-purple-100 text-purple-700', arrow: 'bg-purple-100 text-purple-700' }, sectionId: 'findClients' },
    { label: t('dash.supplier.statProducts'), value: productList.length, note: t('dash.sup.newThisWeek', { count: createdThisWeek(productList) }), icon: Package, tone: { card: 'border-green-200 bg-green-50', chip: 'bg-green-100 text-green-700', arrow: 'bg-green-100 text-green-700' }, sectionId: 'products' },
    { label: t('dash.supplier.statCategories'), value: new Set(productList.map((product) => product.category)).size, icon: Tags, tone: { card: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-600', arrow: 'bg-orange-100 text-orange-600' }, sectionId: 'products' },
  ]
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onSelect?.(item.sectionId)}
          className={`group flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-left shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500/50 ${item.tone.card}`}
        >
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${item.tone.chip}`}>
            <item.icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-graphite/65">{item.label}</span>
            <span className="block truncate font-display text-2xl font-extrabold leading-tight text-graphite">{item.value}</span>
            {item.note && <span className="block truncate text-[11px] font-semibold text-emerald-700">{item.note}</span>}
          </span>
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition group-hover:translate-x-0.5 ${item.tone.arrow}`}>
            <ChevronRight className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        </button>
      ))}
    </section>
  )
}

// A request only needs to answer three questions: who sent it, for which
// project, and what is left to do about it. Everything the shared
// RequestsPanel adds beyond that (addresses, pincodes, galleries, documents,
// "not set" placeholders) is noise on this screen, so the Supplier list draws
// its own compact card instead.
const REQUEST_STATUS_KEYS = {
  pending: 'ui.status.pending',
  accepted: 'ui.requests.accepted',
  rejected: 'ui.requests.rejected',
  withdrawn: 'ui.shared.statusWithdrawn',
}
// Who sent a client request, by the role the server reports.
const CLIENT_ROLE_KEYS = {
  OWNER: 'role.owner',
  CONTRACTOR: 'role.contractor',
  BUILDER: 'role.contractor',
  ENGINEER: 'role.engineer',
  SUPPLIER: 'role.supplier',
}
const REQUEST_STATUS_TONE = {
  pending: 'bg-amber-400',
  accepted: 'bg-emerald-500',
  rejected: 'bg-rose-400',
  withdrawn: 'bg-slate-400',
}

export function SupplierRequestsSection({ requestMessage, requestList, viewMode = 'cards', onAccept, onReject, onWithdraw, onOpen }) {
  const { t, td } = useLanguage()
  // The toggle lives on the tab strip in SupplierDashboard; the same stored
  // requests feed both presentations, so switching views only changes the
  // layout, never the data behind it.
  // One description of a request for both views, so the table can never show a
  // status or an action the card would not.
  const requestView = (request) => {
    const name = request.profile_name || request.sender_name
    const status = String(request.status || '').toLowerCase()
    // Only a request that came in and is still waiting can be acted on.
    const canAct = status === 'pending' && !request.is_sender
    // Contact details ride along with an accepted relationship only, so a
    // card is worth opening only once the request has been accepted.
    const canOpen = status === 'accepted' && typeof onOpen === 'function'
    // The supplier's own request, still unanswered, can be taken back.
    const canWithdraw = status === 'pending' && request.is_sender && typeof onWithdraw === 'function'
    return { name, status, canAct, canOpen, canWithdraw }
  }
  const withdrawButton = (request) => (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); onWithdraw(request.id) }}
      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
    >
      {t('property.action.withdraw')}
    </button>
  )
  const statusLine = (request) => {
    const { status } = requestView(request)
    // Status reads at the same size as the Project column beside it.
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-graphite/60">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${REQUEST_STATUS_TONE[status] || 'bg-slate-300'}`} />
        <span className="truncate">
          {REQUEST_STATUS_KEYS[status] ? t(REQUEST_STATUS_KEYS[status]) : request.status}
          {request.is_sender ? ` · ${t('dash.sent')}` : ''}
        </span>
      </span>
    )
  }
  return (
    <div className="space-y-3">
      {requestMessage && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800">
          {requestMessage}
        </div>
      )}
      {viewMode === 'table' ? (
        // The Store Manager Requests table, with the fields a client request has
        // (no products or quantities: those belong to Purchase Requests).
        <DataTable
          minWidth="min-w-[980px]"
          head={[
            ['store.requests.requestId'], ['dash.common.date'], ['dash.supplier.requester'], ['dash.supplier.requesterType'],
            ['dash.common.project'], ['dash.common.location'], ['dash.common.status'], ['dash.common.action', 'text-end'],
          ].map(([key, align = 'text-start']) => <th key={key} className={`${thClass} ${align}`}>{t(key)}</th>)}
        >
              {requestList.map((request) => {
                const { name, canAct, canOpen } = requestView(request)
                return (
                  <tr key={request.id} className="dash-gold-hover">
                    <td className={`${tdClass} font-extrabold text-graphite`}>#{request.id}</td>
                    <td className={`${tdClass} whitespace-nowrap`}>{formatDate(request.created_at, '—')}</td>
                    <td className={`${tdClass} min-w-[180px]`}>
                      <div className="flex items-center gap-2">
                        {/* The requester's own avatar, from the request row
                            beside their name. */}
                        <SmartImage
                          src={userAvatarSrc(request)}
                          alt={td(name)}
                          className="h-8 w-8 shrink-0 rounded-full object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-extrabold text-graphite">{td(name)}</p>
                          {/* A builder's request with no project: who the builder is. */}
                          {isPartyRequest(request) && (
                            <p className="truncate text-[11px] font-semibold text-graphite/55">
                              {[
                                request.profile_title && td(request.profile_title) !== td(name) ? td(request.profile_title) : '',
                                request.profile_verified ? t('req.party.verifiedYes') : '',
                                memberSinceLabel(request, t) ? `${t('req.party.memberSince')} ${memberSinceLabel(request, t)}` : '',
                              ].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={tdClass}>{CLIENT_ROLE_KEYS[request.sender_role] ? t(CLIENT_ROLE_KEYS[request.sender_role]) : (request.sender_role || '—')}</td>
                    <td className={tdClass}>{(isPartyRequest(request) ? (request.project_id ? td(request.project_title) : '') : td(request.project_title)) || '—'}</td>
                    <td className={tdClass}>{(isPartyRequest(request) ? partyLocation(request, td) : [request.project_address, request.project_pincode].filter(Boolean).map((value) => td(value)).join(', ')) || '—'}</td>
                    <td className={tdClass}>{statusLine(request)}</td>
                    <td className={`${tdClass} text-end`}>
                      {canOpen ? (
                        <button
                          type="button"
                          onClick={() => onOpen(request)}
                          className="inline-flex items-center gap-0.5 text-[11px] font-bold text-brand-700 transition hover:text-brand-800"
                        >
                          {t('dash.common.viewProfile')}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      ) : canAct ? (
                        <span className="flex shrink-0 justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => onReject(request.id)}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
                          >
                            {t('dash.common.reject')}
                          </button>
                          <button
                            type="button"
                            onClick={() => onAccept(request.id)}
                            className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-800"
                          >
                            {t('dash.common.accept')}
                          </button>
                        </span>
                      ) : requestView(request).canWithdraw ? (
                        withdrawButton(request)
                      ) : (
                        <span className="text-graphite/40">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
        </DataTable>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {requestList.map((request) => {
            const { name, status, canAct, canOpen } = requestView(request)
            return (
            <article
              key={request.id}
              {...(canOpen ? {
                role: 'button',
                tabIndex: 0,
                onClick: () => onOpen(request),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(request)
                  }
                },
              } : {})}
              className={`dash-gold-hover flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)] ${canOpen ? 'cursor-pointer transition' : ''}`}
            >
              <div className="flex items-center gap-3">
                <SmartImage
                  src={userAvatarSrc(request)}
                  alt={td(name)}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-graphite">{td(name)}</p>
                  {isPartyRequest(request) ? (
                    // A builder's request with no project: the builder's company, not
                    // the server's "General" stand-in.
                    request.profile_title && td(request.profile_title) !== td(name) && (
                      <p className="truncate text-xs font-semibold text-graphite/55">{td(request.profile_title)}</p>
                    )
                  ) : (
                    <p className="truncate text-xs font-semibold text-graphite/55">{td(request.project_title)}</p>
                  )}
                </div>
              </div>
              {isPartyRequest(request) && (
                // Who the builder is: only the rows that apply, each with a value.
                <dl className="mt-2.5 space-y-1 text-xs" data-testid="party-details">
                  {partyDetailRows(request, t, td).filter(([label]) => label !== t('req.party.builderName') && label !== t('req.party.company')).map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-3">
                      <dt className="shrink-0 text-graphite/45">{label}</dt>
                      <dd className="min-w-0 truncate text-right font-semibold text-graphite/80">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-graphite/60">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${REQUEST_STATUS_TONE[status] || 'bg-slate-300'}`} />
                  <span className="truncate">
                    {REQUEST_STATUS_KEYS[status] ? t(REQUEST_STATUS_KEYS[status]) : request.status}
                    {request.is_sender ? ` · ${t('dash.sent')}` : ''}
                  </span>
                </span>
                {canOpen && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-brand-700">
                    {t('dash.common.viewProfile')}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
                {canAct && (
                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onReject(request.id)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100"
                    >
                      {t('dash.common.reject')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAccept(request.id)}
                      className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-800"
                    >
                      {t('dash.common.accept')}
                    </button>
                  </span>
                )}
                {requestView(request).canWithdraw && withdrawButton(request)}
              </div>
            </article>
          )
        })}
        </div>
      )}
    </div>
  )
}

export function SupplierFindClientsSection({ clientList, requestList = [], requestMessage, sendingReceiverId, sentRequestKeys, onSendRequest, onAcceptRequest, onRejectRequest, onViewProfile }) {
  const { t, td } = useLanguage()
  const [activeTab, setActiveTab] = useState('builders')

  // Categorize incoming requests by sender type.
  const incomingOwnerRequests = requestList.filter((r) => !r.is_sender && r.status === 'pending' && r.request_type === 'OWNER_TO_SUPPLIER')
  const incomingBuilderRequests = requestList.filter((r) => !r.is_sender && r.status === 'pending' && r.request_type === 'CONTRACTOR_TO_SUPPLIER')
  const incomingSupplierRequests = requestList.filter((r) => !r.is_sender && r.status === 'pending' && r.request_type === 'SUPPLIER_TO_SUPPLIER')

  // Discovered clients split by type.
  const ownerClients = clientList.filter((client) => client.type === 'OWNER')
  const builderClients = clientList.filter((client) => client.type === 'BUILDER')

  const tabs = [
    { id: 'houseowners', label: t('role.owner'), count: incomingOwnerRequests.length + ownerClients.length },
    { id: 'builders', label: t('role.builder'), count: incomingBuilderRequests.length + builderClients.length },
  ]

  const requestStatusPill = (status) => {
    if (status === 'accepted') return <EntityPill tone="positive" dot>{t('ui.status.accepted')}</EntityPill>
    if (status === 'rejected') return <EntityPill tone="danger" dot>{t('ui.status.rejected')}</EntityPill>
    if (status === 'withdrawn') return <EntityPill dot>{t('ui.shared.statusWithdrawn')}</EntityPill>
    return <EntityPill tone="accent" dot>{t('ui.status.pending')}</EntityPill>
  }

  const renderIncomingRequest = (request) => (
    <EntityCard
      key={`req-${request.id}`}
      compact
      goldHover
      icon={request.sender_role === 'OWNER' ? Home : Building2}
      label={request.sender_role === 'OWNER' ? t('role.owner') : t('role.builder')}
      avatar={<EntityAvatar user={request} alt={td(request.sender_name)} />}
      title={request.sender_name ? td(request.sender_name) : t('dash.supplier.nearbyClient')}
      subtitle={td(request.project_title || '')}
      pills={[
        { key: 'pincode', text: request.project_pincode || request.sender_pincode || '—', icon: MapPin },
      ]}
      footerLabel={formatDate(request.created_at, '')}
      footerValue={requestStatusPill(request.status)}
    >
      {request.status === 'pending' && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onAcceptRequest(request.id)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-oc-green px-3 py-2 text-xs font-bold text-white transition hover:bg-oc-deep"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {t('ce.accept')}
          </button>
          <button
            type="button"
            onClick={() => onRejectRequest(request.id)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-oc-line bg-white px-3 py-2 text-xs font-bold text-oc-muted transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
          >
            {t('ce.reject')}
          </button>
        </div>
      )}
    </EntityCard>
  )

  const renderDiscoverClient = (client) => {
    const requestKey = `${client.type}-${client.user_id}-${client.project_id || 'profile'}`
    const requestSent = Boolean(sentRequestKeys[requestKey])
    // The client's own role, which the list is already filtered on, rather than
    // guessing from whether a project title happens to be present.
    const isOwner = client.type === 'OWNER'
    // Who the client is comes first on both card types; what they are working
    // on sits underneath. For a House Owner that is their project, for a
    // Builder their company — so a company name is never read as a person.
    const displayTitle = td(client.name || client.company_name || client.project_title) || t('dash.supplier.nearbyClient')
    // Each client's own photo, and their role's default when they have not
    // uploaded one -- the same avatar this person shows everywhere else.
    // `client.type` carries their role. The project cover image is no longer
    // borrowed here: a building is not a person, and using it made the same
    // House Owner look different from one screen to the next.
    const displayImage = userAvatarSrc(client)
    // The project title is already in the existing payload, so the empty-state
    // message is now shown only when there genuinely is no project.
    const ownerLine = client.project_title
      ? `${t('dash.common.project')}: ${td(client.project_title)}`
      : t('dash.supplier.noProjectDetails')
    const builderLine = client.company_name && client.company_name !== client.name ? td(client.company_name) : ''
    const infoLine = isOwner ? ownerLine : builderLine
    // What the builder card used to show as its second line, kept on the card.
    const builderMeta = isOwner
      ? ''
      : (client.services_offered?.length > 0 ? client.services_offered.map((service) => optionLabel(t, SERVICE_OPTION_KEYS, service)).join(', ') : `${client.experience_years || 0} ${t('dash.supplier.yrsExperience')} · ${client.rating || 0} ${t('dash.common.rating')}`)
    const completedProjects = client.completed_project_details?.length
      ? client.completed_project_details.slice(0, 2).map((project) => (project.title ? td(project.title) : t('dash.common.project'))).join(' · ')
      : ''
    // Client card, laid out like the Find Clients reference: avatar, name and
    // company (builder) or project (house owner) with the pincode chip and an
    // open arrow on the right; for a builder the experience, projects and
    // rating chips and the services line; then Send Request beside View
    // Profile. Same data and the same actions the card already had -- View
    // Profile and the arrow are the card's own open-profile click. A house
    // owner has no experience, projects, rating or services, so those parts
    // are simply not drawn for one.
    const sending = sendingReceiverId === client.user_id
    return (
      <article
        key={requestKey}
        onClick={(event) => { if (!event.target.closest('button, a')) onViewProfile(client) }}
        className="oc-entity-card flex cursor-pointer flex-col rounded-[18px] border border-oc-line bg-white p-4 shadow-ocsoft transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5"
      >
        <div className="flex items-start gap-3">
          <EntityAvatar src={displayImage} alt={displayTitle} className="!h-14 !w-14 bg-ocbrand-50" />
          <div className="min-w-0 flex-1 pt-1">
            <p className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold text-oc-ink"><span className="truncate">{displayTitle}</span>{!isOwner && <BuilderTierBadge builderId={client.user_id} />}</p>
            {/* Under the name: a builder's company, or a house owner's
                construction type chip (the project line sits lower down). */}
            {!isOwner && infoLine && <p className="mt-0.5 truncate text-xs font-medium text-oc-muted">{infoLine}</p>}
            {isOwner && client.construction_type && (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-oc-ink">
                <Home className="h-3.5 w-3.5 text-amber-600" /> {constructionTypeLabel(client.construction_type, t)}
              </span>
            )}
          </div>
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-oc-ink">
            <MapPin className="h-3.5 w-3.5 text-emerald-600" /> {client.pincode || '—'}
          </span>
          <button
            type="button"
            aria-label={t('dash.common.viewProfile')}
            onClick={() => onViewProfile(client)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-oc-line bg-white text-oc-ink transition hover:border-emerald-200 hover:bg-emerald-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* A house owner's project line, below the header, wrapping so the
            whole project name shows. */}
        {isOwner && infoLine && <p className="mt-3 whitespace-normal break-words text-xs font-medium leading-snug text-oc-muted">{infoLine}</p>}
        {!isOwner && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-oc-ink">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-oc-sunken px-2.5 py-1">
              <Clock className="h-3.5 w-3.5 text-oc-muted" /> {`${client.experience_years || 0} ${t('dash.supplier.yrs')}`}
            </span>
            <span aria-hidden="true" className="h-4 w-px bg-oc-line" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-oc-sunken px-2.5 py-1">
              <Briefcase className="h-3.5 w-3.5 text-oc-muted" /> {`${client.completed_projects || 0} ${t('dash.supplier.projects')}`}
            </span>
            <span aria-hidden="true" className="h-4 w-px bg-oc-line" />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-bold" title={t('dash.common.rating')}>
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {Number(client.rating || 0).toFixed(1)}
            </span>
          </div>
        )}

        {builderMeta && <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-oc-muted">{builderMeta}</p>}
        {completedProjects && <p className="mt-1 truncate text-[11px] text-oc-faint">{`${t('dash.supplier.completed')}: ${completedProjects}`}</p>}

        <div className="mt-auto grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2.5 pt-3">
          {requestSent ? (
            <span className="inline-flex min-h-10 items-center py-1 text-center leading-tight justify-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {t('dash.common.requestSent')}
            </span>
          ) : (
            <button
              type="button"
              disabled={sending}
              onClick={() => onSendRequest(client)}
              className="inline-flex min-h-10 items-center py-1 text-center leading-tight justify-center gap-1.5 rounded-lg bg-oc-deep px-3 text-xs font-bold text-white transition hover:bg-oc-green disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> {sending ? t('dash.common.sending') : t('dash.common.sendRequest')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onViewProfile(client)}
            className="inline-flex min-h-10 items-center py-1 text-center leading-tight justify-center gap-1.5 rounded-lg border border-oc-line bg-white px-3 text-xs font-bold text-oc-ink transition hover:border-emerald-200 hover:bg-emerald-50"
          >
            <Eye className="h-4 w-4" /> {t('dash.common.viewProfile')}
          </button>
        </div>
      </article>
    )
  }

  const renderTabContent = () => {
    if (activeTab === 'houseowners') {
      const hasContent = incomingOwnerRequests.length > 0 || ownerClients.length > 0
      return hasContent ? (
        <div className="space-y-4">
          {incomingOwnerRequests.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('ce.pendingJoinRequests')}</p>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {incomingOwnerRequests.map(renderIncomingRequest)}
              </div>
            </section>
          )}
          {ownerClients.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.supplier.nearbyClients')}</p>
              <div className="supplier-client-cards grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {ownerClients.map(renderDiscoverClient)}
              </div>
            </section>
          )}
        </div>
      ) : <EmptyState title={t('dash.supplier.noClients')} message={t('dash.supplier.noClientsSub')} />
    }
    if (activeTab === 'builders') {
      const hasContent = incomingBuilderRequests.length > 0 || builderClients.length > 0
      return hasContent ? (
        <div className="space-y-4">
          {incomingBuilderRequests.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('ce.pendingJoinRequests')}</p>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {incomingBuilderRequests.map(renderIncomingRequest)}
              </div>
            </section>
          )}
          {builderClients.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.supplier.nearbyClients')}</p>
              <div className="supplier-client-cards grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {builderClients.map(renderDiscoverClient)}
              </div>
            </section>
          )}
        </div>
      ) : <EmptyState title={t('dash.supplier.noClients')} message={t('dash.supplier.noClientsSub')} />
    }
    // Suppliers tab
    return incomingSupplierRequests.length > 0 ? (
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {incomingSupplierRequests.map(renderIncomingRequest)}
      </div>
    ) : <EmptyState title={t('dash.supplier.noClients')} message={t('dash.supplier.noClientsSub')} />
  }

  return (
    <Card title={t('dash.supplier.nearbyClients')} icon={Search} className="border-slate-200 bg-white shadow-[0_24px_70px_-54px_rgba(15,23,42,0.82)]">
      {requestMessage && (
        <div className="mb-2.5 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800">
          {requestMessage}
        </div>
      )}
      {/* Tab bar */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${
                isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              {tab.label}
              {tab.count > 0 && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>{tab.count}</span>}
            </button>
          )
        })}
      </div>
      {renderTabContent()}
    </Card>
  )
}
