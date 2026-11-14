import { useEffect, useState } from 'react'
import {
  CalendarCheck, CalendarDays, HardHat, Settings, Truck, UserPlus, UserRound, Users, X,
} from 'lucide-react'
import SiteEngineerDashboard from '../../site-work/components/SiteEngineerDashboard.jsx'
import ContractorProjectSpecialistTeam from './BuilderProjectSpecialistTeam.jsx'
import { constructionTypeLabel } from '../../../shared/utils/roleLabels.js'
import { completionPercent, completionText, formatPercent, scheduleText, scheduleWidth } from '../../../shared/utils/projectProgress.js'
import StatusPill from '../../../shared/dashboard/StatusPill.jsx'
import { EntityCard } from '../../../shared/ui/EntityCard.jsx'
import { EntityAvatar } from '../../../shared/ui/EntityPill.jsx'
import { imageUrl } from '../../../shared/api/apiClient.js'
import { defaultProjectImage } from '../../owner/components/OwnerProjectViews.jsx'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import { userAvatarSrc } from '../../../shared/ui/avatars.js'
import { SmartImage } from '../../../shared/ui/ui.jsx'
import ProjectCameraPanel from '../../cameras/components/ProjectCameraPanel.jsx'
import OwnerProjectAnalysisView from '../../owner/components/OwnerProjectAnalysisView.jsx'
import { SITE_ENGINEER_CATEGORY, projectDetailTabs } from '../builderConstants.js'
import { buildingTypeText, formatProjectDate, inr, projectStatusText } from '../builderHelpers.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { supplierTypeOptions } from '../../onboarding/profileConstants.js'
import { optionLabel, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'

// The builder's projects as cards, in the House Owner Projects layout: the same
// EntityCard, avatar, grid and row heights. The fields are the builder's own
// (house owner, type, floors, budget, progress, Site Engineer, status), and a
// click opens the project exactly as the table row did.
export function ContractorProjectsTable({ projectList, onSelect }) {
  const { t, td } = useLanguage()
  return (
    <div className="builder-project-cards grid auto-rows-[minmax(211px,1fr)] grid-cols-1 gap-3 sm:auto-rows-[minmax(215px,1fr)] sm:grid-cols-2 lg:grid-cols-3">
      {projectList.map((project) => {
        const ownerName = project.owner?.name || project.owner_name || ''
        const cardTitle = td(project.title)
        const elapsed = scheduleWidth(project)
        const schedule = scheduleText(project, t)
        // Completion once it can be measured; until then the schedule
        // percentage the bar shows -- only once work has actually started on
        // site (`work_started`); a passed start date alone is no progress.
        const progressValue = completionPercent(project) !== null
          ? completionText(project, t)
          : project.work_started !== true
            ? t('progress.scheduleNotStarted')
            : ['in_progress', 'end_date_passed'].includes(project.schedule_status) ? formatPercent(elapsed) : ''
        return (
          <div key={project.id} className="relative h-full">
            {/* The project status, in the card's top corner beside the title. */}
            <span className="pointer-events-none absolute end-3 top-3 z-[1] max-wide:end-2.5 max-wide:top-2.5">
              <StatusPill status={project.status || 'active'} />
            </span>
            <EntityCard
              compact
              fill
              onClick={() => onSelect(project)}
              avatar={
                <EntityAvatar
                  src={project.cover_image_url ? imageUrl(project.cover_image_url) : defaultProjectImage}
                  alt={cardTitle}
                  fallback={cardTitle.trim().slice(0, 1).toUpperCase() || '•'}
                />
              }
              // Room on the right of the name for the status in the corner.
              title={<span className="block truncate pe-20">{cardTitle}</span>}
              // The address and pincode as the subtitle, as on the House Owner's
              // project card.
              subtitle={`${td(project.address) || t('dash.owner.estimates.locationNotSet')} ${project.pincode || ''}`.trim()}
              // The House Owner card's pills, from the builder's side: who the
              // project is for, its land area, and its building type.
              pills={[
                ...(ownerName ? [{ key: 'owner', text: td(ownerName), icon: UserRound, tone: 'positive' }] : []),
                { key: 'area', text: t('dash.owner.sqft', { area: project.land_area ?? 0 }), tone: 'info' },
                // The stored code, translated. Re-casing it ("RESIDENTIAL" ->
                // "Residential") only produced an English word.
                { key: 'type', text: buildingTypeText(project.building_type, t) || t('dash.common.notSet'), tone: 'accent' },
              ]}
            >
              {/* The planned start and end dates on one line ("Not set" if
                  empty), so the card keeps the House Owner card's size. */}
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                {[
                  [CalendarDays, t('dash.owner.projectDetails.startDate'), formatProjectDate(project.start_date, t)],
                  [CalendarCheck, t('dash.owner.projectDetails.endDate'), formatProjectDate(project.end_date, t)],
                ].map(([Icon, label, value]) => (
                  <span key={label} className="inline-flex min-w-0 items-center gap-1 font-semibold text-oc-muted">
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}: <b className="font-bold text-oc-ink">{value}</b></span>
                  </span>
                ))}
              </div>

              {/* Site Engineer: the same Assigned / Assignment required badges. */}
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-[11px] font-semibold text-oc-muted">{t('dash.contractor.siteEngineer')}:</span>
                {project.assigned_engineer ? (
                  <>
                    <span className="inline-flex shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 ring-1 ring-emerald-200">{t('dash.contractor.assigned')}</span>
                    <span className="min-w-0 truncate text-[11px] font-bold text-slate-700">{td(project.assigned_engineer.name)}</span>
                  </>
                ) : (
                  <span className="inline-flex shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-extrabold uppercase text-brand-700 ring-1 ring-brand-200">{t('dash.contractor.assignmentRequired')}</span>
                )}
              </div>

              {/* Progress on the left, the amount on the right, pinned to the
                  foot of the card as on the owner cards. */}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2">
                <span className="text-[11px] font-semibold text-oc-muted">{progressValue ? `${t('dash.contractor.progress')}: ${progressValue}` : ''}</span>
                {/* The confirmed contract once there is one, else the owner's budget. */}
                <span className="text-sm font-extrabold text-oc-ink">{inr(project.contract_amount ?? project.awarded_amount ?? project.budget, project.project_country)}</span>
              </div>

              {/* Fills to the schedule figure below (elapsed planned time). */}
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${project.work_started === true ? elapsed : 0}%` }} />
              </div>
              <div className="mt-1 flex min-h-[15px] items-center gap-2">
                <p aria-hidden={schedule ? undefined : true} className="min-w-0 flex-1 truncate text-[10px] font-semibold text-oc-muted">{schedule ? `${t('progress.schedule')}: ${schedule}` : ''}</p>
              </div>
            </EntityCard>
          </div>
        )
      })}
    </div>
  )
}

export function ContractorProjectDetail({
  project,
  contractorName,
  activeTab,
  setActiveTab,
  onBack,
  teamEngineers = [],
  projectEngineer = null,
  onAssignEngineer = () => {},
  onUnassignEngineer = () => {},
  assignEngineerMessage = '',
  contractorSuppliers = [],
  projectSuppliers = [],
  onAssignSupplier = () => {},
  assignSupplierMessage = '',
  // Opens My Site Engineers, from the Team tab's empty state.
  onManageEngineers = null,
}) {
  const { t, td } = useLanguage()
  const [selectedEngineerId, setSelectedEngineerId] = useState('')
  const [confirmUnassign, setConfirmUnassign] = useState(false)
  // Which of the three existing Team areas is on screen. Site Engineer first,
  // matching the order the section has always been laid out in.
  const [teamTab, setTeamTab] = useState('siteEngineer')
  // Labelled with the keys each block already renders as its own heading, so
  // the tabs and the sections they reveal always read the same.
  const teamTabs = [
    { id: 'siteEngineer', label: t('dash.contractor.siteEngineer'), sub: t('team.cardSiteEngineerSub'), icon: HardHat },
    { id: 'suppliers', label: t('team.suppliers'), sub: t('team.cardSuppliersSub'), icon: Truck },
    { id: 'specialists', label: t('team.specialists'), sub: t('team.cardSpecialistsSub'), icon: Users },
  ]
  const siteEngineers = teamEngineers.filter(
    (engineer) => (engineer.specialization || '').trim() === SITE_ENGINEER_CATEGORY,
  )
  const assignedSupplierIds = new Set(projectSuppliers.map((supplier) => supplier.user_id))
  // The Builder's accepted suppliers, grouped by the category each supplier
  // saved on their own profile. Nothing is inferred from a name or a product
  // list, and a supplier who has not chosen yet is still listed and assignable
  // rather than disappearing from a flow that worked before.
  const supplierGroups = [
    ...supplierTypeOptions.map((supplierType) => ({
      key: supplierType,
      label: optionLabel(t, SUPPLIER_TYPE_KEYS, supplierType),
      suppliers: contractorSuppliers.filter((supplier) => supplier.supplier_category === supplierType),
    })),
    {
      key: 'uncategorised',
      label: t('team.supplierNoCategory'),
      suppliers: contractorSuppliers.filter((supplier) => !supplierTypeOptions.includes(supplier.supplier_category)),
    },
  ].filter((group) => group.suppliers.length > 0)
  useEffect(() => {
    setSelectedEngineerId('')
    setConfirmUnassign(false)
    setTeamTab('siteEngineer')
  }, [project?.id])

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_20px_58px_-48px_rgba(15,23,42,0.75)]">
      <div className="mb-3.5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 shadow-sm transition hover:bg-brand-50">
            {t('dash.owner.projectDetails.backToProjects')}
          </button>
        </div>
        <div className="dash-scroll flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
          {projectDetailTabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-md px-3.5 py-2 text-[13px] font-extrabold transition ${
                  // Live Camera stands out: red, blinking (live-camera-blink, index.css).
                  tab.id === 'liveCamera'
                    ? `live-camera-blink font-black ${active ? 'bg-red-700 text-white shadow-sm ring-2 ring-red-300' : 'bg-red-600 text-white hover:bg-red-700'}`
                    : active ? 'bg-brand-900 text-white shadow-sm' : 'text-graphite/70 hover:bg-white hover:text-brand-700'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Project Team: a heading, the three existing Team areas as selectable
          cards, then the selected area. Every assign / unassign below is the
          existing one, unchanged; only the layout is new. */}
      {activeTab === 'team' && (
      <div className="mb-3.5">
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-slate-950">{t('team.pageTitle')}</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">{t('team.pageSub')}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {teamTabs.map((tab) => {
            const active = teamTab === tab.id
            const TabIcon = tab.icon
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTeamTab(tab.id)}
                aria-pressed={active}
                className={`flex items-start gap-3 rounded-xl border p-4 text-start transition ${
                  active ? 'border-brand-700 bg-brand-50 shadow-sm' : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50'
                }`}
              >
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${active ? 'bg-white text-brand-800' : 'bg-slate-100 text-slate-700'}`}>
                  <TabIcon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-extrabold text-slate-950">{tab.label}</span>
                  <span className="mt-0.5 block text-xs font-medium leading-5 text-slate-500">{tab.sub}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      )}

      {activeTab === 'team' && teamTab === 'siteEngineer' && (
      <div className="mb-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
              <HardHat className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-extrabold text-slate-950">{t('dash.contractor.siteEngineer')}</p>
              <p className="text-sm font-medium text-slate-500">{t('team.siteEngineerPanelSub')}</p>
            </div>
          </div>
          {projectEngineer ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('dash.contractor.assignedName', { name: td(projectEngineer.name) })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-600 ring-1 ring-rose-100">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> {t('team.notAssigned')}
            </span>
          )}
        </div>
        {projectEngineer && (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SmartImage src={userAvatarSrc(projectEngineer, 'ENGINEER')} alt={projectEngineer.name} className="h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-slate-950">{td(projectEngineer.name)}</p>
                <p className="text-xs font-medium text-slate-500">{t('dash.contractor.engineerMeta', { pincode: projectEngineer.pincode || '—', years: projectEngineer.experience_years || 0 })}</p>
              </div>
            </div>
            {!confirmUnassign ? (
              <button
                type="button"
                onClick={() => setConfirmUnassign(true)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 text-xs font-extrabold text-rose-600 transition hover:bg-rose-50"
              >
                <X className="h-3.5 w-3.5" /> {t('dash.contractor.unassign')}
              </button>
            ) : (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <p className="text-xs font-extrabold text-slate-700">{t('dash.contractor.removeEngineer', { name: td(projectEngineer.name) })}</p>
                <button
                  type="button"
                  onClick={() => setConfirmUnassign(false)}
                  className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-600 transition hover:bg-slate-100"
                >
                  {t('dash.common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmUnassign(false)
                    onUnassignEngineer(project.id, projectEngineer.user_id)
                  }}
                  className="inline-flex h-9 items-center rounded-lg bg-rose-600 px-3 text-xs font-extrabold text-white transition hover:bg-rose-700"
                >
                  {t('dash.contractor.confirm')}
                </button>
              </div>
            )}
          </div>
        )}
        {!projectEngineer && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <label htmlFor={`site-engineer-${project.id}`} className="text-sm font-extrabold text-slate-800">{t('team.availableSiteEngineers')}</label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                id={`site-engineer-${project.id}`}
                value={selectedEngineerId}
                onChange={(event) => setSelectedEngineerId(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="">{t('team.selectSiteEngineer')}</option>
                {/* An engineer already working on a running project cannot be
                    picked for this one; the server refuses it as well. */}
                {siteEngineers.map((engineer) => (
                  <option key={engineer.user_id} value={engineer.user_id} disabled={Boolean(engineer.working_on_project)}>
                    {td(engineer.name)} — {engineer.working_on_project ? t('ce.workingOnAnotherProject') : (engineer.pincode || t('dash.contractor.noPincode'))}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedEngineerId}
                onClick={() => onAssignEngineer(project.id, selectedEngineerId)}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-900 px-6 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                <UserPlus className="h-4 w-4" /> {t('team.assignEngineer')}
              </button>
            </div>
          </div>
        )}
        {assignEngineerMessage && <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{assignEngineerMessage}</p>}
        {siteEngineers.length === 0 && !projectEngineer && (
          <div className="mt-4 flex flex-col items-center rounded-xl border border-slate-200 px-4 py-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-brand-800">
              <Users className="h-6 w-6" />
            </span>
            <p className="mt-3 text-base font-extrabold text-slate-950">{t('team.noSiteEngineersTitle')}</p>
            <p className="mt-1 text-sm font-medium text-slate-500">{t('team.noSiteEngineersSub')}</p>
            {onManageEngineers && (
              <button
                type="button"
                onClick={onManageEngineers}
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-brand-700 bg-white px-5 text-sm font-extrabold text-brand-800 transition hover:bg-brand-50"
              >
                <Settings className="h-4 w-4" /> {t('team.manageSiteEngineers')}
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {activeTab === 'team' && teamTab === 'suppliers' && (
      <div className="mb-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-lg font-extrabold text-slate-950">{t('team.suppliers')}</p>
              <p className="text-sm font-medium text-slate-500">{t('team.suppliersHint')}</p>
            </div>
          </div>
          {projectSuppliers.length > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('team.suppliersAssignedCount', { count: projectSuppliers.length })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-600 ring-1 ring-rose-100">
              <span className="h-2 w-2 rounded-full bg-rose-500" /> {t('team.notAssigned')}
            </span>
          )}
        </div>

        {!projectEngineer && contractorSuppliers.length > 0 && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">{t('team.supplierNeedsEngineer')}</p>
        )}

        {contractorSuppliers.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-xl border border-slate-200 px-4 py-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-brand-800">
              <Truck className="h-6 w-6" />
            </span>
            <p className="mt-3 text-base font-extrabold text-slate-950">{t('team.noSuppliersTitle')}</p>
            <p className="mt-1 text-sm font-medium text-slate-500">{t('team.noSuppliersSub')}</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4">
            {supplierGroups.map((group) => (
              <div key={group.key}>
                <p className="mb-2 text-sm font-extrabold text-slate-800">
                  {group.label} <span className="font-semibold text-slate-500">({group.suppliers.length})</span>
                </p>
                <div className="grid gap-2">
                  {group.suppliers.map((supplier) => {
                    const assigned = assignedSupplierIds.has(supplier.user_id)
                    return (
                      <div key={supplier.user_id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-200 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <SmartImage src={userAvatarSrc(supplier, 'SUPPLIER')} alt={supplier.name} className="h-11 w-11 shrink-0 rounded-full object-cover" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-extrabold text-slate-950">{td(supplier.store_name || supplier.name)}</p>
                            <p className="text-xs font-medium text-slate-500">
                              {supplier.supplier_category
                                ? `${optionLabel(t, SUPPLIER_TYPE_KEYS, supplier.supplier_category)} · ${supplier.pincode || '—'}`
                                : supplier.pincode || '—'}
                            </p>
                          </div>
                        </div>
                        {assigned ? (
                          <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 ring-1 ring-emerald-100">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {t('team.assigned')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!projectEngineer}
                            onClick={() => onAssignSupplier(project.id, supplier.user_id, projectEngineer?.user_id)}
                            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-900 px-5 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            <UserPlus className="h-4 w-4" /> {t('team.assign')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {assignSupplierMessage && <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2.5 text-sm font-bold text-brand-800">{assignSupplierMessage}</p>}
      </div>
      )}

      {/* The specialist Engineer Categories for this project. Self-contained:
          it loads its own data for this project id from the existing endpoints. */}
      {activeTab === 'team' && teamTab === 'specialists' && <ContractorProjectSpecialistTeam project={project} />}

      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          {activeTab === 'details' && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
              {[
                [t('dash.common.projectName'), td(project.title), false],
                [t('dash.common.description'), td(project.description), true],
                [t('dash.common.address'), td(project.address), false],
                [t('dash.common.pincode'), project.pincode, false],
                // The stored codes, rendered through their label maps rather
                // than printed raw.
                [t('dash.common.constructionType'), constructionTypeLabel(project.construction_type, t), false],
                [t('dash.common.buildingType'), buildingTypeText(project.building_type, t), false],
                [t('dash.common.landArea'), `${project.land_area || 0} ${t('dash.owner.profile.sqFt')}`, false],
                [t('dash.common.floors'), project.floors, false],
                // Merged in from the project-summary view that used to open
                // first. Same data sources it read, same labels used elsewhere.
                [t('dash.common.status'), projectStatusText(project.status || 'active', t), false],
                // Completion only once it can be measured.
                ...(completionPercent(project) !== null ? [[t('progress.completion'), completionText(project, t), false]] : []),
                [t('progress.schedule'), scheduleText(project, t) || t('dash.common.notSet'), false],
                ...(project.contract_amount != null ? [[t('dash.common.contractValue'), inr(project.contract_amount, project.project_country), false]] : []),
                ...(project.contract_amount == null && project.awarded_amount != null ? [[t('request.flow.builderQuotation'), inr(project.awarded_amount, project.project_country), false]] : []),
                [t(project.contract_amount != null || project.awarded_amount != null ? 'dash.common.originalBudget' : 'dash.common.budget'), project.budget ? inr(project.budget, project.project_country) : t('dash.common.notSet'), false],
                [t('dash.owner.projectDetails.startDate'), formatProjectDate(project.start_date, t), false],
                [t('dash.owner.projectDetails.endDate'), formatProjectDate(project.end_date, t), false],
              ].map(([label, value, wide]) => (
                <div key={label} className={`rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ${wide ? 'col-span-2 md:col-span-3 xl:col-span-4' : ''}`}>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-graphite/40">{label}</p>
                  <p className="mt-0.5 truncate text-xs font-bold text-graphite">{value || t('dash.common.notSet')}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="site-calendar-dark">
              <SiteEngineerDashboard projectList={[project]} contractorName={contractorName} />
            </div>
          )}

          {/* Project Analysis: read-only figures for this project only. */}
          {activeTab === 'analysis' && <OwnerProjectAnalysisView project={project} viewer="builder" />}

          {/* The project's shared camera. The panel decides for itself whether
              this builder has completed the DVR/NVR verification and shows
              either the setup screen or the cameras. */}
          {activeTab === 'liveCamera' && (
            <ProjectCameraPanel projectId={project.id} projectTitle={td(project.title)} />
          )}

          {activeTab === 'payments' && (
            <div className="space-y-3">
              {(project.escrow_milestones || []).map((milestone) => (
                <div key={milestone.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="font-bold text-graphite">{td(milestone.name)}</p>
                    <p className="text-xs text-graphite/50">{t('dash.owner.projectDetails.escrowMilestone')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-extrabold text-brand-700">{inr(milestone.amount, project.project_country)}</p>
                    <StatusPill status={milestone.status} />
                  </div>
                </div>
              ))}
              {!project.escrow_milestones?.length && <EmptyState title={t('dash.owner.projectDetails.noMilestones')} message={t('dash.owner.projectDetails.milestonesHint')} />}
            </div>
          )}
        </div>
    </section>
  )
}
