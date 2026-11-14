import { useState } from 'react'
import { Building2, Search } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { requestEngineerJoin, respondEngineerJoinRequest } from '../../engineers/engineersApi.js'
import { fetchContractorProfile } from '../../accounts/publicProfileApi.js'
import { fetchNearbyContractors } from '../../projects/projectsApi.js'
import { ContractorProfileModal, EngineerContractorsSection, EngineerJoinTeamSection } from '../../engineer/components/EngineerSections.jsx'
import StoreBuilderRequestsPanel, { useStoreBuilderRequests } from './StoreBuilderRequestsPanel.jsx'
import { Notice, inputClass, primaryButton, refusalText, secondaryButton } from './StoreUi.jsx'

// A Store Manager joins a builder by request, on the same team table and the
// same request/accept endpoints a Site Engineer uses: they find builders by
// pincode and ask to join, or accept a builder's request. The builder's team is
// what links this store to that builder's projects and Site Engineers.
export default function StoreBuildersSection({ teams, incomingRequests, contractors, defaultPincode, country, guard, onChanged }) {
  const { t, td } = useLanguage()
  const [tab, setTab] = useState('team')
  const [notice, setNotice] = useState(null)
  const [selected, setSelected] = useState(null)
  const [profile, setProfile] = useState(null)
  const [pincode, setPincode] = useState(defaultPincode || '')
  // null until the Store Manager searches: until then the list is the builders
  // at their own pincode, which the dashboard already loads.
  const [found, setFound] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  // Requests to and from the builders on this Store Manager's team.
  const builderRequests = useStoreBuilderRequests()
  const pendingIncoming = (builderRequests.data?.requests || []).filter((request) => !request.sent_by_me && request.status === 'PENDING').length

  const teamStatus = (contractorId) => {
    const team = teams.find((item) => String(item.contractor_id) === String(contractorId))
    if (!team) return 'none'
    if (team.status === 'ACTIVE') return 'active'
    return team.status === 'PENDING' ? 'pending' : 'rejected'
  }

  const search = async (event) => {
    event.preventDefault()
    setSearchError('')
    if (!/^\d{6}$/.test(pincode)) {
      setSearchError(t('store.builders.pincodeInvalid'))
      return
    }
    setSearching(true)
    try {
      setFound(await fetchNearbyContractors(pincode, country))
    } catch {
      setFound([])
      setSearchError(t('store.builders.searchFailed'))
    } finally {
      setSearching(false)
    }
  }

  const requestJoin = async (contractorId) => {
    if (guard()) return
    try {
      await requestEngineerJoin(contractorId)
      setNotice({ text: t('dash.engineer.msg.joinRequestSent') })
      onChanged()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('dash.engineer.msg.unableJoinRequest')), error: true })
    }
  }

  const respond = async (relationshipId, action) => {
    if (action === 'ACCEPT' && guard()) return
    try {
      await respondEngineerJoinRequest(relationshipId, action)
      setNotice({ text: t(action === 'ACCEPT' ? 'dash.msg.engineerRequestAccepted' : 'dash.msg.engineerRequestRejected') })
      onChanged()
    } catch (error) {
      setNotice({ text: refusalText(error, td, t('dash.engineer.msg.unableJoinRequest')), error: true })
    }
  }

  const viewBuilder = async (contractor) => {
    setProfile(null)
    setSelected(contractor)
    try {
      setProfile(await fetchContractorProfile(contractor.user_id || contractor.id))
    } catch {
      setProfile(null)
    }
  }

  const noBuilders = teams.length === 0 && incomingRequests.length === 0

  return (
    <div className="space-y-3">
      <Notice message={notice} onClose={() => setNotice(null)} />
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === 'team'} onClick={() => setTab('team')} className={`${secondaryButton} ${tab === 'team' ? '!border-brand-300 !bg-brand-50' : ''}`}>{t('store.builders.myBuilders')}</button>
        <button type="button" aria-pressed={tab === 'find'} onClick={() => setTab('find')} className={`${secondaryButton} ${tab === 'find' ? '!border-brand-300 !bg-brand-50' : ''}`}>{t('store.builders.find')}</button>
        <button type="button" aria-pressed={tab === 'requests'} onClick={() => setTab('requests')} className={`${secondaryButton} ${tab === 'requests' ? '!border-brand-300 !bg-brand-50' : ''}`}>
          {t('store.sbr.builderRequests')}
          {pendingIncoming > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{pendingIncoming}</span>}
        </button>
      </div>
      {tab === 'requests' ? (
        <StoreBuilderRequestsPanel data={builderRequests.data} failed={builderRequests.failed} reload={builderRequests.reload} guard={guard} />
      ) : tab === 'team' ? (
        noBuilders ? (
          <section className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
            <Building2 className="mx-auto mb-2 h-8 w-8 text-brand-400" />
            <h2 className="font-display text-base font-extrabold text-slate-950">{t('store.builders.none')}</h2>
            <p className="mx-auto mt-1 max-w-md text-xs font-medium text-slate-500">{t('store.builders.noneSub')}</p>
          </section>
        ) : (
          <EngineerJoinTeamSection
            teams={teams}
            incomingRequests={incomingRequests}
            onRefresh={onChanged}
            onRespondToBuilder={respond}
          />
        )
      ) : (
        <>
          <form onSubmit={search} noValidate className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t('store.builders.pincode')}</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pincode}
                onChange={(event) => { setPincode(event.target.value.replace(/\D/g, '').slice(0, 6)); setSearchError('') }}
                placeholder={t('store.builders.pincodePh')}
                className={inputClass}
              />
            </label>
            <button type="submit" disabled={searching} className={`${primaryButton} !h-10 shrink-0 px-4`}>
              <Search className="h-4 w-4" /> {t('store.builders.search')}
            </button>
          </form>
          {searchError && <p role="alert" className="text-xs font-bold text-rose-700">{searchError}</p>}
          <EngineerContractorsSection
            contractors={found ?? contractors}
            teamStatusByContractor={teamStatus}
            onViewContractor={viewBuilder}
            onRequestJoin={(contractor) => requestJoin(contractor.user_id || contractor.id)}
          />
        </>
      )}
      {selected && (
        <ContractorProfileModal
          contractor={selected}
          profile={profile}
          onClose={() => { setSelected(null); setProfile(null) }}
          onRequestJoin={requestJoin}
          requestState={teamStatus(selected.user_id || selected.id)}
        />
      )}
    </div>
  )
}
