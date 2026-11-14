import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { formatMoney } from '../messageHelpers.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import BudgetInWords from '../../../shared/ui/BudgetInWords.jsx'
import { fetchProjectAward } from '../../requests/requestsApi.js'
import { useLiveVersion } from '../../../shared/hooks/useLiveRefresh.js'
import { requestFlowStatus } from '../../requests/requestAwards.js'

// Chat cards stay small: what the event is, which project, one amount and a
// status. Everything else -- the full project, the profiles, the decisions --
// lives in the request, reached through View Request.

// The sender's role code as the role name the rest of the app shows.
const SENDER_ROLE_KEYS = {
  OWNER: 'role.owner',
  CONTRACTOR: 'role.contractor',
  BUILDER: 'role.contractor',
  SUPPLIER: 'role.supplier',
  ENGINEER: 'role.engineer',
}

function senderRoleLabel(role, t) {
  const key = SENDER_ROLE_KEYS[role]
  return (key ? t(key) : String(role)).toLowerCase()
}

// Request outcome codes ('accepted' / 'rejected' / 'withdrawn') as display words.
// Withdrawn is the sender taking the request back, not the receiver's answer.
const ACTION_STATE_KEYS = {
  accepted: 'ui.status.accepted',
  rejected: 'ui.status.rejected',
  withdrawn: 'ui.shared.statusWithdrawn',
}
const CLOSED_STATES = ['accepted', 'rejected', 'withdrawn']
const OWNER_BUILDER_REQUEST_TYPES = ['OWNER_TO_CONTRACTOR', 'CONTRACTOR_TO_OWNER']

/** Where this viewer manages the request, or null when it has no Request Details. */
export function requestLinkFor(details, viewerRole) {
  if (!details?.request_id || !OWNER_BUILDER_REQUEST_TYPES.includes(details.request_type)) return null
  if (viewerRole === 'BUILDER') return `/contractor/requests?request=${details.request_id}`
  if (viewerRole === 'OWNER' && details.project_id) return `/owner/projects/${details.project_id}/requests?request=${details.request_id}`
  return null
}

// Workflow events the server posts as plain text ("COUNTER-OFFER: ...").
const EVENT_KEYS = [
  ['QUOTATION', 'chat.event.quotation'],
  ['COUNTER-OFFER', 'chat.event.counterOffer'],
  ['OFFER ACCEPTED', 'chat.event.offerAccepted'],
  ['OFFER REJECTED', 'chat.event.offerRejected'],
  ['ASSIGNMENT DECLINED', 'chat.event.assignmentDeclined'],
  ['ASSIGNMENT CANCELLED', 'chat.event.assignmentCancelled'],
  ['PROJECT ASSIGNED', 'chat.event.projectAssigned'],
  ['REQUEST ACCEPTED', 'chat.event.requestAccepted'],
]

/** { key, text, amount } for a workflow event message, else null. */
export function parseChatEvent(body) {
  const value = String(body || '')
  const entry = EVENT_KEYS.find(([prefix]) => value.startsWith(`${prefix}:`))
  if (!entry) return null
  const text = value.slice(entry[0].length + 1).trim()
  const amountMatch = text.match(/₹\s?([\d,]+(?:\.\d+)?)/)
  return { key: entry[1], text, amount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null }
}

function ViewRequestButton({ link }) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  if (!link) return null
  return (
    <button
      type="button"
      onClick={() => navigate(link)}
      className="mt-2 inline-flex min-h-9 max-w-full items-center gap-1 rounded-lg border border-brand-200 bg-white px-3 py-1 text-start text-xs font-extrabold leading-tight text-brand-700 transition hover:bg-brand-50"
    >
      {t('request.flow.viewRequest')} <ArrowRight className="h-3 w-3 shrink-0 rtl:-scale-x-100" />
    </button>
  )
}

// The small card frame every workflow message uses.
function EventFrame({ label, title, children }) {
  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-graphite shadow-sm">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-brand-600">{label}</p>
      {title && <p className="mt-0.5 break-words text-sm font-extrabold leading-snug text-graphite">{title}</p>}
      {children}
    </div>
  )
}

function AmountLine({ label, amount, country }) {
  if (!(Number(amount) > 0)) return null
  return (
    <p className="mt-1 text-xs text-graphite/60">
      {label}: <span className="font-display text-sm font-extrabold text-brand-700">{formatMoney(amount, country)}</span>
    </p>
  )
}

export function RequestMessageCard({
  details,
  isMine = false,
  viewerRole,
  canAct,
  needsQuote,
  actionState,
  quoteValue,
  quoteStatus,
  onQuoteChange,
  onAccept,
  onReject,
  onViewProfile,
}) {
  const { t, td, country } = useLanguage()
  const link = requestLinkFor(details, viewerRole)
  const label = details.sender_role ? t('dash.msg.roleRequest', { role: senderRoleLabel(details.sender_role, t) }) : t('dash.common.request')
  const projectTitle = details.project_title && details.project_title !== 'General request' ? td(details.project_title) : null
  const quoted = Number(details.quotation_amount || 0) > 0
  return (
    <EventFrame label={label} title={projectTitle || t('dash.common.request')}>
      <AmountLine
        label={quoted ? t('dash.common.quotation') : t('dash.common.budget')}
        amount={quoted ? details.quotation_amount : details.budget}
        country={details.project_country}
      />
      {CLOSED_STATES.includes(actionState) && (
        <p className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${actionState === 'accepted' ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' : actionState === 'withdrawn' ? 'bg-slate-100 text-slate-600 ring-slate-200' : 'bg-red-50 text-red-600 ring-red-100'}`}>
          {t(ACTION_STATE_KEYS[actionState])}
        </p>
      )}
      {link ? (
        // Builder <-> owner requests are answered, quoted and assigned in the request.
        <div><ViewRequestButton link={link} /></div>
      ) : (
        <>
          {canAct && !CLOSED_STATES.includes(actionState) && (
            <form onSubmit={onAccept} className="mt-2 flex flex-col gap-2">
              {needsQuote && (
                <div className="min-w-0">
                  <input
                    value={quoteValue}
                    onChange={onQuoteChange}
                    type="number"
                    min="1"
                    placeholder={t('ui.requests.quotePh')}
                    className="h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-brand-400 focus:bg-white"
                  />
                  <BudgetInWords value={quoteValue} country={details.project_country || country} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="h-9 rounded-lg bg-brand-600 px-3 text-xs font-extrabold text-white transition hover:bg-brand-700">
                  {needsQuote ? t('dash.msg.acceptWithQuote') : t('dash.common.accept')}
                </button>
                <button type="button" onClick={onReject} className="h-9 rounded-lg border border-red-100 bg-red-50 px-3 text-xs font-extrabold text-red-600 transition hover:bg-red-100">{t('dash.common.reject')}</button>
              </div>
              {quoteStatus && <p className="text-xs font-semibold text-graphite/60">{td(quoteStatus)}</p>}
            </form>
          )}
          {/* Only the other person's profile, never the viewer's own. */}
          {!isMine && onViewProfile && (
            <button type="button" onClick={onViewProfile} className="mt-2 text-xs font-extrabold text-brand-700 hover:text-brand-900">{t('dash.common.viewProfile')}</button>
          )}
        </>
      )}
    </EventFrame>
  )
}

export function AssignmentMessageCard({ details, viewerRole, canConfirm, actionStatus, onConfirm }) {
  const { t, td } = useLanguage()
  const [award, setAward] = useState(null)
  const hasAward = Boolean(details.project_id && details.request_id)
  // Re-read when the other side changes the award (see useLiveVersion).
  const liveVersion = useLiveVersion()
  useEffect(() => {
    if (!hasAward) return undefined
    let alive = true
    fetchProjectAward(details.project_id, details.request_id)
      .then((response) => { if (alive) setAward(response?.award || null) })
      .catch(() => { if (alive) setAward(null) })
    return () => { alive = false }
  }, [details.project_id, details.request_id, hasAward, liveVersion])
  const flow = award ? requestFlowStatus(details, award, award.viewer) : null
  const contract = award?.contract_amount != null
  const amount = award ? (award.contract_amount ?? award.agreed_amount) : (details.quotation_amount || details.budget)
  const assignmentAccepted = actionStatus === 'accepted' || details.status === 'accepted'
  return (
    <EventFrame label={t('dash.msg.projectAssignment')} title={td(details.project_title)}>
      {/* An agreed offer is not the quotation, and not a contract until confirmed. */}
      <AmountLine
        label={contract ? t('dash.common.contractValue') : award?.agreed_offer_id ? t('award.headline.amountAgreed') : t('dash.common.quotation')}
        amount={amount}
        country={award?.project_country}
      />
      {flow ? (
        <p className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">{t(flow.key)}</p>
      ) : !hasAward && (
        <>
          {canConfirm && !assignmentAccepted ? (
            <button type="button" onClick={onConfirm} className="mt-2 h-9 rounded-lg bg-brand-600 px-3 text-xs font-extrabold text-white transition hover:bg-brand-700">
              {t('dash.msg.acceptAssignment')}
            </button>
          ) : (
            <p className="mt-1.5 text-[11px] font-bold text-graphite/60">{assignmentAccepted ? t('dash.msg.assignmentAccepted') : t('dash.msg.assignmentSentDot')}</p>
          )}
          {actionStatus && actionStatus !== 'accepted' && <p className="mt-1 text-xs font-bold text-brand-600">{td(actionStatus)}</p>}
        </>
      )}
      <div><ViewRequestButton link={requestLinkFor({ ...details, request_type: details.request_type || 'CONTRACTOR_TO_OWNER' }, viewerRole)} /></div>
    </EventFrame>
  )
}

/** A quotation / negotiation / assignment event the server posted as text. */
export function ChatEventCard({ event, link, country }) {
  const { t, td } = useLanguage()
  return (
    <EventFrame label={t(event.key)}>
      <AmountLine label={t('dash.common.amount')} amount={event.amount} country={country} />
      {event.text && <p className="mt-1 break-words text-xs leading-5 text-graphite/65">{td(event.text)}</p>}
      <div><ViewRequestButton link={link} /></div>
    </EventFrame>
  )
}
