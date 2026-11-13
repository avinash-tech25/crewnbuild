// Pure helpers for the builder subscription screens. No React, no network: every
// decision here is made from the server's answer (GET /subscriptions/me and
// GET /subscriptions/plans), never from state the browser keeps on its own.

export const PLAN_ORDER = ['FREE', 'PROFESSIONAL', 'BUSINESS']
export const IN_FORCE = ['ACTIVE', 'GRACE']
// The free first month of a new builder account: the core tools only, no badge.
// Not "in force" for buying: a plan can be bought during it.
export const TRIAL = 'TRIAL'

// What the Free card lists. Calendar, photos and billing are free for the first
// month only (the server's TRIAL status); the rest are the server's feature codes.
export const FREE_FEATURE_KEYS = [
  'subscription.feature.core',
  'subscription.feature.engineerNotifications',
  'subscription.feature.freeMonth',
]

export const DURATION_MONTHS = { MONTHLY: 1, SIX_MONTHS: 6, ANNUAL: 12 }

/**
 * The selected duration's server price, explained: the total, its whole-rupee
 * monthly equivalent, and the saving against paying the same tier's MONTHLY price
 * for as many months. All in paise, all from the server's prices; null when the
 * duration has no price.
 */
export function priceBreakdown(prices, durationCode) {
  const total = prices?.[durationCode]
  if (total === null || total === undefined) return null
  const months = DURATION_MONTHS[durationCode] || 1
  const perMonth = Math.round(total / months / 100) * 100
  const monthly = prices?.MONTHLY
  const fullMonthly = months > 1 && monthly ? monthly * months : null
  const savings = fullMonthly && fullMonthly > total ? fullMonthly - total : 0
  return { total, months, perMonth, savings, percent: savings ? Math.round((savings * 100) / fullMonthly) : 0 }
}

export const planNameKey = (code) => `subscription.plan.${code || 'FREE'}`
export const planTaglineKey = (code) => `subscription.tagline.${code || 'FREE'}`
export const durationKey = (code) => `subscription.duration.${code}`
export const statusKey = (status) => `subscription.status.${status || 'NONE'}`
export const featureKey = (feature) => `subscription.feature.${feature}`
export const paymentStatusKey = (status) => `subscription.payment.${status}`

/** The badge shows only for a plan the server says is in force and premium. */
export function isPremium(status) {
  return Boolean(status && status.is_premium && IN_FORCE.includes(status.status))
}

export function hasFeature(status, feature) {
  return Boolean(status && (IN_FORCE.includes(status.status) || status.status === TRIAL) && (status.features || []).includes(feature))
}

/** Whole days left of the free month (rounded up), or null outside it. */
export function freeAccessDaysLeft(status, now = Date.now()) {
  if (!status || status.status !== TRIAL || !status.free_access_until) return null
  const end = Date.parse(status.free_access_until)
  return Number.isFinite(end) && end > now ? Math.ceil((end - now) / (24 * 60 * 60 * 1000)) : null
}

/** The free month is over and no paid plan has ever been in force. */
export function freeAccessEnded(status) {
  return Boolean(status && status.status === 'NONE' && status.free_access_until)
}

/**
 * The builder dashboard's plan banner, from the server's status:
 *   { kind: 'trial', days }  free trial running: days left + Upgrade Plan
 *   { kind: 'freeExpired' }  free trial over, never paid: Upgrade Plan
 *   { kind: 'planExpired' }  a paid plan lapsed: Renew / Upgrade Plan
 *   null                     a plan in force, or plans not sold in this region
 */
export function dashboardBanner(status, now = Date.now()) {
  if (!status || status.region_supported === false) return null
  const days = freeAccessDaysLeft(status, now)
  if (days !== null) return { kind: 'trial', days }
  if (freeAccessEnded(status)) return { kind: 'freeExpired' }
  if (status.status === 'EXPIRED') return { kind: 'planExpired' }
  return null
}

/** A house owner's calendar/photos refusal while the project's builder's access is paused. */
export function builderAccessPaused(error) {
  const detail = error?.response?.data?.detail
  return Boolean(detail && typeof detail === 'object' && detail.code === 'BUILDER_SUBSCRIPTION_EXPIRED')
}

/**
 * What a plan card's button does for this builder:
 *   'renew'      the plan in force (same-plan renewal extends it)
 *   'choose'     can be bought now
 *   'blocked'    a different paid plan is in force (switch after it ends)
 *   'unavailable' no price configured, or the region is not supported
 *   'free'       the Free tier (nothing to buy)
 */
export function planAction(planCode, status, priceForDuration, now = Date.now()) {
  if (planCode === 'FREE') return 'free'
  if (status && status.region_supported === false) return 'unavailable'
  if (priceForDuration === null || priceForDuration === undefined) return 'unavailable'
  const inForce = status && IN_FORCE.includes(status.status)
  if (inForce && status.plan_code === planCode) return 'renew'
  // While the Pro expiry popup shows (the same calendar-day window the server
  // allows), Pro may already buy Plus or Premium; it starts when Pro ends.
  if (inForce && planCode === 'BUSINESS' && expiryWarning(status, now)?.kind === 'pro') return 'choose'
  if (inForce) return 'blocked'
  return 'choose'
}

/** A 403 from a paid endpoint, read into what the locked screen should say. */
export function lockedReason(error) {
  const detail = error?.response?.data?.detail
  if (!detail || typeof detail !== 'object') return null
  if (detail.code === 'SUBSCRIPTION_EXPIRED') return { kind: 'expired', requiredPlan: detail.required_plan || 'PROFESSIONAL' }
  if (detail.code === 'FREE_ACCESS_EXPIRED') return { kind: 'freeExpired', requiredPlan: detail.required_plan || 'PROFESSIONAL' }
  if (detail.code === 'PLAN_UPGRADE_REQUIRED') return { kind: 'upgrade', requiredPlan: detail.required_plan || 'BUSINESS' }
  if (detail.code === 'SUBSCRIPTION_REQUIRED') return { kind: 'required', requiredPlan: detail.required_plan || 'PROFESSIONAL' }
  return null
}

/** Ends within `days` (and still in force). */
export function isEndingSoon(status, days = 7, now = Date.now()) {
  if (!status || status.status !== 'ACTIVE' || !status.coverage_end) return false
  if ((status.queued_periods || []).length) return false
  const end = Date.parse(status.coverage_end)
  return Number.isFinite(end) && end - now <= days * 24 * 60 * 60 * 1000 && end > now
}

export const EXPIRY_WARNING_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

// The app's local timezone, Asia/Kolkata (UTC+05:30, no daylight saving): the
// backend's settings.local_timezone / local_utc_offset_minutes, which its upgrade
// window and the reminder's date also use.
export const INDIA_TIME_ZONE = 'Asia/Kolkata'
const INDIA_OFFSET_MS = 330 * 60 * 1000

/** Whole calendar days from `now` to `at` by India's dates, whatever the browser's
 *  timezone: 28 Oct to 31 Oct is 3, whatever the times of day. */
function calendarDaysUntil(at, now) {
  const day = (ms) => Math.floor((ms + INDIA_OFFSET_MS) / DAY_MS)
  return day(at) - day(now)
}

/**
 * The builder dashboard's expiry popup, from the server's status:
 *   { kind: 'free' | 'pro' | 'premium', days, end }  1-3 calendar days left (local dates)
 *   null  more than 3 days left, already ended (the banner says so), a renewal
 *         already queued, or plans not sold in this region
 * Plus (Monthly) and Premium (Annual) are the same tier, so they get the same popup.
 */
export function expiryWarning(status, now = Date.now()) {
  if (!status || status.region_supported === false) return null
  let kind = null
  let end = null
  if (status.status === TRIAL) {
    kind = 'free'
    end = status.free_access_until
  } else if (status.status === 'ACTIVE' && !(status.queued_periods || []).length) {
    kind = status.plan_code === 'BUSINESS' ? 'premium' : status.plan_code === 'PROFESSIONAL' ? 'pro' : null
    end = status.coverage_end
  }
  const at = kind && end ? Date.parse(end) : NaN
  if (!Number.isFinite(at) || at <= now) return null
  // Calendar days left (a plan ending later today counts as 1).
  const days = Math.max(1, calendarDaysUntil(at, now))
  return days <= EXPIRY_WARNING_DAYS ? { kind, days, end } : null
}

export const EXPIRY_WARNING_SEEN_PREFIX = 'crewnbuild_expiry_warning_seen:'

/** A subscription date (start, end, validity, grace, queued period) as India's
 *  date, as the backend and the expiry popup count it, whatever the browser's
 *  timezone. Plan & Billing and the expiry popup show their dates with it. */
export function formatSubscriptionDate(isoUtc, locale) {
  return formatPlanDate(isoUtc, locale, INDIA_TIME_ZONE)
}

/** The end date the expiry popup shows: India's date, like its day count and the
 *  server's reminder, whatever the browser's timezone. */
export function expiryWarningDate(warning, locale) {
  return formatSubscriptionDate(warning?.end, locale)
}

/** Storage key for a shown popup: once per login, account, plan end and days left
 *  (every key with this prefix is forgotten at sign-out, see expiryNotice.js). */
export function expiryWarningSeenKey(userId, warning) {
  return `${EXPIRY_WARNING_SEEN_PREFIX}${userId}:${warning.end}:${warning.days}`
}

/**
 * What the popup says. Free (its 30 days) and Pro: the one "going to expire in
 * {days} days" message with Upgrade; Premium (Plus / Premium): its renewal text.
 */
export function expiryWarningContent(warning) {
  if (!warning) return null
  if (warning.kind === 'free' || warning.kind === 'pro') {
    return { messageKey: 'subscription.expiryWarning.message', values: { days: warning.days }, ctaKey: 'subscription.expiryWarning.upgradeCta' }
  }
  return {
    titleKey: `subscription.expiryWarning.title.${warning.kind}`,
    bodyKey: `subscription.expiryWarning.body.${warning.kind}`,
    values: { days: warning.days },
    ctaKey: 'subscription.expiryWarning.renewCta',
  }
}

/** Milliseconds until the server-reported end of what is in force, for a timed refresh. */
export function msUntilChange(status, now = Date.now()) {
  if (!status) return null
  const edge = status.status === 'GRACE' ? status.grace_until : status.status === 'ACTIVE' ? status.coverage_end
    : status.status === TRIAL ? status.free_access_until : null
  const at = edge ? Date.parse(edge) : NaN
  return Number.isFinite(at) && at > now ? at - now : null
}

/** A date for display, in the viewer's own zone (or `timeZone`, when given) and locale. */
export function formatPlanDate(isoUtc, locale, timeZone = undefined) {
  if (!isoUtc) return '—'
  const value = new Date(isoUtc)
  if (Number.isNaN(value.getTime())) return '—'
  return value.toLocaleDateString(locale || undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone })
}

/** The backend's `{detail: {code, message}}`, or a plain fallback. */
export function subscriptionErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  if (detail && typeof detail === 'object' && detail.message) return detail.message
  if (typeof detail === 'string') return detail
  return fallback
}
