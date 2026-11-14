import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, Briefcase, Building2, CalendarDays, Camera, ClipboardList, LayoutGrid, LifeBuoy, MessageSquare, PackageSearch, Settings, ShoppingCart, Truck, Users, Wrench,
} from 'lucide-react'
import { CART_GATED_ACTIONS, pendingActionIs, useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import { canBookPartner, openPartnerBooking } from '../../partner-booking/partnerBooking.js'
import DashboardShell from '../../../shared/dashboard/DashboardShell.jsx'

/**
 * Where the Site Engineer is, read from the URL.
 *
 * The same arrangement the House Owner dashboard already uses: the address is
 * the single statement of which section is on screen, so a refresh, the
 * browser's Back and Forward buttons and a pasted link all behave the way the
 * navigation does. Every section this dashboard renders has an address, not
 * only the four in the sidebar — the site log, messages, notifications and
 * profile are reached from the topbar and the account menu, and they would
 * otherwise be the only screens the URL could not name.
 *
 * /engineer/live-camera is not here on purpose: it is its own top-level route
 * in AppRouter with its own component, and this dashboard never renders it.
 */
const NAV_PATHS = {
  dashboard: '/engineer',
  projects: '/engineer/my-projects',
  suppliers: '/engineer/my-supplies',
  storeRequests: '/engineer/store-requests',
  findOpportunities: '/engineer/find-opportunities',
  calendar: '/engineer/calendar',
  dailyLogs: '/engineer/daily-logs',
  messages: '/engineer/messages',
  notifications: '/engineer/notifications',
  profile: '/engineer/profile',
}

// The reverse of NAV_PATHS, built from it so the two can never disagree.
const SECTION_BY_SEGMENT = Object.fromEntries(
  Object.entries(NAV_PATHS).map(([section, path]) => [path.replace(/^\/engineer\/?/, ''), section]),
)

function parseEngineerLocation(pathname) {
  const [segment] = pathname.replace(/^\/engineer\/?/, '').split('/').filter(Boolean)
  // An address that names no section falls back to the dashboard, exactly as
  // an unknown section id does when navigating.
  return SECTION_BY_SEGMENT[segment || ''] || 'dashboard'
}
import DeleteAccountSection from '../../accounts/components/DeleteAccountSection.jsx'
import EmailVerificationSection from '../../accounts/components/EmailVerificationSection.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import MessageThread from '../../messaging/components/MessageThread.jsx'
import SiteEngineerDashboard from '../../site-work/components/SiteEngineerDashboard.jsx'
import RequestsPanel from '../../requests/components/RequestsPanel.jsx'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import { acceptProjectRequest, fetchIncomingRequests, rejectProjectRequest } from '../../requests/requestsApi.js'
import EngineerDashboardOverview from '../components/EngineerDashboardOverview.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { HelpCenterModal, FeedbackModal } from '../../support/components/SupportModals.jsx'
import { completeUserProfile, updateUserProfileImage } from '../../auth/authApi.js'
import { profileErrorMessage } from '../../../shared/hooks/useProfileFormErrors.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { assertProfileImage } from '../../../shared/utils/profileImageRules.js'
import { fetchContractorProfile } from '../../accounts/publicProfileApi.js'
import { fetchNearbyContractors } from '../../projects/projectsApi.js'
import { fetchNotifications, markCategoryNotificationsRead, markNotificationsRead } from '../../notifications/notificationsApi.js'
import { fetchMyMaterialRequests } from '../../shop/materialRequestsApi.js'
import {
  applyEngineerOpportunity,
  fetchEngineerOpportunities,
  fetchEngineerProjects,
  fetchEngineerTeam,
  joinEngineerTeam,
  requestEngineerJoin,
  respondEngineerJoinRequest,
} from '../../engineers/engineersApi.js'
import { logoutUser, setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import {
  ContractorProfileModal,
  EngineerContractorsSection,
  EngineerDashboardHero,
  EngineerJoinTeamSection,
  EngineerMyProjectsSection,
  EngineerNotificationsSection,
  EngineerOpportunitiesSection,
  EngineerProfileSection,
  OpportunityDetailModal,
} from '../components/EngineerSections.jsx'
import EngineerSupplierHub from '../components/EngineerSupplierHub.jsx'
import EngineerStoreRequestsSection from '../components/EngineerStoreRequestsSection.jsx'
import { QuickActionCard } from '../../owner/components/OwnerOverviewSection.jsx'
import { formatDate, weekdayName } from '../../../shared/utils/formatters.js'
import { loadCart } from '../../shop/cartSlice.js'
import LocationLeadsPrompt, { LocationLeadsButton, useLocationLeadsPrompt } from '../../../shared/ui/LocationLeadsPrompt.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import useRequestInbox, { useMarkSeenWhenOpened } from '../../../shared/hooks/useRequestInbox.js'
import useSeenBadge from '../../../shared/hooks/useSeenBadge.js'
import NewRequestToast from '../../requests/components/NewRequestToast.jsx'
import WeatherNavButton from '../../weather/components/WeatherNavButton.jsx'
import { projectRequestItems, teamInviteItems } from '../../../shared/utils/requestInbox.js'

// Notification categories that belong to the Suppliers section.
const SUPPLIER_NOTIFICATION_CATEGORIES = ['MATERIAL', 'LABOR', 'EQUIPMENT', 'ASSIGNMENT']

const PENDING_INVITE_KEY = 'crewnbuild_pending_invite'
const APPLIED_OPPORTUNITIES_KEY = 'crewnbuild_applied_opportunities'

function readPendingInviteCode() {
  try {
    return window.localStorage.getItem(PENDING_INVITE_KEY) || ''
  } catch {
    return ''
  }
}

function readAppliedOpportunities() {
  try {
    return JSON.parse(window.localStorage.getItem(APPLIED_OPPORTUNITIES_KEY) || '[]')
  } catch {
    return []
  }
}

function saveAppliedOpportunity(projectId) {
  try {
    const applied = readAppliedOpportunities()
    if (!applied.includes(String(projectId))) {
      window.localStorage.setItem(APPLIED_OPPORTUNITIES_KEY, JSON.stringify([...applied, String(projectId)]))
    }
  } catch {
    /* noop */
  }
}

export default function EngineerDashboard() {
  const { user } = useSelector((state) => state.auth)
  const { t, td, setCountry } = useLanguage()
  const dispatch = useDispatch()
  // Back from Complete Profile with a Buy waiting: open the cart, which resumes it.
  // A clicked notification can name the hub tab to open (Orders, Labor ...).
  const [supplierTab, setSupplierTab] = useState(() => {
    if (pendingActionIs(CART_GATED_ACTIONS)) return 'cart'
    try {
      const pending = sessionStorage.getItem('crewnbuild_pending_supplier_tab')
      if (pending) {
        sessionStorage.removeItem('crewnbuild_pending_supplier_tab')
        return pending
      }
    } catch {
      /* private mode: open the default tab */
    }
    // The supplier-type choice (Material / Labor / Equipment).
    return 'home'
  })
  useEffect(() => {
    const handleNotificationOpen = (event) => {
      if (!event.detail?.supplierTab) return
      try { sessionStorage.removeItem('crewnbuild_pending_supplier_tab') } catch { /* noop */ }
      setSupplierTab(event.detail.supplierTab)
    }
    window.addEventListener('crewnbuild_notification_open', handleNotificationOpen)
    return () => window.removeEventListener('crewnbuild_notification_open', handleNotificationOpen)
  }, [])

  const navigate = useNavigate()
  const location = useLocation()
  const { requireCompleteProfile } = useProfileGate()
  // The open section is derived from the address rather than held beside it, so
  // there is only one answer to what is on screen. Every existing
  // setActiveId(...) call site keeps its meaning; it now records the move in
  // the browser instead of only in React.
  const activeId = useMemo(() => parseEngineerLocation(location.pathname), [location.pathname])
  const setActiveId = useCallback((sectionId) => {
    navigate(NAV_PATHS[sectionId] || NAV_PATHS.dashboard)
  }, [navigate])
  const [searchQuery, setSearchQuery] = useState('')
  const [projectList, setProjectList] = useState([])
  // My Projects badge: the projects of the last SUCCESSFUL load, by key, and
  // whether the latest load succeeded. A failed load keeps the keys, so it can
  // neither clear the badge nor mark anything viewed.
  const [projectLoad, setProjectLoad] = useState({ ok: false, keys: [] })
  useEffect(() => { dispatch(loadCart(projectList[0]?.id)) }, [dispatch, projectList])
  const [teams, setTeams] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  // Project requests addressed to this engineer -- including the specialist
  // invitations a Site Engineer sends. These were being created and notified
  // but never fetched here, so they had nowhere to appear.
  const [projectRequests, setProjectRequests] = useState([])
  const [contractors, setContractors] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [notifications, setNotifications] = useState([])
  const [materialRequests, setMaterialRequests] = useState([])
  const [appliedKeys, setAppliedKeys] = useState(readAppliedOpportunities)
  const [joinMessage, setJoinMessage] = useState('')
  const [joinError, setJoinError] = useState('')
  const [sectionMessage, setSectionMessage] = useState('')
  const [selectedContractor, setSelectedContractor] = useState(null)
  const [contractorProfile, setContractorProfile] = useState(null)
  const [selectedOpportunity, setSelectedOpportunity] = useState(null)
  const [profileSaveMessage, setProfileSaveMessage] = useState('')
  const [profileSaveError, setProfileSaveError] = useState('')
  const [profileImageMessage, setProfileImageMessage] = useState('')
  const [profileImagePreview, setProfileImagePreview] = useState('')
  const [notificationBadgeCounts, setNotificationBadgeCounts] = useState({})
  const [showHelp, setShowHelp] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [findOppTab, setFindOppTab] = useState('joinTeam')
  // Which request lists have loaded successfully; a failed load never clears
  // the New Requests badge.
  const [requestLoads, setRequestLoads] = useState({ requests: false, joinTeam: false })
  const markRequestsLoaded = (kind) => setRequestLoads((current) => (current[kind] ? current : { ...current, [kind]: true }))

  // The engineer dashboard follows the account's country of residence.
  useEffect(() => {
    setCountry(user?.country_of_residence || 'India')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.country_of_residence])

  const logout = () => {
    dispatch(logoutUser())
    navigate('/login')
  }

  // `td` is in the dependencies on purpose: its identity changes when a batch of
  // dynamic translations arrives, which is what makes the shell's greeting
  // re-read the translated name instead of keeping the first, untranslated one
  // this memo happened to compute. The initials come from the stored name so the
  // avatar does not change letters underneath the user; only the hardcoded 'E'
  // fallback is gone, replaced by the translated role's own first letter.
  const userShell = useMemo(() => ({
    name: td(user?.name || '') || t('role.engineer'),
    initials: (user?.name || '').trim().slice(0, 2).toUpperCase() || t('role.engineer').trim().slice(0, 1),
    profileImageUrl: profileImagePreview || user?.profile_image_url || '',
  }), [profileImagePreview, user, t, td])
  const locationPrompt = useLocationLeadsPrompt(user)

  const pendingInviteCode = readPendingInviteCode()

  const engineerCountry = user?.country_of_residence || 'India'
  // Latest load wins: a live refresh can overlap a load already in flight (or
  // the 15 s poll), and the older response must not overwrite the newer one.
  const engineerLoadGuard = useLatestOnly()
  const refreshEngineerData = () => {
    const isLatest = engineerLoadGuard()
    fetchEngineerProjects()
      .then((list) => {
        if (!isLatest()) return
        setProjectList(list)
        setProjectLoad({ ok: true, keys: list.map((project) => `project:${project.id}`) })
      })
      .catch(() => {
        if (!isLatest()) return
        setProjectList([])
        setProjectLoad((current) => ({ ...current, ok: false }))
      })
    fetchEngineerTeam()
      .then((data) => {
        if (!isLatest()) return
        setTeams(data.teams || [])
        setIncomingRequests(data.incoming_requests || [])
        markRequestsLoaded('joinTeam')
      })
      .catch(() => { if (isLatest()) { setTeams([]); setIncomingRequests([]) } })
    fetchIncomingRequests()
      .then((list) => { if (isLatest()) { setProjectRequests(list); markRequestsLoaded('requests') } })
      .catch(() => { if (isLatest()) setProjectRequests([]) })
    fetchEngineerOpportunities(engineerCountry).then(setOpportunities).catch(() => setOpportunities([]))
    fetchMyMaterialRequests().then(setMaterialRequests).catch(() => setMaterialRequests([]))
    if (user?.pincode) {
      fetchNearbyContractors(user.pincode, engineerCountry).then(setContractors).catch(() => setContractors([]))
    }
  }

  // A request, team request, answer or assignment from someone else reloads
  // through this same loader at once, instead of at the next 15 s poll.
  useLiveRefresh(refreshEngineerData)

  const refreshNotifications = () => {
    fetchNotifications()
      .then(setNotifications)
      .catch(() => setNotifications([]))
  }

  useEffect(() => {
    refreshEngineerData()
    const refreshTimer = window.setInterval(refreshEngineerData, 15000)
    const refreshOnFocus = () => refreshEngineerData()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [user?.pincode])

  useEffect(() => {
    refreshNotifications()
    const notificationTimer = window.setInterval(refreshNotifications, 15000)
    return () => window.clearInterval(notificationTimer)
  }, [])
  // A supplier-side change (order decision, labor/equipment answer, supplier
  // assignment) arrives as the existing live hint; reload the list so the
  // Suppliers badge follows at once rather than at the next 15 s refresh.
  useLiveRefresh(refreshNotifications)

  const teamStatusByContractor = (contractorId) => {
    const team = teams.find((item) => String(item.contractor_id) === String(contractorId))
    if (!team) return 'none'
    if (team.status === 'ACTIVE') return 'active'
    if (team.status === 'PENDING') return 'pending'
    return 'rejected'
  }

  const joinTeam = async (code) => {
    setJoinMessage('')
    setJoinError('')
    if (!code) {
      setJoinError(t('dash.engineer.msg.enterCode'))
      return
    }
    try {
      const result = await joinEngineerTeam(code)
      setJoinMessage(t('dash.msg.joinedTeam', { company: td(result.company_name || result.contractor_name) }))
      try {
        window.localStorage.removeItem(PENDING_INVITE_KEY)
      } catch {
        /* noop */
      }
      refreshEngineerData()
    } catch (error) {
      setJoinError(error.response?.data?.detail || t('dash.engineer.msg.unableJoin'))
    }
  }

  const sendJoinRequest = async (contractorId) => {
    if (requireCompleteProfile('sendJoinRequest', contractorId)) return
    setSectionMessage('')
    try {
      await requestEngineerJoin(contractorId)
      setSectionMessage(t('dash.engineer.msg.joinRequestSent'))
      refreshEngineerData()
    } catch (error) {
      setSectionMessage(error.response?.data?.detail || t('dash.engineer.msg.unableJoinRequest'))
    }
  }

  const respondToBuilderRequest = async (relationshipId, action) => {
    // Joining a builder's team needs a complete profile; declining does not.
    if (action === 'ACCEPT' && requireCompleteProfile('respondToBuilderRequest', { relationshipId, action })) return
    setSectionMessage('')
    try {
      await respondEngineerJoinRequest(relationshipId, action)
      setSectionMessage(action === 'ACCEPT' ? t('dash.msg.engineerRequestAccepted') : t('dash.msg.engineerRequestRejected'))
      refreshEngineerData()
    } catch (error) {
      setSectionMessage(error.response?.data?.detail || t('dash.engineer.msg.unableJoinRequest'))
    }
  }

  const applyOpportunity = async (opportunity) => {
    if (requireCompleteProfile('applyOpportunity', opportunity)) return
    setSectionMessage('')
    try {
      const result = await applyEngineerOpportunity(opportunity.project_id)
      saveAppliedOpportunity(opportunity.project_id)
      setAppliedKeys(readAppliedOpportunities())
      setSectionMessage(t('dash.msg.applicationSent', { name: td(result.receiver_name) || t('dash.theBuilder') }))
      setSelectedOpportunity(null)
    } catch (error) {
      setSectionMessage(error.response?.data?.detail || t('dash.engineer.msg.unableApply'))
      if (String(error.response?.status) === '409') {
        saveAppliedOpportunity(opportunity.project_id)
        setAppliedKeys(readAppliedOpportunities())
      }
    }
  }

  const viewContractorProfile = async (contractor) => {
    setContractorProfile(null)
    setSelectedContractor(contractor)
    try {
      const profile = await fetchContractorProfile(contractor.user_id || contractor.id)
      setContractorProfile(profile)
    } catch {
      setContractorProfile(null)
    }
  }

  const saveProfile = async (form) => {
    setProfileSaveMessage('')
    setProfileSaveError('')
    try {
      const updatedUser = await completeUserProfile({
        ...form,
        experience_years: Number(form.experience_years || 0),
        profile_image_url: user?.profile_image_url || '',
      })
      dispatch(setAuthenticatedUser({ user: updatedUser }))
      setProfileSaveMessage(t('dash.engineer.msg.profileSaved'))
    } catch (error) {
      // `profileErrorMessage` rather than the raw detail: on a validation
      // failure the detail is `{message, fields}`, and putting that object into
      // state is what rendered an object as a React child and blanked the page.
      setProfileSaveError(profileErrorMessage(error, t('dash.engineer.msg.unableSaveProfile')))
      // Rethrown so the profile form knows the save was refused: it keeps the
      // editor open with the entered values, marks the offending fields and
      // scrolls to the first one. Swallowing it here read as a successful save.
      throw error
    }
  }

  const uploadProfileImage = async (file) => {
    if (!file) return
    setProfileImageMessage('')
    try {
      assertProfileImage(file, t)
      const uploadedFile = await uploadLocalFile(file)
      setProfileImagePreview(uploadedFile.previewUrl || uploadedFile.url)
      const updatedUser = await updateUserProfileImage(uploadedFile.url)
      dispatch(setAuthenticatedUser({ user: updatedUser }))
      setProfileImageMessage(t('dash.engineer.msg.profilePhotoUpdated'))
    } catch (error) {
      // A file refused before upload says why; anything else keeps the old message.
      setProfileImageMessage(error?.userMessage || t('dash.engineer.msg.profilePhotoFailed'))
    }
  }

  const markAllNotificationsRead = async () => {
    try {
      await markNotificationsRead()
      refreshNotifications()
    } catch {
      /* noop */
    }
  }

  // Requests actually addressed TO this engineer. /project-requests/incoming
  // returns both directions because the Builder and Owner dashboards need the
  // outgoing ones too; without this an engineer sees invitations they sent
  // listed as theirs to accept, and Accept fails because the server rightly
  // refuses anyone who is not the receiver. The sidebar badge already counted
  // it this way, so the panel and the badge now read one list.
  const incomingRequestList = useMemo(
    () => projectRequests.filter((request) => request.is_receiver),
    [projectRequests],
  )
  // Unread supplier-side notifications (explicit categories) for
  // the Suppliers badge. Opening Suppliers marks them read, which clears it.
  const unreadSupplierCount = notifications.filter((notification) => !notification.is_read && SUPPLIER_NOTIFICATION_CATEGORIES.includes(notification.category)).length
  useEffect(() => {
    if (activeId !== 'suppliers' || !unreadSupplierCount) return
    markCategoryNotificationsRead(SUPPLIER_NOTIFICATION_CATEGORIES)
      .then(() => {
        refreshNotifications()
        window.dispatchEvent(new Event('crewnbuild_notifications_refresh'))
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, unreadSupplierCount])

  // New Requests: owner and specialist project requests sent to this engineer,
  // and builders' team invitations -- pending only, never the engineer's own.
  const requestInboxItems = useMemo(() => [
    ...projectRequestItems(projectRequests, () => 'requests', ['OWNER_TO_ENGINEER', 'SITE_ENGINEER_TO_SPECIALIST']),
    ...teamInviteItems(incomingRequests, 'joinTeam'),
  ], [projectRequests, incomingRequests])
  const requestInbox = useRequestInbox({ userId: user?.id, items: requestInboxItems, loaded: requestLoads.requests && requestLoads.joinTeam })
  const inboxKeysIn = (section) => requestInboxItems.filter((item) => item.section === section).map((item) => item.key)
  useMarkSeenWhenOpened(requestInbox, { open: activeId === 'findOpportunities' && findOppTab === 'requests', loaded: requestLoads.requests, displayedKeys: inboxKeysIn('requests') })
  useMarkSeenWhenOpened(requestInbox, { open: activeId === 'findOpportunities' && findOppTab === 'joinTeam', loaded: requestLoads.joinTeam, displayedKeys: inboxKeysIn('joinTeam') })
  const openRequestsFromToast = () => {
    const tab = requestInbox.unreadIn('requests') ? 'requests' : requestInbox.unreadIn('joinTeam') ? 'joinTeam' : 'requests'
    if (activeId === 'findOpportunities' && findOppTab === tab) requestInbox.markSeen(inboxKeysIn(tab))
    setFindOppTab(tab)
    setActiveId('findOpportunities')
  }

  // My Projects: the assigned projects not yet viewed, kept per user in this
  // browser (the New Requests badge's seen store, its own namespace). Opening My
  // Projects after a successful load marks the listed projects viewed; a project
  // assigned later counts again. Not the number of projects.
  const unseenProjectCount = useSeenBadge({
    userId: user?.id,
    namespace: 'crewnbuild_seen_projects',
    keys: projectLoad.keys,
    open: activeId === 'projects',
    loaded: projectLoad.ok,
  })

  // `bareIcon`: the icons without their small box, the same style as the
  // builder's and House Owner's navigation (see SidebarNavItem in DashboardShell).
  const nav = [
    { id: 'dashboard', label: t('ui.dashboard'), icon: LayoutGrid, bareIcon: true, badge: notificationBadgeCounts.dashboard },
    { id: 'projects', label: t('ui.myProjects'), icon: Building2, bareIcon: true, badge: unseenProjectCount || undefined },
    { id: 'suppliers', label: t('ui.suppliers'), icon: Truck, bareIcon: true, badge: unreadSupplierCount || undefined },
    // The engineer's store requests and their history, apart from the Store's shopping.
    { id: 'storeRequests', label: t('store.engineer.navStoreRequests'), icon: ClipboardList, bareIcon: true },
    // Requests now live inside this section, so its pending count moves here
    // too - otherwise an incoming builder request would arrive with no signal.
    // New: the requests and team invitations not yet opened, counted by id.
    { id: 'findOpportunities', label: t('ui.findOpportunities'), icon: Briefcase, bareIcon: true, badge: requestInbox.unreadCount || undefined },
  ]

  useEffect(() => {
    const nextBadgeCounts = {}
    notifications.forEach((notification) => {
      if (notification.is_read) return
      const moduleTabMap = {
        engineers: 'findOpportunities',
        request: 'projects',
        project: 'projects',
        general: 'notifications',
      }
      const tabId = moduleTabMap[notification.module]
      if (tabId) nextBadgeCounts[tabId] = (nextBadgeCounts[tabId] || 0) + 1
    })
    setNotificationBadgeCounts(nextBadgeCounts)
  }, [notifications])

  // The standard account menu, identical on every dashboard. Dark Mode and
  // Logout are supplied by DashboardShell, so the four options a user sees are
  // Profile Settings, Dark Mode, Help & Feedback and Logout.
  const engineerUserMenu = [
    { id: 'profileSettings', label: t('ui.profileSettings'), icon: Settings },
    { id: 'helpFeedback', label: t('ui.helpFeedback'), icon: LifeBuoy },
  ]
  const handleUserMenuSelect = (menuId) => {
    if (menuId === 'profileSettings') {
      setActiveId('profile')
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    if (menuId === 'helpFeedback') setShowHelp(true)
  }

  const pendingTeamInvitationCount = teams.filter((team) => team.status === 'PENDING').length
  const pendingSupplierRequestCount = materialRequests.filter((request) => request.status === 'PENDING').length
  const unreadActivityCount = notifications.filter((notification) => !notification.is_read).length
  // The project the dashboard's Budget Alerts and analytics show: picked in
  // Budget Alerts, the first project until then.
  const [pickedAnalyticsProjectId, setAnalyticsProjectId] = useState('')
  const analyticsProjectId = pickedAnalyticsProjectId || (projectList[0] ? String(projectList[0].id) : '')
  const navigateToSection = (sectionId) => {
    setActiveId(sectionId)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  // Book Technician: the Partner application's booking, as on the House Owner
  // dashboard. Only offered when Partner booking is available.
  const bookTechnician = canBookPartner(user) ? () => {
    if (!openPartnerBooking()) window.alert(t('ui.engineer.bookTechnicianUnavailable'))
  } : undefined
  const engineerQuickActions = [
    {
      id: 'order',
      label: t('owner.quick.order'),
      hint: t('owner.quick.orderSub'),
      icon: ShoppingCart,
      // A Site Engineer's material is requested from the builder's Store Manager
      // (Store), never bought from a supplier; Store says so if there is none.
      onClick: () => {
        setSupplierTab('store')
        navigateToSection('suppliers')
      },
    },
    bookTechnician && {
      id: 'technician',
      label: t('ui.owner.bookTechnician'),
      hint: t('owner.quick.technicianSub'),
      icon: Wrench,
      onClick: bookTechnician,
    },
    // Two more places that already exist, drawn by the same card in the
    // House Owner's blue and purple.
    {
      id: 'suppliers',
      tone: 'construction',
      label: t('dash.eng.viewSuppliers'),
      hint: t('dash.eng.viewSuppliersSub'),
      icon: PackageSearch,
      onClick: () => { setSupplierTab('home'); navigateToSection('suppliers') },
    },
    {
      id: 'opportunities',
      tone: 'buySell',
      label: t('ui.findOpportunities'),
      hint: t('dash.eng.findOpportunitiesSub'),
      icon: Briefcase,
      onClick: () => navigateToSection('findOpportunities'),
    },
  ].filter(Boolean)
  // On a self-construction project there is no builder; the owner who hired
  // the engineer is the party the site log is shared with.
  const siteLogContractorName = projectList[0]?.company_name || projectList[0]?.contractor_name || projectList[0]?.owner_name || t('dash.yourBuilder')
  const respondToProjectRequest = async (requestId, accept) => {
    // Accepting a project request needs a complete profile, as on every other
    // dashboard; rejecting does not.
    if (accept && requireCompleteProfile('respondToProjectRequest', { requestId, accept })) return
    setSectionMessage('')
    try {
      if (accept) await acceptProjectRequest(requestId)
      else await rejectProjectRequest(requestId)
      refreshEngineerData()
    } catch (error) {
      setSectionMessage(error.response?.data?.detail || t('dash.engineer.msg.unableJoinRequest'))
    }
  }

  const openSiteLog = () => {
    setSelectedOpportunity(null)
    setActiveId('calendar')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  // The location prompt saved a pincode: adopt the updated account and open the
  // opportunities. The data refresh keyed on user.pincode reloads them for the
  // new pincode through the existing opportunities request.
  const saveLeadLocation = async (updatedUser) => {
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    locationPrompt.finishPrompt()
    setFindOppTab('opportunities')
    setActiveId('findOpportunities')
  }
  const selectedContractorState = selectedContractor ? teamStatusByContractor(selectedContractor.user_id || selectedContractor.id) : 'none'

  useResumeGatedAction({
    sendJoinRequest,
    applyOpportunity,
    respondToBuilderRequest: ({ relationshipId, action }) => respondToBuilderRequest(relationshipId, action),
    respondToProjectRequest: ({ requestId, accept }) => respondToProjectRequest(requestId, accept),
  })

  return (
    <div className="min-h-screen text-slate-950">
      <LocationLeadsPrompt
        open={locationPrompt.open}
        currentPincode={user?.pincode || ''}
        onDismiss={locationPrompt.dismissPrompt}
        onSaved={saveLeadLocation}
      />
      <DashboardShell
        plainBackground
        sidebarItems={nav}
        activeId={activeId}
        // Opening Suppliers from the navigation starts at the supplier-type choice.
        onNav={(sectionId) => { if (sectionId === 'suppliers') setSupplierTab('home'); setActiveId(sectionId) }}
        user={userShell}
        roleLabel={t('role.engineer')}
        onLogout={logout}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        headerActions={
          <button
            type="button"
            onClick={() => setActiveId('calendar')}
            title={t('ui.calendar')}
            aria-label={t('ui.calendar')}
            aria-pressed={activeId === 'calendar'}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition ${
              activeId === 'calendar'
                ? 'border-ocbrand-300 bg-ocbrand-50 text-oc-deep'
                : 'border-oc-line bg-white text-oc-muted hover:text-oc-deep'
            }`}
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        }
        // The Live Camera page, from the top bar beside the language selector:
        // red and blinking like every other Live Camera button. The Weather
        // page's button sits before it.
        beforeLanguage={
          <>
          <WeatherNavButton />
          <button
            type="button"
            onClick={() => navigate('/engineer/live-camera')}
            title={t('dash.engineer.hero.liveCamera')}
            aria-label={t('dash.engineer.hero.liveCamera')}
            className="live-camera-blink inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-red-700 bg-red-600 px-3 text-xs font-black text-white transition hover:bg-red-700"
          >
            <Camera className="h-4 w-4" />
            <span className="hidden sm:inline">{t('dash.engineer.hero.liveCamera')}</span>
          </button>
          </>
        }
        searchPlaceholder={t('dash.engineer.searchPlaceholder')}
        userMenu={engineerUserMenu}
        onUserMenuSelect={handleUserMenuSelect}
        onMessagesClick={(tab) => setActiveId(tab)}
        unreadMessageCount={notificationBadgeCounts.message || 0}
        defaultTab="dashboard"
        // No breadcrumb: every page here is a top-level nav page the nav
        // already names, and project / profile details open as overlays. The
        // row stays for the control below.
        breadcrumbReplacement={<span aria-hidden="true" />}
        breadcrumbAction={activeId === 'findOpportunities' && locationPrompt.eligible ? (
          <LocationLeadsButton pincode={user?.pincode} onClick={locationPrompt.openPrompt} />
        ) : null}
      >
        {activeId === 'dashboard' && (
          <div className="space-y-3">
            <EngineerDashboardHero
              userShell={userShell}
              // Right side: the project the figures below are for, and today's date.
              aside={(
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {projectList.length > 1 && (
                    <select
                      value={analyticsProjectId}
                      onChange={(event) => setAnalyticsProjectId(event.target.value)}
                      aria-label={t('dash.engineer.analytics.selectProject')}
                      className="h-10 max-w-[12rem] truncate rounded-xl border border-orange-200 bg-white/90 px-3 text-xs font-bold text-[#083E2B] outline-none focus:border-brand-500"
                    >
                      {projectList.map((item) => <option key={item.id} value={String(item.id)}>{td(item.title)}</option>)}
                    </select>
                  )}
                  <div className="flex items-center gap-3 rounded-xl bg-white/80 px-3.5 py-2 ring-1 ring-orange-100">
                    <CalendarDays className="h-6 w-6 text-orange-500" />
                    <div className="leading-tight">
                      <p className="text-[11px] font-semibold text-[#3d5246]">{t('dash.eng.today')}</p>
                      <p className="text-sm font-extrabold text-[#083E2B]">{formatDate(new Date())}</p>
                      <p className="text-[11px] text-[#3d5246]">{weekdayName(new Date().getDay(), { weekday: 'long' })}</p>
                    </div>
                  </div>
                </div>
              )}
            />
            <EngineerDashboardOverview
              projectList={projectList}
              projectId={analyticsProjectId}
              notifications={notifications}
              onViewAllActivity={() => navigateToSection('notifications')}
              // The House Owner's Book Technician and Order Product cards, unchanged,
              // at the House Owner's size (a quarter of the row from `xl`).
              quickActions={(
                // No white card around the cards: they sit on the page, with
                // the section name above them in small text, as on the House
                // Owner's "Our Services". A <p>, not an <h2>: the dashboard's
                // h2 rule (index.css) would force the section-title size.
                <section aria-labelledby="engineer-quick-actions">
                  <p id="engineer-quick-actions" className="mb-1.5 text-[10px] font-bold uppercase leading-none tracking-wider text-oc-muted">
                    {t('dash.engineer.quickActions')}
                  </p>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                    {engineerQuickActions.map((action) => (
                      <QuickActionCard key={action.id} action={action} compact />
                    ))}
                  </div>
                </section>
              )}
              // Site Activity Overview: the dashboard's four existing counts,
              // each opening the same place it did before.
              activityTiles={[
                { id: 'projects', icon: Building2, label: t('ui.myProjects'), value: projectList.length, tone: { card: 'border-sky-100 bg-sky-50/60', chip: 'bg-sky-100 text-sky-700' }, onClick: () => navigateToSection('projects') },
                { id: 'invitations', icon: Users, label: t('dash.pendingTeamInvitations'), value: pendingTeamInvitationCount, note: t('dash.eng.pending'), tone: { card: 'border-orange-100 bg-orange-50/60', chip: 'bg-orange-100 text-orange-600' }, onClick: () => { setFindOppTab('joinTeam'); navigateToSection('findOpportunities') } },
                { id: 'supplierRequests', icon: Truck, label: t('dash.pendingSupplierRequests'), value: pendingSupplierRequestCount, note: t('dash.eng.pending'), tone: { card: 'border-violet-100 bg-violet-50/60', chip: 'bg-violet-100 text-violet-700' }, onClick: () => navigateToSection('suppliers') },
                { id: 'unread', icon: Bell, label: t('dash.unreadActivity'), value: unreadActivityCount, note: t('dash.eng.notifications'), tone: { card: 'border-amber-100 bg-amber-50/60', chip: 'bg-amber-100 text-amber-600' }, onClick: () => navigateToSection('notifications') },
              ]}
            />
          </div>
        )}

        {activeId === 'projects' && (
          <EngineerMyProjectsSection
            projectList={projectList}
            onOpenProject={openSiteLog}
          />
        )}

        {activeId === 'storeRequests' && <EngineerStoreRequestsSection />}

        {activeId === 'findOpportunities' && (
          <div className="space-y-3">
            <div className="dash-scroll flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
              {[
                { id: 'joinTeam', label: t('ui.joinTeam'), badge: requestInbox.unreadIn('joinTeam') },
                // Builder -> Site Engineer requests, moved off the sidebar so
                // team and opportunity work sit in one place. Same panel, same
                // handlers, same records.
                { id: 'requests', label: t('ui.requests'), badge: requestInbox.unreadIn('requests') },
                { id: 'contractors', label: t('ui.discoverBuilders') },
                { id: 'opportunities', label: t('ui.findOpportunities') },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFindOppTab(tab.id)}
                  className={`shrink-0 rounded-md px-3.5 py-2 text-[13px] font-extrabold transition ${
                    findOppTab === tab.id ? 'bg-brand-900 text-white shadow-sm' : 'text-graphite/70 hover:bg-white hover:text-brand-700'
                  }`}
                >
                  {tab.label}
                  {Boolean(tab.badge) && (
                    <span className={`ml-1.5 inline-grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-extrabold ${
                      findOppTab === tab.id ? 'bg-white/20 text-white' : 'bg-brand-100 text-brand-800'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* With nothing to show, the panel's status tabs and its location
                and budget filters would sit above an empty list and read as
                content. Until a builder actually sends a request this stays the
                plain empty card the rest of the dashboard uses; the moment one
                arrives the existing panel renders it exactly as before. */}
            {findOppTab === 'requests' && (
              incomingRequestList.length ? (
                <RequestsPanel
                  title={t('ui.requests')}
                  subtitle={t('specialist.requestsSub')}
                  requestList={incomingRequestList}
                  onAccept={(requestId) => respondToProjectRequest(requestId, true)}
                  onReject={(requestId) => respondToProjectRequest(requestId, false)}
                  variant="command"
                  compact
                />
              ) : (
                <EmptyState
                  icon={Users}
                  title={t('ui.requests.noRequests')}
                  message={t('dash.engineer.noRequestsSub')}
                />
              )
            )}

            {findOppTab === 'joinTeam' && (
              <EngineerJoinTeamSection
                pendingCode={pendingInviteCode}
                teams={teams}
                incomingRequests={incomingRequests}
                onJoin={joinTeam}
                onRefresh={refreshEngineerData}
                onRespondToBuilder={respondToBuilderRequest}
                joinMessage={joinMessage}
                joinError={joinError}
              />
            )}

            {findOppTab === 'contractors' && (
              <EngineerContractorsSection
                contractors={contractors}
                teamStatusByContractor={teamStatusByContractor}
                onViewContractor={viewContractorProfile}
                onRequestJoin={(contractor) => sendJoinRequest(contractor.user_id || contractor.id)}
                message={sectionMessage}
              />
            )}

            {findOppTab === 'opportunities' && (
              <EngineerOpportunitiesSection
                opportunities={opportunities}
                appliedKeys={appliedKeys}
                onApply={applyOpportunity}
                onView={setSelectedOpportunity}
                message={sectionMessage}
              />
            )}
          </div>
        )}

        {(activeId === 'calendar' || activeId === 'dailyLogs') && (
          <div className="site-calendar-dark">
            <SiteEngineerDashboard
              projectList={projectList}
              contractorName={siteLogContractorName}
              viewMode={activeId === 'dailyLogs' ? 'logs' : 'calendar'}
              showBackToCalendar
              // Carries the project the engineer is already looking at, so the
              // camera page opens on it instead of asking them to pick again.
              onLiveCamera={(id) => navigate(`/engineer/live-camera?project=${id}`)}
            />
          </div>
        )}

        {activeId === 'messages' && (
          <div className="contractor-messages-dark space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-brand-600" />
              <h2 className="font-display text-base font-extrabold text-graphite">{t('ui.messages')}</h2>
            </div>
            <MessageThread />
          </div>
        )}


        {activeId === 'suppliers' && (
          <EngineerSupplierHub projects={projectList} activeTab={supplierTab} onTabChange={setSupplierTab} />
        )}

        {activeId === 'notifications' && (
          <EngineerNotificationsSection notifications={notifications} onMarkAllRead={markAllNotificationsRead} />
        )}

        {activeId === 'profile' && (
          <>
            <EngineerProfileSection
              profile={user?.engineer_profile || {}}
              user={user}
              onSave={saveProfile}
              onProfileImageUpload={uploadProfileImage}
              uploadMessage={profileImageMessage}
              saveMessage={profileSaveMessage || undefined}
              errorMessage={profileSaveError || undefined}
            />
            <PhoneChangeSection />
            <EmailVerificationSection />
            <DeleteAccountSection />
          </>
        )}
      </DashboardShell>
      <NewRequestToast inbox={requestInbox} onOpen={openRequestsFromToast} />

      {selectedContractor && (
        <ContractorProfileModal
          contractor={selectedContractor}
          profile={contractorProfile}
          onClose={() => {
            setSelectedContractor(null)
            setContractorProfile(null)
          }}
          onRequestJoin={(contractorId) => sendJoinRequest(contractorId)}
          requestState={selectedContractorState}
          message={sectionMessage}
        />
      )}

      {selectedOpportunity && (
        <OpportunityDetailModal
          opportunity={selectedOpportunity}
          applied={appliedKeys.includes(String(selectedOpportunity.project_id))}
          onApply={applyOpportunity}
          onClose={() => setSelectedOpportunity(null)}
          message={sectionMessage}
        />
      )}

      {showHelp && <HelpCenterModal onClose={() => setShowHelp(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  )
}
