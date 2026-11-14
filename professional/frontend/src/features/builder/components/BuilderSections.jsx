import { useMemo, useState } from 'react'

import { Home, MessageSquare, Plus, Truck, Warehouse } from 'lucide-react'
import MessageThread from '../../messaging/components/MessageThread.jsx'
import StoreBuilderRequestsPanel, { useStoreBuilderRequests } from '../../store/components/StoreBuilderRequestsPanel.jsx'
import { ContractorRequestsBoard } from './BuilderRequestViews.jsx'
import { ContractorProjectDetail, ContractorProjectsTable } from './BuilderProjectViews.jsx'
import { groupProjectsByCategory } from '../builderHelpers.js'
import { projectCategoryTabs } from '../builderConstants.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export function ContractorRequestsSection({
  requestMessage,
  filteredRequestBoardList,
  onAcceptRequest,
  onRejectRequest,
  onWithdrawRequest,
  supplierRequestBoardList = [],
  onNewRequest = null,
}) {
  const { t } = useLanguage()
  // House Owner and Supplier requests are the same stored rows, told apart by
  // request_type. Two tabs rather than one mixed list; each renders the board
  // that already existed for it.
  const [requestTab, setRequestTab] = useState('houseOwner')
  // Requests to and from the Store Managers on this builder's team: their own
  // records and endpoints, not `requests` rows, so they never enter the two boards.
  const storeManagerRequests = useStoreBuilderRequests()
  const requestTabs = [
    { id: 'houseOwner', label: t('dash.contractor.tab.houseOwnerRequests'), count: filteredRequestBoardList.length, icon: Home },
    { id: 'supplier', label: t('dash.contractor.tab.supplierRequests'), count: supplierRequestBoardList.length, icon: Truck },
    { id: 'storeManager', label: t('dash.contractor.tab.storeManagerRequests'), count: storeManagerRequests.data?.requests.length || 0, icon: Warehouse },
  ]
  return (
    <div className="space-y-3">
      {/* Request tabs, with New Request on the same row. New Request opens Find
          Clients, where a builder sends a request -- the existing flow, not a
          second way to create one. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
          {requestTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setRequestTab(tab.id)}
              aria-pressed={requestTab === tab.id}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition ${
                requestTab === tab.id ? 'bg-brand-800 text-white shadow-sm' : 'border border-slate-200 bg-white text-graphite/60 hover:text-graphite'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
        {onNewRequest && (
          <button
            type="button"
            onClick={onNewRequest}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-brand-700 px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-brand-800"
          >
            <Plus className="h-3.5 w-3.5" /> {t('req.board.newRequest')}
          </button>
        )}
      </div>
      {requestMessage && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 px-3.5 py-2 text-[13px] font-semibold text-brand-800">
          {requestMessage}
        </div>
      )}

      {/* Consolidated request table */}
      {requestTab === 'houseOwner' && (
      <section>
        <ContractorRequestsBoard
          requestList={filteredRequestBoardList}
          onAccept={onAcceptRequest}
          onReject={onRejectRequest}
          onWithdraw={onWithdrawRequest}
        />
      </section>
      )}

      {/* The same board, over the supplier rows: one table, one set of status
          filters and one details panel for both tabs, so the two can never show
          the same request in two different shapes. */}
      {requestTab === 'supplier' && (
      <section>
        <ContractorRequestsBoard
          variant="supplier"
          requestList={supplierRequestBoardList}
          onAccept={onAcceptRequest}
          onReject={onRejectRequest}
          onWithdraw={onWithdrawRequest}
        />
      </section>
      )}

      {requestTab === 'storeManager' && (
      <section>
        <StoreBuilderRequestsPanel data={storeManagerRequests.data} failed={storeManagerRequests.failed} reload={storeManagerRequests.reload} />
      </section>
      )}
    </div>
  )
}

export function ContractorProjectsSection({
  selectedProject,
  projectList,
  onSelectProject,
  contractorName,
  timelineEntries,
  activeTab,
  setActiveTab,
  onBackProject,
  teamEngineers = [],
  projectEngineer = null,
  onAssignEngineer = () => {},
  onUnassignEngineer = () => {},
  assignEngineerMessage = '',
  contractorSuppliers = [],
  projectSuppliers = [],
  onAssignSupplier = () => {},
  assignSupplierMessage = '',
  onManageEngineers = null,
}) {
  const { t } = useLanguage()
  const [activeCategory, setActiveCategory] = useState('current')
  // Same projects, only grouped for display. Nothing is added, removed or reordered
  // within a group, so every category keeps the existing newest-first order.
  const projectGroups = useMemo(() => groupProjectsByCategory(projectList), [projectList])
  const activeCategoryTab = projectCategoryTabs.find((tab) => tab.id === activeCategory) || projectCategoryTabs[0]
  const activeCategoryProjects = projectGroups[activeCategoryTab.id]

  // Straight into the full project view. The summary that used to open first
  // is gone; its fields now live in that view's Overview tab.
  const openFullProject = (project) => onSelectProject(project)

  if (selectedProject) {
    return (
      <ContractorProjectDetail
        project={selectedProject}
        contractorName={contractorName}
        timelineEntries={timelineEntries}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onBack={onBackProject}
        teamEngineers={teamEngineers}
        projectEngineer={projectEngineer}
        onAssignEngineer={onAssignEngineer}
        onUnassignEngineer={onUnassignEngineer}
        assignEngineerMessage={assignEngineerMessage}
        contractorSuppliers={contractorSuppliers}
        projectSuppliers={projectSuppliers}
        onAssignSupplier={onAssignSupplier}
        assignSupplierMessage={assignSupplierMessage}
        onManageEngineers={onManageEngineers}
      />
    )
  }
  return (
    <div className="space-y-4">
      {/* All three category tabs always render, including the empty ones. */}
      <div className="dash-scroll flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
        {projectCategoryTabs.map((tab) => {
          const active = activeCategoryTab.id === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveCategory(tab.id)}
              className={`shrink-0 rounded-md px-3.5 py-2 text-[13px] font-extrabold transition ${
                active ? 'bg-brand-900 text-white shadow-sm' : 'text-graphite/70 hover:bg-white hover:text-brand-700'
              }`}
            >
              {t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      {activeCategoryProjects.length > 0 ? (
        // The cards sit straight on the page, as the House Owner's do.
        // Each opens the full project view directly, on Site Activity.
        <ContractorProjectsTable projectList={activeCategoryProjects} onSelect={openFullProject} />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-400">
          {t(activeCategoryTab.emptyKey)}
        </p>
      )}
    </div>
  )
}

export function ContractorMessagesSection() {
  const { t } = useLanguage()
  return (
    <div className="contractor-messages-dark space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-brand-600" />
        <h2 className="font-display text-base font-extrabold text-graphite">{t('ui.messages')}</h2>
      </div>
      <MessageThread />
    </div>
  )
}
