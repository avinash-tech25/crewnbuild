/**
 * The specialist half of the Builder's project Team: the thirteen specialist
 * Engineer Categories, and who currently holds each one on this project.
 *
 * This is the same screen that used to sit under the Site Engineer, moved to the
 * Builder because the Builder owns the project's engineering team. The server
 * endpoints, the request mechanism and the markup are the existing ones; only
 * the surrounding chrome changed, so it now renders as a block inside the
 * existing Team tab beside Site Engineer and Suppliers.
 *
 * Everything here is read from the server. The categories come from
 * /projects/{id}/specialist-team, the people from /specialist-candidates — both
 * filtered and authorised on the backend, so this block only displays what the
 * API already decided the Builder may see.
 */
import { useCallback, useEffect, useState } from 'react'
import { MapPin, UserPlus, UserRound, Users } from 'lucide-react'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar, EntityPill } from '../../../shared/ui/EntityPill.jsx'
import {
  fetchProjectSpecialistCandidates,
  fetchProjectSpecialistTeam,
  sendProjectSpecialistRequest,
} from '../../engineers/engineersApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { optionLabel } from '../../../i18n/optionKeys.js'
import { ENGINEER_CATEGORY_LABEL_KEYS } from '../../onboarding/profileConstants.js'

function statusPill(status, t) {
  if (status === 'accepted') return <EntityPill tone="positive" dot>{t('specialist.assigned')}</EntityPill>
  if (status === 'pending') return <EntityPill tone="accent" dot>{t('specialist.pending')}</EntityPill>
  return <EntityPill tone="neutral">{t('specialist.open')}</EntityPill>
}

/** The category action, worded for the state it is actually in. */
export function actionLabel(status, isOpen, t) {
  if (isOpen) return t('dash.common.cancel')
  if (status === 'accepted') return t('specialist.view')
  if (status === 'pending') return t('specialist.viewRequest')
  return t('specialist.viewEngineers')
}

export default function ContractorProjectSpecialistTeam({ project }) {
  const { t, td } = useLanguage()
  const { requireCompleteProfile } = useProfileGate()
  // The Engineer Category the server stores is an English string that doubles as
  // the value posted back on a request. Only the reading of it is localised; the
  // value handed to openCandidates / sendRequest stays `row.category`.
  const categoryLabel = (category) => optionLabel(t, ENGINEER_CATEGORY_LABEL_KEYS, category)
  const [rows, setRows] = useState([])
  const [openCategory, setOpenCategory] = useState('')
  const [candidates, setCandidates] = useState([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyEngineerId, setBusyEngineerId] = useState(null)

  const loadTeam = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchProjectSpecialistTeam(project.id))
    } catch (error) {
      setMessage(error.response?.data?.detail || t('specialist.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [project.id, t])

  useEffect(() => { loadTeam() }, [loadTeam])

  const openCandidates = async (category) => {
    setMessage('')
    if (openCategory === category) {
      setOpenCategory('')
      setCandidates([])
      return
    }
    setOpenCategory(category)
    setCandidates([])
    try {
      setCandidates(await fetchProjectSpecialistCandidates(project.id, category))
    } catch (error) {
      setMessage(error.response?.data?.detail || t('specialist.loadFailed'))
    }
  }

  // A specialist invitation is a request, so it needs a complete profile. The
  // project travels with the gated action and is used as it was.
  const sendRequest = async (engineerId, category, projectId = project.id) => {
    if (requireCompleteProfile('sendSpecialistRequest', { engineerId, category, projectId })) return
    setMessage('')
    setBusyEngineerId(engineerId)
    try {
      await sendProjectSpecialistRequest(projectId, engineerId)
      // Refresh both, and keep the category open: the other candidates must
      // stay on screen with their own buttons intact.
      await loadTeam()
      setCandidates(await fetchProjectSpecialistCandidates(projectId, category))
      setMessage(t('specialist.requestSent'))
    } catch (error) {
      setMessage(error.response?.data?.detail || t('specialist.requestFailed'))
    } finally {
      setBusyEngineerId(null)
    }
  }

  useResumeGatedAction({
    sendSpecialistRequest: ({ engineerId, category, projectId }) => engineerId && sendRequest(engineerId, category, projectId),
  })

  // How many categories already have an accepted engineer, for the badge.
  const assignedCount = rows.filter((row) => row.status === 'accepted').length

  return (
    <div className="mb-3.5 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <p className="text-lg font-extrabold text-slate-950">{t('team.specialists')}</p>
            <p className="text-sm font-medium text-slate-500">{t('team.specialistsHint')}</p>
          </div>
        </div>
        {!loading && rows.length > 0 && (
          assignedCount > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('team.specialistsAssignedCount', { assigned: assignedCount, total: rows.length })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-600 ring-1 ring-rose-100">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> {t('team.notAssigned')}
            </span>
          )
        )}
      </div>

      {message && (
        <p className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{message}</p>
      )}

      {loading ? (
        <p className="text-xs font-medium text-slate-500">{t('specialist.loading')}</p>
      ) : (
        <div className="space-y-2 border-t border-slate-200 pt-4">
          {rows.map((row) => (
            <section
              key={row.category}
              className={`rounded-xl border bg-white p-3 transition ${openCategory === row.category ? 'border-brand-700 bg-brand-50/40' : 'border-slate-200 hover:border-brand-200'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-slate-950">{categoryLabel(row.category)}</p>
                    <p className="truncate text-xs font-medium text-slate-500">
                      {row.engineer ? td(row.engineer.name) : t('specialist.nobodyYet')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {statusPill(row.status, t)}
                  <button
                    type="button"
                    onClick={() => openCandidates(row.category)}
                    className={openCategory === row.category
                      ? 'inline-flex h-10 items-center justify-center rounded-lg border border-brand-700 bg-white px-4 text-sm font-extrabold text-brand-800 transition hover:bg-brand-50'
                      : 'inline-flex h-10 items-center justify-center rounded-lg bg-brand-900 px-4 text-sm font-extrabold text-white transition hover:bg-brand-800'}
                  >
                    {actionLabel(row.status, openCategory === row.category, t)}
                  </button>
                </div>
              </div>

              {openCategory === row.category && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  {candidates.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                      {t('specialist.noCandidates', { category: categoryLabel(row.category) })}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {candidates.map((engineer) => (
                        <EntityCard
                          key={engineer.user_id}
                          compact
                          icon={UserRound}
                          label={categoryLabel(row.category)}
                          avatar={
                            <EntityAvatar user={engineer} role="ENGINEER" alt={engineer.name} />
                          }
                          title={td(engineer.name)}
                          subtitle={engineer.specialization ? categoryLabel(engineer.specialization) : categoryLabel(row.category)}
                          pills={[{ key: 'pincode', text: engineer.pincode || '—', icon: MapPin }]}
                        >
                          {engineer.request_status === 'accepted' ? (
                            <p className="mt-3 text-center text-[11px] font-extrabold text-emerald-700">
                              {t('specialist.assigned')}
                            </p>
                          ) : engineer.request_status === 'pending' ? (
                            <p className="mt-3 text-center text-[11px] font-extrabold text-ocaccent-600">
                              {t('specialist.pending')}
                            </p>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={busyEngineerId === engineer.user_id || engineer.can_request === false}
                                onClick={() => sendRequest(engineer.user_id, row.category)}
                                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand-900 px-3 text-xs font-extrabold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                              >
                                <UserPlus className="h-3.5 w-3.5" /> {t('specialist.sendRequest')}
                              </button>
                              {engineer.can_request === false && (
                                <p className="mt-1.5 text-center text-[10px] font-semibold text-slate-500">
                                  {t('specialist.categoryFilled')}
                                </p>
                              )}
                            </>
                          )}
                        </EntityCard>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
