import { scoped } from '../../shared/api/adminScope.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

export { scoped, setViewingCountry } from '../../shared/api/adminScope.js'

/**
 * The admin console's calls. The server checks role, permission and country scope on
 * every one; the console only hides what the administrator may not use.
 *
 * Sensitive answers (verification documents, deleted accounts, user and project detail,
 * support tickets, payment history) are fetched when their screen or row is opened and
 * are not kept: `keepUnusedDataFor: 0` drops them from memory as soon as nothing reads
 * them, and nothing here is ever written to browser storage.
 */
const SENSITIVE = { keepUnusedDataFor: 0 }
const send = (method, url, data) => ({ url, method, data })

export const adminApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    identity: build.query({ query: () => ({ url: '/admin/me' }) }),
    overview: build.query({ query: (params) => ({ url: '/admin/overview', params }) }),
    users: build.query({ query: (params) => ({ url: '/admin/users', params }) }),
    userDetail: build.query({ query: (userId) => ({ url: `/admin/users/${userId}` }), ...SENSITIVE }),
    setUserActive: build.mutation({
      query: ({ userId, action, reason }) => send('POST', `/admin/users/${userId}/${action}`, { reason }),
    }),
    projects: build.query({ query: (params) => ({ url: '/admin/projects', params }) }),
    projectDetail: build.query({ query: (projectId) => ({ url: `/admin/projects/${projectId}` }), ...SENSITIVE }),
    leads: build.query({ query: (params) => ({ url: '/admin/leads', params }) }),
    administrators: build.query({ query: (params) => ({ url: '/admin/admins', params }) }),
    managerPresets: build.query({ query: () => ({ url: '/admin/manager-presets' }) }),
    createAdministrator: build.mutation({ query: (details) => send('POST', '/admin/admins', details) }),
    updateAdministrator: build.mutation({ query: ({ userId, changes }) => send('PATCH', `/admin/admins/${userId}`, changes) }),
    setAdministratorActive: build.mutation({
      query: ({ userId, action, reason }) => send('POST', `/admin/admins/${userId}/${action}`, { reason }),
    }),
    adverts: build.query({ query: (params) => ({ url: '/admin/ads', params }) }),
    advertPlacements: build.query({ query: () => ({ url: '/admin/ads/placements' }) }),
    uploadAdvertImage: build.mutation({ query: (form) => send('POST', '/admin/ads/image', form) }),
    createAdvert: build.mutation({ query: (advert) => send('POST', '/admin/ads', advert) }),
    updateAdvert: build.mutation({ query: ({ advertId, changes }) => send('PATCH', `/admin/ads/${advertId}`, changes) }),
    setAdvertStatus: build.mutation({
      query: ({ advertId, status, reason }) => send('POST', `/admin/ads/${advertId}/status`, { status, reason }),
    }),
    advertStats: build.query({ query: (advertId) => ({ url: `/admin/ads/${advertId}/stats` }) }),
    auditLog: build.query({ query: (params) => ({ url: '/admin/audit', params }) }),
    verificationQueue: build.query({ query: (params) => ({ url: '/admin/verification', params }), ...SENSITIVE }),
    decideVerification: build.mutation({ query: ({ userId, decision }) => send('POST', `/admin/verification/${userId}`, decision) }),
    reports: build.query({ query: (params) => ({ url: '/admin/reports', params }) }),
    updateReport: build.mutation({ query: ({ reportId, decision }) => send('POST', `/admin/reports/${reportId}`, decision) }),
    adminNotifications: build.query({ query: (params) => ({ url: '/admin/notifications', params }) }),
    sendAnnouncement: build.mutation({ query: (announcement) => send('POST', '/admin/notifications', announcement) }),
    deletedAccounts: build.query({ query: (params) => ({ url: '/admin/deleted-accounts', params }), ...SENSITIVE }),
    deletedAccount: build.query({ query: (id) => ({ url: `/admin/deleted-accounts/${id}` }), ...SENSITIVE }),
    coupons: build.query({ query: (params) => ({ url: '/admin/coupons', params }) }),
    createCoupon: build.mutation({ query: (coupon) => send('POST', '/admin/coupons', coupon) }),
    updateCoupon: build.mutation({ query: ({ couponId, changes }) => send('PATCH', `/admin/coupons/${couponId}`, changes) }),
    setCouponActive: build.mutation({ query: ({ couponId, active }) => send('POST', `/admin/coupons/${couponId}/status`, { active }) }),
    subscriptionPayments: build.query({ query: (params) => ({ url: '/admin/subscription-payments', params }), ...SENSITIVE }),
    subscriptionPaymentsSummary: build.query({ query: (params) => ({ url: '/admin/subscription-payments/summary', params }), ...SENSITIVE }),
  }),
})

const { endpoints } = adminApi

export const fetchAdminIdentity = () => runQuery(endpoints.identity)
export const fetchAdminOverview = () => runQuery(endpoints.overview, scoped())

export const fetchAdminUsers = (filters = {}) => runQuery(endpoints.users, scoped(filters))
export const fetchUserDetail = (userId) => runQuery(endpoints.userDetail, userId)
export const setUserActive = (userId, active, reason) =>
  runMutation(endpoints.setUserActive, { userId, action: active ? 'reactivate' : 'suspend', reason })

export const fetchAdminProjects = (filters = {}) => runQuery(endpoints.projects, scoped(filters))
export const fetchProjectDetail = (projectId) => runQuery(endpoints.projectDetail, projectId)
export const fetchMarketplaceActivity = (filters = {}) => runQuery(endpoints.leads, scoped(filters))

export const fetchAdministrators = () => runQuery(endpoints.administrators, scoped())
export const fetchManagerPresets = () => runQuery(endpoints.managerPresets)
export const createAdministrator = (details) => runMutation(endpoints.createAdministrator, details)
// Only the fields being changed are sent: an omitted key leaves that side alone, so
// editing a scope cannot quietly clear a permission grant.
export const updateAdministrator = (userId, changes) => runMutation(endpoints.updateAdministrator, { userId, changes })
export const setAdministratorActive = (userId, active, reason) =>
  runMutation(endpoints.setAdministratorActive, { userId, action: active ? 'reactivate' : 'deactivate', reason })

export const fetchAdverts = (filters = {}) => runQuery(endpoints.adverts, scoped(filters))
export const fetchAdvertPlacements = () => runQuery(endpoints.advertPlacements)
export async function uploadAdvertImage(file) {
  const form = new FormData()
  form.append('file', file)
  return (await runMutation(endpoints.uploadAdvertImage, form)).url
}
export const createAdvert = (advert) => runMutation(endpoints.createAdvert, advert)
export const updateAdvert = (advertId, changes) => runMutation(endpoints.updateAdvert, { advertId, changes })
export const setAdvertStatus = (advertId, status, reason) => runMutation(endpoints.setAdvertStatus, { advertId, status, reason })
export const fetchAdvertStats = (advertId) => runQuery(endpoints.advertStats, advertId)

export const fetchAuditLog = (filters = {}) => runQuery(endpoints.auditLog, scoped(filters))

export const fetchVerificationQueue = (state = 'PENDING') => runQuery(endpoints.verificationQueue, scoped({ state }))
export const decideVerification = (userId, decision) => runMutation(endpoints.decideVerification, { userId, decision })

export const fetchAdminReports = (filters = {}) => runQuery(endpoints.reports, scoped(filters))
export const updateReport = (reportId, decision) => runMutation(endpoints.updateReport, { reportId, decision })

export const fetchAdminNotifications = (filters = {}) => runQuery(endpoints.adminNotifications, scoped(filters))
export const sendAnnouncement = (announcement) => runMutation(endpoints.sendAnnouncement, announcement)

// Accounts deleted by their holders (read only). Scoped on the server by the
// administrator's own country; `search` matches name, mobile, email or reference.
export const fetchDeletedAccounts = (search = '') => runQuery(endpoints.deletedAccounts, search ? { q: search } : {})
export const fetchDeletedAccount = (id) => runQuery(endpoints.deletedAccount, id)

// Builder subscription coupons.
export const fetchCoupons = () => runQuery(endpoints.coupons, scoped())
export const createCoupon = (coupon) => runMutation(endpoints.createCoupon, coupon)
export const updateCoupon = (couponId, changes) => runMutation(endpoints.updateCoupon, { couponId, changes })
export const setCouponActive = (couponId, active) => runMutation(endpoints.setCouponActive, { couponId, active })

// Builder subscription payment history and collections.
export const fetchSubscriptionPayments = (query) => runQuery(endpoints.subscriptionPayments, scoped(query))
export const fetchSubscriptionPaymentsSummary = (query) => runQuery(endpoints.subscriptionPaymentsSummary, scoped(query))
