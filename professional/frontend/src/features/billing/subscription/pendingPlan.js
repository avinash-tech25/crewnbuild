// The plan a visitor chose on the landing page, carried across sign-up / sign-in
// and e-mail verification (the same localStorage hand-off the app already uses for
// invites and estimates). It is ONLY a remembered choice: it grants nothing, and the
// builder's Plan & billing page offers it as the next step. The server prices it
// and activates a plan only after a verified payment.

import { findOffer } from './subscriptionOffers.js'

const KEY = 'crewnbuild_pending_plan'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Only the offered cards (Professional Pro Monthly, Premium Monthly, Premium Annual) can be remembered. */
export function isValidPlanChoice(planCode, durationCode) {
  return Boolean(findOffer(planCode, durationCode))
}

export function savePendingPlan(planCode, durationCode, now = Date.now()) {
  if (!isValidPlanChoice(planCode, durationCode)) return false
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ plan_code: planCode, duration_code: durationCode, saved_at: now }))
    return true
  } catch {
    return false
  }
}

export function readPendingPlan(now = Date.now()) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) || 'null')
    if (!stored || !isValidPlanChoice(stored.plan_code, stored.duration_code)) return null
    if (!(now - Number(stored.saved_at) < MAX_AGE_MS)) { clearPendingPlan(); return null }
    return { planCode: stored.plan_code, durationCode: stored.duration_code }
  } catch {
    return null
  }
}

export function clearPendingPlan() {
  try { window.localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}
