import { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, Check, ExternalLink } from 'lucide-react'
import { fetchNotifications, markNotificationRead, markNotificationsRead } from '../notificationsApi.js'
import { playGatedNotificationSound, unlockNotificationAudio } from '../../../shared/utils/notificationSounds.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import { PLAN_BILLING_PATH, isPlanExpiryNotice } from '../../billing/subscription/expiryNotice.js'
import { STORE_MANAGER_PATH, isStoreManager } from '../../../shared/auth/accountPaths.js'

// Display names for the module codes the API infers for each notification.
// The code itself is still what routing below compares against.
const MODULE_KEYS = {
  message: 'ui.shared.moduleMessage',
  request: 'dash.common.request',
  project: 'dash.common.project',
  supplier: 'dash.common.supplier',
  contractor: 'ui.shared.moduleContractor',
  estimate: 'ui.shared.moduleEstimate',
  escrow: 'ui.escrow',
  engineers: 'ui.shared.moduleEngineers',
  general: 'dash.owner.requests.general',
  adverts: 'ui.shared.moduleAdverts',
}

// Display names for the explicit categories. A notification without one keeps
// its module label above.
const CATEGORY_KEYS = {
  MATERIAL: 'ui.shared.categoryMaterial',
  LABOR: 'ui.shared.categoryLabor',
  EQUIPMENT: 'ui.shared.categoryEquipment',
  ENGINEER: 'ui.shared.categoryEngineer',
  PROJECT: 'dash.common.project',
  NEGOTIATION: 'ui.shared.categoryNegotiation',
  ASSIGNMENT: 'ui.shared.categoryAssignment',
  SUPPLIER: 'dash.common.supplier',
  PROPERTY: 'ui.shared.categoryProperty',
  ACCOUNT: 'ui.shared.categoryAccount',
  ANNOUNCEMENT: 'ui.shared.categoryAnnouncement',
}
const notificationLabel = (notification, t, td) => {
  if (notification.category && CATEGORY_KEYS[notification.category]) return t(CATEGORY_KEYS[notification.category])
  return MODULE_KEYS[notification.module] ? t(MODULE_KEYS[notification.module]) : td(notification.module)
}

// The desktop notification carries the same two lines the dropdown shows, so it
// is translated the same way: the backend writes both in English.
function showBrowserNotification(notification, td) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  new Notification(td(notification.title), { body: td(notification.body) })
}

export default function NotificationBell({ onOpen = null }) {
  const { user } = useSelector((state) => state.auth)
  // Which signed-in account the bell is polling for (the session itself is an
  // HttpOnly cookie); a different account starts the list afresh.
  const sessionKey = user?.id || null
  const { t, td } = useLanguage()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  // The notification opened in the dropdown: shown in full there, no navigation.
  const [selectedId, setSelectedId] = useState(null)
  const [notificationList, setNotificationList] = useState([])
  const [pollingEnabled, setPollingEnabled] = useState(true)
  const initializedRef = useRef(false)
  const knownNotificationIdsRef = useRef(new Set())

  const unreadCount = notificationList.filter((notification) => !notification.is_read).length

  const loadNotifications = async () => {
    if (!sessionKey || !pollingEnabled) {
      setNotificationList([])
      return
    }

    const nextNotifications = await fetchNotifications().catch((error) => {
      if (error.response?.status === 401) {
        setPollingEnabled(false)
      }
      return null
    })
    // A failed refresh keeps the list already shown instead of emptying it.
    if (nextNotifications === null) return
    const dashboardNotifications = nextNotifications.filter((notification) => notification.module !== 'message')
    const nextIds = new Set(dashboardNotifications.map((notification) => notification.id))
    const newNotifications = dashboardNotifications.filter((notification) => !knownNotificationIdsRef.current.has(notification.id))

    if (initializedRef.current && newNotifications.length) {
      const newestNotification = newNotifications[0]
      // Through the shared gate: a new request's own popup may sound for the same arrival.
      playGatedNotificationSound(newestNotification.module)
      showBrowserNotification(newestNotification, td)
    }

    knownNotificationIdsRef.current = nextIds
    initializedRef.current = true
    setNotificationList(dashboardNotifications)
  }

  const toggleNotifications = async () => {
    setIsOpen((currentValue) => !currentValue)
    setSelectedId(null)
    unlockNotificationAudio().catch(() => {})
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    await loadNotifications()
  }

  const closeAll = () => {
    setIsOpen(false)
    setSelectedId(null)
  }

  const selected = notificationList.find((notification) => notification.id === selectedId) || null

  const markOneAsRead = async (notification) => {
    if (!sessionKey || !pollingEnabled || notification.is_read) return
    // Shown read at once; the reload confirms it (and the unread count) from the server.
    setNotificationList((current) => current.map((item) => (item.id === notification.id ? { ...item, is_read: true } : item)))
    await markNotificationRead(notification.id).catch((error) => {
      if (error.response?.status === 401) setPollingEnabled(false)
    })
    await loadNotifications()
  }

  const markAllAsRead = async () => {
    if (!sessionKey || !pollingEnabled) return
    await markNotificationsRead().catch((error) => {
      if (error.response?.status === 401) {
        setPollingEnabled(false)
      }
    })
    await loadNotifications()
  }

  const notificationTargetTab = (notification) => {
    const content = `${notification.title || ''} ${notification.body || ''}`.toLowerCase()
    if (user?.role === 'SUPPLIER' && content.includes('purchase request')) return 'incomingRequests'
    // A builder's assignment, its negotiation and the contract are decided in
    // the request itself, so these open the Requests board on that request.
    if (user?.role === 'BUILDER' && /assign|counter-offer|offer accepted|offer rejected|contract/.test(content)) return 'requestsBoard'
    if (content.includes('request') || content.includes('quotation') || content.includes('assignment')) return 'messages'
    if (notification.module === 'message') return 'messages'
    if (notification.module === 'project') return 'projects'
    if (notification.module === 'estimate') return 'estimates'
    if (notification.module === 'escrow') return 'escrow'
    if (notification.module === 'contractor') return user?.role === 'BUILDER' ? 'findClients' : 'contractors'
    if (notification.module === 'supplier') return user?.role === 'SUPPLIER' ? 'findClients' : 'suppliers'
    if (notification.module === 'request') return 'messages'
    return 'profile'
  }

  const dashboardPath = () => {
    if (isStoreManager(user)) return STORE_MANAGER_PATH
    if (user?.role === 'BUILDER') return '/contractor'
    if (user?.role === 'SUPPLIER') return '/supplier'
    if (user?.role === 'ENGINEER') return '/engineer'
    return '/owner'
  }

  // sessionStorage can be unavailable (private mode, blocked storage); the
  // hand-over is then skipped and the page opens on its default view.
  const remember = (key, value) => {
    try { sessionStorage.setItem(key, value) } catch { /* storage unavailable */ }
  }

  // A notification with an explicit category opens the existing screen for it.
  // Rows from before categories existed keep the text-based routing below.
  const openCategorizedNotification = (notification) => {
    const category = notification.category
    const go = (path) => { setIsOpen(false); navigate(path) }
    if (isStoreManager(user)) {
      go(category === 'MATERIAL' ? `${STORE_MANAGER_PATH}/requests` : category === 'ACCOUNT' ? `${STORE_MANAGER_PATH}/profile` : STORE_MANAGER_PATH)
      return
    }
    if (user?.role === 'ENGINEER') {
      // An assignment can be of any supplier type, so it opens the type choice.
      const hubTab = { MATERIAL: 'orders', LABOR: 'labor', EQUIPMENT: 'equipment', ASSIGNMENT: 'home' }[category]
      if (hubTab) {
        // The Suppliers hub's own tab is state, not a URL: hand it over.
        remember('crewnbuild_pending_supplier_tab', hubTab)
        window.dispatchEvent(new CustomEvent('crewnbuild_notification_open', { detail: { supplierTab: hubTab, notification } }))
        go('/engineer/my-supplies')
        return
      }
      const path = { ENGINEER: '/engineer/find-opportunities', NEGOTIATION: '/engineer/find-opportunities', PROJECT: '/engineer/my-projects', ACCOUNT: '/engineer/profile' }[category]
      go(path || '/engineer')
      return
    }
    if (user?.role === 'SUPPLIER') {
      const path = {
        MATERIAL: '/supplier/requests', LABOR: '/supplier/requests', EQUIPMENT: '/supplier/requests', SUPPLIER: '/supplier/requests',
        ASSIGNMENT: '/supplier/my-projects', PROJECT: '/supplier/find-clients', NEGOTIATION: '/supplier/find-clients',
        PROPERTY: '/supplier/messages', ACCOUNT: '/supplier/profile',
      }[category]
      go(path || '/supplier')
      return
    }
    if (user?.role === 'BUILDER') {
      // The plan-expiry reminder opens Plan & Billing; other ACCOUNT notices keep Profile Settings.
      if (isPlanExpiryNotice(notification)) {
        go(PLAN_BILLING_PATH)
        return
      }
      if (category === 'NEGOTIATION' || category === 'SUPPLIER') {
        // The Requests page opens the request this notification names.
        remember('crewnbuild_open_request_hint', `${notification.title || ''} ${notification.body || ''}`)
        go('/contractor/requests')
        return
      }
      const path = {
        ENGINEER: '/contractor/my-site-engineers', PROJECT: '/contractor/projects', ASSIGNMENT: '/contractor/projects',
        MATERIAL: '/contractor/projects', LABOR: '/contractor/projects', EQUIPMENT: '/contractor/projects',
        PROPERTY: '/contractor/messages', ACCOUNT: '/contractor/profile-settings',
      }[category]
      go(path || '/contractor')
      return
    }
    // House Owner: the existing pending-tab hand-over, resolved against the
    // owner's open project by OwnerDashboard (requests, projects, suppliers ...).
    const tab = {
      NEGOTIATION: 'requests', ENGINEER: 'requests', SUPPLIER: 'suppliers', MATERIAL: 'suppliers',
      PROJECT: 'projects', ASSIGNMENT: 'projects', LABOR: 'projects', EQUIPMENT: 'projects',
      PROPERTY: 'messages', ACCOUNT: 'profile',
    }[category]
    if (tab) {
      remember('crewnbuild_pending_dashboard_tab', tab)
      window.dispatchEvent(new CustomEvent('crewnbuild_notification_open', { detail: { tab, notification } }))
    }
    go('/owner')
  }

  const openNotification = (notification) => {
    if (notification.category) {
      openCategorizedNotification(notification)
      return
    }
    const tab = notificationTargetTab(notification)
    if (tab === 'requestsBoard') {
      // Straight to the Requests page, which opens the request for the project
      // this notification names. Going through the dashboard path would send the
      // builder back to the dashboard and leave the tab pending for later.
      remember('crewnbuild_open_request_hint', `${notification.title || ''} ${notification.body || ''}`)
      setIsOpen(false)
      navigate('/contractor/requests')
      return
    }
    remember('crewnbuild_pending_dashboard_tab', tab)
    window.dispatchEvent(new CustomEvent('crewnbuild_notification_open', { detail: { tab, notification } }))
    setIsOpen(false)
    navigate(dashboardPath())
  }

  const openRelatedPage = (notification) => {
    setSelectedId(null)
    openNotification(notification)
  }

  useEffect(() => {
    if (!sessionKey) {
      setNotificationList([])
      return undefined
    }
    setPollingEnabled(true)
    initializedRef.current = false
    knownNotificationIdsRef.current = new Set()
  }, [sessionKey])

  useEffect(() => {
    if (!sessionKey || !pollingEnabled) return undefined
    loadNotifications()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadNotifications()
    }
    const refreshOnFocus = () => loadNotifications()
    const refreshOnDemand = () => loadNotifications()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshOnFocus)
    window.addEventListener('crewnbuild_notifications_refresh', refreshOnDemand)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshOnFocus)
      window.removeEventListener('crewnbuild_notifications_refresh', refreshOnDemand)
    }
  }, [sessionKey, pollingEnabled])

  // A caller can take the bell over and send it somewhere instead of opening the
  // dropdown. The admin console does: an administrator receives no notifications
  // of their own, so the dropdown would always be empty, while the screen it
  // links to is the one they actually want.
  const showing = isOpen && !onOpen

  return (
    <div className="relative">
      <button
        onClick={onOpen || toggleNotifications}
        className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand-700 shadow-sm ring-1 ring-black/5"
        aria-label={t('dash.common.notifications')}
        aria-expanded={onOpen ? undefined : showing}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {showing && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeAll} />
          {/* On a phone the bell is not at the screen's right edge (messages and
              the avatar follow it), so a panel anchored to it ran off the left
              edge; below lg it is pinned to the viewport's right edge, and on a phone it
              spans the page gutters. */}
          <div className="absolute right-0 top-12 z-50 max-lg:fixed max-lg:right-4 max-lg:top-[60px] max-sm:left-4 max-sm:w-auto w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-brand-50 px-4 py-3">
              <p className="font-display text-sm font-bold text-graphite">{t('dash.common.notifications')}</p>
              <button onClick={markAllAsRead} className="text-xs font-bold text-brand-700">{t('dash.common.markAllRead')}</button>
            </div>
            {selected ? (
              <div className="max-h-96 overflow-y-auto px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-graphite">{td(selected.title)}</p>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700 ring-1 ring-brand-100">
                    {notificationLabel(selected, t, td)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-graphite/75">{td(selected.body)}</p>
                <p className="mt-2 text-[10px] font-semibold text-graphite/40">{formatDateTime(selected.created_at, selected.created_at)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setSelectedId(null)} className="inline-flex items-center gap-1 rounded-lg border border-brand-100 px-2.5 py-1.5 text-xs font-bold text-graphite">
                    <ArrowLeft className="h-3.5 w-3.5" />{t('dash.notif.back')}
                  </button>
                  {selected.is_read ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />{t('dash.notif.read')}</span>
                  ) : (
                    <button type="button" onClick={() => markOneAsRead(selected)} className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-2.5 py-1.5 text-xs font-bold text-white">
                      <Check className="h-3.5 w-3.5" />{t('dash.notif.markRead')}
                    </button>
                  )}
                  <button type="button" onClick={() => openRelatedPage(selected)} className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                    {t('dash.notif.open')}<ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
            <div className="max-h-96 overflow-y-auto">
              {notificationList.map((notification) => (
                <button key={notification.id} onClick={() => setSelectedId(notification.id)} className={`block w-full border-b border-brand-50 px-4 py-3 text-left ${notification.is_read ? 'bg-white' : 'bg-brand-50/70'} hover:bg-brand-50`}>
                  <div className="flex items-start justify-between gap-3">
                    {/* Title, body and — for a module nobody has named — the
                        module code itself are all written by the backend in
                        English, so they are translated for display here. */}
                    <p className="text-sm font-bold text-graphite">{td(notification.title)}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-brand-700 ring-1 ring-brand-100">
                      {notificationLabel(notification, t, td)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-graphite/60">{td(notification.body)}</p>
                  {/* A timestamp, in the reader's language. Anything the
                      formatter cannot read as a date is left exactly as it
                      arrived rather than dropped. */}
                  <p className="mt-2 text-[10px] font-semibold text-graphite/40">{formatDateTime(notification.created_at, notification.created_at)}</p>
                </button>
              ))}
              {!notificationList.length && (
                <div className="px-4 py-10 text-center">
                  <p className="font-display text-sm font-bold text-graphite">{t('dash.common.noNotifications')}</p>
                  <p className="mt-1 text-xs text-graphite/50">{t('dash.common.noNotificationsSub')}</p>
                </div>
              )}
            </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
