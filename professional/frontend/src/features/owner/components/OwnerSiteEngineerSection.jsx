/**
 * Hiring a Site Engineer for a self-construction project.
 *
 * A builder-managed project gets its Site Engineer from the builder. A
 * self-construction project has no builder, so the owner hires one directly —
 * and does it the same way they hire a builder: send a request, wait for it to
 * be accepted, then choose one of the engineers who accepted.
 *
 * Nothing here is a second engineer system. It reads the same
 * `/engineers/find` list the builder reads, sends an ordinary project_requests
 * row through the existing `/project-requests/send`, and the assignment writes
 * the same `project_engineers` row the builder's assignment writes. Once
 * assigned, the site record below is the component the owner's project view
 * already renders.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { HardHat, Send, Star } from 'lucide-react'
import { CardAvatar, CardChip, CardGrid, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import SiteEngineerDashboard from '../../site-work/components/SiteEngineerDashboard.jsx'
// The engineer profile window the builder's Find Site Engineers already opens,
// reused as it is so an engineer's details read the same on both dashboards.
import { ContractorEngineerProfileDrawer } from '../../builder/components/BuilderTeamSections.jsx'
import { assignEngineerFromRequest, fetchNearbyEngineers, fetchProjectEngineer, unassignEngineerFromProject } from '../../engineers/engineersApi.js'
import { fetchIncomingRequests, sendProjectRequest } from '../../requests/requestsApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { ENGINEER_CATEGORY_LABEL_KEYS } from '../../onboarding/profileConstants.js'
import { useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'

// The request type and the engineer category the backend enforces. Named here
// so the screen and the server agree; the server is still the one that decides.
const OWNER_TO_ENGINEER = 'OWNER_TO_ENGINEER'
const SITE_ENGINEER_CATEGORY = 'Site Engineer'

export default function OwnerSiteEngineerSection({ project }) {
  const { t, td } = useLanguage()
  const { requireCompleteProfile } = useProfileGate()

  // An engineer's saved category. It is one of a known list, so it is named
  // from the key table; anything outside that list is text somebody typed and
  // is translated as such rather than shown as it was stored.
  const specializationText = (value) => {
    if (!value) return t('role.engineer')
    const key = ENGINEER_CATEGORY_LABEL_KEYS[value]
    return key ? t(key) : td(value)
  }
  const [engineers, setEngineers] = useState([])
  const [requests, setRequests] = useState([])
  const [assigned, setAssigned] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  // The engineer whose profile is open, and whether a request may be sent from it.
  const [profileEngineer, setProfileEngineer] = useState(null)
  // Whether the "Remove {name} from this project?" confirmation is showing.
  const [confirmRemove, setConfirmRemove] = useState(false)

  const projectId = project?.id || null

  // `quiet` (the live refresh only) reloads without blanking the list first.
  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!projectId) return
    if (!quiet) setLoading(true)
    const [engineerList, requestList, current] = await Promise.all([
      fetchNearbyEngineers(project.pincode, project.project_country, projectId, SITE_ENGINEER_CATEGORY).catch(() => []),
      fetchIncomingRequests().catch(() => []),
      fetchProjectEngineer(projectId).catch(() => ({ engineer: null })),
    ])
    setEngineers(Array.isArray(engineerList) ? engineerList : [])
    setRequests(Array.isArray(requestList) ? requestList : [])
    setAssigned(current?.engineer || null)
    setLoading(false)
  }, [projectId, project?.pincode, project?.project_country])

  useEffect(() => { refresh() }, [refresh])
  // An engineer accepting or declining this owner's request shows at once.
  useLiveRefresh(() => refresh({ quiet: true }))

  // This project's own engineer requests, newest standing per engineer.
  const myRequests = useMemo(() => requests.filter(
    (item) => item.request_type === OWNER_TO_ENGINEER && item.project_id === projectId && item.is_sender,
  ), [requests, projectId])

  const statusFor = (engineerId) => myRequests.find((item) => item.receiver_id === engineerId)?.status || 'none'
  const acceptedRequests = myRequests.filter((item) => item.status === 'accepted')

  // An engineer who has accepted is shown above with the decision to make, so
  // listing them again below would only repeat a card that can do nothing.
  // A pending one stays in the list, where the pending state belongs.
  const browseList = engineers.filter((engineer) => statusFor(engineer.user_id) !== 'accepted')

  // Engineers the server reports as already working on another running
  // project. Read from the same /engineers/find list, so it refreshes with it.
  const workingIds = useMemo(
    () => new Set(engineers.filter((engineer) => engineer.working_on_project).map((engineer) => engineer.user_id)),
    [engineers],
  )

  const engineerById = (engineerId) => engineers.find((engineer) => engineer.user_id === engineerId) || null

  // Asking a Site Engineer is a request like asking a builder: it needs a
  // complete profile. The project id travels with the gated action, so the
  // request resumed after Complete Profile is for this same project.
  const send = async (engineer, targetProjectId = projectId) => {
    if (requireCompleteProfile('sendOwnerEngineerRequest', { recipient: engineer, projectId: targetProjectId })) return
    setMessage('')
    setBusyId(engineer.user_id)
    try {
      await sendProjectRequest({ receiver_id: engineer.user_id, project_id: targetProjectId, request_type: OWNER_TO_ENGINEER })
      setMessage(t('dash.supplier.msg.sentTo', { name: td(engineer.name) }))
      await refresh()
    } catch (error) {
      setMessage(error.response?.data?.detail || t('ui.owner.sendRequestFailed'))
    } finally {
      setBusyId(null)
    }
  }

  useResumeGatedAction({
    sendOwnerEngineerRequest: ({ recipient, projectId: savedProjectId }) => recipient && send(recipient, savedProjectId),
  })

  const assign = async (request) => {
    setMessage('')
    setBusyId(request.id)
    try {
      await assignEngineerFromRequest(request.id)
      setMessage(t('ui.owner.siteEngineerAssigned'))
      await refresh()
    } catch (error) {
      setMessage(error.response?.data?.detail || t('ui.owner.assignEngineerFailed'))
    } finally {
      setBusyId(null)
    }
  }

  // The same /projects/{id}/unassign-engineer the builder uses; the server
  // allows it to the owner only on their own self-construction project.
  const remove = async () => {
    if (!assigned) return
    setConfirmRemove(false)
    setMessage('')
    setBusyId(assigned.user_id)
    try {
      await unassignEngineerFromProject(projectId, assigned.user_id)
      setMessage(t('dash.msg.engineerRemoved'))
      await refresh()
    } catch (error) {
      setMessage(error.response?.data?.detail || t('dash.err.unassignEngineer'))
    } finally {
      setBusyId(null)
    }
  }

  if (!projectId) {
    return <EmptyState icon={HardHat} title={t('ui.owner.noProjectSelected')} message={t('ui.owner.noProjectSelectedSub')} />
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl border border-oc-line bg-oc-mint px-4 py-3 text-sm font-semibold text-oc-deep">{message}</div>
      )}

      {/* Once one is assigned, the section is the site record itself — the same
          component and props the project's Site Activity tab already renders. */}
      {assigned ? (
        <>
          <CardGrid testId="owner-assigned-engineer">
            <ListCard
              key={assigned.user_id}
              onClick={() => setProfileEngineer({ engineer: assigned, canRequest: false })}
              avatar={<CardAvatar src={userAvatarSrc(assigned, 'ENGINEER')} alt={td(assigned.name)} />}
              title={td(assigned.name)}
              subtitle={specializationText(assigned.specialization)}
              status={<CardStatus status="assigned">{t('ui.owner.assignedToThisProject')}</CardStatus>}
              rows={[{ key: 'pincode', label: t('dash.common.pincode'), value: assigned.pincode || '—' }]}
              secondary={!confirmRemove ? (
                <button
                  type="button"
                  disabled={busyId === assigned.user_id}
                  onClick={() => setConfirmRemove(true)}
                  className={cardButtonClass('danger')}
                >
                  {t('dash.contractor.unassign')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className={cardButtonClass('secondary')}
                >
                  {t('dash.common.cancel')}
                </button>
              )}
              primary={confirmRemove ? (
                <button
                  type="button"
                  onClick={remove}
                  className={cardButtonClass('danger')}
                >
                  {t('dash.contractor.confirm')}
                </button>
              ) : null}
            >
              {confirmRemove && (
                <p className="mt-auto text-xs font-extrabold text-oc-ink">{t('dash.contractor.removeEngineer', { name: td(assigned.name) })}</p>
              )}
            </ListCard>
          </CardGrid>
          <div className="site-calendar-dark">
            <SiteEngineerDashboard projectList={[project]} photoOnly />
          </div>
        </>
      ) : (
        <>
          {/* Accepted requests come first: this is the choice the owner has to
              make, and it is the same shape as choosing a builder quotation. */}
          {acceptedRequests.length > 0 && (
            <section>
              <h3 className="font-display text-base font-extrabold text-oc-ink">
                {t('ui.owner.acceptedChooseOne', { count: acceptedRequests.length })}
              </h3>
              <div className="mt-2">
                <CardGrid testId="owner-accepted-engineers" label={t('ui.owner.acceptedChooseOne', { count: acceptedRequests.length })}>
                  {acceptedRequests.map((item) => {
                    // Accepted earlier, but put on another project since: the
                    // same label, with no Assign button.
                    const working = workingIds.has(item.receiver_id)
                    return (
                      <ListCard
                        // Already working on a project: shown dimmed, as before.
                        dimmed={working}
                        key={item.id}
                        onClick={engineerById(item.receiver_id) ? () => setProfileEngineer({ engineer: engineerById(item.receiver_id), canRequest: false }) : undefined}
                        avatar={<CardAvatar src={userAvatarSrc(item, 'ENGINEER')} alt={td(item.sender_name)} />}
                        title={td(item.sender_name)}
                        subtitle={t('role.engineer')}
                        status={<CardStatus status="accepted">{t('dash.common.accepted')}</CardStatus>}
                        secondary={working ? (
                          <span className="text-xs font-bold text-slate-700">{t('ui.owner.alreadyWorkingOnProject')}</span>
                        ) : null}
                        primary={working ? null : (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            onClick={(event) => { event.stopPropagation(); assign(item) }}
                            className={cardButtonClass('primary')}
                          >
                            {busyId === item.id ? t('ui.owner.assigning') : t('ui.owner.assignThisProject')}
                          </button>
                        )}
                      />
                    )
                  })}
                </CardGrid>
              </div>
            </section>
          )}

          <section>
            <h3 className="font-display text-base font-extrabold text-oc-ink">{t('ui.owner.findSiteEngineer')}</h3>
            <p className="mt-0.5 text-xs font-medium text-oc-muted">
              {t('ui.owner.siteEngineersNear', { place: project.pincode || t('ui.owner.yourProject') })}
            </p>
            {loading ? null : browseList.length ? (
              <div className="mt-2">
                <CardGrid testId="owner-engineer-cards" label={t('ui.owner.findSiteEngineer')}>
                  {browseList.map((engineer) => {
                    const status = statusFor(engineer.user_id)
                    // Already on another running project, as the server reports
                    // it: the card says so and offers no request.
                    const working = Boolean(engineer.working_on_project)
                    return (
                      <ListCard
                        key={engineer.user_id}
                        // Already working on a project: shown dimmed, as before.
                        dimmed={working}
                        onClick={() => setProfileEngineer({ engineer, canRequest: !working })}
                        avatar={<CardAvatar src={userAvatarSrc(engineer, 'ENGINEER')} alt={td(engineer.name)} />}
                        title={td(engineer.name)}
                        subtitle={specializationText(engineer.specialization)}
                        rows={[
                          { key: 'pincode', label: t('dash.common.pincode'), value: engineer.pincode || '—' },
                        ]}
                        chips={[
                          <CardChip key="rating" tone="blue" icon={Star}>{String(engineer.rating || t('dash.common.new'))}</CardChip>,
                        ]}
                        secondary={working ? (
                          <span className="text-xs font-bold text-slate-700">{t('ui.owner.alreadyWorkingOnProject')}</span>
                        ) : status === 'pending' ? (
                          <CardStatus status="pending">{t('dash.common.requestPending')}</CardStatus>
                        ) : null}
                        primary={working || status === 'pending' ? null : (
                          <button
                            type="button"
                            disabled={busyId === engineer.user_id}
                            onClick={(event) => { event.stopPropagation(); send(engineer) }}
                            className={cardButtonClass('primary')}
                          >
                            {busyId === engineer.user_id ? t('dash.common.sending') : t('dash.common.sendRequest')}
                            <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
                          </button>
                        )}
                      />
                    )
                  })}
                </CardGrid>
              </div>
            ) : (
              <div className="mt-2">
                <EmptyState
                  icon={HardHat}
                  title={engineers.length ? t('ui.owner.everyoneReplied') : t('ui.owner.noEngineersNearby')}
                  message={engineers.length
                    ? t('ui.owner.chooseAcceptedAbove')
                    : t('ui.owner.noEngineersNearbySub')}
                />
              </div>
            )}
          </section>
        </>
      )}

      <AnimatePresence>
        {profileEngineer && (
          <ContractorEngineerProfileDrawer
            engineer={profileEngineer.engineer}
            onClose={() => setProfileEngineer(null)}
            // Send Request is offered only where the card itself offers it: an
            // available engineer with no pending request here. The request is
            // the same `send` the card's button runs.
            onSendRequest={profileEngineer.canRequest && statusFor(profileEngineer.engineer.user_id) !== 'pending'
              ? async (engineer) => { setProfileEngineer(null); await send(engineer) }
              : undefined}
            teamStatus={null}
            requestSent={statusFor(profileEngineer.engineer.user_id) === 'pending'}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
