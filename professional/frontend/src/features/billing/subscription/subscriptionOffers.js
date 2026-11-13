// The three paid builder offers, mapped onto the EXISTING subscription API
// identifiers. Nothing here sets a price or an entitlement: the server prices each
// (plan_code, duration_code) from subscription_plan_prices and grants the features
// of plan_code. A Professional Monthly purchase can therefore never receive the
// Premium (BUSINESS) features, whatever this file says. Premium Monthly and Premium
// Annual are one tier billed two ways: the same features, only the period differs.

import { isPremium } from './subscriptionFormat.js'

export const OFFERS = [
  { id: 'PRO_MONTHLY', planCode: 'PROFESSIONAL', durationCode: 'MONTHLY', months: 1, badge: 'PRO' },
  { id: 'PREMIUM_MONTHLY', planCode: 'BUSINESS', durationCode: 'MONTHLY', months: 1, badge: 'PREMIUM' },
  { id: 'PREMIUM_ANNUAL', planCode: 'BUSINESS', durationCode: 'ANNUAL', months: 12, badge: 'PREMIUM' },
]

export const offerById = (id) => OFFERS.find((offer) => offer.id === id) || null

// Listed only when the server's plan actually includes them (no advertised feature
// that the backend does not grant). The badge line is listed from the plan's mark.
// The Premium portfolio reports (advanced_cost_summary, consolidated_export) are
// listed on the Plus and Premium cards; the portfolio_dashboard view itself is
// not advertised as a line of its own.
const FEATURE_ORDER = ['builder_calendar', 'builder_photos', 'builder_billing', 'bill_adjustments', 'project_summary_export', 'hd_video', 'advanced_cost_summary', 'consolidated_export']

export function findOffer(planCode, durationCode) {
  return OFFERS.find((offer) => offer.planCode === planCode && offer.durationCode === durationCode) || null
}

/** The display name: the offer's own name, or the tier's for a period bought otherwise. */
export function offerNameKey(planCode, durationCode) {
  const offer = findOffer(planCode, durationCode)
  return offer ? `subscription.offer.${offer.id}.name` : `subscription.plan.${planCode || 'FREE'}`
}

export function offerPlan(catalogue, offer) {
  return (catalogue?.plans || []).find((plan) => plan.code === offer.planCode) || null
}

/** The server's price for this offer in paise, or null when it is not configured. */
export function offerPrice(catalogue, offer) {
  const value = offerPlan(catalogue, offer)?.prices?.[offer.durationCode]
  return value === undefined || value === null ? null : value
}

/** Premium Annual against twelve Premium Monthly payments, from the server's prices. */
export function annualSaving(catalogue) {
  const monthly = offerPrice(catalogue, offerById('PREMIUM_MONTHLY'))
  const annual = offerPrice(catalogue, offerById('PREMIUM_ANNUAL'))
  if (!monthly || !annual) return null
  const full = monthly * 12
  const saving = full - annual
  return saving > 0 ? { saving, full, percent: Math.round((saving * 100) / full) } : null
}

/**
 * The translation keys an offer card lists: the features its tier ADDS over the
 * tier below (Professional over Free, Premium over Professional), then its mark.
 */
export function offerFeatureKeys(catalogue, offer) {
  const plan = offerPlan(catalogue, offer)
  if (!plan) return []
  const lower = (catalogue.plans || []).filter((other) => other.rank < plan.rank).sort((a, b) => b.rank - a.rank)[0]
  const inherited = new Set(lower?.features || [])
  const features = FEATURE_ORDER.filter((feature) => (plan.features || []).includes(feature) && !inherited.has(feature))
  const keys = features.map((feature) => `subscription.feature.${feature}`)
  if ((plan.features || []).includes('premium_badge') && plan.badge) keys.push(`subscription.feature.badge.${plan.badge}`)
  return keys
}

/** The body of POST /subscriptions/orders: the offer's identifiers and, optionally, a
 *  coupon CODE -- never an amount; the server prices the order and applies the coupon. */
export function orderRequestBody(planCode, durationCode, couponCode = null) {
  const body = { plan_code: planCode, duration_code: durationCode }
  const code = (couponCode || '').trim()
  if (code) body.coupon_code = code
  return body
}

/** The server's coupon figures for this offer: from the validation's per-plan
 *  `quotes` (a coupon may apply to several plans), else its single quote; or null. */
export function quoteForOffer(quote, planCode, durationCode) {
  if (!quote) return null
  const quotes = Array.isArray(quote.quotes) ? quote.quotes : [quote]
  return quotes.find((item) => item.plan_code === planCode && item.duration_code === durationCode) || null
}

/** Whether a server coupon quote covers this offer (only then is it sent with it). */
export function quoteMatchesOffer(quote, planCode, durationCode) {
  return Boolean(quoteForOffer(quote, planCode, durationCode))
}

/**
 * The limit lines a plan's card and comparison show, from the server's plan
 * `limits` (null = unlimited) and its features: locations, leads per location,
 * live-camera quality and the calendar rule. Each is { key, values } for `t`.
 */
export function planLimitLines(catalogue, planCode) {
  const plan = (catalogue?.plans || []).find((item) => item.code === planCode)
  if (!plan) return []
  const limits = plan.limits || {}
  const lines = []
  if ('max_locations' in limits) {
    lines.push(limits.max_locations === null
      ? { key: 'subscription.limit.locationsUnlimited', values: {} }
      : limits.max_locations === 1
        ? { key: 'subscription.limit.locationsOne', values: {} }
        : { key: 'subscription.limit.locations', values: { count: limits.max_locations } })
  }
  if ('max_leads_per_location' in limits) {
    lines.push(limits.max_leads_per_location === null
      ? { key: 'subscription.limit.leadsUnlimited', values: {} }
      : { key: 'subscription.limit.leads', values: { count: limits.max_leads_per_location } })
  }
  lines.push({ key: (plan.features || []).includes('hd_video') ? 'subscription.limit.hdVideo' : 'subscription.limit.sdOnly', values: {} })
  lines.push({ key: 'subscription.limit.noCalendarEditing', values: {} })
  return lines
}

/**
 * What each plans-page card lists: locations, leads per location and camera
 * quality, from the server's plan. Nothing else (no feature or calendar lines).
 * Display only -- every entitlement is still the server's.
 */
export function planCardLines(catalogue, planCode) {
  return planLimitLines(catalogue, planCode).filter((line) => line.key !== 'subscription.limit.noCalendarEditing')
}

/**
 * A paid card's lines: exactly its plan's three limit lines (locations, leads per
 * location, camera quality), the same as the Free card. No feature or badge
 * lines: the plan's entitlements are unchanged and still the server's.
 */
export function offerCardLines(catalogue, offer) {
  return offerPlan(catalogue, offer) ? planCardLines(catalogue, offer.planCode) : []
}

// The mark each plans-page card shows: PRO on Pro, PLUS on Plus, PREMIUM on
// Premium, none on Free. Card display only; the badge a subscriber's profile shows
// is still the server's (GET /subscriptions/me `badge`).
export const CARD_BADGES = { PRO_MONTHLY: 'PRO', PREMIUM_MONTHLY: 'PLUS', PREMIUM_ANNUAL: 'PREMIUM' }

/**
 * The signed-in builder's own mark, from the server's verified status: the offer
 * in force (plan_code + the current period's duration_code) mapped through
 * CARD_BADGES, so Plus shows PLUS although the server's tier `badge` (shared by
 * Plus and Premium) is PREMIUM. No plan in force, or no server badge, gives null;
 * a period that is no listed offer keeps the server's badge.
 */
export function activeBadge(status) {
  if (!isPremium(status) || !status.badge) return null
  const offer = findOffer(status.plan_code, status.current_period?.duration_code)
  return offer ? CARD_BADGES[offer.id] : status.badge
}

// One look for every paid plan's Choose button (Pro, Plus, Premium), on the
// public plans page and on Plan & billing. Free keeps its own.
export const PAID_PLAN_BUTTON = 'bg-emerald-600 text-white hover:bg-emerald-700'
