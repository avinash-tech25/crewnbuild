import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

export const notificationsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    notifications: build.query({ query: () => ({ url: '/notifications' }) }),
    markAllRead: build.mutation({ query: () => ({ url: '/notifications/read-all', method: 'POST' }) }),
    markOneRead: build.mutation({ query: (notificationId) => ({ url: `/notifications/${notificationId}/read`, method: 'POST' }) }),
    markGroupRead: build.mutation({ query: (params) => ({ url: '/notifications/read-module', method: 'POST', params }) }),
  }),
})

const { endpoints } = notificationsApi

export const fetchNotifications = () => runQuery(endpoints.notifications)
export const markNotificationsRead = () => runMutation(endpoints.markAllRead)
// Marks one notification read (opened in the bell).
export const markNotificationRead = (notificationId) => runMutation(endpoints.markOneRead, notificationId)
export const markModuleNotificationsRead = (moduleName) => runMutation(endpoints.markGroupRead, { module: moduleName })
// Marks unread notifications of these explicit categories (notification.category) read.
export const markCategoryNotificationsRead = (categories) => runMutation(endpoints.markGroupRead, { category: categories.join(',') })
