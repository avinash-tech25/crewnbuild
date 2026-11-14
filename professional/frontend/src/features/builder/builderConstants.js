import { Boxes, Building2, ClipboardList, HardHat, LayoutGrid, Store, UserSearch } from 'lucide-react'

// Every item carries only `labelKey`: the label it renders is looked up in the
// key table at render time (ContractorDashboard builds `label` from it). The
// English `label`/`subtitle` fields that used to sit here were shadowed or never
// rendered at all, so they were a way for untranslated English to ship.
// `bareIcon`: the builder's navigation shows its icons without the small box
// (see SidebarNavItem in DashboardShell); other dashboards are unchanged.
export const baseNav = [
  { id: 'requests', labelKey: 'ui.dashboard', icon: LayoutGrid, bareIcon: true },
  { id: 'projects', labelKey: 'ui.projects', icon: Building2, bareIcon: true },
  // The request board, which used to be reachable only by scrolling the
  // Dashboard page. Its own item, so Sent / New / Accepted / Declined are one
  // click away. Same component, same data -- only where it is reached changed.
  { id: 'requestsBoard', labelKey: 'ui.requests', icon: ClipboardList, bareIcon: true },
  // The section holds Site Engineers and Suppliers, so its own label is
  // 'My Partners'. The tab inside it that lists engineers keeps ui.siteEngineers.
  { id: 'engineers', labelKey: 'ui.myPartners', icon: HardHat, bareIcon: true },
  { id: 'findClients', labelKey: 'ui.findClients', icon: UserSearch, bareIcon: true },
  { id: 'buySell', labelKey: 'ui.buySell', icon: Store, bareIcon: true },
  { id: 'productCatalog', labelKey: 'ui.productCatalog', icon: Boxes, bareIcon: true },
]

export const defaultProjectImage = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80'
export const projectDetailTabs = [
    { id: 'activity', labelKey: 'ui.siteActivity' },
    // The same read-only Project Analysis the House Owner sees for this project,
    // beside Site Activity (the same order as the House Owner's project tabs).
    { id: 'analysis', labelKey: 'owner.analysis.title' },
    // Next to Site Activity and Project Analysis, because the camera is how the
    // builder sees that activity happening. The panel is the shared component the
    // House Owner and the Site Engineer also use, against the same project recorder.
    { id: 'liveCamera', labelKey: 'ui.liveCamera' },
    { id: 'team', labelKey: 'ui.team' },
    { id: 'details', labelKey: 'ui.overview' },
    { id: 'payments', labelKey: 'ui.payments' },
  ]

// The Engineer Category a project's Site Engineer must hold. The backend
// enforces the same value on assignment; this only narrows the picker.
export const SITE_ENGINEER_CATEGORY = 'Site Engineer'

// What Find Site Engineers lists: Site Engineers and Store Managers. Both join
// the builder's team through the same request; only a Site Engineer is
// assigned to a project.
export const FIND_SITE_ENGINEER_CATEGORIES = `${SITE_ENGINEER_CATEGORY},Store Manager`

// Tabs inside the Projects section. All three always render, including when a
// category currently holds no projects.
export const projectCategoryTabs = [
  { id: 'current', labelKey: 'dash.contractor.currentProjects', emptyKey: 'dash.contractor.noAssignedProjects' },
  { id: 'previous', labelKey: 'dash.contractor.previousProjects', emptyKey: 'dash.contractor.noPreviousProjects' },
  { id: 'upcoming', labelKey: 'dash.contractor.upcomingProjects', emptyKey: 'dash.contractor.noUpcomingProjects' },
]
