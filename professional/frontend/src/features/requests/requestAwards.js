import { useCallback, useEffect, useState } from 'react'
import { fetchProjectAward } from './requestsApi.js'
import { useLiveRefresh } from '../../shared/hooks/useLiveRefresh.js'

// The builder <-> owner request is where an assignment is decided. These
// helpers read each accepted request's assignment through the existing
// GET /projects/{id}/award?request_id= call, so the request rows can say
// exactly where the request stands. Nothing here writes.

const OWNER_BUILDER_REQUEST_TYPES = ['OWNER_TO_CONTRACTOR', 'CONTRACTOR_TO_OWNER']

export function hasAssignmentFlow(request) {
  return Boolean(request?.project_id) && request.status === 'accepted' && OWNER_BUILDER_REQUEST_TYPES.includes(request.request_type)
}

/** { [requestId]: award | null } for every accepted owner/builder request, and a reload. */
export function useRequestAwards(requests) {
  const eligible = (requests || []).filter(hasAssignmentFlow)
  const key = eligible.map((request) => `${request.project_id}:${request.id}`).join(',')
  const [awards, setAwards] = useState({})
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all(eligible.map((request) => (
      fetchProjectAward(request.project_id, request.id)
        .then((response) => [request.id, response?.award || null])
        // A builder with no assignment on that request gets "not found".
        .catch(() => [request.id, null])
    ))).then((pairs) => { if (alive) setAwards(Object.fromEntries(pairs)) })
    return () => { alive = false }
    // `key` stands for the eligible list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  // A counter-offer, acceptance, assignment or confirmation by the other side
  // changes the award, not the request list, so it is re-read on a live hint.
  useLiveRefresh(reload)
  return [awards, reload]
}

const PHASE_KEYS = {
  negotiating: 'request.flow.negotiating',
  // quotation_open, quotation_agreed and builder_confirmed (not assigned) are
  // worded per viewer in requestFlowStatus.
  amount_agreed: 'request.flow.amountAgreed',
  contract_confirmed: 'request.flow.contractConfirmed',
  declined: 'request.flow.declined',
  cancelled: 'request.flow.cancelled',
}

/**
 * An assigned award still waiting on the builder's confirmation on a project
 * where work is already recorded. The award API sets `release_blocked_reason`
 * for exactly that case (assigned, pending, work recorded), so no new field is
 * needed. Work does not confirm a contract: only the builder's own Confirm does.
 */
export function awardWorkStartedUnconfirmed(award) {
  return Boolean(award?.release_blocked_reason)
    && award.assigned === true
    && ['assignment_pending', 'amount_agreed'].includes(award.phase)
}

export const FLOW_TONES = {
  action: 'bg-red-50 text-red-700 ring-red-200',
  waiting: 'bg-amber-50 text-amber-800 ring-amber-200',
  negotiating: 'bg-sky-50 text-sky-800 ring-sky-200',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  closed: 'bg-slate-100 text-slate-700 ring-slate-200',
}

/**
 * The request's workflow status for this viewer ('builder' | 'owner'), or null
 * when the request has not reached a quotation yet (the caller keeps its own
 * pending / sent / declined label for those).
 */
export function requestFlowStatus(request, award, viewer) {
  // Started project: the pending assignment is locked, nothing to decide.
  if (award?.locked) return { key: 'request.flow.ongoing', tone: 'confirmed', actionRequired: false }
  if (award) {
    const actionRequired = Boolean(award.action_required_by) && award.action_required_by === viewer
    let key = PHASE_KEYS[award.phase]
    if (award.phase === 'assignment_pending') {
      key = viewer === 'builder' ? 'request.flow.assignedYourConfirmation' : 'request.flow.awaitingBuilder'
    }
    // Assigned, work already recorded, contract still unconfirmed: the
    // confirmation is still required, but the label says work has begun.
    if (awardWorkStartedUnconfirmed(award)) {
      key = viewer === 'builder' ? 'request.flow.workStartedYourConfirmation' : 'request.flow.workStartedAwaitingBuilder'
    }
    // NOT assigned and nothing open: the builder confirms the final amount
    // first; only a confirmed builder can be assigned by the owner.
    if (award.phase === 'quotation_agreed' || award.phase === 'quotation_open') {
      key = viewer === 'builder'
        ? 'request.flow.yourConfirmationRequired'
        : award.phase === 'quotation_agreed' ? 'request.flow.finalAwaitingBuilder' : 'request.flow.waitingBuilderConfirmation'
    }
    if (award.phase === 'builder_confirmed') {
      key = viewer === 'builder' ? 'request.flow.confirmedAwaitingAssignment' : 'request.flow.builderConfirmed'
    }
    const tone = actionRequired
      ? 'action'
      : award.phase === 'contract_confirmed'
        ? 'confirmed'
        : award.phase === 'negotiating'
          ? 'negotiating'
          : ['declined', 'cancelled'].includes(award.phase) ? 'closed' : 'waiting'
    return { key, tone, actionRequired }
  }
  if (!hasAssignmentFlow(request)) return null
  // Accepted, not assigned. Who quoted depends on who opened the request.
  const builderQuotedOnOwnerRequest = request.request_type === 'OWNER_TO_CONTRACTOR'
  if (viewer === 'builder') {
    return { key: builderQuotedOnOwnerRequest ? 'request.flow.quotationSent' : 'request.flow.quotationAccepted', tone: 'waiting', actionRequired: false }
  }
  return { key: builderQuotedOnOwnerRequest ? 'request.flow.quotationReceived' : 'request.flow.quotationAccepted', tone: 'waiting', actionRequired: false }
}
