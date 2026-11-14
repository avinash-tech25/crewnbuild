/**
 * The Store Manager dashboard: an Engineer account (role ENGINEER) in the Store
 * Manager category. AppRouter opens it for that combination only, and every
 * /store-manager API checks the same thing on the server.
 *
 * As on the Engineer dashboard, the address says which section is open, so a
 * refresh, Back and a pasted link all land where they should.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import { Boxes, ClipboardCheck, ClipboardList, HardHat, LayoutGrid, LifeBuoy, MessageSquare, PackageCheck, Settings, ShoppingCart, Wallet } from 'lucide-react'
import LocationLeadsPrompt, { useLocationLeadsPrompt } from '../../../shared/ui/LocationLeadsPrompt.jsx'
import DashboardShell from '../../../shared/dashboard/DashboardShell.jsx'
import DeleteAccountSection from '../../accounts/components/DeleteAccountSection.jsx'
import EmailVerificationSection from '../../accounts/components/EmailVerificationSection.jsx'
import MessageThread from '../../messaging/components/MessageThread.jsx'
import PhoneChangeSection from '../../accounts/components/PhoneChangeSection.jsx'
import { useLatestOnly, useLiveRefresh } from '../../../shared/hooks/useLiveRefresh.js'
import { profileErrorMessage } from '../../../shared/hooks/useProfileFormErrors.js'
import { useProfileGate } from '../../../shared/hooks/useProfileGate.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { logoutUser, setAuthenticatedUser } from '../../../shared/auth/authSlice.js'
import { completeUserProfile, updateUserProfileImage } from '../../auth/authApi.js'
import { fetchEngineerTeam } from '../../engineers/engineersApi.js'
import { fetchNotifications, markNotificationsRead } from '../../notifications/notificationsApi.js'
import { fetchNearbyContractors } from '../../projects/projectsApi.js'
import { fetchStoreItems, fetchStoreOverview, fetchStorePayments, fetchStoreProjects, fetchStorePurchases, fetchStoreRequests } from '../storeManagerApi.js'
import { uploadLocalFile } from '../../../shared/api/uploadApi.js'
import { assertProfileImage } from '../../../shared/utils/profileImageRules.js'
import { HelpCenterModal, FeedbackModal } from '../../support/components/SupportModals.jsx'
import { EngineerNotificationsSection, EngineerProfileSection } from '../../engineer/components/EngineerSections.jsx'
import StoreBuildersSection from '../components/StoreBuildersSection.jsx'
import StoreBuySection from '../components/StoreBuySection.jsx'
import StoreCatalogSection from '../components/StoreCatalogSection.jsx'
import StoreOverviewSection from '../components/StoreOverviewSection.jsx'
import StorePaymentsSection from '../components/StorePaymentsSection.jsx'
import StoreRequestsSection from '../components/StoreRequestsSection.jsx'
import WeatherNavButton from '../../weather/components/WeatherNavButton.jsx'

const NAV_PATHS = {
  dashboard: '/store-manager',
  catalog: '/store-manager/catalog',
  buy: '/store-manager/buy',
  payments: '/store-manager/payments',
  requests: '/store-manager/requests',
  approvals: '/store-manager/approvals',
  builders: '/store-manager/builders',
  messages: '/store-manager/messages',
  notifications: '/store-manager/notifications',
  profile: '/store-manager/profile',
}

const SECTION_BY_SEGMENT = Object.fromEntries(
  Object.entries(NAV_PATHS).map(([section, path]) => [path.replace(/^\/store-manager\/?/, ''), section]),
)

function sectionFromPath(pathname) {
  const [segment] = pathname.replace(/^\/store-manager\/?/, '').split('/').filter(Boolean)
  return SECTION_BY_SEGMENT[segment || ''] || 'dashboard'
}

export default function StoreManagerDashboard() {
  const { user } = useSelector((state) => state.auth)
  const { t, td, setCountry } = useLanguage()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { requireCompleteProfile } = useProfileGate()
  const activeId = useMemo(() => sectionFromPath(location.pathname), [location.pathname])
  const setActiveId = useCallback((sectionId) => {
    navigate(NAV_PATHS[sectionId] || NAV_PATHS.dashboard)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [navigate])

  const [searchQuery, setSearchQuery] = useState('')
  const [overview, setOverview] = useState(null)
  const [items, setItems] = useState([])
  const [requests, setRequests] = useState([])
  const [purchases, setPurchases] = useState([])
  const [payments, setPayments] = useState([])
  // Which of these lists failed to load: shown as an error, never as an empty list.
  const [loadErrors, setLoadErrors] = useState({})
  // "Purchase missing stock" from a request: what Buy opens with (request, product, quantity).
  const [buyPrefill, setBuyPrefill] = useState(null)
  const [projects, setProjects] = useState([])
  const [teams, setTeams] = useState([])
  const [incomingRequests, setIncomingRequests] = useState([])
  const [contractors, setContractors] = useState([])
  const [notifications, setNotifications] = useState([])
  const [profileSaveMessage, setProfileSaveMessage] = useState('')
  const [profileSaveError, setProfileSaveError] = useState('')
  const [profileImageMessage, setProfileImageMessage] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const country = user?.country_of_residence || 'India'
  const locationPrompt = useLocationLeadsPrompt(user)

  useEffect(() => {
    setCountry(country)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country])

  // Latest load wins: a live refresh can overlap a load already in flight.
  const loadGuard = useLatestOnly()
  const refresh = () => {
    const isLatest = loadGuard()
    const flag = (key, failed) => setLoadErrors((current) => (Boolean(current[key]) === failed ? current : { ...current, [key]: failed }))
    const load = (request, apply, key) => request
      .then((data) => { if (isLatest()) { apply(data); if (key) flag(key, false) } })
      .catch(() => { if (key && isLatest()) flag(key, true) })
    load(fetchStoreOverview(), setOverview)
    load(fetchStoreItems(), setItems)
    load(fetchStoreRequests(), setRequests, 'requests')
    load(fetchStorePurchases(), setPurchases, 'purchases')
    load(fetchStorePayments(), setPayments, 'payments')
    load(fetchStoreProjects(), setProjects)
    load(fetchEngineerTeam(), (data) => { setTeams(data.teams || []); setIncomingRequests(data.incoming_requests || []) })
    load(fetchNotifications(), setNotifications)
    if (user?.pincode) load(fetchNearbyContractors(user.pincode, country), setContractors)
  }
  useLiveRefresh(refresh)
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.pincode])

  // Restricted actions ask for Complete Profile first; the server refuses them too.
  const guard = () => requireCompleteProfile('storeManagerAction')

  const pendingCount = requests.filter((request) => request.status === 'PENDING').length
  // Approved and still owed products (nothing handed over yet, or the rest of it).
  const approvedCount = requests.filter((request) => ['APPROVED', 'PARTIALLY_ISSUED'].includes(request.status)).length
  // Supplier deliveries accepted but not yet marked received: their goods are not
  // in the Catalog (nor offered to Site Engineers) until the Store Manager does so.
  const awaitingReceipt = purchases.reduce((count, order) => count + order.lines.filter((line) => line.can_receive).length, 0)
  // Receiving is done under Buy → Purchase History.
  const openPurchases = () => {
    navigate(`${NAV_PATHS.buy}/history`)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  const nav = [
    { id: 'dashboard', label: t('ui.dashboard'), icon: LayoutGrid, bareIcon: true },
    { id: 'catalog', label: t('store.nav.catalog'), icon: Boxes, bareIcon: true },
    { id: 'buy', label: t('store.nav.buy'), icon: ShoppingCart, bareIcon: true },
    { id: 'payments', label: t('store.nav.payments'), icon: Wallet, bareIcon: true },
    { id: 'requests', label: t('store.nav.requests'), icon: ClipboardList, bareIcon: true, badge: pendingCount || undefined },
    { id: 'approvals', label: t('store.nav.approvals'), icon: ClipboardCheck, bareIcon: true, badge: approvedCount || undefined },
    { id: 'builders', label: t('store.nav.builders'), icon: HardHat, bareIcon: true },
  ]
  const userMenu = [
    { id: 'profileSettings', label: t('ui.profileSettings'), icon: Settings },
    { id: 'helpFeedback', label: t('ui.helpFeedback'), icon: LifeBuoy },
  ]
  const userShell = useMemo(() => ({
    name: td(user?.name || '') || t('ui.profile.engCat.storeManager'),
    initials: (user?.name || '').trim().slice(0, 2).toUpperCase() || t('ui.profile.engCat.storeManager').trim().slice(0, 1),
    profileImageUrl: user?.profile_image_url || '',
  }), [user, t, td])

  const logout = () => {
    dispatch(logoutUser())
    navigate('/login')
  }

  const saveProfile = async (form) => {
    setProfileSaveMessage('')
    setProfileSaveError('')
    try {
      const updatedUser = await completeUserProfile({ ...form, experience_years: Number(form.experience_years || 0), profile_image_url: user?.profile_image_url || '' })
      dispatch(setAuthenticatedUser({ user: updatedUser }))
      setProfileSaveMessage(t('dash.engineer.msg.profileSaved'))
    } catch (error) {
      setProfileSaveError(profileErrorMessage(error, t('dash.engineer.msg.unableSaveProfile')))
      throw error
    }
  }

  const uploadProfileImage = async (file) => {
    if (!file) return
    setProfileImageMessage('')
    try {
      assertProfileImage(file, t)
      const uploadedFile = await uploadLocalFile(file)
      dispatch(setAuthenticatedUser({ user: await updateUserProfileImage(uploadedFile.url) }))
      setProfileImageMessage(t('dash.engineer.msg.profilePhotoUpdated'))
    } catch (error) {
      setProfileImageMessage(error?.userMessage || t('dash.engineer.msg.profilePhotoFailed'))
    }
  }

  const markAllNotificationsRead = async () => {
    await markNotificationsRead()
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })))
  }

  return (
    <div className="dash-canvas">
      <DashboardShell
        plainBackground
        sidebarItems={nav}
        activeId={activeId}
        onNav={setActiveId}
        user={userShell}
        roleLabel={t('ui.profile.engCat.storeManager')}
        onLogout={logout}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('store.searchPlaceholder')}
        userMenu={userMenu}
        onUserMenuSelect={(menuId) => {
          if (menuId === 'profileSettings') setActiveId('profile')
          if (menuId === 'helpFeedback') setShowHelp(true)
        }}
        onMessagesClick={setActiveId}
        // No onNotificationsClick: the bell opens its own list and shows a notification
        // in full there, as on every other dashboard, instead of leaving this page.
        defaultTab="dashboard"
        beforeLanguage={<WeatherNavButton />}
        breadcrumbReplacement={<span aria-hidden="true" />}
      >
        {(activeId === 'dashboard' || activeId === 'catalog') && awaitingReceipt > 0 && (
          <div role="status" className="mb-3 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block font-extrabold text-amber-900">{t('store.receipts.waiting', { count: awaitingReceipt })}</span>
              <span className="block font-semibold text-amber-800">{t('store.receipts.waitingSub')}</span>
            </span>
            <button type="button" onClick={openPurchases} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-extrabold text-white transition hover:bg-amber-700">
              <PackageCheck className="h-3.5 w-3.5" /> {t('store.receipts.open')}
            </button>
          </div>
        )}
        {activeId === 'dashboard' && <StoreOverviewSection overview={overview} requests={requests} purchases={purchases} country={country} onNav={setActiveId} userShell={userShell} />}
        {activeId === 'catalog' && <StoreCatalogSection items={items} projects={projects} searchQuery={searchQuery} country={country} guard={guard} onChanged={refresh} />}
        {activeId === 'buy' && <StoreBuySection projects={projects} purchases={purchases} purchasesFailed={Boolean(loadErrors.purchases)} searchQuery={searchQuery} country={country} guard={guard} onChanged={refresh} prefill={buyPrefill} onPrefillUsed={() => setBuyPrefill(null)} onBackToRequest={(section) => setActiveId(section)} />}
        {activeId === 'payments' && <StorePaymentsSection overview={overview} purchases={purchases} payments={payments} country={country} guard={guard} onChanged={refresh} loadFailed={loadErrors} />}
        {(activeId === 'requests' || activeId === 'approvals') && <StoreRequestsSection mode={activeId} requests={requests} loadFailed={Boolean(loadErrors.requests)} country={country} guard={guard} onChanged={refresh} onBuy={(prefill) => { setBuyPrefill({ ...prefill, backTo: activeId }); setActiveId('buy') }} />}
        {activeId === 'builders' && <StoreBuildersSection teams={teams} incomingRequests={incomingRequests} contractors={contractors} defaultPincode={user?.pincode} country={country} guard={guard} onChanged={refresh} />}
        {activeId === 'messages' && (
          <div className="contractor-messages-dark space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-brand-600" />
              <h2 className="font-display text-base font-extrabold text-graphite">{t('ui.messages')}</h2>
            </div>
            <MessageThread />
          </div>
        )}
        {activeId === 'notifications' && <EngineerNotificationsSection notifications={notifications} onMarkAllRead={markAllNotificationsRead} />}
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

      {locationPrompt.open && (
        <LocationLeadsPrompt
          open
          currentPincode={user?.pincode || ''}
          onDismiss={locationPrompt.dismissPrompt}
          onSaved={(updatedUser) => { dispatch(setAuthenticatedUser({ user: updatedUser })); locationPrompt.finishPrompt() }}
        />
      )}
      {showHelp && <HelpCenterModal onClose={() => setShowHelp(false)} />}
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </div>
  )
}
