import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import { CreditCard, LifeBuoy, Settings, UserRound } from 'lucide-react'
import { leadLocationChoices, limitRefusal } from '../../billing/subscription/planLimits.js'
import FreeAccessBanner from '../../billing/subscription/FreeAccessBanner.jsx'
import ExpiryWarningModal from '../../billing/subscription/ExpiryWarningModal.jsx'
import BuilderSubscriptionPanel from '../../billing/subscription/BuilderSubscriptionPanel.jsx'
import BuilderPortfolioSection from '../../billing/subscription/BuilderPortfolioSection.jsx'
import PremiumBadge from '../../billing/subscription/PremiumBadge.jsx'
import PlanSummaryCard from '../../billing/subscription/PlanSummaryCard.jsx'
import useBuilderSubscription from '../../billing/subscription/useBuilderSubscription.js'
import { readPendingPlan } from '../../billing/subscription/pendingPlan.js'
import ProductCatalogPage from '../../shop/components/ProductCatalogPage.jsx'
import { ContractorTopSection } from '../components/BuilderTopSection.jsx'
import LocationLeadsPrompt, { LocationLeadsButton, useLocationLeadsPrompt } from '../../../shared/ui/LocationLeadsPrompt.jsx'

/**
 * Where the Builder is, read from the URL.
 *
 * The same arrangement the House Owner dashboard already uses: the address is
 * the single statement of which section is on screen, so a refresh, the
 * browser's Back and Forward buttons and a pasted link all behave the way the
 * navigation does.
 *
 * Every section this dashboard renders has an address, not only the six in the
 * sidebar — messages, the profile page and Profile Settings are reached from
 * the topbar and the account menu, and they would otherwise be the only screens
 * the URL could not name.
 *
 * The paths follow the navigation's labels rather than its internal ids, the
 * way the House Owner's do. Two are worth naming: the sidebar's Dashboard item
 * carries the id 'requests' and so owns the bare /contractor address, while the
 * item labelled Requests carries the id 'requestsBoard' and owns
 * /contractor/requests.
 */
const NAV_PATHS = {
  requests: '/contractor',
  projects: '/contractor/projects',
  portfolio: '/contractor/portfolio',
  subscription: '/contractor/subscription',
  requestsBoard: '/contractor/requests',
  engineers: '/contractor/my-site-engineers',
  findClients: '/contractor/find-clients',
  buySell: '/contractor/buy-sell',
  productCatalog: '/contractor/product-catalog',
  messages: '/contractor/messages',
  settings: '/contractor/profile-settings',
  // The old separate profile editor is gone; its id (still used for the
  // profile notification badge) opens Profile Settings.
  profile: '/contractor/profile-settings',
}

// The reverse of NAV_PATHS, built from it so the two can never disagree.
// Profile Settings owns /profile-settings; the old /contractor/profile address
// (a bookmark, say) opens it too, so no saved link stops working.
const SECTION_BY_SEGMENT = {
  ...Object.fromEntries(
    Object.entries(NAV_PATHS).filter(([section]) => section !== 'profile').map(([section, path]) => [path.replace(/^\/contractor\/?/, ''), section]),
  ),
  profile: 'settings',
}

// A request refusal as text: most are a string; a plan limit is {code, message, ...}.
function requestErrorText(error, fallback) {
  const detail = error?.response?.data?.detail
  if (detail && typeof detail === 'object') return detail.message || fallback
  return detail || fallback
}

function parseContractorLocation(pathname) {
  const [segment] = pathname.replace(/^\/contractor\/?/, '').split('/').filter(Boolean)
  // An address that names no section falls back to the dashboard, exactly as
  // an unknown section id does when navigating.
  return SECTION_BY_SEGMENT[segment || ''] || 'requests'
}
import ContractorAnalyticsSection from '../components/BuilderAnalyticsSection.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import DashboardShell from '../../../shared/dashboard/DashboardShell.jsx'
import DeleteAccountSection from '../../accounts/components/DeleteAccountSection.jsx'
import EmailVerificationSection from '../../accounts/components/EmailVerificationSection.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import ContractorProfileSettings from '../components/BuilderProfileSettings.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { HelpCenterModal, FeedbackModal } from '../../support/components/SupportModals.jsx'
import { completeUserProfile, updateBusinessLogo, updateUserProfileImage } from '../../auth/authApi.js'
import { profileErrorMessage } from '../../../shared/hooks/useProfileFormErrors.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { assertProfileImage } from '../../../shared/utils/profileImageRules.js'
import PropertyBuySellHub from '../../property/components/PropertyBuySellHub.jsx'
import { logoutUser, setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import {
  fetchNearbyProjects,
  fetchNearbySuppliers,
  fetchOwnerProjects,
  fetchProjectTimelineEntries,
} from '../../projects/projectsApi.js'
import {
  acceptProjectRequest,
  fetchIncomingRequests,
  rejectProjectRequest,
  sendProjectRequest,
  withdrawProjectRequest,
} from '../../requests/requestsApi.js'
import { fetchConversations } from '../../messaging/messagesApi.js'
import { fetchNotifications, markModuleNotificationsRead } from '../../notifications/notificationsApi.js'
import { fetchContractorProfile, fetchSupplierProfile } from '../../accounts/publicProfileApi.js'
import {
  assignEngineerToProject,
  unassignEngineerFromProject,
  fetchEngineerTeam,
  fetchNearbyEngineers,
  fetchProjectEngineer,
  inviteEngineer,
  respondEngineerJoinRequest,
  revokeEngineerInvitation,
  sendContractorEngineerRequest,
  fetchContractorSuppliers,
  assignSupplierToProject,
  fetchProjectSuppliers,
  unassignSupplierFromProject,
} from '../../engineers/engineersApi.js'
import { FIND_SITE_ENGINEER_CATEGORIES, baseNav } from '../builderConstants.js'
import {
  clientIdentity,
  clientRequestState as readClientRequestState,
  findClientRequest as findStoredClientRequest,
  requestTypesForClient,
  normalizePortfolioProjects,
  profileListString,
  readSeenClientKeys,
  requestBoardIdentity,
  saveSeenClientKeys,
} from '../builderHelpers.js'
import {
  ContractorMessagesSection,
  ContractorProjectsSection,
  ContractorRequestsSection,
} from '../components/BuilderSections.jsx'
import { ClientProfileDrawer, ContractorFindClientsSection, SendRequestDrawer } from '../components/BuilderFindClients.jsx'
import {
  AssignProjectDrawer,
  UnassignProjectDrawer,
  ContractorEngineerProfileDrawer,
  InviteEngineerDrawer,
  MySiteEngineersSection,
} from '../components/BuilderTeamSections.jsx'
import { AssignSupplierDrawer, UnassignSupplierDrawer } from '../components/BuilderSupplierSections.jsx'
import ModalErrorBoundary from '../../../shared/ui/ModalErrorBoundary.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import useRequestInbox, { useMarkSeenWhenOpened } from '../../../shared/hooks/useRequestInbox.js'
import NewRequestToast from '../../requests/components/NewRequestToast.jsx'
import WeatherNavButton from '../../weather/components/WeatherNavButton.jsx'
import { projectRequestItems } from '../../../shared/utils/requestInbox.js'

// How long the send / accept / reject banner stays up before clearing itself.
// Long enough to read a sentence, short enough not to describe the next screen.
const REQUEST_MESSAGE_VISIBLE_MS = 5000

export default function ContractorDashboard() {
  const { user } = useSelector((state) => state.auth)
  const { t, setCountry } = useLanguage()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { requireCompleteProfile } = useProfileGate()
  // The builder's plan as the server reports it: drives the badge and the Plan &
  // billing page. Access to paid features is always decided by the backend.
  const subscription = useBuilderSubscription()
  // The open section is derived from the address rather than held beside it, so
  // there is only one answer to what is on screen. Every existing
  // setActiveId(...) call site keeps its meaning; it now records the move in
  // the browser instead of only in React.
  const activeId = useMemo(() => parseContractorLocation(location.pathname), [location.pathname])
  const setActiveId = useCallback((sectionId) => {
    navigate(NAV_PATHS[sectionId] || NAV_PATHS.requests)
  }, [navigate])
  // A plan chosen on the landing page before signing up / in: open Plan & billing
  // once, where it is offered for payment. It is never applied on its own.
  useEffect(() => {
    if (readPendingPlan() && activeId !== 'subscription') setActiveId('subscription')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Buy & Sell opens on SELL for a Builder.
  const [buySellTab, setBuySellTab] = useState('sell')
  const [searchQuery, setSearchQuery] = useState('')
  const [requestList, setRequestList] = useState([])
  // True once the request list has loaded successfully; a failed load never
  // clears the New Requests badge.
  const [requestsLoaded, setRequestsLoaded] = useState(false)
  const [projectList, setProjectList] = useState([])
  const [nearbyProjectList, setNearbyProjectList] = useState([])
  const [seenClientKeys, setSeenClientKeys] = useState([])
  const [timelineEntries, setTimelineEntries] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedClientProfile, setSelectedClientProfile] = useState(null)
  // Open Full Details lands on Site Activity. 'activity' is that tab's id in
  // contractorConstants.projectDetailTabs, where it is labelled "Site Activity".
  const [selectedProjectTab, setSelectedProjectTab] = useState('activity')
  const [activeFindClientTab, setActiveFindClientTab] = useState('houseowners')
  const [requestMessage, setRequestMessageText] = useState('')
  // Bumped on every set. Two identical banners in a row -- "Request already
  // sent" twice, say -- are the same string, so React skips the update and the
  // effect below would not re-run: the second banner would inherit whatever was
  // left of the first one's countdown and could vanish almost at once.
  const [requestMessageToken, setRequestMessageToken] = useState(0)
  // Same name and signature as the raw setter it replaces, so every existing
  // call site is unchanged.
  const setRequestMessage = useCallback((text) => {
    setRequestMessageText(text)
    setRequestMessageToken((token) => token + 1)
  }, [])
  const [sendingReceiverId, setSendingReceiverId] = useState(null)
  const [sentRequestKeys, setSentRequestKeys] = useState({})
  const [supplierProfileMessage, setSupplierProfileMessage] = useState('')
  const [sendRequestTarget, setSendRequestTarget] = useState(null)
  const [sendBusy, setSendBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendSuccess, setSendSuccess] = useState(false)
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const [notificationBadgeCounts, setNotificationBadgeCounts] = useState({})
  const [contractorProfileDetails, setContractorProfileDetails] = useState(null)
  const [contractorProfileError, setContractorProfileError] = useState('')
  const [profileImageMessage, setProfileImageMessage] = useState('')
  const [profileImagePreview, setProfileImagePreview] = useState('')
  const [companyLogoPreview, setCompanyLogoPreview] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [teamData, setTeamData] = useState({ active: [], pending_requests: [], invitations: [] })
  const [nearbyEngineers, setNearbyEngineers] = useState([])
  // Empty until the builder types one: the server then defaults to the active
  // project's location, then the builder's own pincode.
  const [engineersPincode, setEngineersPincode] = useState('')
  const nearbyEngineersRequest = useRef(0)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [invitePrefill, setInvitePrefill] = useState({})
  const [inviteResult, setInviteResult] = useState(null)
  const [inviteError, setInviteError] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [selectedEngineerProfile, setSelectedEngineerProfile] = useState(null)
  const [engineerSectionMessage, setEngineerSectionMessage] = useState('')
  const [assignTarget, setAssignTarget] = useState(null)
  const [assignSuccessProject, setAssignSuccessProject] = useState(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignModalMessage, setAssignModalMessage] = useState('')
  const [activeContractorProject, setActiveContractorProject] = useState(null)
  const [contractorSuppliers, setContractorSuppliers] = useState([])
  // Suppliers already on the open project, for the Team tab.
  const [projectSuppliers, setProjectSuppliers] = useState([])
  const [assignSupplierTarget, setAssignSupplierTarget] = useState(null)
  const [assignSupplierSuccessProject, setAssignSupplierSuccessProject] = useState(null)
  const [assignSupplierBusy, setAssignSupplierBusy] = useState(false)
  const [assignSupplierMessage, setAssignSupplierMessage] = useState('')
  const [unassignSupplierTarget, setUnassignSupplierTarget] = useState(null)
  const [unassignSupplierSuccessProject, setUnassignSupplierSuccessProject] = useState(null)
  const [unassignSupplierBusy, setUnassignSupplierBusy] = useState(false)
  const [unassignSupplierMessage, setUnassignSupplierMessage] = useState('')
  const [unassignTarget, setUnassignTarget] = useState(null)
  const [unassignSuccessProject, setUnassignSuccessProject] = useState(null)
  const [unassignBusy, setUnassignBusy] = useState(false)
  const [unassignModalMessage, setUnassignModalMessage] = useState('')
  const [projectEngineer, setProjectEngineer] = useState(null)
  const [assignEngineerMessage, setAssignEngineerMessage] = useState('')
  const [sentEngineerIds, setSentEngineerIds] = useState(new Set())
  const [sendingEngineerId, setSendingEngineerId] = useState(null)
  const [engineerSubTab, setEngineerSubTab] = useState('team')

  // The builder dashboard follows the account's country of residence.
  useEffect(() => {
    setCountry(user?.country_of_residence || 'India')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.country_of_residence])

  const logout = () => {
    dispatch(logoutUser())
    navigate('/login')
  }
  const userShell = useMemo(() => ({
    name: user?.name || t('role.builder'),
    initials: (user?.name || 'C').slice(0, 2).toUpperCase(),
    profileImageUrl: profileImagePreview || user?.profile_image_url || '',
  }), [profileImagePreview, user])
  const locationPrompt = useLocationLeadsPrompt(user)
  const nearbyClientPincode = user?.pincode || 'all'
  const nearbyClientAccountKey = user?.id ? `${user.id}:${user.email || user.name || 'contractor'}` : ''
  const nearbyClientKeys = useMemo(() => nearbyProjectList.map(clientIdentity), [nearbyProjectList])
  const unseenClientKeys = useMemo(() => (
    nearbyClientKeys.filter((key) => !seenClientKeys.includes(key))
  ), [nearbyClientKeys, seenClientKeys])
  const hasNewNearbyClients = unseenClientKeys.length > 0

  const markNearbyClientsSeen = () => {
    if (!nearbyClientAccountKey) return
    saveSeenClientKeys(nearbyClientAccountKey, nearbyClientPincode, nearbyClientKeys)
    setSeenClientKeys(nearbyClientKeys)
  }

  const refreshContractorSuppliers = () => {
    fetchContractorSuppliers()
      .then(setContractorSuppliers)
      .catch(() => setContractorSuppliers([]))
  }

  // Latest load wins: a live refresh can overlap a load already in flight (or
  // the 10 s poll), and the older response must not overwrite the newer one.
  const contractorLoadGuard = useLatestOnly()
  const refreshContractorData = () => {
    const isLatest = contractorLoadGuard()
    fetchIncomingRequests().then((list) => { if (isLatest()) { setRequestList(list); setRequestsLoaded(true) } })
    refreshContractorSuppliers()
    // Find Site Engineers labels each engineer with any pending request, so it
    // reloads with the team: after Accept / Reject / Send and on a live update.
    refreshNearbyEngineers()
    fetchOwnerProjects().then(async (projects) => {
      const projectsWithAssignments = await Promise.all(projects.map(async (project) => {
        try {
          const [engineerResult, suppliersResult] = await Promise.all([
            fetchProjectEngineer(project.id).catch(() => ({ engineer: null })),
            fetchProjectSuppliers(project.id).catch(() => [])
          ])
          return { ...project, assigned_engineer: engineerResult.engineer || null, assigned_suppliers: Array.isArray(suppliersResult) ? suppliersResult : [] }
        } catch {
          return { ...project, assigned_engineer: null, assigned_suppliers: [] }
        }
      }))
      if (!isLatest()) return
      setProjectList(projectsWithAssignments)
      setSelectedProject((currentSelectedProject) => {
        if (!currentSelectedProject || !projectsWithAssignments.length) return null
        return projectsWithAssignments.find((project) => project.id === currentSelectedProject.id) || null
      })
      // Restore the active project from localStorage or default to the first one
      setActiveContractorProject((currentActive) => {
        if (currentActive && projectsWithAssignments.some((p) => p.id === currentActive.id)) return currentActive
        // Ids are UUIDs: compared as text.
        const storedId = window.localStorage.getItem('crewnbuild_contractor_project_id') || ''
        return projectsWithAssignments.find((p) => String(p.id) === storedId) || projectsWithAssignments[0] || null
      })
    })
    fetchEngineerTeam()
      .then((data) => {
        if (!isLatest()) return
        setTeamData(data)
        // Rebuild sentEngineerIds from outgoing_requests so the Find tab shows
        // 'Request Sent' for exactly the engineers the builder's requests are
        // still pending with: one the engineer rejected can be asked again.
        if (data.outgoing_requests) {
          // Each row is an engineer summary, so the engineer's id is `user_id`.
          setSentEngineerIds(new Set(data.outgoing_requests.map((req) => req.user_id)))
        }
      })
      .catch(() => { if (isLatest()) setTeamData({ active: [], pending_requests: [], invitations: [], outgoing_requests: [] }) })
  }
  // A request, answer, counter-offer or assignment from someone else reloads
  // through this same loader at once, instead of at the next 10 s poll.
  useLiveRefresh(refreshContractorData)

  // The request banner dismisses itself. It used to stay up until the next
  // request action, so a confirmation about one lead was still on screen while
  // the builder was looking at a different one, which read as a status of
  // whatever they were looking at now.
  useEffect(() => {
    if (!requestMessage) return undefined
    const timer = setTimeout(() => setRequestMessageText(''), REQUEST_MESSAGE_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [requestMessage, requestMessageToken])

  // Re-fetch clients and engineers whenever the active project (and thus country) changes
  useEffect(() => {
    const discoveryCountry = activeContractorProject?.project_country || user?.country_of_residence || 'India'
    fetchNearbyProjects(discoveryCountry).then(setNearbyProjectList).catch(() => setNearbyProjectList([]))
    // Find Site Engineers lists Site Engineers and Store Managers. The other
    // Engineer Categories are project specialists, invited from the project Team.
    refreshNearbyEngineers()
    // user?.pincode: leads are matched on the saved pincode, so a newly saved
    // location has to reload them.
  }, [activeContractorProject?.id, user?.country_of_residence, user?.pincode])

  function refreshNearbyEngineers(pincode = engineersPincode) {
    // Only a full pincode is searched; a partial one would just match nobody.
    // Empty falls back to the project's (or the builder's) location.
    if (pincode && pincode.length !== 6) return
    const discoveryCountry = activeContractorProject?.project_country || user?.country_of_residence || 'India'
    // Only the newest request may fill the list, whatever order replies arrive in.
    const requestId = ++nearbyEngineersRequest.current
    fetchNearbyEngineers(pincode, discoveryCountry, activeContractorProject?.id || null, FIND_SITE_ENGINEER_CATEGORIES)
      .then((engineers) => { if (requestId === nearbyEngineersRequest.current) setNearbyEngineers(engineers) })
      .catch(() => { if (requestId === nearbyEngineersRequest.current) setNearbyEngineers([]) })
  }

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
            request: 'requestsBoard',
            project: 'projects',
            contractor: 'findClients',
            supplier: 'findClients',
            estimate: 'projects',
            escrow: 'projects',
            engineers: 'engineers',
            general: 'profile',
          }
          const tabId = moduleTabMap[notification.module]
          if (tabId) nextBadgeCounts[tabId] = (nextBadgeCounts[tabId] || 0) + 1
        })
        setNotificationBadgeCounts(nextBadgeCounts)
      })
      .catch(() => setNotificationBadgeCounts({}))
  }

  useEffect(() => {
    refreshContractorData()
    const contractorDataTimer = window.setInterval(refreshContractorData, 10000)
    const refreshOnFocus = () => refreshContractorData()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(contractorDataTimer)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [])
  useEffect(() => {
    if (!nearbyClientAccountKey) {
      setSeenClientKeys([])
      return
    }
    setSeenClientKeys(readSeenClientKeys(nearbyClientAccountKey, nearbyClientPincode))
  }, [nearbyClientAccountKey, nearbyClientPincode])
  useEffect(() => {
    if (activeId === 'findClients' && nearbyClientKeys.length) {
      markNearbyClientsSeen()
    }
  }, [activeId, nearbyClientAccountKey, nearbyClientKeys.join('|')])
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
    if (selectedProject?.id) {
      // A builder without a plan or free month is refused the calendar (403); the
      // section shows the upgrade prompt instead of an unhandled error.
      fetchProjectTimelineEntries(selectedProject.id).then(setTimelineEntries).catch(() => setTimelineEntries([]))
    } else {
      setTimelineEntries([])
    }
  }, [selectedProject?.id])
  useEffect(() => {
    if (selectedProject?.id) {
      fetchProjectSuppliers(selectedProject.id).then(setProjectSuppliers).catch(() => setProjectSuppliers([]))
      fetchProjectEngineer(selectedProject.id)
        .then((result) => setProjectEngineer(result.engineer))
        .catch(() => setProjectEngineer(null))
    } else {
      setProjectEngineer(null)
    }
  }, [selectedProject?.id])
  useEffect(() => {
    if (!user?.id) return
    setContractorProfileError('')
    fetchContractorProfile(user.id)
      .then(setContractorProfileDetails)
      .catch((error) => setContractorProfileError(profileErrorMessage(error, t('dash.err.loadBuilderProfile'))))
  }, [user?.id])

  const uploadContractorProfileImage = async (file) => {
    if (!file) return
    assertProfileImage(file, t)
    setProfileImageMessage(t('dash.msg.uploadingProfileImage'))
    const uploadedFile = await uploadLocalFile(file)
    setProfileImagePreview(uploadedFile.previewUrl || uploadedFile.url)
    const updatedUser = await updateUserProfileImage(uploadedFile.url)
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    setContractorProfileDetails((currentProfileDetails) => currentProfileDetails ? { ...currentProfileDetails, profile_image_url: uploadedFile.url } : currentProfileDetails)
    setProfileImageMessage(t('dash.msg.profileImageUpdated'))
  }

  const uploadContractorCompanyLogo = async (file) => {
    if (!file) return
    assertProfileImage(file, t)
    setProfileImageMessage(t('dash.msg.uploadingLogo'))
    const uploadedFile = await uploadLocalFile(file)
    setCompanyLogoPreview(uploadedFile.previewUrl || uploadedFile.url)
    const updatedProfile = await updateBusinessLogo(uploadedFile.url)
    setContractorProfileDetails(updatedProfile)
    setProfileImageMessage(t('dash.msg.logoUpdated'))
  }

  const saveContractorSettingsChanges = async (updates) => {
    const profile = contractorProfileDetails || {}
    const listValue = (field) => (
      updates[field] !== undefined
        ? profileListString(updates[field])
        : profileListString(profile[field])
    )
    const payload = {
      name: updates.name ?? profile.name ?? user?.name ?? '',
      phone: updates.phone ?? profile.phone ?? user?.phone ?? '',
      address: updates.address ?? profile.address ?? user?.address ?? '',
      pincode: updates.pincode ?? profile.pincode ?? user?.pincode ?? '',
      company_name: updates.company_name ?? profile.company_name ?? user?.name ?? '',
      company_logo_url: profile.company_logo_url || '',
      profile_image_url: profile.profile_image_url || user?.profile_image_url || '',
      license_number: updates.license_number ?? profile.license_number ?? '',
      experience_years: Number(updates.experience_years ?? profile.experience_years ?? 0),
      about: updates.about ?? profile.about ?? '',
      gstin: updates.gstin ?? profile.gstin ?? '',
      pan: updates.pan ?? profile.pan ?? '',
      website: updates.website ?? profile.website ?? '',
      business_type: updates.business_type ?? profile.business_type ?? '',
      registration_year: (updates.registration_year ?? profile.registration_year ?? '') === '' ? null : Number(updates.registration_year ?? profile.registration_year ?? 0),
      team_size: updates.team_size ?? profile.team_size ?? '',
      insurance_available: Boolean(updates.insurance_available ?? profile.insurance_available),
      service_locations: listValue('service_locations'),
      services_offered: listValue('services_offered'),
      equipment_owned: listValue('equipment_owned'),
      documents: listValue('documents'),
      gallery: listValue('gallery'),
      // The portfolio as edited in Settings, or the saved one when the save
      // does not touch it.
      completed_project_details: JSON.stringify(normalizePortfolioProjects(updates.completed_project_details ?? profile.completed_project_details ?? [])),
    }
    const updatedUser = await completeUserProfile(payload)
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    const refreshedProfile = await fetchContractorProfile(user.id)
    setContractorProfileDetails(refreshedProfile)
    return refreshedProfile
  }

  const sendContractorClientRequest = async (client, requestType, quotationAmount = null) => {
    if (requireCompleteProfile('sendContractorClientRequest', { client, requestType, quotationAmount })) return
    const receiverId = client.owner_id
    const requestKey = `${requestType}-${receiverId}-${client.project_id || 'profile'}`
    setRequestMessage('')
    setSendingReceiverId(receiverId)
    try {
      const requestDetails = {
        receiver_id: receiverId,
        project_id: client.project_id || null,
        request_type: requestType,
      }
      if (quotationAmount) requestDetails.quotation_amount = Number(String(quotationAmount).replace(/,/g, '').trim())
      await sendProjectRequest(requestDetails)
      // The builder has just SENT this request, so the confirmation has to be
      // the outgoing one. It used 'dash.msg.requestSentTo' -- "{name} has sent a
      // {label} request to you." -- which is the message shown to whoever
      // RECEIVES a request, and it filled {name} with client.title. On a project
      // lead that title is the project, so sending a request reported back
      // "4BHK Duplex Family Home at Nanakramguda has sent a request to you.":
      // wrong direction, and the project named as the sender. ({label} was never
      // passed either, which is the giveaway that the key did not belong here.)
      //
      // The outgoing string already exists and names the RECIPIENT, resolved the
      // same way the client profile drawer resolves it: store name for a
      // supplier, house owner for a project or owner lead.
      setRequestMessage(t('dash.contractor.requestSentBody', {
        name: client.store_name || client.owner_name || client.title || t('dash.clientFallback'),
      }))
      setSentRequestKeys((currentKeys) => ({ ...currentKeys, [requestKey]: true }))
      refreshContractorData()
      // The open leads per location changed (Find Clients shows them).
      if (requestType === 'CONTRACTOR_TO_OWNER') subscription.refresh()
      return true
    } catch (error) {
      const detail = requestErrorText(error, t('dash.err.sendRequest'))
      setRequestMessage(detail)
      if (requestType === 'CONTRACTOR_TO_OWNER' && limitRefusal(error)) subscription.refresh()
      if (detail === 'Request already sent') {
        setSentRequestKeys((currentKeys) => ({ ...currentKeys, [requestKey]: true }))
        refreshContractorData()
      }
      throw error
    } finally {
      setSendingReceiverId(null)
    }
  }

  const openSendRequest = (client, requestType) => {
    setSendRequestTarget({ client, requestType })
    setSendError('')
    setSendSuccess(false)
  }

  const confirmSendRequest = async (quotationAmount) => {
    if (!sendRequestTarget) return
    setSendBusy(true)
    setSendError('')
    try {
      await sendContractorClientRequest(sendRequestTarget.client, sendRequestTarget.requestType, quotationAmount)
      setSendSuccess(true)
    } catch (error) {
      setSendError(requestErrorText(error, t('dash.err.sendRequest')))
    } finally {
      setSendBusy(false)
    }
  }

  const acceptContractorRequest = async (requestId, quotationAmount) => {
    if (requireCompleteProfile('acceptContractorRequest', { requestId, quotationAmount })) return
    setRequestMessage('')
    try {
      await acceptProjectRequest(requestId, quotationAmount)
      setRequestMessage(t('dash.msg.requestAccepted'))
      refreshContractorData()
    } catch (error) {
      setRequestMessage(error.response?.data?.detail || t('dash.err.acceptRequest'))
    }
  }

  const rejectContractorRequest = async (requestId) => {
    setRequestMessage('')
    try {
      await rejectProjectRequest(requestId)
      setRequestMessage(t('dash.msg.requestRejected'))
      refreshContractorData()
    } catch (error) {
      setRequestMessage(error.response?.data?.detail || t('dash.err.rejectRequest'))
    }
  }

  // Take back one of the Builder's own pending requests; it stays as Withdrawn.
  const withdrawContractorRequest = async (requestId) => {
    setRequestMessage('')
    try {
      await withdrawProjectRequest(requestId)
      setRequestMessage(t('dash.msg.requestWithdrawn'))
      refreshContractorData()
    } catch (error) {
      const detail = error.response?.data?.detail
      setRequestMessage(typeof detail === 'string' && detail ? detail : t('dash.err.withdrawRequest'))
    }
  }

  const openSupplierProfile = async (supplier) => {
    setRequestMessage('')
    setSupplierProfileMessage(t('dash.msg.loadingSupplierProfile'))
    // A supplier from the first moment, so the full-screen supplier page opens
    // straight away (with its loading note) rather than a homeowner's side
    // panel that only became the supplier's once the profile had loaded.
    setSelectedClientProfile({ ...supplier, client_type: 'SUPPLIER' })
    const supplierUserId = supplier.user_id || supplier.owner_id || supplier.id
    if (!supplierUserId) {
      setSupplierProfileMessage(t('dash.err.loadSupplierProfile'))
      return
    }
    try {
      const profile = await fetchSupplierProfile(supplierUserId)
      setSelectedClientProfile({
        ...supplier,
        ...profile,
        client_type: 'SUPPLIER',
        owner_id: supplier.owner_id || profile.user_id || supplierUserId,
        user_id: profile.user_id || supplier.user_id || supplierUserId,
      })
      setSupplierProfileMessage('')
    } catch (error) {
      setSupplierProfileMessage(error.response?.data?.detail || t('dash.err.loadSupplierProfile'))
    }
  }

  // The location prompt saved a pincode: adopt the updated account, load the
  // leads for that pincode through the existing find-clients request, and open
  // the leads so they are on screen straight away.
  const saveLeadLocation = async (updatedUser) => {
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    locationPrompt.finishPrompt()
    const discoveryCountry = activeContractorProject?.project_country || updatedUser?.country_of_residence || 'India'
    await fetchNearbyProjects(discoveryCountry).then(setNearbyProjectList).catch(() => setNearbyProjectList([]))
    setActiveFindClientTab('houseowners')
    selectDashboardSection('findClients')
  }

  const selectDashboardSection = (sectionId) => {
    if (sectionId === 'projects') {
      setSelectedProject(null)
      setSelectedProjectTab('activity')
    }
    if (sectionId !== 'findClients') {
      setSelectedClientProfile(null)
      setSendRequestTarget(null)
    }
    if (sectionId === 'findClients') {
      markNearbyClientsSeen()
    }
    setActiveId(sectionId)
    if (sectionId !== 'projects') setAssignEngineerMessage('')
    const tabNotificationModules = {
      requests: ['request'],
      // The Requests board itself: opening it reads its request notifications,
      // as the Dashboard (which used to carry the board) always did.
      requestsBoard: ['request'],
      projects: ['project', 'estimate', 'escrow'],
      engineers: ['engineers'],
      findClients: ['contractor', 'supplier'],
      messages: ['message', 'request', 'contractor', 'supplier'],
      profile: ['general'],
    }
    const modulesToRead = tabNotificationModules[sectionId] || []
    modulesToRead.forEach((moduleName) => {
      markModuleNotificationsRead(moduleName)
        .then(refreshNotificationBadgeCounts)
        .catch(() => {})
    })
  }

  useEffect(() => {
    const applyPendingDashboardTab = (tabId) => {
      if (!tabId || !baseNav.some((item) => item.id === tabId)) return
      selectDashboardSection(tabId)
    }
    const storedTab = sessionStorage.getItem('crewnbuild_pending_dashboard_tab')
    if (storedTab) {
      sessionStorage.removeItem('crewnbuild_pending_dashboard_tab')
      applyPendingDashboardTab(storedTab)
    }
    const handleNotificationOpen = (event) => applyPendingDashboardTab(event.detail?.tab)
    window.addEventListener('crewnbuild_notification_open', handleNotificationOpen)
    return () => window.removeEventListener('crewnbuild_notification_open', handleNotificationOpen)
  }, [])

  const handleRespondEngineerJoinRequest = async (relationshipId, action) => {
    // Taking an engineer onto the team needs a complete profile; declining does not.
    if (action === 'ACCEPT' && requireCompleteProfile('respondEngineerJoinRequest', { relationshipId, action })) return
    try {
      await respondEngineerJoinRequest(relationshipId, action)
      setEngineerSectionMessage(action === 'ACCEPT' ? t('dash.msg.engineerAdded') : t('dash.msg.joinRequestRejected'))
      refreshContractorData()
    } catch (error) {
      setEngineerSectionMessage(error.response?.data?.detail || t('dash.err.updateJoinRequest'))
    }
  }

  const generateInvite = async ({ phone, email }) => {
    setInviteBusy(true)
    setInviteError('')
    try {
      const result = await inviteEngineer({ phone, email })
      setInviteResult(result)
      refreshContractorData()
    } catch (error) {
      setInviteError(error.response?.data?.detail || t('dash.err.generateInvitation'))
    } finally {
      setInviteBusy(false)
    }
  }

  const openInviteModal = (prefill = {}) => {
    setInvitePrefill(prefill || {})
    setInviteResult(null)
    setInviteError('')
    setInviteModalOpen(true)
  }

  const handleRevokeInvitation = async (invitationId) => {
    setEngineerSectionMessage('')
    try {
      await revokeEngineerInvitation(invitationId)
      setEngineerSectionMessage(t('dash.msg.invitationRevoked'))
      refreshContractorData()
    } catch (error) {
      setEngineerSectionMessage(error.response?.data?.detail || t('ui.contractor.errRevokeInvitation'))
    }
  }

  // The project is read at the moment of the click and kept with the gated
  // action, so the request resumed after Complete Profile names the same one.
  // "Request sent" to a Site Engineer is a toast, not a notice board: it
  // confirms the send and clears itself after 4 seconds -- the same dismissal
  // the Supplier and House Owner dashboards use for their banners -- and on
  // leaving the section or tab, so it never sits on the page or comes back on
  // a re-render. Every other message here (errors included) is unchanged.
  const engineerRequestSentText = t('dash.msg.engineerRequestSent')
  useEffect(() => {
    if (engineerSectionMessage !== engineerRequestSentText) return undefined
    const hideTimer = window.setTimeout(() => setEngineerSectionMessage(''), 4000)
    return () => window.clearTimeout(hideTimer)
  }, [engineerSectionMessage, engineerRequestSentText])
  useEffect(() => {
    setEngineerSectionMessage((current) => (current === engineerRequestSentText ? '' : current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, engineerSubTab])

  const sendEngineerRequest = async (engineer, projectId = activeContractorProject?.id || null) => {
    if (requireCompleteProfile('sendEngineerRequest', { recipient: engineer, projectId })) return
    setEngineerSectionMessage('')
    const engineerId = engineer.user_id || engineer.id
    setSendingEngineerId(engineerId)
    try {
      await sendContractorEngineerRequest(engineerId, projectId)
      setSentEngineerIds((prev) => new Set([...prev, engineerId]))
      setEngineerSectionMessage(t('dash.msg.engineerRequestSent'))
      refreshContractorData()
    } catch (error) {
      const detail = error.response?.data?.detail || t('dash.err.sendRequest')
      setEngineerSectionMessage(detail)
      if (detail.includes('already') || detail.includes('Already')) {
        setSentEngineerIds((prev) => new Set([...prev, engineerId]))
      }
    } finally {
      setSendingEngineerId(null)
    }
  }

  const assignEngineer = async (projectId, engineerId) => {
    setAssignEngineerMessage('')
    try {
      await assignEngineerToProject(projectId, engineerId)
      setAssignEngineerMessage(t('dash.msg.engineerAssigned'))
      const result = await fetchProjectEngineer(projectId)
      setProjectEngineer(result.engineer)
      refreshContractorData()
    } catch (error) {
      setAssignEngineerMessage(error.response?.data?.detail || t('dash.err.assignEngineer'))
    }
  }

  const unassignEngineer = async (projectId, engineerId) => {
    setAssignEngineerMessage('')
    try {
      await unassignEngineerFromProject(projectId, engineerId)
      setProjectEngineer(null)
      setAssignEngineerMessage(t('dash.msg.engineerRemoved'))
      refreshContractorData()
    } catch (error) {
      setAssignEngineerMessage(error.response?.data?.detail || t('dash.err.unassignEngineer'))
    }
  }

  // An API error as text the panel can show. FastAPI's 422 `detail` is a list
  // of objects ({ type, loc, msg, input }); putting that on screen crashes
  // React ("Objects are not valid as a React child"), which blanked the page.
  const apiErrorText = (error, fallback) => {
    const detail = error?.response?.data?.detail
    if (typeof detail === 'string' && detail.trim()) return detail
    if (Array.isArray(detail)) {
      const text = detail.map((item) => (typeof item === 'string' ? item : item?.msg)).filter(Boolean).join(' ')
      if (text) return text
    }
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message
    return fallback
  }

  const openUnassignProject = (engineer) => {
    setUnassignTarget(engineer)
    setUnassignSuccessProject(null)
    setUnassignModalMessage('')
  }

  const confirmUnassignProject = async (project) => {
    if (!unassignTarget) return
    setUnassignBusy(true)
    setUnassignModalMessage('')
    try {
      await unassignEngineerFromProject(project.id, unassignTarget.user_id)
      setUnassignSuccessProject(project)
      refreshContractorData()
    } catch (error) {
      setUnassignModalMessage(apiErrorText(error, t('dash.err.unassignProject')))
    } finally {
      setUnassignBusy(false)
    }
  }

  const openAssignProject = (engineer) => {
    setAssignTarget(engineer)
    setAssignSuccessProject(null)
    setAssignModalMessage('')
  }

  const openAssignSupplier = (supplier) => {
    setAssignSupplierTarget(supplier)
    setAssignSupplierSuccessProject(null)
    setAssignSupplierMessage('')
  }

  const assignSupplierToTeam = async (projectId, supplierId, engineerId) => {
    setAssignSupplierMessage('')
    if (!engineerId) {
      setAssignSupplierMessage(t('team.supplierNeedsEngineer'))
      return
    }
    try {
      await assignSupplierToProject(projectId, supplierId, engineerId)
      const refreshed = await fetchProjectSuppliers(projectId).catch(() => [])
      setProjectSuppliers(refreshed)
    } catch (error) {
      setAssignSupplierMessage(error.response?.data?.detail || t('team.assignSupplierFailed'))
    }
  }

  const confirmAssignSupplier = async (project, engineerId) => {
    if (!assignSupplierTarget) return
    setAssignSupplierBusy(true)
    setAssignSupplierMessage('')
    try {
      await assignSupplierToProject(project.id, assignSupplierTarget.id, engineerId)
      setAssignSupplierSuccessProject(project)
      refreshContractorData()
    } catch (error) {
      setAssignSupplierMessage(error.response?.data?.detail || t('ui.contractor.errAssignSupplier'))
    } finally {
      setAssignSupplierBusy(false)
    }
  }

  const openUnassignSupplier = (supplier) => {
    setUnassignSupplierTarget(supplier)
    setUnassignSupplierSuccessProject(null)
    setUnassignSupplierMessage('')
  }

  const confirmUnassignSupplier = async (project, engineerId) => {
    if (!unassignSupplierTarget) return
    setUnassignSupplierBusy(true)
    setUnassignSupplierMessage('')
    // A supplier's assignment row names its project `project_id` /
    // `project_title` (not `id` / `title`); reading `project.id` sent the
    // request to /projects/undefined/unassign-supplier, which the API refuses.
    const projectId = project.project_id ?? project.id
    try {
      await unassignSupplierFromProject(projectId, unassignSupplierTarget.id, engineerId)
      setUnassignSupplierSuccessProject({ ...project, id: projectId, title: project.project_title ?? project.title })
      refreshContractorData()
    } catch (error) {
      setUnassignSupplierMessage(apiErrorText(error, t('ui.contractor.errUnassignSupplier')))
    } finally {
      setUnassignSupplierBusy(false)
    }
  }

  // Map of project id -> engineer name for projects that already have a Site Engineer,
  // so the Assign Project modal can mark them as taken (not assignable again).
  const assignedEngineerByProject = (teamData?.active || []).reduce((map, engineer) => {
    ;(engineer.assigned_projects || []).forEach((project) => {
      if (project?.id && !map[project.id]) map[project.id] = engineer.name
    })
    return map
  }, {})

  const confirmAssignProject = async (project) => {
    if (!assignTarget) return
    setAssignBusy(true)
    setAssignModalMessage('')
    try {
      await assignEngineerToProject(project.id, assignTarget.user_id)
      setAssignSuccessProject(project)
      refreshContractorData()
    } catch (error) {
      setAssignModalMessage(error.response?.data?.detail || t('dash.err.assignProject'))
    } finally {
      setAssignBusy(false)
    }
  }

  // The standard account menu, identical on every dashboard. Dark Mode and
  // Logout are supplied by DashboardShell, so the four options a user sees are
  // Profile Settings, Dark Mode, Help & Feedback and Logout.
  const contractorUserMenu = [
    { id: 'profileSettings', label: t('ui.profileSettings'), icon: Settings },
    { id: 'subscription', label: t('subscription.panel.menu'), icon: CreditCard },
    { id: 'helpFeedback', label: t('ui.helpFeedback'), icon: LifeBuoy },
  ]
  const handleUserMenuSelect = (menuId) => {
    if (menuId === 'profileSettings') {
      setActiveId('settings')
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    if (menuId === 'subscription') {
      setActiveId('subscription')
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    if (menuId === 'helpFeedback') setShowHelp(true)
  }
  const sidebarActiveId = activeId === 'settings' ? 'profile' : activeId

  // New Requests: the owner and supplier requests sent to this builder that the
  // Requests board shows and that are still pending.
  const requestInboxItems = useMemo(
    () => projectRequestItems(requestList, () => 'requestsBoard', ['OWNER_TO_CONTRACTOR', 'SUPPLIER_TO_CONTRACTOR']),
    [requestList],
  )
  const requestInbox = useRequestInbox({ userId: user?.id, items: requestInboxItems, loaded: requestsLoaded })
  useMarkSeenWhenOpened(requestInbox, {
    open: activeId === 'requestsBoard',
    loaded: requestsLoaded,
    displayedKeys: requestInboxItems.map((item) => item.key),
  })
  const openRequestsFromToast = () => {
    if (activeId === 'requestsBoard') requestInbox.markSeen(requestInboxItems.map((item) => item.key))
    else selectDashboardSection('requestsBoard')
  }

  const nav = baseNav.map((item) => {
    const translatedItem = { ...item, label: t(item.labelKey) }
    if (item.id === 'findClients') return { ...translatedItem, hasDot: hasNewNearbyClients, badge: unseenClientKeys.length || notificationBadgeCounts[item.id] }
    // Requests: the unread incoming requests themselves, by id.
    if (item.id === 'requestsBoard') return { ...translatedItem, badge: requestInbox.unreadIn('requestsBoard') || undefined }
    return { ...translatedItem, badge: notificationBadgeCounts[item.id] }
  })
  const ownerClientList = nearbyProjectList.filter((client) => client.client_type !== 'SUPPLIER')
  const supplierClientList = nearbyProjectList.filter((client) => client.client_type === 'SUPPLIER')
  const completedProjectCount = normalizePortfolioProjects(contractorProfileDetails?.completed_project_details || []).length
  const contractorDisplayName = contractorProfileDetails?.company_name || contractorProfileDetails?.name || user?.name || t('dash.common.builder')
  // Status comes from the stored request (matched by id in contractorHelpers),
  // so it survives a reload instead of relying on local optimistic state.
  // A single request type from a caller names the relationship, not the direction:
  // both directions are always considered so an accepted incoming request is not
  // still offered as "Send Request". An explicit array is passed through as given.
  const requestTypesFor = (client, requestType) => (Array.isArray(requestType) ? requestType : requestTypesForClient(client))
  const findClientRequest = (client, requestType) => findStoredClientRequest(requestList, client, requestTypesFor(client, requestType))
  // A lead whose only requests were declined or withdrawn is open again: neither
  // blocks anything (the backend's duplicate rule counts only pending and
  // accepted), so the Builder may send a new one. Those requests stay on the
  // Requests board as history. A declined supplier lead is unchanged; a
  // withdrawn one (the sender took it back) reopens for either kind of lead.
  const reopenedAfterRejection = (client, storedState) => (
    storedState === 'withdrawn' || (storedState === 'rejected' && client.client_type !== 'SUPPLIER')
  )
  const clientRequestState = (client, requestType) => {
    const requestKey = `${requestType}-${client.owner_id}-${client.project_id || 'profile'}`
    const storedState = readClientRequestState(requestList, client, requestTypesFor(client, requestType))
    if (storedState !== 'none' && !reopenedAfterRejection(client, storedState)) return storedState
    // Only used for the moment between sending and the refresh landing.
    if (storedState === 'none' && sentRequestKeys[requestKey]) return 'sent'
    // An owner lead with no project of its own still counts as accepted when
    // contact with that owner is already unlocked.
    if (!client.project_id && client.can_view_contact) return 'accepted'
    return 'none'
  }
  // Find Clients lists leads that have no live request on them, in either
  // direction. One that does -- sent, incoming or accepted -- is a request,
  // and the Requests board is where a request is read and answered.
  // Carrying it here as well showed the same thing twice, in two places that
  // could disagree.
  // A pending or accepted request (either direction) keeps the lead off this
  // list; declined- or withdrawn-only leads come back so a new request can be
  // sent. findClientRequest ranks accepted > pending > rejected > withdrawn, so
  // a rejected or withdrawn match means there is nothing live on the lead.
  const openOwnerClientList = ownerClientList.filter((client) => {
    const storedRequest = findClientRequest(client)
    return !storedRequest || ['rejected', 'withdrawn'].includes(storedRequest.status)
  })
  const requestedOwnerClientList = ownerClientList.filter((client) => clientRequestState(client, 'CONTRACTOR_TO_OWNER') !== 'none')
  // The supplier side of the same /project-requests/incoming payload. Split
  // by request_type, so a request appears under exactly one tab and neither
  // list invents a status: they are the stored ones.
  const supplierRequestBoardList = requestList
    .filter((request) => ['CONTRACTOR_TO_SUPPLIER', 'SUPPLIER_TO_CONTRACTOR'].includes(request.request_type))
    .map((request) => ({
      ...request,
      sender_name: request.sender_name || request.profile_title || t('role.supplier'),
    }))

  const requestBoardList = [
    ...requestList
      .filter((request) => ['OWNER_TO_CONTRACTOR', 'CONTRACTOR_TO_OWNER'].includes(request.request_type))
      .map((request) => ({
        ...request,
        id: request.id,
        sender_name: request.sender_name || request.profile_title || t('role.owner'),
        project_title: request.project_title || t('dash.homeownerProject'),
        project_address: request.project_address || request.sender_address,
        project_pincode: request.project_pincode || request.sender_pincode,
        budget: request.budget || request.project_budget,
        land_area: request.land_area || request.project_land_area,
        is_sender: request.request_type === 'CONTRACTOR_TO_OWNER',
      })),
    ...requestedOwnerClientList
      .filter((client) => !findClientRequest(client, 'CONTRACTOR_TO_OWNER'))
      .map((client) => {
        const state = clientRequestState(client, 'CONTRACTOR_TO_OWNER')
        return {
          id: `sent-${client.owner_id}-${client.project_id || client.id}`,
          status: state === 'accepted' ? 'accepted' : state === 'rejected' ? 'rejected' : 'pending',
          request_type: 'CONTRACTOR_TO_OWNER',
          is_sender: true,
          sender_name: client.owner_name || client.profile_title || t('role.owner'),
          project_title: client.project_title || client.title || t('dash.homeownerProject'),
          project_address: client.address,
          project_pincode: client.pincode,
          budget: client.budget,
          land_area: client.land_area,
          project_image_url: client.cover_image_url,
          source_client: client,
        }
      }),
  ]
    // A declined request stays on the board as history, under Declined; it
    // used to be dropped here, so the Builder's request simply vanished.
    .filter((request) => ['pending', 'accepted', 'rejected', 'withdrawn'].includes(request.status || 'pending'))
    .reduce((uniqueRequests, request) => {
      // A stored request is a record of its own and keeps its own row: two
      // requests between the same builder and owner (an accepted one and a
      // newer pending one, say) are two rows, never one hiding the other.
      // Matching on title / name / address only folds away the board's own
      // "sent-..." placeholder rows for a lead a stored record already covers.
      const isPlaceholder = (entry) => String(entry.id).startsWith('sent-')
      const requestKey = requestBoardIdentity(request)
      if (!isPlaceholder(request)) {
        if (uniqueRequests.some((existingRequest) => existingRequest.id === request.id)) return uniqueRequests
        const placeholderIndex = uniqueRequests.findIndex((existingRequest) => isPlaceholder(existingRequest) && requestBoardIdentity(existingRequest) === requestKey)
        if (placeholderIndex !== -1) return uniqueRequests.map((currentRequest, index) => (index === placeholderIndex ? request : currentRequest))
        return [...uniqueRequests, request]
      }
      const existingIndex = uniqueRequests.findIndex((existingRequest) => requestBoardIdentity(existingRequest) === requestKey)
      if (existingIndex === -1) return [...uniqueRequests, request]
      const existingRequest = uniqueRequests[existingIndex]
      // A stored record always outranks a placeholder for the same lead.
      if (!isPlaceholder(existingRequest)) return uniqueRequests
      const existingHasImage = Boolean(existingRequest.project_image_url || existingRequest.cover_image_url)
      const nextHasImage = Boolean(request.project_image_url || request.cover_image_url)
      if (!existingHasImage && nextHasImage) {
        return uniqueRequests.map((currentRequest, index) => (index === existingIndex ? request : currentRequest))
      }
      return uniqueRequests
    }, [])
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredRequestBoardList = normalizedSearchQuery
    ? requestBoardList.filter((request) => [
      request.sender_name,
      request.profile_title,
      request.project_title,
      request.project_address,
      request.project_pincode,
      request.status,
    ].join(' ').toLowerCase().includes(normalizedSearchQuery))
    : requestBoardList

  // Supplier requests: SUPPLIER_TO_CONTRACTOR (incoming) and CONTRACTOR_TO_SUPPLIER (outgoing)
  // Deduplicate by counterparty — show one card per supplier, keeping the most recent request.
  const supplierRequestList = requestList
    .filter((request) => ['SUPPLIER_TO_CONTRACTOR', 'CONTRACTOR_TO_SUPPLIER'].includes(request.request_type))
    .map((request) => ({
      ...request,
      sender_name: request.sender_name || request.profile_title || t('role.supplier'),
      project_title: request.project_title || t('dash.homeownerProject'),
      _counterpartyId: request.is_sender ? request.receiver_id : request.sender_id,
    }))
    .reduce((unique, request) => {
      const existing = unique.find((r) => r._counterpartyId === request._counterpartyId)
      if (!existing) return [...unique, request]
      // Never overwrite an accepted request with a pending/rejected one.
      if (existing.status === 'accepted' && request.status !== 'accepted') return unique
      if (request.status === 'accepted' && existing.status !== 'accepted') {
        return unique.map((r) => r._counterpartyId === request._counterpartyId ? request : r)
      }
      // For equal statuses keep the more recent request.
      if (new Date(request.created_at_iso) > new Date(existing.created_at_iso)) {
        return unique.map((r) => r._counterpartyId === request._counterpartyId ? request : r)
      }
      return unique
    }, [])
  // Accepted suppliers (for My Team tab)
  const acceptedSuppliers = supplierRequestList.filter((r) => r.status === 'accepted')

  useResumeGatedAction({
    sendContractorClientRequest: (payload) =>
      sendContractorClientRequest(payload?.client, payload?.requestType, payload?.quotationAmount).catch(() => {}),
    acceptContractorRequest: (payload) => acceptContractorRequest(payload?.requestId, payload?.quotationAmount),
    sendEngineerRequest: ({ recipient, projectId }) => recipient && sendEngineerRequest(recipient, projectId),
    respondEngineerJoinRequest: ({ relationshipId, action }) => handleRespondEngineerJoinRequest(relationshipId, action),
  })

  return (
    <div id="top" className="min-h-screen text-slate-950">
      <LocationLeadsPrompt
        open={locationPrompt.open}
        currentPincode={user?.pincode || ''}
        onDismiss={locationPrompt.dismissPrompt}
        onSaved={saveLeadLocation}
        pincodeChoices={leadLocationChoices(subscription.status)}
      />
      <DashboardShell
        plainBackground
        // The Weather page, from the top bar beside the language selector.
        beforeLanguage={<WeatherNavButton />}
        sidebarItems={nav}
        activeId={sidebarActiveId}
        onNav={selectDashboardSection}
        user={userShell}
        roleLabel={t('role.contractor')}
        onLogout={logout}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('dash.searchContractor')}
        userMenu={contractorUserMenu}
        // No breadcrumb on the top-level pages (Dashboard, Projects, Requests
        // and the rest): the nav already says where you are. It appears only
        // once you go inside -- an opened project -- as Dashboard / Projects /
        // <project>, with Projects leading back to the list.
        breadcrumbTrail={activeId === 'projects' && selectedProject ? [
          {
            label: nav.find((item) => item.id === 'projects')?.label || t('ui.projects'),
            onClick: () => {
              setSelectedProject(null)
              setSelectedProjectTab('activity')
            },
          },
          { label: selectedProject.title || '' },
        ] : null}
        breadcrumbReplacement={activeId === 'projects' && selectedProject ? null : <span aria-hidden="true" />}
        onUserMenuSelect={handleUserMenuSelect}
        onMessagesClick={(tab) => selectDashboardSection(tab)}
        unreadMessageCount={unreadMessageCount}
        defaultTab="requests"
        headerActions={<PremiumBadge status={subscription.status} onClick={() => selectDashboardSection('subscription')} />}
      >
        {activeId !== 'subscription' && <FreeAccessBanner status={subscription.status} onViewPlans={() => selectDashboardSection('subscription')} />}
        {activeId !== 'subscription' && <ExpiryWarningModal status={subscription.status} userId={user?.id} onViewPlans={() => selectDashboardSection('subscription')} />}
        {activeId === 'subscription' && <BuilderSubscriptionPanel subscription={subscription} />}
        {activeId === 'portfolio' && (
          <BuilderPortfolioSection
            subscription={subscription}
            onViewPlans={() => selectDashboardSection('subscription')}
            onOpenProjects={() => selectDashboardSection('projects')}
          />
        )}
        {activeId === 'settings' && (
          <>
            <ContractorProfileSettings
              profile={contractorProfileDetails ? { ...contractorProfileDetails, email: user?.email ?? contractorProfileDetails.email, phone: user?.phone ?? contractorProfileDetails.phone, profile_image_url: profileImagePreview || contractorProfileDetails.profile_image_url, company_logo_url: companyLogoPreview || contractorProfileDetails.company_logo_url } : contractorProfileDetails}
              user={userShell}
              errorMessage={contractorProfileError}
              onSaveField={saveContractorSettingsChanges}
              // The photo and logo uploads report here, success or failure, so
              // a failed upload is never silent on this screen.
              uploadMessage={profileImageMessage}
              onProfileImageUpload={(file) => uploadContractorProfileImage(file).catch((error) => setProfileImageMessage(profileErrorMessage(error, t('ps.uploadFailed'))))}
              onCompanyLogoUpload={(file) => uploadContractorCompanyLogo(file).catch((error) => setProfileImageMessage(profileErrorMessage(error, t('dash.err.logoUploadFailed'))))}
              onNavigate={selectDashboardSection}
              onBack={() => setActiveId('requests')}
              subscriptionStatus={subscription.status}
            />
            <PhoneChangeSection />
            <EmailVerificationSection />
            <DeleteAccountSection />
          </>
        )}
        {activeId === 'requests' && (
          <>
            <ContractorTopSection
              userShell={userShell}
              activeProjects={projectList.length}
              completedProjects={completedProjectCount}
              hasNewNearbyClients={hasNewNearbyClients}
              onNavigate={selectDashboardSection}
            />
            <PlanSummaryCard subscription={subscription} onNavigate={selectDashboardSection} />
            <ContractorAnalyticsSection projectList={projectList} requestList={requestList} onNavigate={selectDashboardSection} />
          </>
        )}

        {/* The same request board the Dashboard used to carry, now reached
            from its own navigation item. Same component, same props. */}
        {activeId === 'requestsBoard' && (
          <ContractorRequestsSection
            requestMessage={requestMessage}
            filteredRequestBoardList={filteredRequestBoardList}
            supplierRequestBoardList={supplierRequestBoardList}
            onAcceptRequest={acceptContractorRequest}
            onRejectRequest={rejectContractorRequest}
            onWithdrawRequest={withdrawContractorRequest}
            // A builder sends requests from Find Clients; New Request opens it.
            onNewRequest={() => selectDashboardSection('findClients')}
          />
        )}

        {activeId === 'projects' && (
          <ContractorProjectsSection
            selectedProject={selectedProject}
            projectList={projectList}
            onSelectProject={(projectDetails) => {
              setSelectedProject(projectDetails)
              setSelectedProjectTab('activity')
            }}
            contractorName={contractorDisplayName}
            timelineEntries={timelineEntries}
            activeTab={selectedProjectTab}
            setActiveTab={setSelectedProjectTab}
            onBackProject={() => {
              setSelectedProject(null)
              setSelectedProjectTab('activity')
            }}
            teamEngineers={teamData.active || []}
            projectEngineer={projectEngineer}
            onAssignEngineer={assignEngineer}
            onUnassignEngineer={unassignEngineer}
            assignEngineerMessage={assignEngineerMessage}
            contractorSuppliers={contractorSuppliers}
            projectSuppliers={projectSuppliers}
            onAssignSupplier={assignSupplierToTeam}
            assignSupplierMessage={assignSupplierMessage}
            onManageEngineers={() => setActiveId('engineers')}
          />
        )}

        {activeId === 'engineers' && (
          <MySiteEngineersSection
            teamData={teamData}
            contractorName={contractorDisplayName}
            onInvite={openInviteModal}
            onRespond={handleRespondEngineerJoinRequest}
            onViewEngineer={setSelectedEngineerProfile}
            onAssignProject={openAssignProject}
            onUnassignProject={openUnassignProject}
            onRevokeInvitation={handleRevokeInvitation}
            message={engineerSectionMessage}
            activeTab={engineerSubTab}
            onTabChange={setEngineerSubTab}
            engineers={nearbyEngineers}
            engineersPincode={engineersPincode}
            onPincodeChange={(value) => {
              setEngineersPincode(value)
              refreshNearbyEngineers(value)
            }}
            onSendEngineerRequest={sendEngineerRequest}
            sentEngineerIds={sentEngineerIds}
            sendingEngineerId={sendingEngineerId}
            onRefreshNearbyEngineers={() => refreshNearbyEngineers()}
            acceptedSuppliers={acceptedSuppliers}
            contractorSuppliers={contractorSuppliers}
            onOpenSupplierProfile={openSupplierProfile}
            onAssignSupplier={openAssignSupplier}
            onUnassignSupplier={openUnassignSupplier}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        )}



        {activeId === 'findClients' && (
          <ContractorFindClientsSection
            clientRequestState={clientRequestState}
            findClientRequest={findClientRequest}
            onSendRequest={openSendRequest}
            sendingReceiverId={sendingReceiverId}
            onAcceptRequest={acceptContractorRequest}
            onRejectRequest={rejectContractorRequest}
            openSupplierProfile={openSupplierProfile}
            requestMessage={requestMessage}
            activeFindClientTab={activeFindClientTab}
            setActiveFindClientTab={setActiveFindClientTab}
            openOwnerClientList={openOwnerClientList}
            supplierClientList={supplierClientList}
            onSelectClient={setSelectedClientProfile}
            // Which pincode these leads are for, and the way to change it:
            // in the section's tab row, on the right.
            subscriptionStatus={subscription.status}
            locationAction={locationPrompt.eligible ? (
              <LocationLeadsButton pincode={user?.pincode} onClick={locationPrompt.openPrompt} />
            ) : null}
          />
        )}

        {activeId === 'buySell' && (
          <PropertyBuySellHub
            activeTab={buySellTab}
            onTabChange={setBuySellTab}
            projects={projectList}
            defaultCountry={user?.country_of_residence || 'India'}
          />
        )}

        {activeId === 'productCatalog' && (
          // Browse-only: a Builder has no cart. Suppliers are the nearby ones,
          // found by the same /suppliers/nearby rules as elsewhere.
          <ProductCatalogPage title={null} loadSuppliers={() => fetchNearbySuppliers()} />
        )}
        {activeId === 'messages' && <ContractorMessagesSection />}

      </DashboardShell>
      <NewRequestToast inbox={requestInbox} onOpen={openRequestsFromToast} />

      <AnimatePresence>
        {inviteModalOpen && (
          <InviteEngineerDrawer
            contractorName={contractorDisplayName}
            prefill={invitePrefill}
            onClose={() => setInviteModalOpen(false)}
            onGenerate={generateInvite}
            inviteResult={inviteResult}
            error={inviteError}
            busy={inviteBusy}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedEngineerProfile && (
          <ContractorEngineerProfileDrawer
            engineer={selectedEngineerProfile}
            onClose={() => setSelectedEngineerProfile(null)}
            teamStatus={
              teamData?.active?.some((e) => e.user_id === selectedEngineerProfile.user_id)
                ? 'active'
                : teamData?.pending_requests?.some((e) => e.user_id === selectedEngineerProfile.user_id)
                  ? 'pending'
                  : null
            }
            requestSent={sentEngineerIds.has(selectedEngineerProfile.user_id)}
            onSendRequest={sendEngineerRequest}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {assignSupplierTarget && (
          <AssignSupplierDrawer
            supplier={assignSupplierTarget}
            projectList={projectList}
            teamData={teamData}
            contractorSuppliers={contractorSuppliers}
            onClose={() => setAssignSupplierTarget(null)}
            onAssign={confirmAssignSupplier}
            busy={assignSupplierBusy}
            successProject={assignSupplierSuccessProject}
            error={assignSupplierMessage}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {unassignSupplierTarget && (
          <ModalErrorBoundary name="UnassignSupplierDrawer" onClose={() => setUnassignSupplierTarget(null)}>
            <UnassignSupplierDrawer
              supplier={unassignSupplierTarget}
              onClose={() => setUnassignSupplierTarget(null)}
              onUnassign={confirmUnassignSupplier}
              busy={unassignSupplierBusy}
              successProject={unassignSupplierSuccessProject}
              error={unassignSupplierMessage}
            />
          </ModalErrorBoundary>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {assignTarget && (
          <AssignProjectDrawer
            engineer={assignTarget}
            projectList={projectList}
            assignedByProject={assignedEngineerByProject}
            onClose={() => setAssignTarget(null)}
            onAssign={confirmAssignProject}
            busy={assignBusy}
            successProject={assignSuccessProject}
            error={assignModalMessage}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {unassignTarget && (
          <ModalErrorBoundary name="UnassignProjectDrawer" onClose={() => setUnassignTarget(null)}>
            <UnassignProjectDrawer
              engineer={unassignTarget}
              onClose={() => setUnassignTarget(null)}
              onUnassign={confirmUnassignProject}
              busy={unassignBusy}
              successProject={unassignSuccessProject}
              error={unassignModalMessage}
            />
          </ModalErrorBoundary>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedClientProfile && (
          <ClientProfileDrawer
            selectedClientProfile={selectedClientProfile}
            clientRequestState={clientRequestState}
            onSendRequest={openSendRequest}
            sendingReceiverId={sendingReceiverId}
            supplierProfileMessage={supplierProfileMessage}
            onClose={() => {
              setSelectedClientProfile(null)
              setSupplierProfileMessage('')
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sendRequestTarget && (
          <SendRequestDrawer
            client={sendRequestTarget.client}
            requestType={sendRequestTarget.requestType}
            onClose={() => setSendRequestTarget(null)}
            onSend={confirmSendRequest}
            busy={sendBusy}
            error={sendError}
            success={sendSuccess}
          />
        )}
      </AnimatePresence>
      {showHelp && <HelpCenterModal onClose={() => setShowHelp(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  )
}
