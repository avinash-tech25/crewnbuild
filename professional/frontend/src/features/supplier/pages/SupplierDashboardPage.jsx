import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Building2, ChevronRight, ClipboardList, FolderKanban, Home, LayoutGrid, LayoutList, LifeBuoy, Loader2, Search, Settings,
} from 'lucide-react'
import MessageThread from '../../messaging/components/MessageThread.jsx'
import { useProfileGate, useResumeGatedAction } from '../../../shared/hooks/useProfileGate.js'
import DashboardShell from '../../../shared/dashboard/DashboardShell.jsx'
import DeleteAccountSection from '../../accounts/components/DeleteAccountSection.jsx'
import EmailVerificationSection from '../../accounts/components/EmailVerificationSection.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import { HelpCenterModal, FeedbackModal } from '../../support/components/SupportModals.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { completeUserProfile, updateBusinessLogo, updateUserProfileImage } from '../../auth/authApi.js'
import { profileErrorMessage } from '../../../shared/hooks/useProfileFormErrors.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { assertProfileImage } from '../../../shared/utils/profileImageRules.js'
import { logoutUser, setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import {
  acceptProjectRequest,
  fetchIncomingRequests,
  rejectProjectRequest,
  sendProjectRequest,
  withdrawProjectRequest,
} from '../../requests/requestsApi.js'
import { fetchConversations } from '../../messaging/messagesApi.js'
import { fetchNotifications, markModuleNotificationsRead } from '../../notifications/notificationsApi.js'
import { fetchSupplierClients, fetchSupplierProfile } from '../../accounts/publicProfileApi.js'
import { baseNav, equipmentNav, laborNav } from '../supplierConstants.js'

/**
 * Where the Supplier is, read from the URL.
 *
 * The same arrangement the House Owner dashboard already uses: the address is
 * the single statement of which section is on screen, so a refresh, the
 * browser's Back and Forward buttons and a pasted link all behave the way the
 * navigation does.
 *
 * Every section this dashboard renders has an address, not only the six in the
 * sidebar — messages and the profile page are reached from the topbar and the
 * account menu, and they would otherwise be the only screens the URL could not
 * name.
 *
 * The paths follow the navigation's labels rather than its internal ids, the
 * way the House Owner's do. One is worth naming: the sidebar's Dashboard item
 * carries the id 'requests' and so owns the bare /supplier address, while the
 * item labelled Requests carries the id 'incomingRequests' and owns
 * /supplier/requests.
 */
const NAV_PATHS = {
  requests: '/supplier',
  myProjects: '/supplier/my-projects',
  findClients: '/supplier/find-clients',
  incomingRequests: '/supplier/requests',
  products: '/supplier/products',
  orders: '/supplier/orders',
  messages: '/supplier/messages',
  profile: '/supplier/profile',
  // Labor Supplier only (laborNav).
  laborServices: '/supplier/labor-services',
  laborAssignments: '/supplier/assignments',
  // Equipment Supplier only (equipmentNav).
  equipmentInventory: '/supplier/equipment',
  equipmentAssignments: '/supplier/equipment-assignments',
}

// The reverse of NAV_PATHS, built from it so the two can never disagree.
const SECTION_BY_SEGMENT = Object.fromEntries(
  Object.entries(NAV_PATHS).map(([section, path]) => [path.replace(/^\/supplier\/?/, ''), section]),
)

function parseSupplierLocation(pathname) {
  const [segment] = pathname.replace(/^\/supplier\/?/, '').split('/').filter(Boolean)
  // An address that names no section falls back to the dashboard, exactly as
  // an unknown section id does when navigating.
  return SECTION_BY_SEGMENT[segment || ''] || 'requests'
}
import { readSeenSupplierClientKeys, saveSeenSupplierClientKeys, supplierClientIdentity } from '../supplierHelpers.js'
import { ClientProfileModal } from '../components/SupplierPanels.jsx'
import { SupplierDashboardHero } from '../components/SupplierHero.jsx'
import { SupplierProfilePanel } from '../components/SupplierProfilePanel.jsx'
import { RequestProfileDashboard } from '../../requests/components/RequestProfileDashboard.jsx'
import { SupplierFindClientsSection, SupplierRequestsSection, SupplierStatsGrid } from '../components/SupplierSections.jsx'
import { SupplierCatalogPicker } from '../components/SupplierCatalogPicker.jsx'
import { SupplierStorefront } from '../../storefront/components/SupplierStorefront.jsx'
import { useSupplierProducts } from '../../catalog/supplierCatalogSlice.js'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import SupplierMaterialRequests from '../components/SupplierMaterialRequests.jsx'
import SupplierPurchaseRequests from '../components/SupplierPurchaseRequests.jsx'
import SupplierAnalyticsDashboard from '../components/SupplierAnalyticsDashboard.jsx'
import SupplierMyProjects from '../components/SupplierMyProjects.jsx'
import SupplierRecentSection from '../components/SupplierRecentSection.jsx'
import { deleteSupplierProduct, fetchSupplierProducts, updateSupplierProduct } from '../../catalog/supplierProductsApi.js'
import { fetchSupplierMaterialRequests } from '../../shop/materialRequestsApi.js'
import { fetchSupplierMyProjects } from '../../projects/projectsApi.js'
import { optionLabel, SUPPLIER_TYPE_KEYS } from '../../../i18n/optionKeys.js'
import LocationLeadsPrompt, { LocationLeadsButton, useLocationLeadsPrompt } from '../../../shared/ui/LocationLeadsPrompt.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import useRequestInbox, { useMarkSeenWhenOpened } from '../../../shared/hooks/useRequestInbox.js'
import NewRequestToast from '../../requests/components/NewRequestToast.jsx'
import { projectRequestItems, purchaseRequestItems, supplierJobRequestItems } from '../../../shared/utils/requestInbox.js'
import { fetchLaborServices, fetchLaborTrades, fetchSupplierLaborRequests, LABOR_SUPPLIER_CATEGORY } from '../../labour/labourApi.js'
import { LaborAssignmentsSection, LaborRequestsSection, LaborServicesSection, LaborSupplierStatsGrid } from '../../labour/components/SupplierLaborSections.jsx'
import { EQUIPMENT_SUPPLIER_CATEGORY, fetchEquipmentItems, fetchSupplierEquipmentRequests } from '../../equipment/equipmentApi.js'
import { EquipmentAssignmentsSection, EquipmentInventorySection, EquipmentRequestsSection, EquipmentSupplierStatsGrid } from '../../equipment/components/SupplierEquipmentSections.jsx'
import WeatherNavButton from '../../weather/components/WeatherNavButton.jsx'

// The request types keep the old names (SUPPLIER_TO_CONTRACTOR); the client's role is the
// account role the server sends, BUILDER for a builder.
const SUPPLIER_REQUEST_TYPES = { OWNER: 'SUPPLIER_TO_OWNER', BUILDER: 'SUPPLIER_TO_CONTRACTOR', CONTRACTOR: 'SUPPLIER_TO_CONTRACTOR' }
const supplierRequestTypeFor = (clientRole) => SUPPLIER_REQUEST_TYPES[clientRole] || `SUPPLIER_TO_${clientRole}`

export default function SupplierDashboard() {
  const { user } = useSelector((state) => state.auth)
  const { t, td, setCountry } = useLanguage()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { requireCompleteProfile } = useProfileGate()
  // The open section is derived from the address rather than held beside it, so
  // there is only one answer to what is on screen. Every existing
  // setActiveId(...) call site keeps its meaning; it now records the move in
  // the browser instead of only in React.
  const activeId = useMemo(() => parseSupplierLocation(location.pathname), [location.pathname])
  const setActiveId = useCallback((sectionId) => {
    navigate(NAV_PATHS[sectionId] || NAV_PATHS.requests)
  }, [navigate])
  const [requestList, setRequestList] = useState([])
  const [clientList, setClientList] = useState([])
  // The supplier's own listings, held in supplierCatalogSlice.
  const [productList, setProductList] = useSupplierProducts()
  const [materialRequestList, setMaterialRequestList] = useState([])
  const [myProjectsList, setMyProjectsList] = useState([])
  // One search box lives in the topbar and filters whichever section is open —
  // the same pattern the owner and builder dashboards use — instead of only
  // narrowing the Products list.
  const [searchQuery, setSearchQuery] = useState('')
  const [productUpdateMessage, setProductUpdateMessage] = useState('')
  const [showListingForm, setShowListingForm] = useState(false)
  const [requestMessage, setRequestMessage] = useState('')
  const [sendingReceiverId, setSendingReceiverId] = useState(null)
  const [sentRequestKeys, setSentRequestKeys] = useState({})
  const [selectedClientProfile, setSelectedClientProfile] = useState(null)
  const [selectedRequestProfile, setSelectedRequestProfile] = useState(null)
  const [seenClientKeys, setSeenClientKeys] = useState([])
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const [notificationBadgeCounts, setNotificationBadgeCounts] = useState({})
  const [supplierProfileDetails, setSupplierProfileDetails] = useState(null)
  const [supplierProfileStatus, setSupplierProfileStatus] = useState('loading')
  const [supplierProfileError, setSupplierProfileError] = useState('')
  const [profileImageMessage, setProfileImageMessage] = useState('')
  const [profileImagePreview, setProfileImagePreview] = useState('')
  const [storeLogoPreview, setStoreLogoPreview] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [supplierRequestTab, setSupplierRequestTab] = useState('all')
  // Requests shows two kinds: buyers' purchases ("Buy") and client/lead requests.
  const [requestKind, setRequestKind] = useState('purchase')
  // Which request lists have loaded successfully; a failed load never clears
  // the New Requests badge. Each supplier type's own list is tracked apart, so
  // a load made before the profile names the type cannot stand in for another.
  const [requestLoads, setRequestLoads] = useState({ client: false, material: false, labor: false, equipment: false })
  const markRequestsLoaded = (kind) => setRequestLoads((current) => (current[kind] ? current : { ...current, [kind]: true }))
  // Table is the default request presentation — the compact view the Requests
  // page opens on — and Cards is the optional denser layout. Switching only
  // changes the layout of the same stored requests, never the data behind them.
  const [requestViewMode, setRequestViewMode] = useState('table')
  // Labor Supplier data (GET /labor/services, /labor/requests, /labor/trades).
  const [laborServiceList, setLaborServiceList] = useState([])
  const [laborRequestList, setLaborRequestList] = useState([])
  const [laborTrades, setLaborTrades] = useState([])
  const [laborRefreshKey, setLaborRefreshKey] = useState(0)
  // Equipment Supplier data (GET /equipment/items, /equipment/requests).
  const [equipmentItemList, setEquipmentItemList] = useState([])
  const [equipmentRequestList, setEquipmentRequestList] = useState([])
  const [equipmentRefreshKey, setEquipmentRefreshKey] = useState(0)

  // The supplier dashboard follows the account's country of residence.
  useEffect(() => {
    setCountry(user?.country_of_residence || 'India')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.country_of_residence])

  const userShell = useMemo(() => ({
    name: td(user?.name) || t('role.supplier'),
    initials: (user?.name || 'S').slice(0, 2).toUpperCase(),
    profileImageUrl: profileImagePreview || user?.profile_image_url || '',
  }), [profileImagePreview, user, t, td])
  const supplierPincode = user?.pincode || supplierProfileDetails?.pincode || 'all'
  const locationPrompt = useLocationLeadsPrompt(user)
  const clientIdentityKeys = useMemo(() => clientList.map(supplierClientIdentity), [clientList])
  const unseenClientKeys = useMemo(
    () => clientIdentityKeys.filter((clientKey) => !seenClientKeys.includes(clientKey)),
    [clientIdentityKeys, seenClientKeys],
  )
  const hasNewNearbyClients = unseenClientKeys.length > 0

  // Find Clients exists to discover NEW clients. Once a request already links
  // the supplier to a client — in either direction, whatever its outcome — that
  // client stops being a prospect: the existing request is the source of truth
  // and the Requests section is where it is managed. Rows are matched by the
  // stored supplier ↔ client relationship (never by name), so another
  // supplier's requests never hide a client here.
  const discoverableClients = useMemo(() => {
    const requested = new Set()
    requestList.forEach((request) => {
      // A withdrawn request blocks nothing: its sender took it back, so the
      // client is discoverable again (a live request, if any, still hides it).
      if (request.status === 'withdrawn') return
      if (request.request_type === 'SUPPLIER_TO_OWNER' || request.request_type === 'OWNER_TO_SUPPLIER') {
        requested.add(`OWNER:${request.is_sender ? request.receiver_id : request.sender_id}`)
      } else if (request.request_type === 'SUPPLIER_TO_CONTRACTOR' || request.request_type === 'CONTRACTOR_TO_SUPPLIER') {
        requested.add(`BUILDER:${request.is_sender ? request.receiver_id : request.sender_id}`)
      }
    })
    return clientList.filter((client) => !requested.has(`${client.type}:${client.user_id}`))
  }, [clientList, requestList])

  // The topbar search narrows whichever section is open. Fields are matched
  // against the same values each section already renders, so a result is never
  // a record the section itself would not show.
  const searchText = searchQuery.trim().toLowerCase()
  const matchesSearch = (...fields) => (
    !searchText || fields.filter(Boolean).some((field) => String(field).toLowerCase().includes(searchText))
  )

  // Partnership requests split by who the other party is. `sender_role` on the
  // payload is the counterparty's role, so this is decided by the stored
  // relationship rather than by any name. Both directions are kept: a request
  // the supplier sent from Find Clients is exactly the one that used to vanish
  // once the other side answered it.
  const ownerRequestList = useMemo(
    () => requestList.filter((request) => request.sender_role === 'OWNER'),
    [requestList],
  )
  const builderRequestList = useMemo(
    () => requestList.filter((request) => request.sender_role === 'BUILDER'),
    [requestList],
  )
  const supplierCountry = user?.country_of_residence || 'India'
  // The role label follows the supplier's own saved category (e.g. "Material
  // Supplier") instead of the generic "Supplier", falling back to the generic
  // label while the profile loads or until a category is chosen.
  const supplierRoleLabel = supplierProfileDetails?.supplier_category
    ? optionLabel(t, SUPPLIER_TYPE_KEYS, supplierProfileDetails.supplier_category)
    : t('role.supplier')
  // A Labor Supplier gets the labor screens; every other supplier keeps the
  // Material dashboard exactly as it was. Decided by the saved category only.
  const isLaborSupplier = supplierProfileDetails?.supplier_category === LABOR_SUPPLIER_CATEGORY
  const laborLoadGuard = useLatestOnly()
  const refreshLaborData = () => {
    if (!isLaborSupplier) return
    const isLatest = laborLoadGuard()
    fetchLaborServices()
      .then((list) => { if (isLatest()) setLaborServiceList(list) })
      .catch(() => { if (isLatest()) setLaborServiceList([]) })
    fetchSupplierLaborRequests()
      .then((list) => { if (isLatest()) { setLaborRequestList(list); setLaborRefreshKey((key) => key + 1); markRequestsLoaded('labor') } })
      .catch(() => { if (isLatest()) setLaborRequestList([]) })
  }
  useEffect(() => {
    if (!isLaborSupplier) return
    refreshLaborData()
    fetchLaborTrades().then(setLaborTrades).catch(() => setLaborTrades([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLaborSupplier])
  // A new labor request, a cancellation, completion or saved attendance from
  // the Site Engineer reloads through the same live hint as everything else.
  useLiveRefresh(refreshLaborData)

  // An Equipment Supplier gets the equipment screens, the same way.
  const isEquipmentSupplier = supplierProfileDetails?.supplier_category === EQUIPMENT_SUPPLIER_CATEGORY
  const equipmentLoadGuard = useLatestOnly()
  const refreshEquipmentData = () => {
    if (!isEquipmentSupplier) return
    const isLatest = equipmentLoadGuard()
    fetchEquipmentItems()
      .then((list) => { if (isLatest()) setEquipmentItemList(list) })
      .catch(() => { if (isLatest()) setEquipmentItemList([]) })
    fetchSupplierEquipmentRequests()
      .then((list) => { if (isLatest()) { setEquipmentRequestList(list); setEquipmentRefreshKey((key) => key + 1); markRequestsLoaded('equipment') } })
      .catch(() => { if (isLatest()) setEquipmentRequestList([]) })
  }
  useEffect(() => {
    refreshEquipmentData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEquipmentSupplier])
  // A new request, cancellation or logged usage from the Site Engineer reloads
  // through the existing live hint.
  useLiveRefresh(refreshEquipmentData)

  // Latest load wins: a live refresh can overlap a load already in flight, and
  // the older response must not overwrite the newer one.
  const supplierLoadGuard = useLatestOnly()
  const refreshSupplierData = () => {
    const isLatest = supplierLoadGuard()
    fetchIncomingRequests()
      .then((list) => { if (isLatest()) { setRequestList(list); markRequestsLoaded('client') } })
      .catch(() => { if (isLatest()) setRequestList([]) })
    fetchSupplierClients(supplierCountry).then(setClientList).catch(() => setClientList([]))
    fetchSupplierProducts().then(setProductList).catch(() => setProductList([]))
    fetchSupplierMaterialRequests()
      .then((list) => { if (isLatest()) { setMaterialRequestList(list); markRequestsLoaded('material') } })
      .catch(() => { if (isLatest()) setMaterialRequestList([]) })
    fetchSupplierMyProjects()
      .then((list) => { if (isLatest()) setMyProjectsList(list) })
      .catch(() => { if (isLatest()) setMyProjectsList([]) })
  }
  // A request, answer, purchase request or project assignment from someone
  // else reloads through this same loader, without a page refresh.
  useLiveRefresh(refreshSupplierData)

  const refreshSupplierClients = () => {
    fetchSupplierClients(supplierCountry).then(setClientList).catch(() => setClientList([]))
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
            request: 'requests',
            project: 'findClients',
            contractor: 'findClients',
            supplier: 'findClients',
            estimate: 'findClients',
            escrow: 'findClients',
            general: 'profile',
          }
          const tabId = moduleTabMap[notification.module]
          if (tabId) nextBadgeCounts[tabId] = (nextBadgeCounts[tabId] || 0) + 1
        })
        setNotificationBadgeCounts(nextBadgeCounts)
      })
      .catch(() => setNotificationBadgeCounts({}))
  }

  useEffect(refreshSupplierData, [])
  useEffect(() => {
    const clientRefreshTimer = window.setInterval(refreshSupplierClients, 10000)
    const refreshClientsOnFocus = () => refreshSupplierClients()
    window.addEventListener('focus', refreshClientsOnFocus)
    return () => {
      window.clearInterval(clientRefreshTimer)
      window.removeEventListener('focus', refreshClientsOnFocus)
    }
  }, [])
  // The supplier's category decides which dashboard (Material, Labor or
  // Equipment) is shown, so nothing type-specific renders until it is known.
  const loadSupplierProfile = useCallback(() => {
    if (!user?.id) return
    setSupplierProfileStatus('loading')
    fetchSupplierProfile(user.id)
      .then((details) => {
        setSupplierProfileDetails(details)
        setSupplierProfileStatus('ready')
      })
      .catch(() => setSupplierProfileStatus('error'))
  }, [user?.id])
  useEffect(() => {
    loadSupplierProfile()
  }, [loadSupplierProfile])
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
    if (activeId !== 'profile' || !user?.id) return
    setSupplierProfileError('')
    fetchSupplierProfile(user.id)
      .then(setSupplierProfileDetails)
      .catch((error) => setSupplierProfileError(profileErrorMessage(error, t('dash.supplier.msg.unableLoadProfile'))))
  }, [activeId, user?.id])
  useEffect(() => {
    if (!user?.id) return
    setSeenClientKeys(readSeenSupplierClientKeys(user.id, supplierPincode))
  }, [supplierPincode, user?.id])
  useEffect(() => {
    if (activeId !== 'findClients' || !user?.id || !clientIdentityKeys.length) return
    const nextSeenKeys = [...new Set([...seenClientKeys, ...clientIdentityKeys])]
    if (nextSeenKeys.length === seenClientKeys.length) return
    setSeenClientKeys(nextSeenKeys)
    saveSeenSupplierClientKeys(user.id, supplierPincode, nextSeenKeys)
  }, [activeId, clientIdentityKeys, seenClientKeys, supplierPincode, user?.id])

  // The request banner is a toast, not a notice board: it should confirm an
  // action and then clear itself, so a "Request sent to …" from long ago is
  // never still sitting at the top of the Requests page.
  useEffect(() => {
    if (!requestMessage) return
    const hideTimer = window.setTimeout(() => setRequestMessage(''), 4000)
    return () => window.clearTimeout(hideTimer)
  }, [requestMessage])

  const sendSupplierClientRequest = async (client) => {
    if (requireCompleteProfile('sendSupplierClientRequest', client)) return
    const requestKey = `${client.type}-${client.user_id}-${client.project_id || 'profile'}`
    setRequestMessage('')
    setSendingReceiverId(client.user_id)
    try {
      await sendProjectRequest({
        receiver_id: client.user_id,
        project_id: client.project_id || null,
        request_type: supplierRequestTypeFor(client.type),
      })
      setRequestMessage(t('dash.supplier.msg.sentTo', { name: td(client.name) }))
      setSentRequestKeys((currentKeys) => ({ ...currentKeys, [requestKey]: true }))
      refreshSupplierData()
    } catch (error) {
      const detail = error.response?.data?.detail || t('dash.supplier.msg.unableSend')
      setRequestMessage(detail)
      if (detail === 'Request already sent') {
        setSentRequestKeys((currentKeys) => ({ ...currentKeys, [requestKey]: true }))
      }
    } finally {
      setSendingReceiverId(null)
    }
  }

  const acceptSupplierRequest = async (requestId) => {
    if (requireCompleteProfile('acceptSupplierRequest', requestId)) return
    setRequestMessage('')
    try {
      await acceptProjectRequest(requestId)
      setRequestMessage(t('dash.supplier.msg.accepted'))
      refreshSupplierData()
    } catch (error) {
      setRequestMessage(error.response?.data?.detail || t('dash.supplier.msg.unableAccept'))
    }
  }

  const rejectSupplierRequest = async (requestId) => {
    setRequestMessage('')
    try {
      await rejectProjectRequest(requestId)
      setRequestMessage(t('dash.supplier.msg.rejected'))
      refreshSupplierData()
    } catch (error) {
      setRequestMessage(error.response?.data?.detail || t('dash.supplier.msg.unableReject'))
    }
  }

  // Take back one of the supplier's own pending requests; it stays as Withdrawn.
  const withdrawSupplierRequest = async (requestId) => {
    setRequestMessage('')
    try {
      await withdrawProjectRequest(requestId)
      setRequestMessage(t('dash.msg.requestWithdrawn'))
      refreshSupplierData()
    } catch (error) {
      const detail = error.response?.data?.detail
      setRequestMessage(typeof detail === 'string' && detail ? detail : t('dash.err.withdrawRequest'))
    }
  }

  const deleteProductListing = async (productId) => {
    const product = productList.find((item) => item.id === productId)
    if (!window.confirm(t('dash.supplier.msg.deleteConfirm', { name: td(product?.name) || t('dash.supplier.msg.thisProduct') }))) return
    try {
      await deleteSupplierProduct(productId)
      setProductList((items) => items.filter((item) => item.id !== productId))
      setMaterialRequestList((items) => items.filter((item) => item.product_id !== productId))
      setProductUpdateMessage(t('dash.supplier.msg.deleted'))
    } catch (error) { setProductUpdateMessage(error.response?.data?.detail || t('dash.supplier.msg.unableRemove')) }
  }

  // Returns the listing as the server saved it, or null when the save was
  // refused, so a caller that shows the result (the product card) can tell the two apart.
  const updateProductListing = async (productId, updates) => {
    try { const updated = await updateSupplierProduct(productId, updates); setProductList((items) => items.map((item) => item.id === productId ? updated : item)); setProductUpdateMessage(t('dash.supplier.msg.catalogUpdated')); return updated } catch (error) { setProductUpdateMessage(error.response?.data?.detail || t('dash.supplier.msg.unableUpdate')); return null }
  }

  const logout = () => {
    dispatch(logoutUser())
    navigate('/login')
  }

  const uploadSupplierProfileImage = async (file) => {
    if (!file) return
    assertProfileImage(file, t)
    setProfileImageMessage(t('dash.supplier.msg.uploadingProfileImage'))
    const uploadedFile = await uploadLocalFile(file)
    setProfileImagePreview(uploadedFile.previewUrl || uploadedFile.url)
    const updatedUser = await updateUserProfileImage(uploadedFile.url)
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    setSupplierProfileDetails((currentProfileDetails) => currentProfileDetails ? { ...currentProfileDetails, profile_image_url: uploadedFile.url } : currentProfileDetails)
    setProfileImageMessage(t('dash.supplier.msg.profileImageUpdated'))
  }

  const uploadSupplierStoreLogo = async (file) => {
    if (!file) return
    assertProfileImage(file, t)
    setProfileImageMessage(t('dash.supplier.msg.uploadingStoreLogo'))
    const uploadedFile = await uploadLocalFile(file)
    setStoreLogoPreview(uploadedFile.previewUrl || uploadedFile.url)
    const updatedProfile = await updateBusinessLogo(uploadedFile.url)
    setSupplierProfileDetails(updatedProfile)
    setProfileImageMessage(t('dash.supplier.msg.storeLogoUpdated'))
  }

  const saveSupplierProfileChanges = async (profileUpdates) => {
    setProfileImageMessage(t('dash.supplier.msg.savingProfile'))
    try {
      // The complete profile in one request, exactly as the existing API expects
      // it. Supplier Category travels in `profileUpdates` like every other field.
      const updatedUser = await completeUserProfile({
        ...profileUpdates,
        profile_image_url: supplierProfileDetails?.profile_image_url || '',
        store_logo_url: supplierProfileDetails?.store_logo_url || '',
        registration_year: profileUpdates.registration_year === '' ? null : Number(profileUpdates.registration_year),
      })
      dispatch(setAuthenticatedUser({ user: updatedUser }))
      const refreshedProfile = await fetchSupplierProfile(user.id)
      setSupplierProfileDetails(refreshedProfile)
      setProfileImageMessage(t('dash.supplier.msg.profileSaved'))
    } catch (error) {
      // Clear "Saving..." so it cannot sit there describing something that did
      // not happen; the panel shows what actually went wrong, and where.
      setProfileImageMessage('')
      throw error
    }
  }

  // The location prompt saved a pincode: adopt the updated account, load the
  // leads for it through the existing find-clients request and show them.
  const saveLeadLocation = async (updatedUser) => {
    dispatch(setAuthenticatedUser({ user: updatedUser }))
    locationPrompt.finishPrompt()
    await fetchSupplierClients(updatedUser?.country_of_residence || supplierCountry).then(setClientList).catch(() => setClientList([]))
    selectDashboardSection('findClients')
  }

  const selectDashboardSection = (sectionId) => {
    setActiveId(sectionId)
    if (sectionId === 'findClients' && user?.id) {
      const nextSeenKeys = [...new Set([...seenClientKeys, ...clientIdentityKeys])]
      setSeenClientKeys(nextSeenKeys)
      saveSeenSupplierClientKeys(user.id, supplierPincode, nextSeenKeys)
    }
    const tabNotificationModules = {
      requests: ['request'],
      findClients: ['project', 'contractor', 'supplier', 'estimate', 'escrow'],
      profile: ['general'],
    }
    const modulesToRead = tabNotificationModules[sectionId] || []
    modulesToRead.forEach((moduleName) => {
      markModuleNotificationsRead(moduleName)
        .then(refreshNotificationBadgeCounts)
        .catch(() => {})
    })
  }

  const supplierProfileReady = supplierProfileStatus === 'ready'
  const supplierNav = !supplierProfileReady ? [] : isLaborSupplier ? laborNav : isEquipmentSupplier ? equipmentNav : baseNav
  // A section can be opened only from this supplier type's own navigation,
  // plus Messages and Profile, which every supplier reaches from the top bar.
  const sectionAllowed = supplierProfileReady
    && (supplierNav.some((item) => item.id === activeId) || activeId === 'messages' || activeId === 'profile')
  useEffect(() => {
    if (supplierProfileReady && !sectionAllowed) navigate(NAV_PATHS.requests, { replace: true })
  }, [supplierProfileReady, sectionAllowed, navigate])

  // New Requests: client requests sent to this supplier, plus the purchase,
  // labor or equipment requests its supplier type receives -- pending only.
  // The type-specific part waits for the profile (the same gate the navigation
  // uses), so a Labor or Equipment supplier's inbox never starts out as a
  // Material one and then switches over.
  const purchaseKind = !supplierProfileReady ? null : isLaborSupplier ? 'labor' : isEquipmentSupplier ? 'equipment' : 'material'
  const requestInboxItems = useMemo(() => [
    ...projectRequestItems(requestList, () => 'client', ['OWNER_TO_SUPPLIER', 'CONTRACTOR_TO_SUPPLIER']),
    ...(purchaseKind === 'labor'
      ? supplierJobRequestItems(laborRequestList, 'labor', 'purchase')
      : purchaseKind === 'equipment'
        ? supplierJobRequestItems(equipmentRequestList, 'equipment', 'purchase')
        : purchaseKind === 'material'
          ? purchaseRequestItems(materialRequestList, 'purchase')
          : []),
  ], [requestList, laborRequestList, equipmentRequestList, materialRequestList, purchaseKind])
  const purchaseLoaded = Boolean(purchaseKind && requestLoads[purchaseKind])
  const requestInbox = useRequestInbox({ userId: user?.id, items: requestInboxItems, loaded: requestLoads.client && purchaseLoaded })
  const keysIn = (section) => requestInboxItems.filter((item) => item.section === section).map((item) => item.key)
  // Each kind is cleared when its own list is the one on screen and has loaded.
  useMarkSeenWhenOpened(requestInbox, { open: sectionAllowed && activeId === 'incomingRequests' && requestKind === 'purchase', loaded: purchaseLoaded, displayedKeys: keysIn('purchase') })
  useMarkSeenWhenOpened(requestInbox, { open: sectionAllowed && activeId === 'incomingRequests' && requestKind === 'client', loaded: requestLoads.client, displayedKeys: keysIn('client') })
  const openRequestsFromToast = () => {
    if (activeId === 'incomingRequests') requestInbox.markSeen(keysIn(requestKind))
    else selectDashboardSection('incomingRequests')
  }

  const nav = supplierNav.map((item) => {
    const translatedItem = { ...item, label: t(item.labelKey) }
    if (item.id === 'findClients') return { ...translatedItem, badge: unseenClientKeys.length || notificationBadgeCounts[item.id], hasDot: hasNewNearbyClients }
    // New requests not yet opened: client requests and the buyers' purchase,
    // labor or equipment requests, counted by id.
    if (item.id === 'incomingRequests') return { ...translatedItem, badge: requestInbox.unreadCount || undefined }
    // Assignments: the accepted requests, i.e. the workers / equipment on projects now.
    if (item.id === 'equipmentAssignments') return { ...translatedItem, badge: equipmentRequestList.filter((request) => request.status === 'ACCEPTED').length || undefined }
    if (item.id === 'laborAssignments') return { ...translatedItem, badge: laborRequestList.filter((request) => request.status === 'ACCEPTED').length || undefined }
    return { ...translatedItem, badge: notificationBadgeCounts[item.id] }
  })

  // The standard account menu, identical on every dashboard. Dark Mode and
  // Logout are supplied by DashboardShell, so the four options a user sees are
  // Profile Settings, Dark Mode, Help & Feedback and Logout.
  const supplierUserMenu = [
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

  useResumeGatedAction({ sendSupplierClientRequest, acceptSupplierRequest: (id) => acceptSupplierRequest(id) })

  return (
    <div className="min-h-screen">
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
        onNav={selectDashboardSection}
        user={userShell}
        roleLabel={supplierRoleLabel}
        onLogout={logout}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('dash.supplier.searchPlaceholder')}
        userMenu={supplierUserMenu}
        onUserMenuSelect={handleUserMenuSelect}
        onMessagesClick={(tab) => selectDashboardSection(tab)}
        unreadMessageCount={unreadMessageCount}
        defaultTab="requests"
        beforeLanguage={<WeatherNavButton />}
        // The Products page's Add/Back control sits at the right end of the
        // breadcrumb row, so the catalogue below starts at the top.
        wide={sectionAllowed && activeId === 'products'}
        // No breadcrumb: every page here is a top-level nav page the nav
        // already names, and project / profile details open as overlays. The
        // row stays for the controls below.
        breadcrumbReplacement={<span aria-hidden="true" />}
        breadcrumbAction={!sectionAllowed ? null : activeId === 'products' ? (
          <button
            type="button"
            onClick={() => { setProductUpdateMessage(''); setShowListingForm((visible) => !visible) }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#1f2937] px-3 text-xs font-extrabold text-white shadow-sm transition hover:bg-brand-950"
          >
            {showListingForm ? t('dash.supplier.closeAddProduct') : t('dash.supplier.addPublishListing')}
          </button>
        ) : activeId === 'findClients' && locationPrompt.eligible ? (
          <LocationLeadsButton pincode={user?.pincode} onClick={locationPrompt.openPrompt} />
        ) : null}
      >
        {supplierProfileStatus === 'loading' && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm font-bold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('dash.supplier.profile.loading')}
          </div>
        )}
        {supplierProfileStatus === 'error' && (
          <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
            <p className="text-sm font-bold text-rose-700">{t('dash.supplier.msg.unableLoadProfile')}</p>
            <button type="button" onClick={loadSupplierProfile} className="inline-flex h-9 items-center rounded-lg bg-[#1f2937] px-4 text-xs font-extrabold text-white hover:bg-brand-950">
              {t('dash.engineer.liveCamera.retry')}
            </button>
          </div>
        )}
        {sectionAllowed && (<>
        {activeId === 'orders' && (
          <SupplierMaterialRequests
            searchQuery={searchQuery}
            onInventoryChanged={() => fetchSupplierProducts().then(setProductList)}
          />
        )}

        {activeId === 'requests' && isLaborSupplier && (
          <>
            {/* productCount only drives the Material "add products" hint, which
                does not apply to a Labor Supplier. */}
            <SupplierDashboardHero
              user={userShell}
              profile={supplierProfileDetails}
              productCount={1}
              subtitle={t('labor.supplier.heroSub')}
            />
            <LaborSupplierStatsGrid services={laborServiceList} requests={laborRequestList} onSelect={selectDashboardSection} />
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-extrabold text-graphite">{t('labor.supplier.pendingTitle')}</h2>
                <button type="button" onClick={() => selectDashboardSection('incomingRequests')} className="inline-flex items-center gap-1 text-xs font-extrabold text-brand-800 hover:underline">
                  {t('ui.requests')} <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                </button>
              </div>
              <LaborRequestsSection compact requests={laborRequestList} services={laborServiceList} onChanged={refreshLaborData} />
            </section>
            <SupplierRecentSection
              parts={['requests']}
              requestList={requestList}
              materialRequestList={materialRequestList}
              productList={productList}
              myProjectsList={myProjectsList}
              onNavigate={selectDashboardSection}
            />
          </>
        )}

        {activeId === 'laborServices' && isLaborSupplier && (
          <LaborServicesSection services={laborServiceList} trades={laborTrades} onChanged={refreshLaborData} />
        )}

        {activeId === 'laborAssignments' && isLaborSupplier && (
          <LaborAssignmentsSection requests={laborRequestList} services={laborServiceList} refreshKey={laborRefreshKey} />
        )}

        {activeId === 'requests' && isEquipmentSupplier && (
          <>
            {/* productCount only drives the Material "add products" hint. */}
            <SupplierDashboardHero
              user={userShell}
              profile={supplierProfileDetails}
              productCount={1}
              subtitle={t('equipment.supplier.heroSub')}
            />
            <EquipmentSupplierStatsGrid items={equipmentItemList} requests={equipmentRequestList} onSelect={selectDashboardSection} />
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-extrabold text-graphite">{t('equipment.supplier.pendingTitle')}</h2>
                <button type="button" onClick={() => selectDashboardSection('incomingRequests')} className="inline-flex items-center gap-1 text-xs font-extrabold text-brand-800 hover:underline">
                  {t('ui.requests')} <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
                </button>
              </div>
              <EquipmentRequestsSection compact requests={equipmentRequestList} onChanged={refreshEquipmentData} />
            </section>
            <SupplierRecentSection
              parts={['requests']}
              requestList={requestList}
              materialRequestList={materialRequestList}
              productList={productList}
              myProjectsList={myProjectsList}
              onNavigate={selectDashboardSection}
            />
          </>
        )}

        {activeId === 'equipmentInventory' && isEquipmentSupplier && (
          <EquipmentInventorySection items={equipmentItemList} onChanged={refreshEquipmentData} />
        )}

        {activeId === 'equipmentAssignments' && isEquipmentSupplier && (
          <EquipmentAssignmentsSection requests={equipmentRequestList} onChanged={refreshEquipmentData} refreshKey={equipmentRefreshKey} />
        )}

        {activeId === 'requests' && !isLaborSupplier && !isEquipmentSupplier && (
          <>
            <SupplierDashboardHero
              user={userShell}
              profile={supplierProfileDetails}
              productCount={productList.filter((product) => product.is_published !== false).length}
            />
            <SupplierStatsGrid requestList={requestList} clientList={discoverableClients} productList={productList} onSelect={selectDashboardSection} />
            {/* While typing in the top search on the Dashboard itself, show where
                those requests, projects and clients live, and jump to them. */}
            {searchText && (() => {
              const resultRequests = requestList
                .filter((request) => matchesSearch(request.profile_name, request.sender_name, request.project_title, request.status))
                .slice(0, 6)
              const resultProjects = myProjectsList
                .filter((project) => matchesSearch(project.title, project.requester?.name))
                .slice(0, 6)
              const resultClients = discoverableClients
                .filter((client) => matchesSearch(client.name, client.company_name, client.project_title, client.pincode))
                .slice(0, 6)
              const foundCount = resultRequests.length + resultProjects.length + resultClients.length
              const statusKey = (status) => (
                { pending: 'ui.status.pending', accepted: 'ui.requests.accepted', rejected: 'ui.requests.rejected', withdrawn: 'ui.shared.statusWithdrawn' }[String(status || '').toLowerCase()]
              )
              const ResultRow = ({ icon: RowIcon, tileClass, title, sub, onClick }) => (
                <button
                  type="button"
                  onClick={onClick}
                  className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-100 bg-white px-3 py-2 text-left transition hover:-translate-y-0.5 hover:border-[rgba(8,62,43,.22)] hover:bg-[linear-gradient(180deg,#f9c85f_0%,#f4b740_52%,#e9a92f_100%)] hover:shadow-[0_14px_30px_-20px_rgba(23,32,28,0.35)]"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ${tileClass}`}><RowIcon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-extrabold text-graphite">{title}</span>
                    {sub && <span className="block truncate text-[11px] font-semibold text-graphite/55">{sub}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-graphite/40 transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
                </button>
              )
              const resultGroup = (label, list, renderRow) => list.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-graphite/45">{label} · {list.length}</p>
                  <div className="grid gap-1.5 sm:grid-cols-2">{list.map(renderRow)}</div>
                </div>
              )
              return (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
                  <p className="mb-3 flex items-center gap-2 font-display text-[15px] font-extrabold text-graphite">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Search className="h-4 w-4" /></span>
                    {t('dash.supplier.searchResults', { query: searchQuery })}
                  </p>
                  {foundCount > 0 ? (
                    <div className="space-y-3">
                      {resultGroup(t('ui.requests'), resultRequests, (request) => {
                        const statusLabelKey = statusKey(request.status)
                        return (
                          <ResultRow
                            key={`req-${request.id}`}
                            icon={Building2}
                            tileClass="bg-sky-50 text-sky-700 ring-sky-200"
                            title={td(request.profile_name || request.sender_name)}
                            sub={`${td(request.project_title || '')}${statusLabelKey ? ` · ${t(statusLabelKey)}` : ''}`}
                            onClick={() => selectDashboardSection('incomingRequests')}
                          />
                        )
                      })}
                      {resultGroup(t('ui.myProjects'), resultProjects, (project) => (
                        <ResultRow
                          key={`project-${project.project_id}`}
                          icon={FolderKanban}
                          tileClass="bg-emerald-50 text-emerald-700 ring-emerald-200"
                          title={td(project.title)}
                          sub={td(project.requester?.name)}
                          onClick={() => selectDashboardSection('myProjects')}
                        />
                      ))}
                      {resultGroup(t('ui.findClients'), resultClients, (client) => (
                        <ResultRow
                          key={`client-${client.type}-${client.user_id}`}
                          icon={client.type === 'OWNER' ? Home : Building2}
                          tileClass="bg-amber-50 text-amber-700 ring-amber-200"
                          title={td(client.name || client.company_name)}
                          sub={client.type === 'OWNER' ? (client.project_title ? td(client.project_title) : t('role.owner')) : t('role.builder')}
                          onClick={() => selectDashboardSection('findClients')}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-slate-50/70 px-3 py-6 text-center text-xs font-semibold text-graphite/45">
                      {t('dash.supplier.noSearchResults', { query: searchQuery })}
                    </p>
                  )}
                </section>
              )
            })()}
            {/* Recent Activity, Top Products and Quick Actions, then Recent
                Requests beside Sales Overview. The same panels, laid out here. */}
            <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
              <div className="lg:col-span-2 xl:col-span-1 [&>div]:h-full">
                <SupplierRecentSection
                  parts={['activity']}
                  requestList={requestList}
                  materialRequestList={materialRequestList}
                  productList={productList}
                  myProjectsList={myProjectsList}
                  onNavigate={selectDashboardSection}
                />
              </div>
              <SupplierAnalyticsDashboard
                parts={['top', 'actions']}
                orders={materialRequestList}
                onNavigate={selectDashboardSection}
                // Add New Product: the Products page with its add form open, as its own Add button does.
                onAddProduct={() => { selectDashboardSection('products'); setProductUpdateMessage(''); setShowListingForm(true) }}
              />
            </section>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <SupplierRecentSection
                parts={['requests']}
                requestList={requestList}
                materialRequestList={materialRequestList}
                productList={productList}
                myProjectsList={myProjectsList}
                onNavigate={selectDashboardSection}
              />
              <SupplierAnalyticsDashboard parts={['sales']} orders={materialRequestList} onNavigate={selectDashboardSection} />
            </section>
          </>
        )}

        {activeId === 'incomingRequests' && (() => {
          // All is the default view — every request, both House Owner and
          // Builder — and the user can switch between All, House Owner or
          // Builder at any time.
          const tabs = [
            { id: 'all', label: t('dash.contractor.filter.all'), list: requestList.filter((request) => matchesSearch(request.profile_name, request.sender_name, request.project_title, request.status)) },
            { id: 'owner', label: t('role.owner'), list: ownerRequestList.filter((request) => matchesSearch(request.profile_name, request.sender_name, request.project_title, request.status)) },
            { id: 'builder', label: t('role.builder'), list: builderRequestList.filter((request) => matchesSearch(request.profile_name, request.sender_name, request.project_title, request.status)) },
          ]
          const active = tabs.find((tab) => tab.id === supplierRequestTab) || tabs[0]
          // "N new": the requests of that kind not yet opened, by id.
          const pendingPurchases = requestInbox.unreadIn('purchase')
          const pendingClients = requestInbox.unreadIn('client')
          // A Labor or Equipment Supplier has its own requests where a Material
          // Supplier has buyers' purchases.
          const kinds = [
            isLaborSupplier
              ? { id: 'purchase', label: t('labor.supplier.requestsKind'), count: pendingPurchases }
              : isEquipmentSupplier
                ? { id: 'purchase', label: t('equipment.supplier.requestsKind'), count: pendingPurchases }
                : { id: 'purchase', label: 'Purchase Requests', count: pendingPurchases },
            { id: 'client', label: 'Client Requests', count: pendingClients },
          ]
          const kindStrip = (
            <div role="tablist" aria-label="Request type" className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
              {kinds.map((kind) => {
                const isActive = requestKind === kind.id
                return (
                  <button
                    key={kind.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setRequestKind(kind.id)}
                    className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-extrabold transition ${isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/60 hover:bg-slate-50 hover:text-graphite'}`}
                  >
                    {kind.label}
                    {kind.count > 0 && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-oc-amber text-graphite'}`}>{kind.count} new</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
          if (requestKind === 'purchase' && isEquipmentSupplier) {
            return (
              <section className="space-y-3">
                {kindStrip}
                <EquipmentRequestsSection requests={equipmentRequestList} onChanged={refreshEquipmentData} />
              </section>
            )
          }
          if (requestKind === 'purchase' && isLaborSupplier) {
            return (
              <section className="space-y-3">
                {kindStrip}
                <LaborRequestsSection requests={laborRequestList} services={laborServiceList} onChanged={refreshLaborData} />
              </section>
            )
          }
          if (requestKind === 'purchase') {
            return (
              <section className="space-y-3">
                {kindStrip}
                <SupplierPurchaseRequests country={user?.country_of_residence || 'India'} onChanged={setMaterialRequestList} />
              </section>
            )
          }
          return (
            <section className="space-y-3">
              {kindStrip}
              {/* One white block: the All, House Owner and Builder titles sit
                  directly next to each other, and the Card/Table switch rides
                  at the right end of the same strip. */}
              <div className="flex overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5">
                {tabs.map((tab) => {
                  const isActive = active.id === tab.id
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSupplierRequestTab(tab.id)}
                      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-extrabold transition ${
                        isActive ? 'bg-brand-700 text-white shadow-sm' : 'text-graphite/55 hover:bg-slate-50 hover:text-graphite'
                      }`}
                    >
                      {tab.label}
                      {tab.list.length > 0 && (
                        <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${isActive ? 'bg-white/20 text-white' : 'bg-brand-50 text-brand-700'}`}>
                          {tab.list.length}
                        </span>
                      )}
                    </button>
                  )
                })}
                {/* Same control the Products table uses, sized to sit beside the
                    tabs inside the strip. */}
                <div className="ml-auto flex shrink-0 items-center gap-1 rounded-xl bg-slate-100 p-1">
                  <button type="button" onClick={() => setRequestViewMode('table')} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition ${requestViewMode === 'table' ? 'bg-white text-graphite shadow-sm' : 'text-graphite/55 hover:text-graphite'}`}><LayoutList className="h-3.5 w-3.5" />{t('dash.supplier.table')}</button>
                  <button type="button" onClick={() => setRequestViewMode('cards')} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition ${requestViewMode === 'cards' ? 'bg-white text-graphite shadow-sm' : 'text-graphite/55 hover:text-graphite'}`}><LayoutGrid className="h-3.5 w-3.5" />{t('dash.supplier.cards')}</button>
                </div>
              </div>
              {active.list.length ? (
                <SupplierRequestsSection
                  requestMessage={requestMessage}
                  requestList={active.list}
                  viewMode={requestViewMode}
                  onViewModeChange={setRequestViewMode}
                  onAccept={acceptSupplierRequest}
                  onReject={rejectSupplierRequest}
                  onWithdraw={withdrawSupplierRequest}
                  onOpen={setSelectedRequestProfile}
                />
              ) : (
                <EmptyState
                  icon={ClipboardList}
                  title={t('ui.requests.noRequests')}
                  message={t('dash.supplier.requestsSub')}
                />
              )}
            </section>
          )
        })()}

        {activeId === 'findClients' && (
          <SupplierFindClientsSection
            clientList={discoverableClients.filter((client) => matchesSearch(client.name, client.company_name, client.project_title, client.pincode))}
            requestList={requestList.filter((request) => matchesSearch(request.profile_name, request.sender_name, request.project_title, request.status))}
            requestMessage={requestMessage}
            sendingReceiverId={sendingReceiverId}
            sentRequestKeys={sentRequestKeys}
            onSendRequest={sendSupplierClientRequest}
            onAcceptRequest={acceptSupplierRequest}
            onRejectRequest={rejectSupplierRequest}
            onViewProfile={setSelectedClientProfile}
          />
        )}

        {activeId === 'myProjects' && (
          <SupplierMyProjects
            projectList={myProjectsList.filter((project) => matchesSearch(project.title, project.requester?.name, project.status))}
            materialRequestList={materialRequestList}
          />
        )}

        {activeId === 'products' && (
          <div className="space-y-2">
            {showListingForm && <div className="mx-auto w-full max-w-4xl">
              <SupplierCatalogPicker
                onAdded={(listing, note) => {
                  setProductList((items) => [listing, ...items])
                  setProductUpdateMessage(note || `${listing.name} added to your catalog.`)
                  // Back to the product list: close the form, then re-read the
                  // list from the server so it matches what was saved.
                  setShowListingForm(false)
                  fetchSupplierProducts().then(setProductList).catch(() => {})
                }}
              />
            </div>}
              {!showListingForm && (
                <SupplierStorefront
                  productList={productList}
                  message={productUpdateMessage}
                  pincode={user?.pincode || supplierProfileDetails?.pincode || ''}
                  onUpdateProduct={updateProductListing}
                  onDeleteProduct={deleteProductListing}
                />
              )}
          </div>
        )}

        {activeId === 'messages' && <MessageThread />}
        {activeId === 'profile' && (
          <>
            <SupplierProfilePanel
              profile={supplierProfileDetails ? { ...supplierProfileDetails, email: user?.email ?? supplierProfileDetails.email, phone: user?.phone ?? supplierProfileDetails.phone, profile_image_url: profileImagePreview || supplierProfileDetails.profile_image_url, store_logo_url: storeLogoPreview || supplierProfileDetails.store_logo_url } : supplierProfileDetails}
              errorMessage={supplierProfileError}
              uploadMessage={profileImageMessage}
              onProfileImageUpload={(file) => uploadSupplierProfileImage(file).catch((error) => setProfileImageMessage(profileErrorMessage(error, t('dash.common.profileImageUploadFailed'))))}
              onStoreLogoUpload={(file) => uploadSupplierStoreLogo(file).catch((error) => setProfileImageMessage(profileErrorMessage(error, t('dash.supplier.msg.storeLogoUploadFailed'))))}
              // Handed over unwrapped on purpose. The panel needs the rejection
              // to keep the editor open, mark the refused fields and scroll to
              // the first one; catching it here reported a refused save as a
              // saved one, and put the error object itself into a message that
              // is rendered — which is what blanked the page.
              onSaveProfile={saveSupplierProfileChanges}
            />
            <PhoneChangeSection />
            <EmailVerificationSection />
            <DeleteAccountSection />
          </>
        )}
        {selectedRequestProfile && (
          // The counterparty view the messages module already uses for a request.
          // can_view_contact comes from the API, so phone and email appear only
          // when the server judged the relationship accepted.
          <RequestProfileDashboard
            details={selectedRequestProfile}
            canViewContact={Boolean(selectedRequestProfile.can_view_contact)}
            onClose={() => setSelectedRequestProfile(null)}
          />
        )}
        {selectedClientProfile && (
          <ClientProfileModal
            client={selectedClientProfile}
            requestSent={Boolean(sentRequestKeys[`${selectedClientProfile.type}-${selectedClientProfile.user_id}-${selectedClientProfile.project_id || 'profile'}`])}
            sending={sendingReceiverId === selectedClientProfile.user_id}
            onClose={() => setSelectedClientProfile(null)}
            onSendRequest={sendSupplierClientRequest}
          />
        )}
        </>)}
      </DashboardShell>
      <NewRequestToast inbox={requestInbox} onOpen={openRequestsFromToast} />
      {showHelp && <HelpCenterModal onClose={() => setShowHelp(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  )
}
