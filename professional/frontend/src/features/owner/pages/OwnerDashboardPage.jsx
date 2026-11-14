import { Building2, HardHat, LayoutGrid, LifeBuoy, Plus, Search, Settings, ShoppingCart, Store, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  createProjectRequest,
  deleteOwnerProject,
  fetchNearbyContractors,
  fetchNearbySuppliers,
  fetchOwnerProjects,
  fetchProjectPhotos,
} from '../../projects/projectsApi.js'
import {
  acceptProjectRequest,
  assignProjectToContractor,
  fetchIncomingRequests,
  negotiateQuotation,
  rejectProjectRequest,
  sendProjectRequest,
  withdrawProjectRequest,
} from '../../requests/requestsApi.js'
import { fetchConversations, sendConversationMessage } from '../../messaging/messagesApi.js'
import { fetchNotifications, markModuleNotificationsRead } from '../../notifications/notificationsApi.js'
import { completeUserProfile, updateUserProfileImage } from '../../auth/authApi.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { assertProfileImage } from '../../../shared/utils/profileImageRules.js'
import { openPartnerBooking, partnerBookingConfigured } from '../../partner-booking/partnerBooking.js'
import { logoutUser, setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { CART_GATED_ACTIONS, pendingActionIs, useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import LocationLeadsPrompt, { useLocationLeadsPrompt } from '../../../shared/ui/LocationLeadsPrompt.jsx'
import DashboardShell from '../../../shared/dashboard/DashboardShell.jsx'
import DeleteAccountSection from '../../accounts/components/DeleteAccountSection.jsx'
import EmailVerificationSection from '../../accounts/components/EmailVerificationSection.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import { HelpCenterModal, FeedbackModal } from '../../support/components/SupportModals.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { floorCountFor } from '../../../shared/utils/floorOptions.js'
import { OwnerProfileSection, OwnerMessagesSection, OwnerProjectsSection } from '../components/OwnerSections.jsx'
import OwnerOverviewSection from '../components/OwnerOverviewSection.jsx'
import TechnicianPaymentsSection from '../../billing/components/TechnicianPaymentsSection.jsx'
import OwnerProjectWorkspace, { PROJECT_SECTION_DASHBOARD, projectSectionIds, projectSectionLabel } from '../components/OwnerProjectWorkspace.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import useRequestInbox, { useMarkSeenWhenOpened } from '../../../shared/hooks/useRequestInbox.js'
import NewRequestToast from '../../requests/components/NewRequestToast.jsx'
import { projectRequestItems } from '../../../shared/utils/requestInbox.js'
import { completionPercent, scheduleWidth } from '../../../shared/utils/projectProgress.js'
import PropertyBuySellHub from '../../property/components/PropertyBuySellHub.jsx'
import ContractorProfileDetails from '../../builder/components/BuilderProfileDetails.jsx'
import { loadCart, selectCartCount } from '../../shop/cartSlice.js'
import WeatherNavButton from '../../weather/components/WeatherNavButton.jsx'
import {
  OWNER_BUILDER_REQUEST_TYPES,
  estimateFromDetails,
  normalizeEstimateText,
  projectFromEstimate,
  projectScheduleProblem,
  readLocalEstimates,
  removeLocalEstimate,
  readSeenContractorIds,
  readSeenSupplierIds,
  saveSeenContractorIds,
  saveSeenSupplierIds,
} from '../ownerHelpers.js'

// The three pages of the House Owner's workspace. The top navigation is exactly
// these, at every width and whatever the account owns — it no longer grows and
// shrinks with the selected project, because a project is now a page of its own
// rather than a context the whole dashboard is filtered through.
const NAV_DASHBOARD = 'dashboard'
const NAV_PROJECTS = 'projects'
const NAV_BUY_SELL = 'buySell'

// Pages reached from the topbar rather than the navigation, exactly as before:
// the message button and the account menu.
const NAV_MESSAGES = 'messages'
const NAV_PROFILE = 'profile'

const NAV_PATHS = {
  [NAV_DASHBOARD]: '/owner',
  [NAV_PROJECTS]: '/owner/projects',
  [NAV_BUY_SELL]: '/owner/buy-sell',
  [NAV_MESSAGES]: '/owner/messages',
  [NAV_PROFILE]: '/owner/profile',
}

const CURRENT_PROJECT_STORAGE_KEY = 'crewnbuild_current_project_id'

/**
 * Where the owner is, read from the URL.
 *
 * The address is the single statement of what is on screen — which page, which
 * project, and which section of that project. Nothing else holds that state, so
 * the browser's own Back button, a bookmarked project and a link pasted to
 * someone else all behave the way the navigation does.
 */
function parseOwnerLocation(pathname) {
  const [first, second, third] = pathname.replace(/^\/owner\/?/, '').split('/').filter(Boolean)
  if (first === 'projects') {
    if (!second) return { page: NAV_PROJECTS }
    return { page: 'project', projectId: second, section: third || PROJECT_SECTION_DASHBOARD }
  }
  if (first === 'buy-sell') return { page: NAV_BUY_SELL }
  if (first === 'messages') return { page: NAV_MESSAGES }
  if (first === 'profile') return { page: NAV_PROFILE }
  return { page: NAV_DASHBOARD }
}

// Which navigation item is lit for a given page. A project page lights
// Projects, because that is where it was opened from and where Back leads.
const NAV_FOR_PAGE = {
  [NAV_DASHBOARD]: NAV_DASHBOARD,
  [NAV_PROJECTS]: NAV_PROJECTS,
  project: NAV_PROJECTS,
  [NAV_BUY_SELL]: NAV_DASHBOARD,
  [NAV_MESSAGES]: NAV_MESSAGES,
  [NAV_PROFILE]: NAV_PROFILE,
}

// The notification modules each destination marks read on arrival. The same
// mapping as before; only the names of the destinations changed, and estimates
// moved with the saved-estimate list onto the Projects page.
const SECTION_NOTIFICATION_MODULES = {
  [NAV_DASHBOARD]: [],
  [NAV_PROJECTS]: ['project', 'estimate'],
  [NAV_BUY_SELL]: [],
  [NAV_MESSAGES]: ['message', 'request', 'contractor', 'supplier'],
  [NAV_PROFILE]: ['general'],
  requests: ['request'],
  builders: ['contractor'],
  suppliers: ['supplier'],
  escrow: ['escrow'],
}

function readStoredProjectId() {
  try {
    return window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

const projectSectionPath = (projectId, sectionId) => (
  sectionId === PROJECT_SECTION_DASHBOARD
    ? `/owner/projects/${projectId}`
    : `/owner/projects/${projectId}/${sectionId}`
)

export default function HomeownerDashboard() {
  const { user } = useSelector((state) => state.auth)
  const { t, td } = useLanguage()
  const dispatch = useDispatch()
  const cartCount = useSelector(selectCartCount)
  // The same pincode prompt the other three dashboards show, for an owner who
  // chose "Later" on the pincode step.
  const locationPrompt = useLocationLeadsPrompt(user)
  const saveOwnerLocation = (updatedUser) => {
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    locationPrompt.finishPrompt()
  }
  // Back from Complete Profile with a Buy waiting: open the cart, which resumes it.
  const [supplierTab, setSupplierTab] = useState(() => (pendingActionIs(CART_GATED_ACTIONS) ? 'cart' : 'suppliers'))
  // Buy & Sell opens on BUY for a House Owner.
  const [buySellTab, setBuySellTab] = useState('buy')
  const [searchQuery, setSearchQuery] = useState('')

  const navigate = useNavigate()
  const location = useLocation()
  const { requireCompleteProfile } = useProfileGate()
  const ownerRoute = useMemo(() => parseOwnerLocation(location.pathname), [location.pathname])
  const [projectList, setProjectList] = useState([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [requestList, setRequestList] = useState([])
  // True once the request list has loaded successfully; a failed load never
  // clears the New Requests badge.
  const [requestsLoaded, setRequestsLoaded] = useState(false)
  const [contractorList, setContractorList] = useState([])
  const [seenContractorIds, setSeenContractorIds] = useState([])
  const [supplierList, setSupplierList] = useState([])
  const [seenSupplierIds, setSeenSupplierIds] = useState([])
  const [requestMessage, setRequestMessage] = useState('')
  const [requestDecisionMessage, setRequestDecisionMessage] = useState('')
  const [assignBuilderMessage, setAssignBuilderMessage] = useState('')
  const [assigningBuilderId, setAssigningBuilderId] = useState(null)
  const [projectUpdateMessage, setProjectUpdateMessage] = useState('')
  const [sendingReceiverId, setSendingReceiverId] = useState(null)
  // The builder whose profile is open in the centred window over Find Builders.
  const [viewingBuilderId, setViewingBuilderId] = useState(null)
  // A project opens on its Project Dashboard (the overview view).
  const [selectedProjectTab, setSelectedProjectTab] = useState('details')
  // Set by a project card's Edit: the project page opens its Overview already in edit mode.
  const [editProjectOnOpen, setEditProjectOnOpen] = useState(false)
  const [timelineEntries, setTimelineEntries] = useState([])
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [localEstimateList, setLocalEstimateList] = useState([])
  const [projectListMessage, setProjectListMessage] = useState('')
  const [convertingEstimateId, setConvertingEstimateId] = useState(null)
  const [convertMessage, setConvertMessage] = useState('')
  const [deletingEstimateId, setDeletingEstimateId] = useState(null)
  const [estimateDeleteMessage, setEstimateDeleteMessage] = useState('')
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const [notificationBadgeCounts, setNotificationBadgeCounts] = useState({})
  const [profileImageMessage, setProfileImageMessage] = useState('')
  const [profileImagePreview, setProfileImagePreview] = useState('')
  // Support modals, the same pair the other three dashboards already use.
  const [showHelp, setShowHelp] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [ownerProfileEditDetails, setOwnerProfileEditDetails] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    address: user?.address || '',
    pincode: user?.pincode || '',
    country_of_residence: user?.country_of_residence || 'India',
    building_type: user?.owner_profile?.building_type || 'RESIDENTIAL',
    construction_type: user?.owner_profile?.construction_type || 'CONTRACTOR',
    budget: user?.owner_profile?.budget || 0,
    land_area: user?.owner_profile?.land_area || 0,
    floors: user?.owner_profile?.floors || 1,
    floor_type: user?.owner_profile?.floor_type || '',
  })
  // True from the first keystroke until the next save or an explicit Cancel.
  // A ref rather than state: nothing renders differently for it, and it must be
  // readable by the seeding effect without becoming one of its dependencies.
  const ownerProfileHasUnsavedEdits = useRef(false)

  // The project this page is about, when the page is about one. The global
  // pages have none on purpose: with the topbar project dropdown gone, the
  // address is the only thing that says which project is being worked on.
  const openedProject = useMemo(() => {
    if (ownerRoute.page !== 'project') return null
    return projectList.find((project) => String(project.id) === String(ownerRoute.projectId)) || null
  }, [ownerRoute.page, ownerRoute.projectId, projectList])

  // Only for the few defaults that used to fall back to "whichever project came
  // first" — profile preferences and the like. Never used to decide what a page
  // shows.
  const fallbackProject = openedProject || projectList[0] || null

  // Only a failed send leaves a note here now; it clears after a few seconds
  // and whenever another project (or page) is opened.
  useEffect(() => { setRequestMessage('') }, [ownerRoute.page, ownerRoute.projectId])
  useEffect(() => {
    if (!requestMessage) return undefined
    const timer = window.setTimeout(() => setRequestMessage(''), 5000)
    return () => window.clearTimeout(timer)
  }, [requestMessage])

  // The name as it is READ, so the avatar's initials come from the same letters
  // the greeting shows rather than from a hard-coded English "HO".
  const userShell = useMemo(() => {
    const displayName = td(user?.name || '')
    return {
      name: displayName,
      initials: displayName.trim().slice(0, 2).toUpperCase() || '•',
      profileImageUrl: profileImagePreview || user?.profile_image_url || '',
    }
  }, [profileImagePreview, user, td])

  // Latest load wins: a live refresh can overlap a load already in flight, and
  // the older response must not overwrite the newer one.
  const ownerLoadGuard = useLatestOnly()
  const refreshOwnerData = async () => {
    const isLatest = ownerLoadGuard()
    setProjectListMessage('')
    const ownerProjects = await fetchOwnerProjects().catch((error) => {
      if (isLatest()) setProjectListMessage(error.response?.data?.detail || t('dash.err.loadProjects'))
      return []
    })
    if (!isLatest()) return
    setProjectList(ownerProjects)
    setProjectsLoaded(true)

    fetchIncomingRequests()
      .then((list) => { if (isLatest()) { setRequestList(list); setRequestsLoaded(true) } })
      .catch(() => { if (isLatest()) setRequestList([]) })
  }
  // A request, answer, counter-offer or assignment from someone else reloads
  // through this same loader, without a page refresh.
  useLiveRefresh(refreshOwnerData)

  const refreshUnreadMessageCount = () => {
    fetchConversations()
      .then((conversationList) => {
        const totalUnreadMessages = conversationList.reduce((total, conversation) => total + Number(conversation.unread_count || 0), 0)
        setUnreadMessageCount(totalUnreadMessages)
      })
      .catch(() => setUnreadMessageCount(0))
  }

  const refreshNotificationBadgeCounts = () => {
    fetchNotifications()
      .then((notificationList) => {
        const nextBadgeCounts = {}
        notificationList.forEach((notification) => {
          if (notification.is_read) return
          const moduleTabMap = {
            request: 'requests',
            project: 'projects',
            contractor: 'builders',
            supplier: 'suppliers',
            estimate: 'estimates',
            escrow: 'escrow',
            general: 'profile',
          }
          const tabId = moduleTabMap[notification.module]
          if (tabId) nextBadgeCounts[tabId] = (nextBadgeCounts[tabId] || 0) + 1
        })
        setNotificationBadgeCounts(nextBadgeCounts)
      })
      .catch(() => setNotificationBadgeCounts({}))
  }

  const logout = () => {
    dispatch(logoutUser())
    navigate('/login')
  }

  const uploadOwnerProfileImage = async (file) => {
    if (!file) return
    assertProfileImage(file, t)
    setProfileImageMessage(t('dash.msg.uploadingProfileImage'))
    const uploadedFile = await uploadLocalFile(file)
    setProfileImagePreview(uploadedFile.previewUrl || uploadedFile.url)
    const updatedUser = await updateUserProfileImage(uploadedFile.url)
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    setProfileImageMessage(t('dash.msg.profileImageUpdated'))
  }

  const markSectionNotificationsRead = useCallback((sectionId) => {
    (SECTION_NOTIFICATION_MODULES[sectionId] || []).forEach((moduleName) => {
      markModuleNotificationsRead(moduleName)
        .then(refreshNotificationBadgeCounts)
        .catch(() => {})
    })
  }, [])

  // The top navigation, the topbar message button and the account menu all
  // arrive here. Every destination is a real address, so the browser records it.
  const goToPage = useCallback((pageId) => {
    markSectionNotificationsRead(pageId)
    navigate(NAV_PATHS[pageId] || NAV_PATHS[NAV_DASHBOARD])
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [markSectionNotificationsRead, navigate])

  // Opening a project card leaves the catalogue for that project's own page.
  // A project opens on the first tab of its navigation: Find Builders, or
  // Requests for a self-construction project (which has no builders).
  const openProject = useCallback((project, sectionId = null) => {
    if (!project?.id) return
    try { window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, String(project.id)) } catch { /* private mode */ }
    setSelectedProjectTab('details')
    setShowProjectForm(false)
    setProjectUpdateMessage('')
    const firstSection = project.construction_type === 'SELF_CONSTRUCTION' ? 'requests' : 'builders'
    navigate(projectSectionPath(project.id, sectionId || firstSection))
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [navigate])

  // The project card's Assign Builder: the same project page, on its Assigned
  // Builders section, which lists this project's accepted quotations and
  // assigns through the existing /project-requests/assign.
  const openProjectAssignBuilders = useCallback((project) => {
    openProject(project, PROJECT_SECTION_DASHBOARD)
    setSelectedProjectTab('assignedBuilders')
  }, [openProject])

  // The project card's Edit: the same project page, on its Overview (Details)
  // with the existing edit form open, instead of a form inside the card.
  const openProjectOverviewEdit = useCallback((project) => {
    openProject(project, PROJECT_SECTION_DASHBOARD)
    setSelectedProjectTab('details')
    setEditProjectOnOpen(true)
  }, [openProject])

  const openProjectSection = useCallback((sectionId) => {
    if (!openedProject) return
    markSectionNotificationsRead(sectionId)
    // The "new since you last looked" dots are cleared by looking, exactly as
    // they were when these sections lived in the top navigation.
    if (sectionId === 'builders') {
      const currentContractorIds = contractorList.map((contractor) => contractor.user_id || contractor.id).filter(Boolean)
      saveSeenContractorIds(user?.id, openedProject.pincode || user?.pincode, currentContractorIds)
      setSeenContractorIds(currentContractorIds)
    }
    if (sectionId === 'suppliers') {
      const currentSupplierIds = supplierList.map((supplier) => supplier.user_id || supplier.id).filter(Boolean)
      saveSeenSupplierIds(user?.id, openedProject.pincode || user?.pincode, currentSupplierIds)
      setSeenSupplierIds(currentSupplierIds)
    }
    navigate(projectSectionPath(openedProject.id, sectionId))
  }, [contractorList, markSectionNotificationsRead, navigate, openedProject, supplierList, user?.id, user?.pincode])

  // A notification names one of the destinations the dashboard has always used.
  // Several of them live inside a project now, so they are resolved against the
  // project last opened, falling back to the catalogue when there is none.
  const notificationDestination = useCallback((tabId) => {
    if (tabId === 'messages') return NAV_PATHS[NAV_MESSAGES]
    if (tabId === 'profile') return NAV_PATHS[NAV_PROFILE]
    // Saved estimates moved onto the Projects page along with the project cards.
    if (tabId === 'projects' || tabId === 'estimates') return NAV_PATHS[NAV_PROJECTS]

    const wantedSection = { requests: 'requests', escrow: 'escrow', contractors: 'builders', suppliers: 'suppliers' }[tabId]
    if (!wantedSection) return ''

    const storedProjectId = readStoredProjectId()
    const project = projectList.find((candidate) => String(candidate.id) === storedProjectId) || projectList[0]
    if (!project) return NAV_PATHS[NAV_PROJECTS]
    // A section this project does not have — Builders on a self-construction
    // project, say — lands on the project itself rather than on an empty screen.
    const section = projectSectionIds(project).includes(wantedSection) ? wantedSection : PROJECT_SECTION_DASHBOARD
    return projectSectionPath(project.id, section)
  }, [projectList])

  // A notification can hand over a destination before the projects have loaded,
  // so it is held until there is a project list to resolve it against.
  const [pendingNotificationTab, setPendingNotificationTab] = useState(() => {
    try {
      const storedTab = sessionStorage.getItem('crewnbuild_pending_dashboard_tab')
      if (storedTab) sessionStorage.removeItem('crewnbuild_pending_dashboard_tab')
      return storedTab || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    const handleNotificationOpen = (event) => {
      if (event.detail?.tab) setPendingNotificationTab(event.detail.tab)
    }
    window.addEventListener('crewnbuild_notification_open', handleNotificationOpen)
    return () => window.removeEventListener('crewnbuild_notification_open', handleNotificationOpen)
  }, [])

  useEffect(() => {
    if (!pendingNotificationTab || !projectsLoaded) return
    const destination = notificationDestination(pendingNotificationTab)
    setPendingNotificationTab('')
    if (destination) navigate(destination)
  }, [navigate, notificationDestination, pendingNotificationTab, projectsLoaded])

  // `projectId` is taken from the open project at the moment of the click and
  // stored with the gated action, so a request resumed after Complete Profile
  // goes to the same project even before the project list has reloaded.
  const sendOwnerContractorRequest = async (contractor, projectId = openedProject?.id || null) => {
    if (requireCompleteProfile('sendOwnerContractorRequest', { recipient: contractor, projectId })) return
    setRequestMessage('')

    setSendingReceiverId(contractor.user_id)
    try {
      await sendProjectRequest({
        receiver_id: contractor.user_id,
        project_id: projectId,
        request_type: 'OWNER_TO_CONTRACTOR',
      })
      // No "Request sent to …" note: the card's own button shows the request is pending.
      refreshOwnerData()
    } catch (error) {
      setRequestMessage(error.response?.data?.detail || t('dash.err.sendBuilderRequest'))
    } finally {
      setSendingReceiverId(null)
    }
  }

  const requestProjectUpdate = async (project) => {
    setProjectUpdateMessage('')
    if (!project?.contractor_id) {
      setProjectUpdateMessage(t('dash.err.noBuilderAssigned'))
      return
    }
    setSendingReceiverId(project.contractor_id)
    try {
      // The message body is sent, stored and read by the builder — whose own
      // language is their business, not the owner's. It is never displayed
      // here, so it is composed in English and left alone.
      await sendConversationMessage({
        receiver_id: project.contractor_id,
        body: `${user?.name || 'Homeowner'} requested a site update for ${project.title || 'this project'}. Please share the latest progress, photos, and current work status.`,
        message_type: 'TEXT',
      })
      setProjectUpdateMessage(t('dash.msg.updateRequestSent'))
      refreshOwnerData()
    } catch (error) {
      setProjectUpdateMessage(error.response?.data?.detail || t('dash.err.requestProjectUpdate'))
    } finally {
      setSendingReceiverId(null)
    }
  }

  const sendOwnerSupplierRequest = async (supplier, projectId = supplierProject?.id || null) => {
    if (requireCompleteProfile('sendOwnerSupplierRequest', { recipient: supplier, projectId })) return
    setRequestMessage('')
    if (!projectId) {
      setRequestMessage(t('ui.owner.createSelfProjectFirst'))
      navigate(NAV_PATHS[NAV_PROJECTS])
      return
    }

    setSendingReceiverId(supplier.user_id)
    try {
      await sendProjectRequest({
        receiver_id: supplier.user_id,
        project_id: projectId,
        request_type: 'OWNER_TO_SUPPLIER',
      })
      // No "Request sent to …" note: the card's own button shows the request is pending.
      refreshOwnerData()
      // Re-read the supplier list so the card shows the status the API now
      // holds, instead of the button changing on the strength of the click.
      refreshSupplierList()
    } catch (error) {
      setRequestMessage(error.response?.data?.detail || t('dash.err.sendSupplierRequest'))
    } finally {
      setSendingReceiverId(null)
    }
  }


  useEffect(() => {
    refreshOwnerData()
  }, [user?.pincode])

  useEffect(() => {
    setLocalEstimateList(readLocalEstimates(user))
  }, [user])

  useEffect(() => {
    refreshUnreadMessageCount()
    const messageCountTimer = window.setInterval(refreshUnreadMessageCount, 10000)
    return () => window.clearInterval(messageCountTimer)
  }, [])

  useEffect(() => {
    refreshNotificationBadgeCounts()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNotificationBadgeCounts()
    }
    const refreshOnFocus = () => refreshNotificationBadgeCounts()
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  useEffect(() => {
    if (!openedProject?.id) {
      setTimelineEntries([])
      return
    }
    fetchProjectPhotos(openedProject.id).then(setTimelineEntries).catch(() => setTimelineEntries([]))
  }, [openedProject?.id])

  // An address naming a project the account does not own, or a section that
  // project does not have, is corrected rather than rendered empty. `replace`,
  // so the bad address is not left in the history for Back to return to.
  useEffect(() => {
    if (ownerRoute.page !== 'project' || !projectsLoaded) return
    if (!openedProject) {
      navigate(NAV_PATHS[NAV_PROJECTS], { replace: true })
      return
    }
    if (!projectSectionIds(openedProject).includes(ownerRoute.section)) {
      navigate(projectSectionPath(openedProject.id, PROJECT_SECTION_DASHBOARD), { replace: true })
    }
  }, [navigate, openedProject, ownerRoute.page, ownerRoute.section, projectsLoaded])

  // Materials are only bought for a self-construction project, so those are the
  // projects the Suppliers dropdown offers.
  const selfConstructionProjects = useMemo(
    () => projectList.filter((project) => project.construction_type === 'SELF_CONSTRUCTION'),
    [projectList],
  )
  // The project the Suppliers area is working in. That area only exists on a
  // self-construction project's own page, so it is that project — suppliers,
  // their status, the cart and the orders are all read for it and can never
  // disagree with one another.
  const supplierProject = openedProject?.construction_type === 'SELF_CONSTRUCTION' ? openedProject : null

  // The cart badge follows the project being bought for, like the cart itself.
  useEffect(() => { dispatch(loadCart(supplierProject?.id)) }, [dispatch, supplierProject?.id])

  // One place that loads the supplier list, so sending a request can re-read it
  // and pick up the status the API now holds.
  const refreshSupplierList = useCallback(() => {
    if (!supplierProject?.id) {
      setSupplierList([])
      return Promise.resolve()
    }
    const sitePincode = supplierProject.pincode || user?.pincode
    const siteCountry = supplierProject.project_country || user?.country_of_residence || 'India'
    return fetchNearbySuppliers(sitePincode, siteCountry, supplierProject.id)
      .then(setSupplierList)
      .catch(() => setSupplierList([]))
  }, [supplierProject?.id, supplierProject?.pincode, supplierProject?.project_country, user?.pincode, user?.country_of_residence])

  // Opening Suppliers re-reads the list, so a decision the supplier made while
  // the owner was on another screen is picked up. Without this the cards keep
  // the statuses fetched when the project was first opened, and an accepted
  // request goes on reading "Request Pending" until a full page reload.
  useEffect(() => {
    if (ownerRoute.section === 'suppliers') refreshSupplierList()
  }, [ownerRoute.section, refreshSupplierList])

  // Builder discovery is read for the project whose page is open.
  useEffect(() => {
    if (!openedProject?.id) {
      setContractorList([])
      return
    }
    const sitePincode = openedProject.pincode || user?.pincode
    const siteCountry = openedProject.project_country || user?.country_of_residence || 'India'
    fetchNearbyContractors(sitePincode, siteCountry, openedProject.id).then(setContractorList).catch(() => setContractorList([]))
  }, [openedProject?.id, openedProject?.pincode, openedProject?.project_country, user?.pincode, user?.country_of_residence])

  useEffect(() => { refreshSupplierList() }, [refreshSupplierList])

  const projectPreferenceDetails = fallbackProject || user?.owner_profile || {}
  const contractorPincode = openedProject?.pincode || user?.pincode
  const supplierPincode = supplierProject?.pincode || user?.pincode
  const unseenContractorCount = contractorList.filter((contractor) => !seenContractorIds.includes(contractor.user_id || contractor.id)).length
  const unseenSupplierCount = supplierList.filter((supplier) => !seenSupplierIds.includes(supplier.user_id || supplier.id)).length

  useEffect(() => {
    setSeenContractorIds(readSeenContractorIds(user?.id, contractorPincode))
  }, [user?.id, contractorPincode])

  useEffect(() => {
    setSeenSupplierIds(readSeenSupplierIds(user?.id, supplierPincode))
  }, [user?.id, supplierPincode])

  useEffect(() => {
    if (ownerRoute.section !== 'builders') return
    const currentContractorIds = contractorList.map((contractor) => contractor.user_id || contractor.id).filter(Boolean)
    saveSeenContractorIds(user?.id, contractorPincode, currentContractorIds)
    setSeenContractorIds(currentContractorIds)
  }, [ownerRoute.section, contractorList, contractorPincode, user?.id])

  useEffect(() => {
    if (ownerRoute.section !== 'suppliers') return
    const currentSupplierIds = supplierList.map((supplier) => supplier.user_id || supplier.id).filter(Boolean)
    saveSeenSupplierIds(user?.id, supplierPincode, currentSupplierIds)
    setSeenSupplierIds(currentSupplierIds)
  }, [ownerRoute.section, supplierList, supplierPincode, user?.id])

  // The delete banner is a toast, not a notice board: it confirms the delete
  // and then clears itself. It used to stay until the *next* delete, so
  // "Project deleted successfully." sat on the page long after the fact and
  // read as if it were describing whatever the owner was looking at now.
  // Same 4 second dismissal the supplier dashboard's request banner uses.
  useEffect(() => {
    if (!estimateDeleteMessage) return
    const hideTimer = window.setTimeout(() => setEstimateDeleteMessage(''), 4000)
    return () => window.clearTimeout(hideTimer)
  }, [estimateDeleteMessage])

  const deleteEstimate = async (estimate) => {
    setEstimateDeleteMessage('')
    if (estimate.project_id) {
      setDeletingEstimateId(estimate.project_id)
      try {
        await deleteOwnerProject(estimate.project_id)
        await refreshOwnerData()
        setEstimateDeleteMessage(t('dash.msg.projectDeleted'))
      } catch (error) {
        setEstimateDeleteMessage(error.response?.data?.detail || t('dash.err.deleteProject'))
      } finally {
        setDeletingEstimateId(null)
      }
      return
    }
    // Local draft estimates only exist in the owner's draft storage.
    removeLocalEstimate(user?.id, estimate.id)
    setLocalEstimateList(readLocalEstimates(user))
    setEstimateDeleteMessage(t('dash.msg.projectDeleted'))
  }

  // Every accepted quotation on THIS project, whichever side opened the
  // conversation. It used to require `is_sender` and OWNER_TO_CONTRACTOR, so a
  // builder who approached the owner first (CONTRACTOR_TO_OWNER) never appeared
  // here to be chosen from -- which is why accepting one of those was made to
  // assign the project outright. Both directions are the same thing: a builder
  // offering a price on this project.
  const acceptedQuotations = useMemo(() => {
    if (!openedProject?.id) return []
    return requestList.filter((request) => (
      OWNER_BUILDER_REQUEST_TYPES.includes(request.request_type)
      && request.status === 'accepted'
      && request.project_id === openedProject.id
      && Number(request.quotation_amount || 0) > 0
    ))
  }, [requestList, openedProject?.id])

  // Selecting a quotation assigns THIS project through the existing endpoint.
  // Reloaded either way, so a refusal (e.g. another assignment got there
  // first) shows the project's real state.
  const assignBuilderToProject = async (requestId) => {
    if (assigningBuilderId != null) return
    setAssignBuilderMessage('')
    setAssigningBuilderId(requestId)
    try {
      const result = await assignProjectToContractor(requestId)
      // No confirmed award yet: the quotation went to the builder to confirm.
      if (result?.status === 'awaiting_builder_confirmation') setAssignBuilderMessage(t('quote.confirmationRequested'))
    } catch (error) {
      setAssignBuilderMessage(error.response?.data?.detail || t('quote.assignFailed'))
    } finally {
      await refreshOwnerData()
      setAssigningBuilderId(null)
    }
  }

  // Negotiate on a quotation: assigns THIS project with the owner's opening
  // counter-offer. The modal shows a refusal; the data is reloaded either way,
  // so a stale screen catches up.
  const negotiateWithBuilder = async (requestId, amount, note) => {
    setAssignBuilderMessage('')
    try {
      await negotiateQuotation(requestId, amount, note)
    } finally {
      await refreshOwnerData()
    }
  }

  // The backend's reason when it refuses an answer (for example a request that
  // was already accepted or rejected elsewhere), else the generic message.
  const requestDecisionError = (error, fallbackKey) => {
    const detail = error?.response?.data?.detail
    return typeof detail === 'string' && detail ? detail : t(fallbackKey)
  }

  const acceptOwnerRequest = async (requestId) => {
    if (requireCompleteProfile('acceptOwnerRequest', requestId)) return
    setRequestDecisionMessage('')
    try {
      await acceptProjectRequest(requestId)
    } catch (error) {
      setRequestDecisionMessage(requestDecisionError(error, 'dash.err.acceptRequest'))
    }
    // Refreshed either way, so a request answered elsewhere shows its real state.
    refreshOwnerData()
  }

  const rejectOwnerRequest = async (requestId) => {
    setRequestDecisionMessage('')
    try {
      await rejectProjectRequest(requestId)
    } catch (error) {
      setRequestDecisionMessage(requestDecisionError(error, 'dash.err.rejectRequest'))
    }
    refreshOwnerData()
  }

  // Take back one of the owner's own pending requests; it stays as Withdrawn.
  const withdrawOwnerRequest = async (requestId) => {
    setRequestDecisionMessage('')
    try {
      await withdrawProjectRequest(requestId)
    } catch (error) {
      setRequestDecisionMessage(requestDecisionError(error, 'dash.err.withdrawRequest'))
    }
    refreshOwnerData()
  }

  // `estimate` carries the start_date / end_date the owner entered on the card
  // (also when resumed after Complete Profile). Never converted without them.
  const convertEstimateToProject = async (estimate) => {
    const scheduleProblem = projectScheduleProblem(estimate?.start_date, estimate?.end_date)
    if (scheduleProblem) {
      setConvertMessage(t(scheduleProblem))
      return
    }
    if (requireCompleteProfile('convertEstimateToProject', estimate)) return
    setConvertMessage('')
    setConvertingEstimateId(estimate.id)
    try {
      // Stored values, not interface copy: these are written to the project
      // record and read back by every other role, so they stay in English
      // whatever language the owner is reading the screen in.
      const createdProject = await createProjectRequest({
        title: estimate.project_title || 'Untitled project',
        description: estimate.project_description || 'Created from saved estimate',
        address: estimate.address || '',
        pincode: estimate.pincode || user?.pincode || '',
        building_type: estimate.building_type || 'RESIDENTIAL',
        construction_type: estimate.construction_type || 'CONTRACTOR',
        budget: Number(estimate.budget || 0),
        land_area: Number(estimate.land_area || 0),
        floors: Number(estimate.floors || 1),
        start_date: estimate.start_date,
        end_date: estimate.end_date,
      })
      if (estimate.owner_id === user?.id || (estimate.owner_email && estimate.owner_email === user?.email)) {
        removeLocalEstimate(user?.id, estimate.id)
        setLocalEstimateList(readLocalEstimates(user))
      }
      setConvertMessage(t('dash.msg.estimateConverted', { title: td(createdProject.title) }))
      await refreshOwnerData()
    } catch (error) {
      setConvertMessage(error.response?.data?.detail || t('dash.err.convertEstimate'))
    } finally {
      setConvertingEstimateId(null)
    }
  }

  // The Projects page, as one list.
  //
  // Each entry pairs what the card shows with what its actions act on. A real
  // project pairs itself with the estimate derived from it — which is exactly
  // what the saved-requirement card used to hand those actions, so Edit and
  // Delete work on unchanged handlers. A draft that never became a project is
  // an entry too, drawn as a project through the same helper the catalogue has
  // always used, and matched against the real projects first so a draft that
  // has since been built is not listed a second time.
  const projectEntries = useMemo(() => {
    const estimateKeyOf = (title, description, address, pincode, budget, landArea, floors) => [
      normalizeEstimateText(title),
      normalizeEstimateText(description),
      normalizeEstimateText(address),
      normalizeEstimateText(pincode),
      Number(budget || 0),
      Number(landArea || 0),
      Number(floors || 1),
    ].join('|')

    const realProjectKeys = new Set(projectList.map((project) => estimateKeyOf(
      project.title, project.description, project.address, project.pincode,
      project.budget, project.land_area, project.floors,
    )))

    // The furthest-along project first, by the same figure its card shows:
    // completion once measured, else the schedule figure once work has
    // started. Projects not started keep their existing order after those.
    const progressOf = (project) => completionPercent(project) ?? (project.work_started === true ? scheduleWidth(project) : -1)
    const projectRows = [...projectList]
      .sort((a, b) => progressOf(b) - progressOf(a))
      .map((project) => ({
        project,
        estimate: estimateFromDetails(project, { id: `project-${project.id}`, source: 'Project', phone: user?.phone }),
      }))

    const draftRows = localEstimateList
      .filter((estimate) => !realProjectKeys.has(estimateKeyOf(
        estimate.project_title, estimate.project_description, estimate.address, estimate.pincode,
        estimate.budget, estimate.land_area, estimate.floors,
      )))
      .map((estimate) => ({ project: projectFromEstimate(estimate), estimate }))

    return [...projectRows, ...draftRows]
  }, [localEstimateList, projectList, user?.phone])

  // Search filtering for topbar search
  const sq = searchQuery.trim().toLowerCase()
  const filteredProjectEntries = useMemo(() => {
    if (!sq) return projectEntries
    return projectEntries.filter(({ project }) =>
      [project.title, project.address, project.pincode, project.description, project.contractor?.name]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(sq))
    )
  }, [projectEntries, sq])

  const filteredContractorList = useMemo(() => {
    if (!sq) return contractorList
    return contractorList.filter((contractor) =>
      [contractor.company_name, contractor.name, contractor.pincode]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(sq))
    )
  }, [contractorList, sq])

  const filteredRequestList = useMemo(() => {
    if (!sq) return requestList
    return requestList.filter((request) =>
      [request.sender_name, request.receiver_name, request.project_title]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(sq))
    )
  }, [requestList, sq])

  // The profile form is seeded from the account, and re-seeded whenever the
  // account itself changes -- but never while there are unsaved edits, or a
  // background refresh would quietly throw away what the owner has typed.
  const seedOwnerProfileEditDetails = () => {
    setOwnerProfileEditDetails({
      name: user?.name || '',
      phone: user?.phone || '',
      address: user?.address || '',
      pincode: user?.pincode || '',
      country_of_residence: user?.country_of_residence || 'India',
      building_type: projectPreferenceDetails.building_type || 'RESIDENTIAL',
      construction_type: projectPreferenceDetails.construction_type || 'CONTRACTOR',
      budget: projectPreferenceDetails.budget || 0,
      land_area: projectPreferenceDetails.land_area || 0,
      floors: projectPreferenceDetails.floors || 1,
    })
  }

  const resetOwnerProfileEditDetails = () => {
    ownerProfileHasUnsavedEdits.current = false
    seedOwnerProfileEditDetails()
  }

  useEffect(() => {
    if (ownerProfileHasUnsavedEdits.current) return
    seedOwnerProfileEditDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.name,
    user?.phone,
    user?.address,
    user?.pincode,
    user?.country_of_residence,
    user?.created_at,
    user?.owner_profile?.building_type,
    user?.owner_profile?.construction_type,
    user?.owner_profile?.budget,
    user?.owner_profile?.land_area,
    user?.owner_profile?.floors,
    fallbackProject?.id,
  ])

  const updateOwnerProfileEditField = (field, value) => {
    ownerProfileHasUnsavedEdits.current = true
    setOwnerProfileEditDetails((currentDetails) => ({ ...currentDetails, [field]: value }))
  }

  const saveOwnerProfileChanges = async (event) => {
    event?.preventDefault()
    setProfileImageMessage(t('dash.msg.savingProfile'))
    try {
      // The complete profile in one request, through the existing API.
      const updatedUser = await completeUserProfile({
        ...ownerProfileEditDetails,
        profile_image_url: user?.profile_image_url || '',
        // Stored profile fields, never displayed from here: English on the wire.
        project_title: user?.owner_profile?.project_title || fallbackProject?.title || 'General',
        project_description: user?.owner_profile?.project_description || fallbackProject?.description || 'Project preferences',
        budget: Number(ownerProfileEditDetails.budget || 0),
        land_area: Number(ownerProfileEditDetails.land_area || 0),
        // Numeric value derived from the chosen configuration, so every
        // existing reader of `floors` keeps the number it expects.
        floors: floorCountFor(ownerProfileEditDetails.country_of_residence, ownerProfileEditDetails.floor_type, ownerProfileEditDetails.floors),
        floor_type: ownerProfileEditDetails.floor_type || null,
      })
      ownerProfileHasUnsavedEdits.current = false
      dispatch(setAuthenticatedUser({ user: updatedUser }))
      setProfileImageMessage(t('dash.msg.profileSaved'))
      refreshOwnerData()
    } catch (error) {
      // Clear "Saving..." so it cannot sit there describing something that did
      // not happen, and let the rejection reach the profile section: it keeps
      // the entered values, marks the refused fields and scrolls to the first.
      setProfileImageMessage('')
      throw error
    }
  }

  // New Requests: builder and supplier requests sent to this owner for one of
  // their projects, pending only. Each counts under its own project's Requests.
  const requestInboxItems = useMemo(
    () => projectRequestItems(requestList.filter((request) => request.project_id), (request) => `project:${request.project_id}`, ['CONTRACTOR_TO_OWNER', 'SUPPLIER_TO_OWNER']),
    [requestList],
  )
  const requestInbox = useRequestInbox({ userId: user?.id, items: requestInboxItems, loaded: requestsLoaded })
  const openedProjectRequestKeys = openedProject
    ? requestInboxItems.filter((item) => item.section === `project:${openedProject.id}`).map((item) => item.key)
    : []
  useMarkSeenWhenOpened(requestInbox, {
    open: ownerRoute.page === 'project' && ownerRoute.section === 'requests' && Boolean(openedProject),
    loaded: requestsLoaded,
    displayedKeys: openedProjectRequestKeys,
  })
  const openRequestsFromToast = () => {
    // The project holding the newest unread request (the list is newest first).
    const unread = new Set(requestInbox.unreadKeys)
    const newest = requestInboxItems.find((item) => unread.has(item.key))
    const project = newest && projectList.find((item) => `project:${item.id}` === newest.section)
    if (!project) return
    if (openedProject?.id === project.id && ownerRoute.section === 'requests') requestInbox.markSeen(openedProjectRequestKeys)
    else openProject(project, 'requests')
  }

  // Dashboard and Projects. Buy & Sell is reached from the dashboard's Quick
  // Actions; its page and route are unchanged.
  // `bareIcon`: the icons without their small box, the same style as the
  // builder's navigation (see SidebarNavItem in DashboardShell).
  const nav = [
    { id: NAV_DASHBOARD, label: t('ui.dashboard'), icon: LayoutGrid, bareIcon: true },
    {
      id: NAV_PROJECTS,
      label: t('ui.projects'),
      icon: Building2,
      bareIcon: true,
      // Plus every project's new incoming requests, so one waiting in a project
      // the owner has not opened is still signalled from the top navigation.
      badge: (Number(notificationBadgeCounts.projects || 0) + Number(notificationBadgeCounts.estimates || 0) + requestInbox.unreadCount) || undefined,
    },
  ]

  // The dashboard's four Quick Actions. Each opens a place that already exists,
  // the same way the old buttons and the old Buy & Sell tab did:
  //   Construction Project  Projects, with the create-project form open
  //   Buy & Sell            the Buy & Sell page
  //   Book Technician       the Partner application's technician booking
  //   Order Product         the Suppliers page of a self-construction project
  //                         (the current one if it is one, else the first) --
  //                         materials are only ordered for such a project.
  const orderProject = (() => {
    const storedId = readStoredProjectId()
    return selfConstructionProjects.find((project) => String(project.id) === String(storedId)) || selfConstructionProjects[0] || null
  })()
  // Partner's booking, at its start or straight on one trade's page.
  const bookTechnician = (trade = null) => {
    // Say why it could not open: no Partner address configured, or the popup was blocked.
    if (!partnerBookingConfigured) window.alert(t('ui.owner.bookTechnicianNotConfigured'))
    else if (!openPartnerBooking(trade, user)) window.alert(t('ui.owner.bookTechnicianPopupBlocked'))
  }
  const openOrderCatalog = () => { if (orderProject) openProject(orderProject, 'suppliers') }
  const ownerQuickActions = [
    {
      id: 'construction',
      label: t('owner.quick.construction'),
      hint: t('owner.quick.constructionSub'),
      icon: HardHat,
      onClick: () => {
        setShowProjectForm(true)
        navigate(NAV_PATHS[NAV_PROJECTS])
        window.scrollTo({ top: 0, behavior: 'auto' })
      },
    },
    { id: 'buySell', label: t('ui.buySell'), hint: t('owner.quick.buySellSub'), icon: Store, onClick: () => goToPage(NAV_BUY_SELL) },
    {
      id: 'technician',
      label: t('ui.owner.bookTechnician'),
      hint: t('owner.quick.technicianSub'),
      icon: Wrench,
      onClick: () => bookTechnician(),
    },
    {
      id: 'order',
      label: t('owner.quick.order'),
      hint: orderProject ? t('owner.quick.orderSub') : t('owner.quick.orderNeedsSelf'),
      icon: ShoppingCart,
      disabled: !orderProject,
      onClick: openOrderCatalog,
    },
  ]

  // The standard account menu, identical on every dashboard. Dark Mode and
  // Logout are supplied by DashboardShell, so the four options a user sees are
  // Profile Settings, Dark Mode, Help & Feedback and Logout.
  const ownerUserMenu = [
    { id: 'profileSettings', label: t('ui.profileSettings'), icon: Settings },
    { id: 'helpFeedback', label: t('ui.helpFeedback'), icon: LifeBuoy },
  ]
  const handleUserMenuSelect = (menuId) => {
    if (menuId === 'profileSettings') goToPage(NAV_PROFILE)
    if (menuId === 'helpFeedback') setShowHelp(true)
  }

  // Projects / <this project> / <section>. Only a project page runs deeper than
  // a single crumb, so every other page keeps the shell's own two-crumb line.
  const breadcrumbTrail = useMemo(() => {
    // Buy & Sell is opened from the dashboard, so it reads Dashboard / Buy & Sell.
    if (ownerRoute.page === NAV_BUY_SELL) return [{ label: t('ui.buySell') }]
    if (ownerRoute.page !== 'project' || !openedProject) return null
    const trail = [{ label: t('ui.projects'), onClick: () => goToPage(NAV_PROJECTS) }]
    const projectLabel = td(openedProject.title)
    if (ownerRoute.section === PROJECT_SECTION_DASHBOARD) {
      trail.push({ label: projectLabel })
    } else {
      trail.push({ label: projectLabel, onClick: () => openProject(openedProject) })
      trail.push({ label: projectSectionLabel(ownerRoute.section, t) })
    }
    return trail
  }, [goToPage, openProject, openedProject, ownerRoute.page, ownerRoute.section, t, td])

  // Resumes whatever the user was doing when Complete Profile was requested.
  // The stored payload names its own recipient and project.
  useResumeGatedAction({
    sendOwnerContractorRequest: ({ recipient, projectId }) => recipient && sendOwnerContractorRequest(recipient, projectId),
    sendOwnerSupplierRequest: ({ recipient, projectId }) => recipient && sendOwnerSupplierRequest(recipient, projectId),
    convertEstimateToProject,
    acceptOwnerRequest,
  })

  return (
    <div className="min-h-screen text-slate-950">
      <LocationLeadsPrompt
        open={locationPrompt.open}
        currentPincode={user?.pincode || ''}
        onDismiss={locationPrompt.dismissPrompt}
        onSaved={saveOwnerLocation}
      />
      <DashboardShell
        plainBackground
        // The Weather page, from the top bar beside the language selector.
        beforeLanguage={<WeatherNavButton />}
        sidebarItems={nav}
        activeId={NAV_FOR_PAGE[ownerRoute.page]}
        onNav={goToPage}
        user={userShell}
        roleLabel={t('role.owner')}
        onLogout={logout}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('ui.searchProjects')}
        // The Projects page has its search in its own row (below), so the
        // topbar one is hidden there: one search box, same query.
        showSearch={ownerRoute.page !== NAV_PROJECTS}
        userMenu={ownerUserMenu}
        onUserMenuSelect={handleUserMenuSelect}
        onMessagesClick={(pageId) => goToPage(pageId)}
        unreadMessageCount={unreadMessageCount}
        defaultTab={NAV_DASHBOARD}
        breadcrumbTrail={breadcrumbTrail}
        // On the home page the breadcrumb would only say "Dashboard" under the
        // Dashboard tab, so it is left out (an empty placeholder keeps the
        // buttons on the right). On Projects its place holds the project
        // search -- the same query the topbar search sets. Every other page,
        // project pages included, keeps its breadcrumb.
        breadcrumbReplacement={ownerRoute.page === NAV_DASHBOARD ? <span aria-hidden="true" /> : ownerRoute.page === NAV_PROJECTS ? (
          // A floor on the width lets the (wrapping) row put Create New Project
          // under the search on a phone, instead of crushing the search to
          // nothing beside a long translated button label.
          <div className="relative min-w-[min(100%,12rem)] flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-oc-deep/55" aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('ui.searchProjectsOnly')}
              aria-label={t('ui.searchProjectsOnly')}
              className="h-9 w-full rounded-full border border-[rgba(8,62,43,.18)] bg-white pl-10 pr-4 text-[13px] font-medium text-oc-ink outline-none transition placeholder:text-oc-deep/55 focus:border-oc-deep/30 focus:ring-4 focus:ring-white/40"
            />
          </div>
        ) : null}
        // Create New Project rides on the breadcrumb row on the Projects page,
        // the same slot the supplier console puts its Add Listing button in.
        // Same handler and same flow as before. The dashboard's own actions are
        // its Quick Actions.
        breadcrumbAction={ownerRoute.page === NAV_PROJECTS ? (
          <button
            type="button"
            onClick={() => setShowProjectForm((currentValue) => !currentValue)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-oc-deep"
          >
            <Plus className="h-3.5 w-3.5" /> {t('ui.createProject')}
          </button>
        ) : null}
        // A project page stands on its own: the top navigation goes, and the
        // breadcrumb above the content is the way back to the global view.
        showNav={ownerRoute.page !== 'project'}
      >
        {ownerRoute.page === NAV_DASHBOARD && (
          <OwnerOverviewSection
            user={user}
            userShell={userShell}
            projectList={projectList}
            requestList={requestList}
            onOpenProject={openProject}
            onOpenProjects={() => goToPage(NAV_PROJECTS)}
            quickActions={ownerQuickActions}
            onOpenCatalog={openOrderCatalog}
            catalogAvailable={Boolean(orderProject)}
            onBookTechnician={bookTechnician}
            onAcceptRequest={acceptOwnerRequest}
            onRejectRequest={rejectOwnerRequest}
            decisionMessage={requestDecisionMessage}
          />
        )}
        {/* Completed technician bookings and their Razorpay TEST payment. */}
        {ownerRoute.page === NAV_DASHBOARD && <TechnicianPaymentsSection />}

        {ownerRoute.page === NAV_PROJECTS && (
          <div className="space-y-4">
            {/* The "Projects" heading that sat here is gone: the navigation
                item and the breadcrumb already say where this is, so it
                repeated the page's own name and pushed the first card down.
                space-y-4 rather than space-y-6 closes the gap it left. */}
            <OwnerProjectsSection
              showProjectForm={showProjectForm}
              onProjectCreated={async (createdProject) => {
                if (createdProject) {
                  setProjectList((currentProjectList) => [createdProject, ...currentProjectList])
                }
                await refreshOwnerData()
                setShowProjectForm(false)
              }}
              projectListMessage={projectListMessage}
              projectEntries={filteredProjectEntries}
              onSelectProject={openProject}
              onAssignBuilder={openProjectAssignBuilders}
              onEditProject={openProjectOverviewEdit}
              onConvertEstimate={convertEstimateToProject}
              convertingEstimateId={convertingEstimateId}
              convertMessage={convertMessage}
              onDeleteEstimate={deleteEstimate}
              deletingEstimateId={deletingEstimateId}
              deleteMessage={estimateDeleteMessage}
            />
          </div>
        )}

        {ownerRoute.page === 'project' && openedProject && (
          <OwnerProjectWorkspace
            project={openedProject}
            section={ownerRoute.section}
            onSectionChange={openProjectSection}
            badges={{
              // This project's new incoming requests, by id.
              requests: requestInbox.unreadIn(`project:${openedProject.id}`) || undefined,
              builders: notificationBadgeCounts.builders || unseenContractorCount,
              suppliers: notificationBadgeCounts.suppliers || unseenSupplierCount || cartCount || undefined,
              escrow: notificationBadgeCounts.escrow,
            }}
            dashboardProps={{
              ownerName: user?.name,
              timelineEntries,
              activeTab: selectedProjectTab,
              setActiveTab: setSelectedProjectTab,
              onRequestUpdate: requestProjectUpdate,
              requestingUpdate: sendingReceiverId === openedProject.contractor_id,
              updateRequestMessage: projectUpdateMessage,
              quotations: acceptedQuotations,
              onAssignBuilder: assignBuilderToProject,
              assigningBuilderId,
              assignMessage: assignBuilderMessage,
              onBack: () => goToPage(NAV_PROJECTS),
              // Overview Edit saved: reload, so the Overview shows the new values.
              onProjectSaved: refreshOwnerData,
              startEditing: editProjectOnOpen,
              onEditStarted: () => setEditProjectOnOpen(false),
            }}
            requestsProps={{
              // Strictly this project's own requests. A request that names no
              // project used to be shown here too, on the reasoning that it
              // belonged to the account rather than to one site — but that put
              // the same account-level request inside every project, including
              // self-construction projects where a builder request has no
              // business appearing. Those requests are still on the Dashboard,
              // which reads the unfiltered list.
              requestList: filteredRequestList.filter((request) => request.project_id === openedProject.id),
              onAccept: acceptOwnerRequest,
              onReject: rejectOwnerRequest,
              onWithdraw: withdrawOwnerRequest,
              // An assignment decided in the request (e.g. cancelled) changes
              // the project's builder, so the project data is reloaded.
              onAwardChanged: refreshOwnerData,
              decisionMessage: requestDecisionMessage,
              // A quotation not yet negotiated can be negotiated from its
              // request too; assigning is only in the Assign Builder tab.
              project: openedProject,
              onNegotiateBuilder: negotiateWithBuilder,
            }}
            buildersProps={{
              // A refused Accept/Reject on a builder's card is reported on the
              // same card list as the send result.
              requestMessage: requestDecisionMessage || requestMessage,
              contractorList: filteredContractorList,
              sendingReceiverId,
              pincode: openedProject.pincode || user?.pincode,
              // The project this Builder section belongs to, so the cards can
              // reflect the project's assigned-builder and request state.
              project: openedProject,
              // The same project-scoped request list the Project Request block
              // renders, so a card's Pending/Accepted state and the block's
              // request rows can never disagree.
              requestList: filteredRequestList.filter((request) => request.project_id === openedProject.id),
              // Opens the builder's profile in a centred window over this list,
              // rather than replacing the dashboard with the full-screen page.
              onViewProfile: (contractor) => setViewingBuilderId(contractor.user_id),
              onSendRequest: sendOwnerContractorRequest,
              // The same handlers the Requests tab above uses, so answering a
              // builder's request from their card behaves identically.
              onAcceptRequest: acceptOwnerRequest,
              onRejectRequest: rejectOwnerRequest,
            }}
            suppliersProps={{
              projects: selfConstructionProjects,
              currentProjectId: supplierProject?.id,
              pincode: supplierPincode,
              country: supplierProject?.project_country || user?.country_of_residence || 'India',
              activeTab: supplierTab,
              onTabChange: setSupplierTab,
              requestMessage,
              sendingReceiverId,
              onSendRequest: sendOwnerSupplierRequest,
            }}
          />
        )}

        {ownerRoute.page === NAV_BUY_SELL && (
          <PropertyBuySellHub
            activeTab={buySellTab}
            onTabChange={setBuySellTab}
            projects={projectList}
            defaultCountry={user?.country_of_residence || 'India'}
          />
        )}

        {ownerRoute.page === NAV_MESSAGES && <OwnerMessagesSection />}

        {ownerRoute.page === NAV_PROFILE && (
          <>
            <OwnerProfileSection
              user={user}
              userShell={userShell}
              profileImageMessage={profileImageMessage}
              profileImagePreview={profileImagePreview}
              ownerProfileEditDetails={ownerProfileEditDetails}
              updateOwnerProfileEditField={updateOwnerProfileEditField}
              saveOwnerProfileChanges={saveOwnerProfileChanges}
              resetOwnerProfileEditDetails={resetOwnerProfileEditDetails}
              uploadOwnerProfileImage={uploadOwnerProfileImage}
              setProfileImageMessage={setProfileImageMessage}
              firstProject={fallbackProject}
            />
            <PhoneChangeSection />
            <EmailVerificationSection />
            <DeleteAccountSection />
          </>
        )}

      </DashboardShell>
      <NewRequestToast inbox={requestInbox} onOpen={openRequestsFromToast} />

      {viewingBuilderId && (
        <ContractorProfileDetails variant="modal" contractorId={viewingBuilderId} projectId={openedProject?.id} onClose={() => setViewingBuilderId(null)} />
      )}

      {showHelp && <HelpCenterModal onClose={() => setShowHelp(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  )
}
