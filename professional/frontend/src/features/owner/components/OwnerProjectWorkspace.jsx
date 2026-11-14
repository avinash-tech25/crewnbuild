/**
 * One project, opened as a page of its own.
 *
 * The House Owner reaches this by clicking a card on the Projects page, which
 * is a real navigation to `/owner/projects/<id>` — not a panel that opens in
 * front of the catalogue. Everything on this page is scoped to that one
 * project, so nothing here has to ask which project is "current": the URL
 * already said.
 *
 * The sections are the ones the owner used to reach from the top navigation,
 * moved in here where they belong to a project. Which of them exist depends on
 * how the project is being built, and that is the same rule the top navigation
 * has always applied:
 *
 *   a builder-managed project  Builders   (find and appoint a builder)
 *   a self-construction project  Site Engineer + Suppliers
 *
 * Every section renders the component it already rendered — this file chooses
 * between them, it does not reimplement any of them.
 */
import { useMemo } from 'react'
import { ArrowLeft, BarChart3, Camera, FileText, HardHat, Images, LayoutDashboard, Receipt, Truck, UserCheck, Wallet } from 'lucide-react'
import OwnerSiteEngineerSection from './OwnerSiteEngineerSection.jsx'
import OwnerSupplierHub from './OwnerSupplierHub.jsx'
import { OwnerContractorsSection, OwnerEscrowSection, OwnerRequestsSection } from './OwnerSections.jsx'
import { ProjectDetailPanel } from './OwnerProjectViews.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'

export const PROJECT_SECTION_DASHBOARD = 'dashboard'

/**
 * The sections this project has, in order. Exported so the router can tell a
 * section that does not belong to this project from one that does — a
 * self-construction project has no Builders page, and asking for one must land
 * back on the project's own dashboard rather than on an empty screen.
 */
export function projectSectionIds(project) {
  const isSelfConstruction = project?.construction_type === 'SELF_CONSTRUCTION'
  return [
    PROJECT_SECTION_DASHBOARD,
    'requests',
    ...(isSelfConstruction ? ['siteEngineer', 'suppliers'] : ['builders']),
    'escrow',
  ]
}

/**
 * A section's name. One definition, so the tab a section is opened from and the
 * breadcrumb that says where you are can never word it differently. Every label
 * but the project's own dashboard is a key the top navigation already used.
 */
export function projectSectionLabel(sectionId, t) {
  return {
    [PROJECT_SECTION_DASHBOARD]: t('dash.owner.projectNav.dashboard'),
    requests: t('ui.requests'),
    builders: t('ui.builders'),
    siteEngineer: t('role.engineer'),
    suppliers: t('ui.suppliers'),
    escrow: t('ui.escrow'),
  }[sectionId] || ''
}

/**
 * The project's tabs: one row, plain words, in the order a House Owner works.
 *
 *   Find Builders | Requests | Assign Builder | Site Activity | Project Analysis | Live Camera | Overview | Escrow | Payments
 *   (self-construction: Requests | Site Engineer | Suppliers | Site Activity | Project Analysis | Live Camera | Overview | Escrow | Payments)
 *
 * Every tab is an existing place, reached exactly as before: `section` is a page
 * of this project (its own address), `tab` a view inside the project's
 * dashboard panel. Nothing is added or removed.
 */
function projectTabs(project, t) {
  const selfConstruction = project?.construction_type === 'SELF_CONSTRUCTION'
  const sections = new Set(projectSectionIds(project))
  const tab = (id, section, view, label, icon) => ({ id, section, view, label, icon })
  // Order: the builder workflow first (Find Builders, Requests, Assign
  // Builder), then site work, then Overview, Escrow and Payments.
  return [
    ...(selfConstruction
      ? [
        tab('requests', 'requests', null, t('ui.requests'), FileText),
        tab('siteEngineer', 'siteEngineer', null, t('role.engineer'), HardHat),
        tab('suppliers', 'suppliers', null, t('ui.suppliers'), Truck),
      ]
      : [
        tab('builders', 'builders', null, t('projectNav.findBuilders'), HardHat),
        tab('requests', 'requests', null, t('ui.requests'), FileText),
        tab('chooseBuilder', PROJECT_SECTION_DASHBOARD, 'assignedBuilders', t('quote.assignBuilder'), UserCheck),
      ]),
    tab('sitePhotos', PROJECT_SECTION_DASHBOARD, 'timeline', t('ui.siteActivity'), Images),
    // Read-only figures for this project, beside its Site Activity.
    tab('analysis', PROJECT_SECTION_DASHBOARD, 'analysis', t('owner.analysis.title'), BarChart3),
    tab('liveCamera', PROJECT_SECTION_DASHBOARD, 'liveCamera', t('ui.liveCamera'), Camera),
    tab('overview', PROJECT_SECTION_DASHBOARD, 'details', t('ui.overview'), LayoutDashboard),
    tab('escrow', 'escrow', null, t('ui.escrow'), Wallet),
    tab('payments', PROJECT_SECTION_DASHBOARD, 'payments', t('ui.payments'), Receipt),
  ].filter((entry) => sections.has(entry.section))
}

export default function OwnerProjectWorkspace({
  project,
  section,
  onSectionChange,
  badges = {},
  dashboardProps = {},
  requestsProps = {},
  buildersProps = {},
  suppliersProps = {},
  siteEngineerProps = {},
}) {
  const { t, td } = useLanguage()
  const { activeTab, setActiveTab, onBack } = dashboardProps

  const tabs = useMemo(() => projectTabs(project, t), [project?.construction_type, t])

  // A dashboard view picks its view first, then (if elsewhere) the page.
  const openTab = (entry) => {
    if (entry.view) setActiveTab?.(entry.view)
    if (section !== entry.section) onSectionChange(entry.section)
  }
  const isActive = (entry) => section === entry.section && (!entry.view || activeTab === entry.view)

  return (
    <div className="space-y-3">
      {/* One navigation row: back to the Projects list (the same action as
          before), then the project's tabs. The project's name is already in
          the breadcrumb above, so it is not repeated as a heading here. The
          tabs scroll sideways on a phone rather than wrapping. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('dash.owner.projectDetails.backToProjects')}
          title={t('dash.owner.projectDetails.backToProjects')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-oc-deep shadow-sm transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      <div role="tablist" aria-label={td(project?.title)} className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1">
        {tabs.map((entry) => {
          const active = isActive(entry)
          const badgeCount = entry.view ? 0 : Number(badges[entry.section] || 0)
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => openTab(entry)}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-extrabold transition ${
                // Live Camera stands out: red, blinking (live-camera-blink, index.css).
                entry.id === 'liveCamera'
                  ? `live-camera-blink font-black ${active ? 'bg-red-700 text-white shadow-sm ring-2 ring-red-300' : 'bg-red-600 text-white hover:bg-red-700'}`
                  : active ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
              }`}
            >
              <entry.icon className="h-3.5 w-3.5" />
              {entry.label}
              {badgeCount > 0 && (
                <span className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-extrabold ${
                  active ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-800'
                }`}>
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
      </div>

      {section === PROJECT_SECTION_DASHBOARD && <ProjectDetailPanel project={project} {...dashboardProps} />}

      {section === 'requests' && <OwnerRequestsSection {...requestsProps} />}

      {section === 'builders' && <OwnerContractorsSection {...buildersProps} />}

      {section === 'siteEngineer' && <OwnerSiteEngineerSection project={project} {...siteEngineerProps} />}

      {section === 'suppliers' && <OwnerSupplierHub {...suppliersProps} />}

      {section === 'escrow' && (
        <OwnerEscrowSection milestones={project?.escrow_milestones} projectCountry={project?.project_country} />
      )}
    </div>
  )
}
