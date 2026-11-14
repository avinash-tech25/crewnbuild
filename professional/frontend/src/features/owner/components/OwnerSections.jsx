import { Fragment, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Camera, LayoutGrid, LayoutList, MapPin, MessageSquare, Phone, Sparkles, Star, Check, Eye, Pencil, Save, UserRound, Wallet, X } from 'lucide-react'
import MessageThread from '../../messaging/components/MessageThread.jsx'
import { avatarFromPath, userAvatarSrc } from '../../../shared/ui/avatars.js'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import AwardPanel from '../../requests/components/AwardPanel.jsx'
import NegotiateQuotationModal from '../../requests/components/NegotiateQuotationModal.jsx'
import { FLOW_TONES, hasAssignmentFlow, requestFlowStatus, useRequestAwards } from '../../requests/requestAwards.js'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar, EntityPill } from '../../../shared/ui/EntityPill.jsx'
import { requestTypeLabel as sharedRequestTypeLabel } from '../../../shared/utils/roleLabels.js'
import { builderIdOnRequest, countryText, money } from '../ownerHelpers.js'
import { EmptyState, Card } from './OwnerPanels.jsx'
import { ProjectForm, ProjectListTable } from './OwnerProjectViews.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { SERVICE_OPTION_KEYS, optionLabel } from '../../../i18n/optionKeys.js'
import { RequiredMark, requiredProfileFields } from '../../accounts/components/ProfileCompletionMeter.jsx'
import FieldError from '../../../shared/ui/FieldError.jsx'
import PincodeAreaHint from '../../../shared/ui/PincodeAreaHint.jsx'
import { usePincodeAreaLookup } from '../../../shared/hooks/usePincodeAreaLookup.js'
import { INVALID_FIELD_CLASS, profileErrorMessage, useProfileFormErrors } from '../../../shared/hooks/useProfileFormErrors.js'
import { OWNER_REQUEST_TYPES, findClientRequest as findBuilderRequest } from '../../builder/builderHelpers.js'
import ProfileImageHint from '../../../shared/ui/ProfileImageHint.jsx'
import { PROFILE_IMAGE_ACCEPT } from '../../../shared/utils/profileImageRules.js'
import { ratingLabel } from '../../../shared/utils/ratingLabel.js'
import { BuilderTierBadge } from '../../billing/subscription/TierBadge.jsx'
import { counterpartyRole, partyHeading, supplierCategoryLabel } from '../../requests/counterparty.js'
import PartyDetails from '../../requests/components/PartyDetails.jsx'

// Exported so the dashboard's activity list names a request exactly the way the
// requests table names it, from this one definition.
//
// A type this owner screen does not name is handed to the app-wide table in
// utils/roleLabels.js, which knows the rest. Only a type neither of them has
// ever heard of reaches the last line, and that is read out as words rather
// than shown as the raw enum "SUPPLIER TO ENGINEER" -- `td` translates those
// words like any other text the interface did not write itself.
export function requestTypeLabel(requestType, t, td) {
  const mapped = {
    CONTRACTOR_TO_OWNER: t('dash.common.builderRequest'),
    OWNER_TO_CONTRACTOR: t('dash.common.builderRequest'),
    OWNER_TO_SUPPLIER: t('dash.common.supplierRequest'),
    SUPPLIER_TO_OWNER: t('dash.common.supplierRequest'),
    OWNER_TO_ENGINEER: t('ui.owner.engineerRequest'),
  }[requestType]
  if (mapped) return mapped
  if (!requestType) return t('dash.common.request')
  const shared = sharedRequestTypeLabel(requestType, t)
  if (shared && shared !== requestType) return shared
  const spelled = String(requestType).replaceAll('_', ' ').toLowerCase()
  const readable = spelled.charAt(0).toUpperCase() + spelled.slice(1)
  return td ? td(readable) : readable
}

// The sender's role code as the role name the rest of the app shows.
const SENDER_ROLE_KEYS = {
  OWNER: 'role.owner',
  CONTRACTOR: 'role.contractor',
  BUILDER: 'role.contractor',
  SUPPLIER: 'role.supplier',
  ENGINEER: 'role.engineer',
}

export function OwnerRequestsSection({
  requestList,
  onAccept,
  onReject,
  onWithdraw,
  onAwardChanged,
  decisionMessage = '',
  projectCountry = 'India',
  project = null,
  onNegotiateBuilder,
}) {
  const { t, td } = useLanguage()
  const [expandedRequestId, setExpandedRequestId] = useState(null)
  // The quotation whose Negotiate dialog is open.
  const [negotiating, setNegotiating] = useState(null)
  // Each builder request's assignment state: its decisions live in the request.
  const [awards, reloadAwards] = useRequestAwards(requestList)
  const [searchParams] = useSearchParams()
  const linkedRequestId = searchParams.get('request')
  // Opened straight from a link (?request=<id>, e.g. a chat card or the
  // Assign Builder tab).
  useEffect(() => {
    if (linkedRequestId && requestList.some((request) => String(request.id) === linkedRequestId)) {
      setExpandedRequestId(linkedRequestId)
    }
  }, [linkedRequestId, requestList])
  const awardChanged = () => {
    reloadAwards()
    onAwardChanged?.()
  }
  // The opened request shows in a large window over the list, the same layout
  // as the builder's request window. Closing it clears the selection.
  const selectedRequest = requestList.find((request) => request.id === expandedRequestId) || null
  const closeRequest = () => setExpandedRequestId(null)
  useEffect(() => {
    if (expandedRequestId == null || negotiating) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setExpandedRequestId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedRequestId, negotiating])
  // Amounts on this project's quotations are in the project's own currency.
  const quoteCountry = project?.project_country || projectCountry
  // A quotation the owner can still choose: accepted, quoted, its assignment
  // state loaded and not live (none yet, or a cancelled one), and the project
  // free and no work started -- the rules /project-requests/assign applies.
  // A planned start date that has arrived does not block (warning only).
  // A negotiation not yet assigned holds the project's one live award, so no
  // other quotation can be negotiated or assigned until it is cancelled.
  const liveNegotiation = Object.values(awards).some((award) => award && award.assigned === false && ['negotiating', 'awaiting_builder', 'confirmed'].includes(award.status))
  const canChooseQuotation = (request) => Boolean(project)
    && hasAssignmentFlow(request)
    && Number(request.quotation_amount || 0) > 0
    && request.id in awards
    && (!awards[request.id] || awards[request.id].phase === 'cancelled')
    && !project.contractor_id
    && !liveNegotiation
    && project.work_started !== true
    && builderIdOnRequest(request) != null
  // One header for a column of many rows: when every request comes from the
  // same kind of counterparty it is named, and a mixed list falls back to the
  // neutral label the app already uses. Each row's Request cell still says
  // which kind it is.
  const senderRoles = [...new Set(requestList.map((request) => request.sender_role).filter(Boolean))]
  const senderColumnLabel = t(senderRoles.length === 1
    ? { BUILDER: 'role.contractor', CONTRACTOR: 'role.contractor', SUPPLIER: 'role.supplier' }[senderRoles[0]] || 'dash.common.name'
    : 'dash.common.name')
  return (
    <section className="overflow-hidden rounded-2xl border border-oc-line bg-white shadow-[0_16px_46px_-36px_rgba(15,23,42,0.55)]">
      {decisionMessage && (
        <div role="alert" className="mx-5 my-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {decisionMessage}
        </div>
      )}
      {!requestList.length ? (
        <div className="p-5"><EmptyState title={t('dash.owner.requests.emptyTitle')} message={t('dash.owner.requests.emptySub')} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-oc-line bg-oc-sunken text-[10px] font-extrabold uppercase tracking-[0.14em] text-oc-muted">
                <th className="px-4 py-2.5">{senderColumnLabel}</th>
                <th className="px-4 py-2.5">{t('dash.common.project')}</th>
                <th className="px-4 py-2.5">{t('dash.common.request')}</th>
                <th className="px-4 py-2.5">{t('dash.common.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('dash.common.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oc-line">
              {requestList.map((request) => {
                const pending = request.status === 'pending'
                const canAct = pending && !request.is_sender
                const expanded = expandedRequestId === request.id
                const flow = requestFlowStatus(request, awards[request.id], 'owner')
                return (
                  <Fragment key={request.id}>
                    <tr className="dash-gold-hover">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-oc-ink">
                        {counterpartyRole(request) === 'SUPPLIER' ? (
                          // A supplier by its store name, with its own name and category under it.
                          <>
                            <span className="block">{partyHeading(request, td)}</span>
                            <span className="block text-[11px] font-semibold text-oc-muted">
                              {[partyHeading(request, td) !== td(request.sender_name) ? td(request.sender_name) : '', supplierCategoryLabel(request, t)].filter(Boolean).join(' · ')}
                            </span>
                          </>
                        ) : td(request.sender_name)}
                      </td>
                      <td className="max-w-56 px-4 py-3">
                        <p className="truncate font-semibold text-oc-ink">{td(request.project_title) || t('dash.owner.requests.general')}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-oc-mint ring-1 ring-oc-line">
                            <img src={userAvatarSrc(request)} alt="" className="h-full w-full object-cover" />
                          </span>
                          <span className="text-xs font-bold text-oc-ink">{requestTypeLabel(request.request_type, t, td)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {flow ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ring-1 ${FLOW_TONES[flow.tone]}`}>
                            {flow.actionRequired && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                            {t(flow.key)}
                          </span>
                        ) : <StatusPill status={request.status} />}
                        {/* The quotation, visible without opening the row. */}
                        {Number(request.quotation_amount || 0) > 0 && (
                          <p className="mt-1 whitespace-nowrap text-[11px] font-bold text-oc-ink">
                            {t('dash.common.quotation')}: {money(request.quotation_amount, projectCountry)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canAct ? (
                            <>
                              <button
                                onClick={() => onAccept(request.id)}
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white transition hover:bg-oc-deep"
                              >
                                <Check className="h-3.5 w-3.5" /> {t('dash.common.accept')}
                              </button>
                              <button
                                onClick={() => onReject(request.id)}
                                className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-extrabold text-red-600 transition hover:bg-red-100"
                              >
                                <X className="h-3.5 w-3.5" /> {t('dash.common.reject')}
                              </button>
                            </>
                          ) : (
                            <>
                              {/* The owner's own request, still unanswered, can be taken back. */}
                              {onWithdraw && pending && request.is_sender && (
                                <button
                                  onClick={() => onWithdraw(request.id)}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-muted transition hover:bg-oc-sunken"
                                >
                                  {t('property.action.withdraw')}
                                </button>
                              )}
                              {/* A builder's quotation that can still be negotiated:
                                  Negotiate straight from the row (the same dialog and
                                  rules as inside the request). Otherwise View Request. */}
                              {canChooseQuotation(request) && onNegotiateBuilder ? (
                                <button
                                  onClick={() => setNegotiating(request)}
                                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white transition hover:bg-oc-deep"
                                >
                                  <MessageSquare className="h-3.5 w-3.5" /> {t('quote.negotiate')}
                                </button>
                              ) : (
                                <button
                                  onClick={() => setExpandedRequestId(expanded ? null : request.id)}
                                  className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-extrabold transition ${flow?.actionRequired ? 'bg-oc-green text-white hover:bg-oc-deep' : 'border border-oc-line bg-white text-oc-ink hover:bg-ocbrand-50'}`}
                                >
                                  <Eye className="h-3.5 w-3.5" /> {expanded ? t('dash.common.hide') : flow ? t('request.flow.viewRequest') : t('dash.common.view')}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedRequest && (() => {
        const request = selectedRequest
        const flow = requestFlowStatus(request, awards[request.id], 'owner')
        return (
          // A centred window over the list, laid out like the builder's request window.
          <div className="fixed inset-0 z-[130] grid place-items-center p-3 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={closeRequest}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            >
              {/* Heading: project, request type and status. */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('dash.common.requestDetails')}</p>
                  {/* A supplier's request is headed by the supplier's store name. */}
                  <h3 className="truncate text-slate-950">{counterpartyRole(request) === 'SUPPLIER' ? partyHeading(request, td) : td(request.project_title) || t('dash.owner.requests.general')}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                    <span>{requestTypeLabel(request.request_type, t, td)}</span>
                    <span className="text-slate-300" aria-hidden="true">|</span>
                    {flow ? (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ring-1 ${FLOW_TONES[flow.tone]}`}>
                        {flow.actionRequired && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                        {t(flow.key)}
                      </span>
                    ) : <StatusPill status={request.status} />}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeRequest}
                  aria-label={t('dash.contractor.closeDetails')}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/50 p-3 sm:p-5">
                {counterpartyRole(request) === 'SUPPLIER' ? (
                  // A supplier: who it is and what it supplies, as on the builder's
                  // side; the project row names this owner's project.
                  <PartyDetails request={request} />
                ) : (
                <>
                {/* The sender in one compact row: avatar, name and role on the
                    left; rating, PIN code and phone as small chips on the right
                    (wrapping under the name on a narrow window). A long value is
                    cut with an ellipsis and stays readable from its tooltip. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-oc-line bg-white px-3 py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {/* The sender's own avatar, resolved from the
                        request row their name came from. */}
                    <img src={userAvatarSrc(request)} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-oc-line" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold leading-5 text-oc-ink">
                        {td(request.sender_name)}
                        <span className="ms-1.5 text-[11px] font-semibold text-oc-muted">{SENDER_ROLE_KEYS[request.sender_role] ? t(SENDER_ROLE_KEYS[request.sender_role]) : td(request.sender_role)}</span>
                      </p>
                      {request.profile_about && <p className="truncate text-[11px] leading-4 text-oc-muted" title={td(request.profile_about)}>{td(request.profile_about)}</p>}
                    </div>
                  </div>
                  <dl className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    {[
                      [Star, t('dash.common.rating'), String(request.profile_rating || 0)],
                      [MapPin, t('dash.common.pincode'), request.profile_pincode || request.sender_pincode || '—'],
                      [Phone, t('dash.common.phone'), request.status === 'accepted' ? request.profile_phone || '—' : t('dash.common.lockedUntilAccepted')],
                    ].map(([Icon, label, value]) => (
                      <div key={label} className="inline-flex min-w-0 max-w-[12rem] items-center gap-1 rounded-full bg-oc-mint px-2 py-0.5 ring-1 ring-oc-line" title={`${label}: ${value}`}>
                        <dt className="shrink-0 text-oc-deep"><Icon className="h-3 w-3" aria-label={label} /></dt>
                        <dd className="truncate font-bold text-oc-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                </>
                )}
                {/* A quotation not chosen yet: Negotiate. Assigning is done
                    in the project's Assign Builder tab, never here. Once
                    negotiating, AwardPanel below. */}
                {canChooseQuotation(request) && onNegotiateBuilder && (
                  <div className="flex flex-col gap-3 rounded-xl border border-oc-line bg-white p-3 sm:flex-row sm:items-center">
                    <dl className="grid min-w-0 flex-1 grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-oc-faint">{t('request.flow.builderQuotation')}</dt><dd className="font-extrabold text-oc-ink">{money(request.quotation_amount, quoteCountry)}</dd></div>
                      <div><dt className="text-oc-faint">{t('award.negotiateModal.yourBudget')}</dt><dd className="font-bold text-oc-ink">{Number(project.original_budget ?? project.budget) > 0 ? money(project.original_budget ?? project.budget, quoteCountry) : t('dash.common.notSet')}</dd></div>
                    </dl>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setNegotiating(request)}
                        className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-oc-line bg-white px-4 text-xs font-extrabold text-oc-ink transition hover:bg-oc-sunken disabled:cursor-not-allowed disabled:text-slate-400 sm:flex-none"
                      >
                        {t('quote.negotiate')}
                      </button>
                    </div>
                  </div>
                )}
                {/* The assignment made on this request: the owner's side of
                    the negotiation (accept / reject / counter) and cancel. */}
                {hasAssignmentFlow(request) && request.id in awards && (
                  <div>
                    {/* Remounted when an award is made on this request
                        (Negotiate / Assign here), so it is not left on
                        the empty state it loaded before. */}
                    <AwardPanel key={awards[request.id]?.id || 'none'} projectId={request.project_id} requestId={request.id} onChanged={awardChanged} framed={false} showParties={false} />
                  </div>
                )}
              </div>
            </motion.aside>
          </div>
        )
      })()}
      {negotiating && (
        <NegotiateQuotationModal
          quotation={negotiating.quotation_amount}
          builderName={negotiating.sender_name}
          budget={project?.original_budget ?? project?.budget}
          country={quoteCountry}
          onSubmit={async (amount, note) => {
            try {
              await onNegotiateBuilder(negotiating.id, amount, note)
            } finally {
              reloadAwards()
            }
          }}
          onClose={() => setNegotiating(null)}
        />
      )}
    </section>
  )
}

/**
 * The Projects catalogue — the whole page, in one section.
 *
 * Projects and saved requirements used to be two lists under two headings, so
 * a project was listed twice. They are one list now: each entry is a project
 * card that carries that project's own actions. Picking one is a navigation to
 * its page, which OwnerProjectWorkspace renders at `/owner/projects/<id>`.
 */
export function OwnerProjectsSection({
  showProjectForm,
  onProjectCreated,
  projectListMessage,
  projectEntries = [],
  onSelectProject,
  defaultCountry = 'India',
  ...estimateActions
}) {
  const { t } = useLanguage()
  return (
    <div className="space-y-4">
      {showProjectForm && <ProjectForm onProjectCreated={onProjectCreated} defaultCountry={defaultCountry} />}
      {projectListMessage && (
        <div className="rounded-xl border border-oc-line bg-oc-sunken px-4 py-3 text-sm font-semibold text-oc-muted">
          {projectListMessage}
        </div>
      )}
      <ProjectListTable entries={projectEntries} onSelect={onSelectProject} defaultCountry={defaultCountry} {...estimateActions} />
      {!projectEntries.length && <EmptyState title={t('dash.owner.projects.emptyTitle')} message={t('dash.owner.projects.emptySub')} />}
    </div>
  )
}

// Specialization pill colours, in turn.
const SERVICE_TONES = ['bg-sky-50 text-sky-700', 'bg-emerald-50 text-emerald-700', 'bg-orange-50 text-orange-700', 'bg-violet-50 text-violet-700']

// A builder's own services offered, up to three and a "+N", for the Find
// Builders table and cards alike.
function ServicePills({ services = [], small = false }) {
  const { t, td } = useLanguage()
  if (!services?.length) return <span className="text-xs text-oc-faint">—</span>
  const label = (service) => {
    const known = optionLabel(t, SERVICE_OPTION_KEYS, service)
    return known === service ? td(service) : known
  }
  // The cards' fixed one-line row has room for two; the table shows three.
  const shown = small ? 2 : 3
  return (
    <div className={`flex ${small ? 'flex-nowrap gap-1' : 'flex-wrap gap-1.5'}`}>
      {services.slice(0, shown).map((service, index) => (
        <span key={service} className={`rounded-md font-semibold ${small ? 'min-w-0 truncate px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'} ${SERVICE_TONES[index % SERVICE_TONES.length]}`}>
          {label(service)}
        </span>
      ))}
      {services.length > shown && (
        <span className={`shrink-0 rounded-md bg-slate-100 font-semibold text-slate-600 ${small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]'}`}>+{services.length - shown}</span>
      )}
    </div>
  )
}

// A builder who joined within this window (2 days) is marked "Newly joined".
const NEWLY_JOINED_MS = 2 * 24 * 60 * 60 * 1000

export function OwnerContractorsSection({ requestMessage, contractorList, sendingReceiverId, onViewProfile, onSendRequest, onAcceptRequest, onRejectRequest, pincode, projectDetails, project, requestList = [] }) {
  const { t, td } = useLanguage()
  // Cards by default; Table stays one click away.
  const [viewMode, setViewMode] = useState('cards')
  // A project that already has an assigned builder cannot take another one, so
  // every OTHER builder card is shown disabled. Reuses the existing assignment
  // field (project.contractor_id) the dashboard already reads to say "No
  // builder is assigned to this project yet" — never project completion.
  const assignedBuilderId = project?.contractor_id
  const builderAlreadyAssigned = Boolean(assignedBuilderId)
  // Each accepted request's assignment, read exactly as the Requests tab reads
  // it, so a card and its request row can never disagree (a cancelled or
  // declined assignment used to leave the card on "Quotation received").
  const [awards] = useRequestAwards(requestList)
  const projectMeta = [
    projectDetails?.land_area ? t('dash.owner.sqft', { area: projectDetails.land_area }) : '',
    projectDetails?.floors ? (Number(projectDetails.floors) === 1 ? t('dash.owner.contractors.floorsOne', { n: projectDetails.floors }) : t('dash.owner.contractors.floorsMany', { n: projectDetails.floors })) : '',
  ].filter(Boolean).join(' · ')
  return (
    // No "Nearby Builders" heading: the Find Builders tab already names it.
    // The builder count shares the top row with the pincode and the view
    // switch, so the cards start straight below it.
    <Card
      action={(
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-oc-muted">{contractorList.length === 1 ? t('dash.owner.contractors.inAreaOne', { count: contractorList.length }) : t('dash.owner.contractors.inAreaMany', { count: contractorList.length })}</p>
          <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-oc-muted">
            <MapPin className="h-3.5 w-3.5" />
            {t('dash.owner.contractors.pincodeLabel', { pincode: pincode || t('dash.common.notSet') })}
          </span>
          {contractorList.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 rounded-xl bg-slate-100 p-1">
              {[['cards', LayoutGrid, 'dash.supplier.cards'], ['table', LayoutList, 'dash.supplier.table']].map(([mode, ModeIcon, labelKey]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  aria-label={t(labelKey)}
                  title={t(labelKey)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition ${viewMode === mode ? 'bg-white text-graphite shadow-sm' : 'text-graphite/55 hover:text-graphite'}`}
                >
                  {/* Icon only on a phone, as the builder's Cards/Table switch does:
                      the worded pair was wider than the screen in Tamil at 320px. */}
                  <ModeIcon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t(labelKey)}</span>
                </button>
              ))}
            </div>
          )}
          </div>
        </div>
      )}
    >
      <div className="space-y-3">
        {requestMessage && (
          <div className="rounded-xl border border-oc-line bg-oc-mint px-4 py-3 text-sm font-semibold text-oc-deep">
            {requestMessage}
          </div>
        )}
        {(() => {
          const renderBuilder = (contractor) => {
            const sending = sendingReceiverId === contractor.user_id
            const builderName = td(contractor.name || contractor.company_name) || t('role.builder')
            // Shown underneath, and only when it adds something the heading
            // does not already say -- compared as they are displayed, so the
            // two never both appear saying the same thing.
            const companyName = contractor.company_name && td(contractor.company_name) !== builderName
              ? td(contractor.company_name)
              : ''
            // The builder already assigned to this project keeps their card
            // exactly as it is; only the OTHER builders are unavailable.
            // Compared as strings: a user id is a UUID, and Number() on one is NaN,
            // which is not equal to itself -- every builder would read as not assigned.
            const isAssignedBuilder = builderAlreadyAssigned && String(contractor.user_id) === String(assignedBuilderId)
            const unavailable = builderAlreadyAssigned && !isAssignedBuilder
            // The request that already exists between the owner and THIS builder
            // for THIS project, so the card reflects the stored record instead of
            // offering a duplicate.
            //
            // Matched in BOTH directions. It used to look only for a request the
            // owner had sent (`is_sender` + OWNER_TO_CONTRACTOR), so a builder
            // who wrote to the owner first -- CONTRACTOR_TO_OWNER, with the owner
            // as receiver -- was never found, and stayed on "Send Request" even
            // after the owner had accepted them. The two directions describe one
            // relationship, and either one settles this card.
            //
            // This is the same matcher the builder's own Find Clients grid uses
            // on the other side of the relationship, rather than a second copy of
            // the rule that could drift from it. It reads the stored `status`;
            // no status is invented here, and an accepted record outranks a
            // pending or rejected one when several exist.
            const existingRequest = findBuilderRequest(
              requestList,
              // The helper calls the far side of the relationship `owner_id`
              // because it was written from the builder's point of view. Here the
              // far side is the builder.
              { owner_id: contractor.user_id, project_id: project?.id },
              OWNER_REQUEST_TYPES,
            )
            const requestStatus = existingRequest?.status || 'none'
            // Where an accepted request now stands -- quotation, assignment,
            // negotiation, contract, declined, cancelled or ongoing -- from the
            // same helper the Requests tab uses.
            const award = existingRequest ? awards[existingRequest.id] : null
            const flow = requestStatus === 'accepted' ? requestFlowStatus(existingRequest, award, 'owner') : null
            // A pending request is either one the owner sent (they wait) or one
            // this builder sent to the owner (the owner decides). Only the
            // second is actionable here, with the same Accept / Reject the
            // Requests tab offers -- never to the sender.
            const incomingPendingRequest = requestStatus === 'pending'
              ? requestList.find((request) => (
                OWNER_REQUEST_TYPES.includes(request.request_type)
                && request.status === 'pending'
                && request.is_receiver
                && String(request.sender_id) === String(contractor.user_id)
              ))
              : null
            const pills = [
              // The builder's rating, or "New" while they have no reviews -- the
              // same wording on every builder view.
              { key: 'rating', text: ratingLabel(contractor.rating, contractor.review_count, t), icon: Star, tone: 'accent' },
              // Joined in the last 2 days.
              ...(contractor.joined_at && Date.now() - new Date(contractor.joined_at).getTime() <= NEWLY_JOINED_MS
                ? [{ key: 'new', text: t('dash.owner.contractors.newlyJoined'), icon: Sparkles, tone: 'brand' }]
                : []),
              // Only a live verification decision from the backend earns the
              // badge; it is no longer shown on every builder.
              ...(contractor.is_verified === true
                ? [{ key: 'verified', text: t('dash.common.verified'), icon: BadgeCheck, tone: 'brand' }]
                : []),
            ]
            // The request controls, shared by the card and the table row.
            const action = (
              unavailable ? (
                <>
                  <button
                    disabled
                    title={t('dash.owner.contractors.builderAssignedNote')}
                    className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-oc-green px-3 py-2 text-xs font-bold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('dash.common.sendRequest')}
                    <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={2.25} />
                  </button>
                  <p className="mt-1.5 text-[11px] font-semibold leading-snug text-oc-faint">
                    {t('dash.owner.contractors.builderAssignedNote')}
                  </p>
                </>
              ) : requestStatus === 'accepted' ? (
                // The request was accepted, so no new request can be sent; the
                // pill says where it stands now, worded as in the Requests tab.
                <span className={`mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ring-1 ${flow ? FLOW_TONES[flow.tone] : 'bg-emerald-50 text-emerald-700 ring-emerald-100'}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" /> {flow ? t(flow.key) : t('dash.common.accepted')}
                </span>
              ) : incomingPendingRequest ? (
                // This builder asked the owner: answer it here, through the
                // same accept / reject the Requests tab uses.
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onAcceptRequest?.(incomingPendingRequest.id) }}
                    className="inline-flex items-center justify-center gap-1 rounded-full bg-oc-green px-3 py-2 text-xs font-bold text-white transition hover:bg-oc-deep"
                  >
                    <Check className="h-3.5 w-3.5" /> {t('dash.common.accept')}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onRejectRequest?.(incomingPendingRequest.id) }}
                    className="inline-flex items-center justify-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100"
                  >
                    <X className="h-3.5 w-3.5" /> {t('dash.common.reject')}
                  </button>
                </div>
              ) : requestStatus === 'pending' ? (
                // Request already sent for this project; a pill replaces the
                // button so it cannot create a duplicate request.
                <span className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ocaccent-50 px-3 py-2 text-xs font-bold text-ocaccent-600 ring-1 ring-ocaccent-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-ocaccent-400" /> {t('dash.common.requestPending')}
                </span>
              ) : (
                <>
                {/* After a rejected or withdrawn request a new one may be sent,
                    exactly as before; the old status is no longer printed here. */}
                <button
                  disabled={sending}
                  onClick={() => onSendRequest(contractor)}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-oc-green px-3 py-2 text-xs font-bold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? t('dash.common.sending') : t('dash.common.sendRequest')}
                  <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={2.25} />
                </button>
                </>
              )
            )
            if (viewMode === 'table') {
              return (
                <tr
                  key={contractor.id}
                  aria-disabled={unavailable || undefined}
                  className={`align-middle text-sm ${unavailable ? 'pointer-events-none opacity-60' : 'hover:bg-slate-50/60'}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <button type="button" onClick={() => onViewProfile(contractor)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <EntityAvatar user={contractor} role="BUILDER" alt={builderName} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-bold text-oc-ink hover:underline">{builderName}</span><BuilderTierBadge builderId={contractor.user_id} /></span>
                          {companyName && <span className="block truncate text-xs uppercase text-oc-faint">{companyName}</span>}
                        </span>
                      </button>
                      {/* Verified / Newly joined, beside the name. */}
                      <div className="flex shrink-0 flex-col items-start gap-1">
                        {pills.filter((pill) => pill.key !== 'rating').map((pill) => (
                          <EntityPill key={pill.key} tone={pill.tone} icon={pill.icon}>{pill.text}</EntityPill>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-oc-muted">{t('dash.owner.contractors.yearsShort', { n: Number(contractor.experience_years || 0) })}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-oc-muted">{Number(contractor.completed_projects || 0)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="flex items-center gap-1 font-bold text-oc-ink">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {ratingLabel(contractor.rating, contractor.review_count, t)}
                    </span>
                    <span className="block text-xs text-oc-faint">{t('dash.owner.contractors.reviews', { count: Number(contractor.review_count || 0) })}</span>
                  </td>
                  <td className="px-4 py-3">
                    <ServicePills services={contractor.services_offered} />
                  </td>
                  {/* The card's own controls at one fixed width, so every row's
                      buttons line up, and View beside them. */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-36 [&>*:first-child]:mt-0 [&_button]:rounded-xl [&_span]:rounded-xl [&_p]:whitespace-normal [&_p]:text-center">{action}</div>
                      {/* View: the builder's profile, as clicking a card opens it. */}
                      <button
                        type="button"
                        onClick={() => onViewProfile(contractor)}
                        className="inline-flex w-20 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-oc-line bg-white py-2 text-xs font-bold text-oc-ink transition hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" /> {t('dash.owner.contractors.view')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            }
            return (
              <div
                key={contractor.id}
                aria-disabled={unavailable || undefined}
                // h-full + `fill`: every card in a row is the same height.
                className={`relative h-full ${unavailable ? 'pointer-events-none cursor-not-allowed opacity-60 blur-[1px]' : ''}`}
              >
              {/* Newly joined: a badge in the card's top corner. */}
              {pills.some((pill) => pill.key === 'new') && (
                <span className="pointer-events-none absolute end-0 top-0 z-10 inline-flex items-center gap-1 rounded-bl-xl rounded-tr-[18px] bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm">
                  <Sparkles className="h-3 w-3" /> {t('dash.owner.contractors.newlyJoined')}
                </span>
              )}
              <EntityCard
                compact
                fill
                // No "Builder" heading: every card in this list is a builder,
                // and the builder's own name is the card's title.
                tightTop
                onClick={() => onViewProfile(contractor)}
                avatar={
                  /* A builders list, so every row is a CONTRACTOR: their
                      uploaded picture, else the Builder default. */
                  <EntityAvatar user={contractor} role="BUILDER" alt={builderName} />
                }
                title={<span className="inline-flex max-w-full items-center gap-1.5"><span className="truncate">{builderName}</span><BuilderTierBadge builderId={contractor.user_id} /></span>}
                // The company line is always there (blank when there is none),
                // with the Verified mark at its end, so every card is the same
                // size whatever a builder has.
                subtitle={(
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate uppercase">{companyName || ' '}</span>
                    {contractor.is_verified === true && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-ocbrand-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-ocbrand-700">
                        <BadgeCheck className="h-3 w-3" /> {t('dash.common.verified')}
                      </span>
                    )}
                  </span>
                )}
                // No amount on the card: neither the project's budget nor the
                // builder's quotation or contract value is shown here.
                meta={projectMeta || null}
              >
                {/* The table row's figures: experience, completed projects and rating. */}
                <div className="mt-2 grid grid-cols-3 divide-x divide-oc-line rounded-lg bg-slate-50 py-1.5 text-center">
                  <div>
                    <p className="text-[9px] font-semibold text-oc-faint">{t('dash.owner.contractors.colExperience')}</p>
                    <p className="text-xs font-bold text-oc-ink">{t('dash.owner.contractors.yearsShort', { n: Number(contractor.experience_years || 0) })}</p>
                  </div>
                  <div>
                    <p className="truncate px-0.5 text-[9px] font-semibold text-oc-faint">{t('dash.owner.contractors.colCompleted')}</p>
                    <p className="text-xs font-bold text-oc-ink">{Number(contractor.completed_projects || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold text-oc-faint">{t('dash.owner.contractors.colRating')}</p>
                    <p className="flex items-center justify-center gap-1 text-xs font-bold text-oc-ink">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {ratingLabel(contractor.rating, contractor.review_count, t)}
                    </p>
                    <p className="text-[9px] text-oc-faint">{t('dash.owner.contractors.reviews', { count: Number(contractor.review_count || 0) })}</p>
                  </div>
                </div>
                <div className="mt-2 h-[22px] overflow-hidden">
                  <ServicePills services={contractor.services_offered} small />
                </div>
                {/* mt-auto: the buttons sit at the bottom of every card. */}
                <div className="mt-auto flex items-start gap-1.5 pt-2">
                  <div className="min-w-0 flex-1 [&>*:first-child]:mt-0 [&_button]:rounded-lg [&_button]:py-1.5 [&_span]:rounded-lg [&>span]:py-1.5">{action}</div>
                  {/* View: the builder's profile, as clicking the card opens it. */}
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onViewProfile(contractor) }}
                    className="inline-flex w-16 shrink-0 items-center justify-center gap-1 rounded-lg border border-oc-line bg-white py-1.5 text-xs font-bold text-oc-ink transition hover:bg-slate-50"
                  >
                    <Eye className="h-3.5 w-3.5" /> {t('dash.owner.contractors.view')}
                  </button>
                </div>
              </EntityCard>
              </div>
            )
          }
          if (!contractorList.length) {
            return <EmptyState title={t('dash.owner.contractors.emptyTitle')} message={t('dash.owner.contractors.emptySub')} />
          }
          return viewMode === 'table' ? (
            <div className="overflow-x-auto rounded-xl border border-oc-line">
              <table className="w-full min-w-[1040px] table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[22%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-oc-line bg-slate-50 text-xs text-oc-faint">
                    <th className="px-4 py-3 font-semibold">{t('dash.common.builder')}</th>
                    <th className="px-4 py-3 text-center font-semibold">{t('dash.owner.contractors.colExperience')}</th>
                    <th className="px-4 py-3 text-center font-semibold">{t('dash.owner.contractors.colCompleted')}</th>
                    <th className="px-4 py-3 font-semibold">{t('dash.owner.contractors.colRating')}</th>
                    <th className="px-4 py-3 font-semibold">{t('dash.owner.contractors.colSpecialization')}</th>
                    <th className="px-4 py-3 text-right font-semibold">{t('dash.owner.contractors.colAction')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oc-line">{contractorList.map(renderBuilder)}</tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{contractorList.map(renderBuilder)}</div>
          )
        })()}
      </div>
    </Card>
  )
}

export function OwnerEscrowSection({ milestones, projectCountry = 'India' }) {
  const { t, td } = useLanguage()
  return (
    <Card title={t('dash.owner.escrow.title')} icon={Wallet}>
      <div className="space-y-2">
        {(milestones || []).map((milestone) => (
          // Wraps on a phone: the amount and its (translated) status go under
          // the milestone name rather than past the card.
          <div key={milestone.id} className="dash-gold-hover flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-oc-line px-3 py-2.5">
            <span className="min-w-0 text-sm font-medium text-oc-ink">{td(milestone.name)}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-oc-ink">{money(milestone.amount, projectCountry)}</span>
              <StatusPill status={milestone.status} />
            </span>
          </div>
        ))}
        {!milestones?.length && <EmptyState title={t('dash.owner.escrow.emptyTitle')} message={t('dash.owner.escrow.emptySub')} />}
      </div>
    </Card>
  )
}

export function OwnerMessagesSection() {
  return <MessageThread />
}

function OwnerSectionRow({ label, value, required = false }) {
  return (
    <div className="grid grid-cols-1 gap-x-3 border-b border-oc-line py-1.5 last:border-0 sm:grid-cols-[minmax(0,132px)_minmax(0,1fr)] sm:items-baseline">
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-oc-faint">{label}{required && <RequiredMark satisfied={value !== null && value !== undefined && value !== ''} />}</span>
      <span className="min-w-0 break-words text-sm font-bold text-oc-ink">{value || '—'}</span>
    </div>
  )
}

const ownerLabelClass = 'text-[10px] font-extrabold uppercase tracking-wide text-oc-muted'
const ownerInputClass = 'mt-1.5 h-10 w-full rounded-lg border border-oc-line bg-white px-3 text-sm font-semibold text-oc-ink outline-none placeholder:text-oc-faint focus:border-ocbrand-400 focus:ring-2 focus:ring-oc-line'

// The order these fields are read on screen, so "the first invalid one" is the
// first the owner would reach rather than the first the backend happened to
// serialise. project_title and project_description are mandatory to the API but
// are not edited here — the dashboard supplies them — so a message about either
// is carried by the general banner instead.
const OWNER_FIELD_ORDER = [
  'name', 'phone', 'pincode', 'address', 'country_of_residence',
  'building_type', 'construction_type', 'budget', 'land_area', 'floors',
]

/** The one entry point into editing. Every editable card follows this button. */
function OwnerEditButton({ onClick }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-oc-deep px-3 text-xs font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-oc-deep"
    >
      <Pencil className="h-3.5 w-3.5" /> {t('dash.common.edit')}
    </button>
  )
}

export function OwnerProfileSection({
  user,
  userShell,
  profileImageMessage,
  ownerProfileEditDetails,
  updateOwnerProfileEditField,
  saveOwnerProfileChanges,
  resetOwnerProfileEditDetails,
  uploadOwnerProfileImage,
  setProfileImageMessage,
}) {
  const { t, td } = useLanguage()
  // Mandatory labels follow the API's profile_completion definition; no list
  // of required fields is kept in this file.
  const requiredFields = requiredProfileFields(user)
  // The profile reads as plain information until the owner asks to change it.
  // One flag for the whole section, so every editable card opens together and
  // there is exactly one Save for all of them.
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldErrors, formError, registerField, clearErrors, clearFieldError, applyError } = useProfileFormErrors()

  const updateField = (field, value) => {
    updateOwnerProfileEditField(field, value)
    clearFieldError(field)
  }

  const pincodeLookupState = usePincodeAreaLookup(
    editing ? ownerProfileEditDetails.pincode : '',
    undefined,
    ownerProfileEditDetails.country_of_residence || user?.country_of_residence,
  )
  // The pincode resolves the area. Applied here rather than through the hook's
  // own callback because the form state lives in the dashboard: the resolved
  // area fills Address only while Address is still blank, so a street address
  // the owner typed themselves is never overwritten.
  useEffect(() => {
    const resolvedArea = pincodeLookupState.areaDetails?.display
    if (!resolvedArea) return
    if ((ownerProfileEditDetails.address || '').trim()) return
    updateOwnerProfileEditField('address', resolvedArea)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pincodeLookupState.areaDetails?.display])

  const startEditing = () => {
    clearErrors()
    setEditing(true)
  }

  const saveProfile = async () => {
    if (saving) return
    setSaving(true)
    clearErrors()
    try {
      await saveOwnerProfileChanges()
      setEditing(false)
    } catch (error) {
      // The editor stays open with everything the owner entered still in it;
      // the backend decides which field is wrong and this points them at it.
      applyError(error, t('dash.owner.profile.saveError'), OWNER_FIELD_ORDER)
    } finally {
      setSaving(false)
    }
  }

  const cancelEdits = () => {
    resetOwnerProfileEditDetails?.()
    clearErrors()
    setEditing(false)
  }

  const fieldClass = (field) => (
    fieldErrors[field]
      ? `${ownerInputClass.replace('border-oc-line ', '').replace('bg-white ', '')} ${INVALID_FIELD_CLASS}`
      : ownerInputClass
  )

  return (
    <div className="space-y-3">
      {/* No "Settings" heading: the page is already Profile Settings. */}
      <Card>
        {profileImageMessage && <p className="mb-3 text-xs font-semibold text-oc-deep">{profileImageMessage}</p>}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="shrink-0">
            {/* The same avatar this House Owner shows on every other
                screen, settings included. */}
            <img src={avatarFromPath(userShell.profileImageUrl, 'OWNER')} alt="" className="h-24 w-24 rounded-2xl object-cover ring-1 ring-oc-line" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-extrabold text-oc-ink">{td(user?.name) || t('dash.owner.profile.homeOwner')}</h2>
            <p className="mt-0.5 text-sm font-semibold text-oc-muted">
              {user?.email || '—'} · {td(user?.address) || '—'} · {user?.pincode || '—'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-oc-deep px-3 text-xs font-extrabold text-white transition hover:bg-oc-deep">
                <Camera className="h-3.5 w-3.5" /> {user?.profile_image_url ? t('dash.owner.profile.changeImage') : t('dash.owner.profile.addImage')}
                <input type="file" accept={PROFILE_IMAGE_ACCEPT} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadOwnerProfileImage(file).catch((error) => setProfileImageMessage(profileErrorMessage(error, t('dash.common.profileImageUploadFailed')))) }} />
              </label>
              <span className="inline-flex h-9 items-center rounded-full bg-oc-mint px-3 text-xs font-bold text-oc-deep">{t('dash.owner.profile.houseOwner')}</span>
            </div>
            <ProfileImageHint className="mt-1.5" />
          </div>
        </div>
      </Card>

      {/* Address and Pincode are edited once, here. They used to appear under
          Overview as well, which meant two inputs for the same value. */}
      <Card
        title={t('dash.owner.profile.personalInfo')}
        icon={UserRound}
        action={!editing && <OwnerEditButton onClick={startEditing} />}
      >
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className={ownerLabelClass}>{t('dash.common.name')}{requiredFields.has('name') && <RequiredMark />}</span>
              <input ref={registerField('name')} value={ownerProfileEditDetails.name || ''} onChange={(event) => updateField('name', event.target.value)} className={fieldClass('name')} />
              <FieldError message={fieldErrors.name} />
            </label>
            <label>
              <span className={ownerLabelClass}>{t('dash.common.phone')}{requiredFields.has('phone') && <RequiredMark />}</span>
              <input ref={registerField('phone')} value={ownerProfileEditDetails.phone || ''} onChange={(event) => updateField('phone', event.target.value)} className={fieldClass('phone')} />
              <FieldError message={fieldErrors.phone} />
            </label>
            <label>
              <span className={ownerLabelClass}>{t('dash.common.pincode')}{requiredFields.has('pincode') && <RequiredMark />}</span>
              <input ref={registerField('pincode')} value={ownerProfileEditDetails.pincode || ''} onChange={(event) => updateField('pincode', event.target.value)} className={fieldClass('pincode')} />
              <PincodeAreaHint lookupState={pincodeLookupState} />
              <FieldError message={fieldErrors.pincode} />
            </label>
            <label>
              <span className={ownerLabelClass}>{t('dash.common.email')}{requiredFields.has('email') && <RequiredMark />}</span>
              <input value={user?.email || ''} disabled className={`${ownerInputClass} bg-oc-sunken text-oc-muted`} />
            </label>
            <label className="sm:col-span-2">
              <span className={ownerLabelClass}>{t('dash.common.address')}{requiredFields.has('address') && <RequiredMark />}</span>
              <input ref={registerField('address')} value={ownerProfileEditDetails.address || ''} onChange={(event) => updateField('address', event.target.value)} className={fieldClass('address')} />
              <FieldError message={fieldErrors.address} />
            </label>
            <label className="sm:col-span-2">
              <span className={ownerLabelClass}>{t('dash.common.countryOfResidence')}</span>
              <select ref={registerField('country_of_residence')} value={ownerProfileEditDetails.country_of_residence || 'India'} onChange={(event) => updateField('country_of_residence', event.target.value)} className={fieldClass('country_of_residence')}>
                <option value="India">{t('country.india')}</option>
              </select>
              <span className="mt-1 block text-[11px] font-medium text-oc-muted">{t('dash.owner.profile.countryHint')}</span>
              <FieldError message={fieldErrors.country_of_residence} />
            </label>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-0 md:grid-cols-2">
            <OwnerSectionRow required={requiredFields.has('name')} label={t('dash.common.name')} value={td(user?.name)} />
            {/* Phone, email and pincode are identifiers, not words: they are
                read back exactly as they are stored, in every language. */}
            <OwnerSectionRow required={requiredFields.has('phone')} label={t('dash.common.phone')} value={user?.phone} />
            <OwnerSectionRow required={requiredFields.has('email')} label={t('dash.common.email')} value={user?.email} />
            <OwnerSectionRow required={requiredFields.has('pincode')} label={t('dash.common.pincode')} value={user?.pincode} />
            <OwnerSectionRow required={requiredFields.has('address')} label={t('dash.common.address')} value={td(user?.address)} />
            <OwnerSectionRow label={t('dash.common.countryOfResidence')} value={countryText(user?.country_of_residence || 'India', t)} />
          </div>
        )}
      </Card>

      {/* The old "Document Gallery" card held only a second profile-photo
          uploader; the photo is changed from the camera button above. */}

      {/* One Save for the whole profile, at the bottom of the edit section, and
          only while editing. No field saves on its own. */}
      {editing && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-oc-line bg-white px-4 py-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
          {formError && (
            <p className="mr-auto min-w-0 text-sm font-bold text-rose-700">{formError}</p>
          )}
          <button
            type="button"
            onClick={cancelEdits}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-muted transition hover:bg-ocbrand-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> {t('dash.common.cancel')}
          </button>
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-oc-green px-4 text-xs font-extrabold text-white transition hover:bg-oc-deep disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? t('dash.common.saving') : t('dash.common.save')}
          </button>
        </div>
      )}
    </div>
  )
}
