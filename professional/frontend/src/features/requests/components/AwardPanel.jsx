import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Clock, FileSignature, Lock, MessageSquare, XCircle } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatMoney } from '../../messaging/messageHelpers.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { awardWorkStartedUnconfirmed } from '../requestAwards.js'
import {
  acceptAwardOffer,
  cancelAward,
  confirmAwardContract,
  declineAward,
  fetchProjectAward,
  rejectAwardOffer,
  submitAwardOffer,
} from '../requestsApi.js'

// One project's builder assignment -- or, before the owner assigns, the
// negotiation with one builder (`award.assigned` false): its status, the amounts
// on the table, the whole offer history and the actions this viewer may take.
// Agreeing a quotation never assigns the project; only the owner's explicit
// Assign does, and only then can the builder confirm a contract. That Assign
// lives in the project's Assign Builder tab, not here: this panel is the
// request's details and negotiation only. The server decides
// which actions are allowed (`award.actions`); this only renders them. Every
// amount-bearing action sends the amount on screen, so a stale screen gets a
// 409 and reloads instead of agreeing to something else.

const PHASE_TONE = {
  assignment_pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  negotiating: 'bg-sky-50 text-sky-800 ring-sky-200',
  quotation_open: 'bg-sky-50 text-sky-800 ring-sky-200',
  quotation_agreed: 'bg-amber-50 text-amber-800 ring-amber-200',
  builder_confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amount_agreed: 'bg-violet-50 text-violet-800 ring-violet-200',
  contract_confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  declined: 'bg-red-50 text-red-700 ring-red-200',
  cancelled: 'bg-slate-100 text-slate-700 ring-slate-200',
}

// One negotiation round's offers as a timeline: who proposed what, when, and
// how it ended. Used for the current round and for each earlier one.
function OfferTimeline({ offers, money, t, td }) {
  return (
    <ol className="mt-2.5">
      {offers.map((offer, index) => (
        <li key={offer.id} className="relative grid grid-cols-[1rem_1fr] gap-2.5 pb-3 last:pb-0">
          {/* Timeline: a dot per offer, joined to the next one. */}
          {index < offers.length - 1 && <span className="absolute left-[0.4rem] top-4 bottom-0 w-px bg-oc-line" aria-hidden="true" />}
          <span className={`mt-1 h-3 w-3 rounded-full border-2 ${offer.proposed_by === 'owner' ? 'border-oc-green bg-white' : 'border-oc-green bg-oc-green'}`} aria-hidden="true" />
          <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start">
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-5 text-oc-ink">{t(offer.proposed_by === 'owner' ? 'award.byOwner' : 'award.byBuilder')} · {td(offer.proposer_name)}</p>
              <p className="text-xs leading-5 text-oc-muted">{offer.note ? td(offer.note) : '—'}</p>
            </div>
            <div className="sm:text-right">
              <p className="font-display text-[13px] font-extrabold leading-5 text-oc-ink">{money(offer.amount)}</p>
              {offer.created_at && <p className="text-[11px] text-oc-muted">{new Date(offer.created_at + 'Z').toLocaleString()}</p>}
            </div>
            <span className="w-fit rounded-full bg-oc-sunken px-2 py-0.5 text-[10px] font-bold uppercase text-oc-muted ring-1 ring-oc-line">{t(`award.offerStatus.${offer.status}`)}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

function errorText(error, fallback) {
  const detail = error?.response?.data?.detail
  if (detail?.message) return detail.message
  if (typeof detail === 'string') return detail
  return fallback
}

// `readOnly` shows the status and amounts only, with a VIEW REQUEST link: the
// decisions themselves are taken in the request's details, never in two places.
// Presentation only: `details` is rendered between the status banner and the
// amounts (a host page's own project details), and `showParties` hides the
// project / owner / builder strip when that host already shows them, and
// `framed={false}` drops the outer card when the host already frames it.
export default function AwardPanel({ projectId, requestId = null, onChanged, onLoaded, compact = false, readOnly = false, details = null, showParties = true, framed = true }) {
  const { t, td } = useLanguage()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [showCounter, setShowCounter] = useState(false)
  const [counterAmount, setCounterAmount] = useState('')
  const [counterNote, setCounterNote] = useState('')

  // Latest load wins, so a live reload overlapping one in flight cannot be
  // overwritten by the older answer.
  const loadGuard = useLatestOnly()
  const load = useCallback(async () => {
    const isLatest = loadGuard()
    try {
      const response = await fetchProjectAward(projectId, requestId)
      if (!isLatest()) return
      setData(response)
      onLoaded?.(response)
    } catch {
      if (isLatest()) setData(null)
    } finally {
      setLoading(false)
    }
    // onLoaded is a notification only; re-creating it must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, requestId])

  useEffect(() => { load() }, [load])
  // The other side's counter-offer, acceptance or confirmation shows at once.
  useLiveRefresh(load)

  const award = data?.award
  if (loading) return <p className="text-xs font-semibold text-oc-muted">{t('award.loading')}</p>
  if (!award) return null

  const money = (value) => formatMoney(value, award.project_country)
  // The request this assignment was made on, where the decisions are taken.
  const requestPath = award.viewer === 'builder'
    ? `/contractor/requests?request=${award.request_id}`
    : `/owner/projects/${award.project_id}/requests?request=${award.request_id}`
  const agreed = money(award.agreed_amount)
  const openOffer = award.open_offer
  // 'assign' and 'unassign' live in the owner's Assign Builder tab; this
  // panel never draws them.
  const actions = (award.actions || []).filter((action) => action !== 'assign' && action !== 'unassign')
  const isBuilder = award.viewer === 'builder'
  const actionRequired = award.action_required_by && award.action_required_by === award.viewer
  const releaseBlocked = Boolean(award.release_blocked_reason)
  // Work recorded on an assigned award the builder has not confirmed: still a
  // pending contract, said plainly rather than as a fresh assignment.
  const workStartedUnconfirmed = awardWorkStartedUnconfirmed(award)
  // Not assigned yet: the panel is a negotiation, and its words say so.
  const negotiationOnly = award.assigned === false
  // A started project's pending assignment is no longer open for decision.
  const phaseText = award.locked
    ? t('request.flow.ongoing')
    : workStartedUnconfirmed
    ? t('award.status.work_started_unconfirmed')
    : award.phase === 'quotation_agreed'
    ? t(isBuilder ? 'award.status.final_your_confirmation' : 'award.status.final_awaiting_builder', { amount: agreed })
    : award.phase === 'quotation_open'
    ? t(isBuilder ? 'award.status.quotation_your_confirmation' : 'award.status.quotation_awaiting_builder', { amount: agreed })
    : award.phase === 'builder_confirmed'
    ? t('award.status.builder_confirmed', { amount: agreed })
    : award.phase === 'amount_agreed'
    ? t('award.status.amount_agreed', { amount: agreed })
    : award.phase === 'contract_confirmed'
      ? t('award.status.contract_confirmed', { amount: money(award.contract_amount ?? award.agreed_amount) })
      : t(`award.status.${award.phase}`)

  const run = async (action, successMessage = '') => {
    setBusy(true)
    setMessage('')
    try {
      await action()
      setDialog(null)
      setShowCounter(false)
      setCounterAmount('')
      setCounterNote('')
      if (successMessage) setMessage(successMessage)
      await load()
      onChanged?.()
    } catch (error) {
      setMessage(errorText(error, t('award.error')))
      // A changed amount or state: show the current one.
      if (error?.response?.status === 409) await load()
    } finally {
      setBusy(false)
    }
  }

  const submitCounter = (event) => {
    event.preventDefault()
    const amount = Number(counterAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage(t('award.form.invalidAmount'))
      return
    }
    run(() => submitAwardOffer(award.id, amount, counterNote.trim()))
  }

  // The offer on the table and the viewer's own last one, for the headline and
  // the counter form. The other side's standing amount, when nothing is open,
  // is the agreed amount (the quotation until an offer is agreed).
  const openIsMine = Boolean(openOffer) && openOffer.proposed_by === award.viewer
  const myPrevious = [...(award.offers || [])].reverse().find((offer) => offer.proposed_by === award.viewer && offer.id !== openOffer?.id)
  const theirCurrent = openOffer && !openIsMine ? openOffer.amount : award.agreed_amount

  // One line saying where the negotiation stands, in business terms. "Contract"
  // only once the builder has confirmed it.
  let headline = null
  if (!award.locked) {
    if (award.phase === 'negotiating' && openOffer) {
      headline = openIsMine
        ? { label: t('award.headline.yourOffer'), amount: openOffer.amount, sub: t(isBuilder ? 'award.waitingOwner' : 'award.waitingBuilder') }
        : { label: t(openOffer.proposed_by === 'owner' ? 'award.headline.ownerCounter' : 'award.headline.builderCounter'), amount: openOffer.amount, action: true }
    } else if (award.phase === 'quotation_agreed') {
      // Agreed, NOT assigned: the builder's confirmation is next.
      headline = { label: t('award.headline.quotationAccepted'), amount: award.agreed_amount, sub: t(isBuilder ? 'award.confirmFinalQuotationSub' : 'award.awaitingBuilderConfirmation'), action: isBuilder }
    } else if (award.phase === 'builder_confirmed') {
      // Confirmed by the builder, NOT assigned: the owner's assignment is next.
      headline = { label: t('award.headline.builderConfirmed'), amount: award.agreed_amount, sub: t(isBuilder ? 'award.awaitingOwnerAssignment' : 'award.readyToAssign'), action: !isBuilder }
    } else if (award.phase === 'amount_agreed') {
      headline = {
        label: isBuilder ? t('award.headline.assignedToYou') : t('award.headline.assignedTo', { name: td(award.builder_name) }),
        amount: award.agreed_amount,
        sub: t(isBuilder ? 'award.awaitingYourConfirmation' : 'award.awaitingBuilderConfirmation'),
        action: isBuilder,
      }
    } else if (award.phase === 'contract_confirmed') {
      headline = { label: t('award.headline.contractConfirmed'), amount: award.contract_amount ?? award.agreed_amount, done: true }
    }
  }

  const rows = [
    [t('award.project'), td(award.project_title)],
    [t('award.owner'), td(award.owner_name)],
    [t('award.builder'), td(award.builder_name)],
    [t('dash.common.originalBudget'), award.original_budget > 0 ? money(award.original_budget) : t('dash.common.notSet')],
    [t('award.originalQuotation'), money(award.original_quotation)],
    // Only an amount both sides actually agreed; until then it is the quotation above.
    ...(award.agreed_offer_id ? [[t(negotiationOnly ? 'award.agreedQuotation' : 'award.headline.amountAgreed'), agreed, true]] : []),
    ...(award.contract_amount != null ? [[t('dash.common.contractValue'), money(award.contract_amount), true]] : []),
  ]

  const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-oc-green px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50'
  const secondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-oc-line bg-white px-4 py-2 text-sm font-extrabold text-oc-ink transition hover:bg-oc-sunken disabled:cursor-not-allowed disabled:opacity-50'
  const danger = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-extrabold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50'
  // In the action row the buttons keep to one line at their own width.
  const rowButton = 'sm:whitespace-nowrap'

  // The status banner: one line saying where things stand, then what to do next.
  const ended = award.phase === 'declined' || award.phase === 'cancelled'
  const bannerTone = award.locked
    ? { box: 'border-oc-line bg-oc-sunken', icon: 'bg-slate-500', title: 'text-oc-ink', Icon: Lock }
    : headline?.done
      ? { box: 'border-emerald-200 bg-emerald-50', icon: 'bg-emerald-600', title: 'text-emerald-900', Icon: CheckCircle2 }
      : ended
        ? { box: 'border-red-200 bg-red-50', icon: 'bg-red-500', title: 'text-red-800', Icon: XCircle }
        : actionRequired
          ? { box: 'border-amber-200 bg-amber-50', icon: 'bg-amber-500', title: 'text-amber-900', Icon: AlertCircle }
          : { box: 'border-sky-200 bg-sky-50', icon: 'bg-sky-600', title: 'text-sky-900', Icon: Clock }
  const BannerIcon = bannerTone.Icon
  const instructions = [
    award.locked ? t('award.lockedNote') : null,
    award.locked ? award.locked_reason : null,
    actionRequired && isBuilder && award.phase === 'assignment_pending' && !workStartedUnconfirmed ? t('award.awaitingYourDecision') : null,
    workStartedUnconfirmed
      ? (isBuilder ? t('award.workStartedBuilderNote', { amount: agreed }) : t('award.workStartedOwnerNote', { name: td(award.builder_name) }))
      : null,
    actionRequired && isBuilder && award.phase === 'quotation_open' ? t('award.confirmFinalQuotationSub') : null,
    award.action_required_by && !actionRequired && !headline?.sub
      ? t(award.action_required_by === 'owner' ? 'award.waitingOwner' : 'award.waitingBuilder')
      : null,
  ].filter(Boolean)

  // Amounts: the original budget and quotation always; the agreed amount and
  // contract value when they exist (the same rows as before), with the amount
  // on the table now -- the headline -- set apart. A row already shown as the
  // headline is not repeated.
  const [projectRow, ownerRow, builderRow, ...amountRows] = rows
  const headlineCovers = (label) => (
    (award.phase === 'contract_confirmed' && label === t('dash.common.contractValue'))
    || (['quotation_agreed', 'amount_agreed', 'builder_confirmed'].includes(award.phase) && award.agreed_offer_id && label === t(negotiationOnly ? 'award.agreedQuotation' : 'award.headline.amountAgreed'))
  )
  const amountTiles = amountRows.filter(([label]) => !(headline && headlineCovers(label)))
  const headlineTone = headline?.done
    ? 'border-emerald-200 bg-emerald-50'
    : headline?.action
      ? 'border-amber-200 bg-amber-50'
      : 'border-ocbrand-100 bg-ocbrand-50'

  return (
    <div className={`text-oc-ink ${framed ? `rounded-2xl border border-oc-line bg-white shadow-sm ${compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'}` : ''}`}>
      <div className="grid gap-3">
        {/* Status banner */}
        <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 ${bannerTone.box}`}>
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-white ${bannerTone.icon}`}>
            <BannerIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">{t(negotiationOnly ? 'award.titleNegotiation' : 'award.title')}</p>
            <p className={`font-display text-sm font-extrabold leading-snug ${bannerTone.title}`}>
              {actionRequired && <span className="text-red-700">{t('award.actionRequired')} · </span>}
              {phaseText}
            </p>
            {instructions.map((line) => (
              <p key={line} className="mt-0.5 text-xs leading-5 text-oc-muted">{line}</p>
            ))}
          </div>
        </div>

        {/* Planned start date arrived, no work yet: a warning, not a lock. */}
        {!readOnly && !award.locked && !isBuilder && ['today', 'passed'].includes(award.planned_start_notice) && (
          <p className="rounded-xl bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
            {t(award.planned_start_notice === 'today' ? 'quote.plannedStartToday' : 'quote.plannedStartPassed')}
          </p>
        )}

        {/* The host page's project details, between the banner and the amounts. */}
        {details}

        {showParties && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-oc-line px-3.5 py-2.5 sm:grid-cols-3">
            {[projectRow, ownerRow, builderRow].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-oc-muted">{label}</dt>
                <dd className="truncate text-sm font-bold text-oc-ink">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Amounts */}
        <section className="rounded-xl border border-oc-line bg-white px-3.5 py-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-2 sm:px-4">
          <h4 className="shrink-0 text-oc-deep">{t('dash.common.amount')}</h4>
          <div className="mt-1.5 grid grid-cols-2 items-center gap-x-4 gap-y-2 sm:mt-0 sm:flex sm:flex-wrap sm:gap-x-8">
            {amountTiles.map(([label, value, strong]) => (
              <div key={label} className="min-w-0">
                <p className="truncate text-[11px] text-oc-muted">{label}</p>
                <p className={`font-display text-sm leading-5 ${strong ? 'font-extrabold' : 'font-bold'} text-oc-ink`}>{value}</p>
              </div>
            ))}
            {headline && (
              <div className={`col-span-2 w-fit min-w-0 max-w-full rounded-lg border px-2.5 py-1 ${headlineTone}`}>
                <p className="truncate text-[10px] font-extrabold uppercase tracking-wide text-oc-deep">{headline.label}</p>
                <p className="font-display text-base font-extrabold leading-5 text-oc-ink">{money(headline.amount)}</p>
                {headline.sub && (
                  <span className={`mt-0.5 inline-flex rounded px-1.5 py-px text-[10px] font-semibold leading-snug ring-1 ${PHASE_TONE[award.phase] || PHASE_TONE.cancelled}`}>{headline.sub}</span>
                )}
              </div>
            )}
          </div>
          {openOffer?.note && (
            <p className="mt-2 basis-full rounded-lg bg-oc-sunken/50 px-2.5 py-1 text-xs text-oc-muted sm:mt-0">
              <span className="font-bold">{t('award.form.reason')}:</span> {td(openOffer.note)}
            </p>
          )}
        </section>

        {readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-oc-muted">{t('request.flow.manageInRequest')}</p>
            <button type="button" className={primary} onClick={() => navigate(requestPath)}>{t('request.flow.viewRequest')}</button>
          </div>
        )}

        {!readOnly && actions.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {isBuilder && actions.includes('confirm') && (
              <button type="button" disabled={busy} className={`${primary} ${rowButton}`} onClick={() => setDialog('confirm')}>
                <FileSignature className="h-4 w-4" aria-hidden="true" />
                {negotiationOnly
                  ? t('award.confirmQuotation', { amount: agreed })
                  : award.phase === 'amount_agreed' || workStartedUnconfirmed ? t('award.confirmContract', { amount: agreed }) : t('award.agree', { amount: agreed })}
              </button>
            )}
            {actions.includes('accept_offer') && openOffer && (
              <button type="button" disabled={busy} className={`${primary} ${rowButton}`} onClick={() => run(() => acceptAwardOffer(openOffer.id, openOffer.amount))}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {t('award.acceptOffer', { amount: money(openOffer.amount) })}
              </button>
            )}
            {actions.includes('reject_offer') && openOffer && (
              <button type="button" disabled={busy} className={`${secondary} ${rowButton}`} onClick={() => run(() => rejectAwardOffer(openOffer.id))}>
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {t('award.rejectOffer')}
              </button>
            )}
            {actions.includes('counter') && (
              <button type="button" disabled={busy} className={`${secondary} ${rowButton}`} onClick={() => setShowCounter((open) => !open)}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                {isBuilder ? (openOffer ? t('award.counterAgain') : t('award.negotiate')) : t('award.counter')}
              </button>
            )}
            {actions.includes('decline') && (
              <button type="button" disabled={busy || releaseBlocked} className={`${danger} ${rowButton}`} onClick={() => setDialog('decline')}>
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {t(negotiationOnly ? 'award.withdraw' : 'award.reject')}
              </button>
            )}
            {actions.includes('cancel') && (
              <button type="button" disabled={busy || releaseBlocked} className={`${danger} ${rowButton}`} onClick={() => setDialog('cancel')}>
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {t(negotiationOnly ? 'award.cancelNegotiation' : 'award.cancel')}
              </button>
            )}
          </div>
        )}
        {!readOnly && releaseBlocked && (actions.includes('decline') || actions.includes('cancel')) && (
          <p className="-mt-1 text-xs font-semibold text-amber-800">{award.release_blocked_reason}</p>
        )}

        {!readOnly && showCounter && (
          <form onSubmit={submitCounter} className="grid gap-2.5 rounded-xl border border-oc-line bg-oc-sunken p-3.5">
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">{t('award.form.title')}</p>
            <p className="text-xs font-semibold text-oc-muted">
              {isBuilder && !(openOffer && !openIsMine) ? t('award.currentAgreed') : t(isBuilder ? 'award.form.ownerOffer' : 'award.form.builderOffer')}: <b className="text-oc-ink">{money(theirCurrent)}</b>
              {myPrevious ? <> · {t('award.form.yourPrevious')}: <b className="text-oc-ink">{money(myPrevious.amount)}</b></> : null}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-oc-muted">
                {t('award.form.proposedAmount')}
                <input type="number" min="1" required value={counterAmount} onChange={(event) => setCounterAmount(event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2.5 text-sm outline-none focus:border-ocbrand-400" />
                {Number(counterAmount) > 0 && <span className="mt-1 block text-xs font-bold text-oc-ink">{money(counterAmount)}</span>}
              </label>
              <label className="text-xs font-bold text-oc-muted">
                {t('award.form.reason')}
                <textarea maxLength={1000} rows={2} value={counterNote} onChange={(event) => setCounterNote(event.target.value)} className="mt-1 w-full rounded-xl border border-oc-line bg-white px-3 py-2 text-sm outline-none focus:border-ocbrand-400" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} className={primary}>{t('award.form.submit')}</button>
              <button type="button" disabled={busy} className={secondary} onClick={() => setShowCounter(false)}>{t('dash.common.cancel')}</button>
            </div>
          </form>
        )}

        {message && <p className="rounded-xl bg-oc-sunken px-3.5 py-2 text-xs font-bold text-oc-ink">{message}</p>}

        {!readOnly && (
          <section className="rounded-xl border border-oc-line bg-white p-3.5 sm:p-4">
            <h4 className="text-oc-ink">{t('award.history')}</h4>
            {award.offers.length === 0 ? (
              <p className="mt-2 text-sm text-oc-muted">{t('award.noHistory')}</p>
            ) : (
              <OfferTimeline offers={award.offers} money={money} t={t} td={td} />
            )}

            {/* Earlier rounds on this request with this builder -- a negotiation
                that was cancelled or withdrawn before this one began -- kept
                visible, oldest first. */}
            {(award.earlier_rounds || []).length > 0 && (
              <div className="mt-4 border-t border-oc-line pt-3">
                <h5 className="text-xs font-extrabold uppercase tracking-wide text-oc-muted rtl:tracking-normal">{t('award.earlierRounds')}</h5>
                <div className="mt-2 space-y-3">
                  {award.earlier_rounds.map((round, index) => (
                    <div key={round.award_id} className="rounded-lg bg-oc-sunken/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <p className="font-bold text-oc-ink">
                          {t('award.roundLabel', { n: index + 1 })}
                          <span className="ms-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-oc-muted ring-1 ring-oc-line">
                            {t(round.status === 'declined' ? 'award.roundDeclined' : 'award.roundCancelled')}
                          </span>
                        </p>
                        <p className="text-oc-muted">
                          {t('award.roundAgreed', { amount: money(round.agreed_amount) })}
                          {round.ended_at && <span className="ms-2">{new Date(round.ended_at + 'Z').toLocaleString()}</span>}
                        </p>
                      </div>
                      {round.offers.length
                        ? <div className="mt-2.5"><OfferTimeline offers={round.offers} money={money} t={t} td={td} /></div>
                        : <p className="mt-1.5 text-xs text-oc-muted">{t('award.roundNoOffers')}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {!readOnly && dialog && (() => {
        // One dialog for every decision; a negotiation that was never assigned
        // is withdrawn or cancelled, not "rejected" or "unassigned".
        const copy = {
          // Not assigned yet: the builder confirms the final quotation, and the
          // owner then decides whether to assign.
          confirm: negotiationOnly
            ? { title: 'award.dialog.confirmQuotationTitle', body: t('award.dialog.confirmQuotationBody', { amount: agreed }), party: 'owner', amount: 'award.dialog.agreedAmount' }
            : { title: 'award.dialog.confirmTitle', body: t('award.dialog.confirmBody', { amount: agreed }), party: 'owner', amount: 'award.dialog.agreedAmount' },
          // Withdrawing a confirmation the owner never assigned does not bar
          // the builder from this project, so it has its own wording.
          decline: negotiationOnly
            ? { title: 'award.dialog.withdrawTitle', body: t(award.phase === 'builder_confirmed' ? 'award.dialog.withdrawConfirmedBody' : 'award.dialog.withdrawBody'), party: 'owner', amount: 'award.currentAgreed' }
            : { title: 'award.dialog.rejectTitle', body: t('award.dialog.rejectBody'), party: 'owner', amount: 'award.currentAgreed' },
          cancel: negotiationOnly
            ? { title: 'award.dialog.cancelNegotiationTitle', body: t('award.dialog.cancelNegotiationBody'), party: 'builder', amount: 'award.currentAgreed' }
            : { title: 'award.dialog.cancelTitle', body: t('award.dialog.cancelBody'), party: 'builder', amount: 'award.currentAgreed' },
        }[dialog]
        return (
          <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 text-oc-ink shadow-xl">
              <p className="font-display text-lg font-extrabold">{t(copy.title)}</p>
              <dl className="mt-3 grid gap-1 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-oc-muted">{t('award.project')}</dt><dd className="text-right font-bold">{td(award.project_title)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-oc-muted">{t(copy.party === 'builder' ? 'award.builder' : 'award.owner')}</dt><dd className="text-right font-bold">{td(copy.party === 'builder' ? award.builder_name : award.owner_name)}</dd></div>
                <div className="flex justify-between gap-3">
                  <dt className="text-oc-muted">{t(copy.amount)}</dt>
                  <dd className="text-right font-extrabold">{agreed}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-oc-muted">{copy.body}</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" disabled={busy} className={secondary} onClick={() => setDialog(null)}>{t('award.dialog.back')}</button>
                {dialog === 'confirm' && (
                  <button type="button" disabled={busy} className={primary} onClick={() => run(() => confirmAwardContract(award.id, award.agreed_amount))}>
                    {t(negotiationOnly ? 'award.confirmQuotation' : 'award.confirmContract', { amount: agreed })}
                  </button>
                )}
                {dialog === 'decline' && (
                  <button type="button" disabled={busy} className={danger} onClick={() => run(() => declineAward(award.id))}>{t(negotiationOnly ? 'award.withdraw' : 'award.reject')}</button>
                )}
                {dialog === 'cancel' && (
                  <button type="button" disabled={busy} className={danger} onClick={() => run(() => cancelAward(award.id))}>{t(negotiationOnly ? 'award.cancelNegotiation' : 'award.cancel')}</button>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
