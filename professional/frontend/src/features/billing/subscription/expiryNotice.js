import { EXPIRY_WARNING_SEEN_PREFIX } from './subscriptionFormat.js'

// The builder's Plan & Billing page (ContractorDashboard NAV_PATHS.subscription).
export const PLAN_BILLING_PATH = '/contractor/subscription'

// The server's plan-expiry reminder (entitlements.PLAN_REMINDER_TITLE), and the
// titles earlier reminders were stored under. All are ACCOUNT notifications.
const PLAN_REMINDER_TITLES = [/^Your plan expires soon$/, /^Your plan expires within \d+ days?$/, /^Your plan renews soon$/]

/** Whether a notification is the builder's plan-expiry reminder (opens Plan & Billing). */
export function isPlanExpiryNotice(notification) {
  if (!notification || notification.category !== 'ACCOUNT') return false
  const title = String(notification.title || '').trim()
  return PLAN_REMINDER_TITLES.some((pattern) => pattern.test(title))
}

/** Forgets every "expiry popup already shown" mark, so the next login shows it again. */
export function forgetSeenWarnings(storage) {
  try {
    const keys = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && key.startsWith(EXPIRY_WARNING_SEEN_PREFIX)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch {
    /* storage unavailable: nothing was remembered either */
  }
}
