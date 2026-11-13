// Pure helpers for the builder's location and lead limits and the limit-reached
// prompts. No React, no network: the limits and the usage are the server's
// (GET /subscriptions/me `usage`, present only where they are enforced -- India
// builders), and every limit is enforced again on the server.
import { IN_FORCE } from './subscriptionFormat.js'
import { offerById, planLimitLines } from './subscriptionOffers.js'

export const LOCATION_LIMIT_REACHED = 'LOCATION_LIMIT_REACHED'
export const LEAD_LIMIT_REACHED = 'LEAD_LIMIT_REACHED'
export const PLAN_UPGRADE_REQUIRED = 'PLAN_UPGRADE_REQUIRED'

// The offers each prompt names (subscriptionOffers.js ids), by the tier in force.
// A Free builder at the location limit is offered Pro (3 locations) and both
// Premium options (unlimited); a Pro builder, Premium only. Each button states its
// own allowance (offerLocationLine). The lead prompt names no plan.
const UPGRADE_OFFERS = {
  locations: { FREE: ['PRO_MONTHLY', 'PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'], PROFESSIONAL: ['PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'] },
  hd: { FREE: ['PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'], PROFESSIONAL: ['PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'] },
  leads: {},
}

// A paid feature the server refused, keyed by the plan that includes it: a Pro
// feature offers Pro and both Premium options, a Premium feature Premium only.
const FEATURE_OFFERS = {
  PROFESSIONAL: ['PRO_MONTHLY', 'PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'],
  BUSINESS: ['PREMIUM_MONTHLY', 'PREMIUM_ANNUAL'],
}

export function upgradeOfferIds(kind, planCode) {
  return UPGRADE_OFFERS[kind]?.[planCode || 'FREE'] || []
}

/**
 * The "you can add up to N service locations" line for the plan's cap, as
 * { key, values } for `t`: the cap is the server's (serviceLocationCap), never a
 * number of this file's own. A cap of 3 keeps the existing, fully translated line;
 * null (unlimited) gives no line.
 */
export function maxLocationsMessage(cap) {
  if (cap === null || cap === undefined) return null
  if (cap === 1) return { key: 'cp.msg.maxLocationOne', values: {} }
  if (cap === 3) return { key: 'cp.msg.maxLocations', values: {} }
  return { key: 'cp.msg.maxLocationsCount', values: { count: cap } }
}

/**
 * An upgrade button's own location allowance, from the server's catalogue
 * (GET /subscriptions/plans): "Up to 3 locations" for Pro, "Unlimited locations"
 * for Plus and Premium, as { key, values } for `t`; null until the catalogue is
 * loaded or when the plan is unknown.
 */
export function offerLocationLine(catalogue, offerId) {
  const offer = offerById(offerId)
  if (!offer) return null
  return planLimitLines(catalogue, offer.planCode).find((line) => line.key.startsWith('subscription.limit.location')) || null
}

export function featureOfferIds(requiredPlan) {
  return FEATURE_OFFERS[requiredPlan] || FEATURE_OFFERS.PROFESSIONAL
}

/** The server's usage block, or null where no limit applies (outside India, not loaded). */
export function limitUsage(status) {
  return status?.usage || null
}

/** Saved locations against the cap: { used, limit, remaining, atLimit }; limit null = unlimited. */
export function locationUsage(status, savedCount) {
  const usage = limitUsage(status)
  if (!usage) return null
  const limit = usage.max_locations
  const used = Number.isFinite(savedCount) ? savedCount : usage.locations_used
  if (limit === null || limit === undefined) return { used, limit: null, remaining: null, atLimit: false }
  return { used, limit, remaining: Math.max(limit - used, 0), atLimit: used >= limit }
}

/**
 * The most service locations the profile form lets a builder add: the plan's
 * (null = unlimited) once the server has reported it; for an India builder whose
 * plan is not known yet, none -- never a guessed 3, which held Plus and Premium to
 * 3 -- the server still refuses a save over the real limit; elsewhere the existing 3.
 */
export function serviceLocationCap(usage, pincodeLocations) {
  if (usage) return usage.limit
  return pincodeLocations ? null : 3
}

/**
 * The pincodes a Free/Pro builder can pick in Find Clients' "Leads for ... Change":
 * the server's lead locations (registered service locations, and the account's
 * pincode only while it is one of them or a slot is free). Empty when no location
 * cap applies (Plus, Premium, outside India): there any pincode may be entered.
 */
export function leadLocationChoices(status) {
  const usage = limitUsage(status)
  if (!usage || usage.max_locations === null || usage.max_locations === undefined) return []
  return [...new Set((usage.leads || []).map((row) => String(row.pincode)).filter(Boolean))]
}

/** Open leads in one pincode: { pincode, used, limit, remaining, atLimit }, or null. */
export function leadUsage(status, pincode) {
  const usage = limitUsage(status)
  if (!usage || !pincode) return null
  const row = (usage.leads || []).find((item) => item.pincode === String(pincode))
  const limit = usage.max_leads_per_location
  const used = row ? row.used : 0
  if (!limit) return { pincode: String(pincode), used, limit: null, remaining: null, atLimit: false }
  return { pincode: String(pincode), used, limit, remaining: Math.max(limit - used, 0), atLimit: used >= limit }
}

/** A limit refusal from the server: { kind, limit, pincode, planCode } or null. */
export function limitRefusal(error) {
  const detail = error?.response?.data?.detail
  if (!detail || typeof detail !== 'object') return null
  if (detail.code === LOCATION_LIMIT_REACHED) return { kind: 'locations', limit: detail.limit, planCode: detail.plan_code || 'FREE' }
  if (detail.code === LEAD_LIMIT_REACHED) return { kind: 'leads', limit: detail.limit, pincode: detail.pincode || '' }
  return null
}

/** The tier whose prompt applies: the plan in force, else Free (the usage block says so too). */
export function promptPlan(status) {
  if (status?.usage?.plan_code) return status.usage.plan_code
  return status && IN_FORCE.includes(status.status) ? status.plan_code : 'FREE'
}

/** A different tier cannot be bought while a paid plan is in force (server rule). */
export function upgradeWaitsForPlanEnd(status, offerPlanCode) {
  return Boolean(status && IN_FORCE.includes(status.status) && status.plan_code !== offerPlanCode)
}
