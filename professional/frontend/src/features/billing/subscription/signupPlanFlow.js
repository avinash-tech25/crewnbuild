// Pure helpers for the paid builder sign-up: landing plan card -> /signup?role=builder
// &plan=&billing= -> sign-up -> e-mail verification -> PIN code -> checkout. No React,
// no network. The server still decides everything: it records the plan only for a
// builder account, prices it, and activates it only after a verified payment.
import { findOffer } from './subscriptionOffers.js'

export const BUILDER_ROLE = 'BUILDER'
const DEFAULT_SIGNUP_ROLE = 'OWNER'

// The role a sign-up link preselects, by the key the landing page uses
// (/signup?role=home|builder|engineer|supplier) or by the API role code itself
// (/signup?role=CONTRACTOR, the footer and invite links).
export const SIGNUP_LINK_ROLES = { home: 'OWNER', builder: BUILDER_ROLE, engineer: 'ENGINEER', supplier: 'SUPPLIER' }
// Old links name the Builder role CONTRACTOR (the role is called BUILDER since R4b).
const LEGACY_ROLE_CODES = { CONTRACTOR: BUILDER_ROLE }

/** The role /signup?role= names, else Owner: a key, a role code, or nothing usable. */
export function signupRoleFromLink(requestedRole) {
  const requested = String(requestedRole || '').trim()
  if (!requested) return DEFAULT_SIGNUP_ROLE
  const byKey = SIGNUP_LINK_ROLES[requested.toLowerCase()]
  if (byKey) return byKey
  const code = LEGACY_ROLE_CODES[requested.toUpperCase()] || requested.toUpperCase()
  return Object.values(SIGNUP_LINK_ROLES).includes(code) ? code : DEFAULT_SIGNUP_ROLE
}

/** The paid offer a sign-up link names (?plan=&billing=), or null for any other link. */
export function planFromSignupLink(planCode, durationCode) {
  const offer = findOffer(planCode, durationCode)
  return offer ? { planCode: offer.planCode, durationCode: offer.durationCode } : null
}

// The Free Builder card's link (/signup?role=builder&plan=FREE): an explicit sign of
// the Free Builder flow, distinct from a plain /signup?role=builder, which any link
// may use and which leaves the role free to change. FREE is not a purchasable offer
// (planFromSignupLink gives null for it), so this flow never reaches checkout.
export const FREE_SIGNUP_PLAN = 'FREE'

/** Whether a sign-up link is the Free Builder flow (?plan=FREE). */
export function isFreeBuilderSignupLink(planCode) {
  return String(planCode || '').trim().toUpperCase() === FREE_SIGNUP_PLAN
}

/** The role a sign-up submits: a paid builder link, or the Free Builder flow, always signs up a builder. */
export function signupRole(chosenRole, linkPlan, freeBuilderFlow = false) {
  return linkPlan || freeBuilderFlow ? BUILDER_ROLE : chosenRole
}

/**
 * The plan a sign-up page uses: only the one its own link names. A paid sign-up's
 * link always carries ?plan=&billing= (refreshing keeps it), so a plan remembered
 * from an earlier visit (pendingPlan storage) never turns a plain /signup -- the
 * free Get Started flow -- into a paid one.
 */
export function signupPagePlan(linkPlan) {
  return linkPlan || null
}

/**
 * Whether Create Account first shows the builder plans (the Get Started flow): a
 * phone-first builder sign-up whose link named no plan. A link from a landing plan
 * card (?plan=, which locks the role) already carries its choice, so its sign-up
 * never asks for a plan a second time.
 */
export function offersSignupPlanStep(phoneFirst, role, roleLocked) {
  return phoneFirst === true && role === BUILDER_ROLE && !roleLocked
}

/** Whether a finished sign-up keeps the remembered plan: only a builder's paid sign-up. */
export function keepsRememberedPlan(role, linkPlan) {
  return role === BUILDER_ROLE && Boolean(linkPlan)
}

/** The plan fields sent with sign-up: only a builder carries a plan to checkout. */
export function signupPlanFields(role, plan) {
  return role === BUILDER_ROLE && plan ? { plan_code: plan.planCode, duration_code: plan.durationCode } : {}
}

/** What checkout shows: only the plan the server recorded at sign-up (user.subscription_checkout). */
export function checkoutOffers(subscriptionCheckout) {
  const offer = subscriptionCheckout ? findOffer(subscriptionCheckout.plan_code, subscriptionCheckout.duration_code) : null
  return offer ? [offer] : []
}
