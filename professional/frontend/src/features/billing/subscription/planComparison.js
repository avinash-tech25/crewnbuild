// Pure helpers for the Free / Pro / Premium presentation. No React, no network:
// what a plan includes is the server's (GET /subscriptions/plans features), what
// the builder has now is the server's (GET /subscriptions/me). Nothing here grants
// or refuses anything; every paid endpoint is still checked on the server.
import { IN_FORCE, hasFeature } from './subscriptionFormat.js'

export const COMPARISON_PLAN_CODES = ['FREE', 'PROFESSIONAL', 'BUSINESS']
const CORE = ['builder_calendar', 'builder_photos', 'builder_billing']

// One row per comparison line. `always`: the base builder workspace, which no plan
// gates. `freeMonth`: what a new account has free for its first month (the
// server's TRIAL status: Professional without the badge), which the Free plan
// itself does not include.
export const COMPARISON_ROWS = [
  { id: 'base', labelKey: 'subscription.feature.core', always: true },
  { id: 'core', labelKey: 'subscription.compare.row.core', features: CORE, freeMonth: true },
  { id: 'project_summary_export', labelKey: 'subscription.feature.project_summary_export', features: ['project_summary_export'], freeMonth: true },
  { id: 'bill_adjustments', labelKey: 'subscription.feature.bill_adjustments', features: ['bill_adjustments'], freeMonth: true },
  { id: 'hd_video', labelKey: 'subscription.feature.hd_video', features: ['hd_video'] },
  { id: 'advanced_cost_summary', labelKey: 'subscription.feature.advanced_cost_summary', features: ['advanced_cost_summary'] },
  { id: 'consolidated_export', labelKey: 'subscription.feature.consolidated_export', features: ['consolidated_export'] },
  { id: 'badge', labelKey: 'subscription.compare.row.badge', features: ['premium_badge'] },
]

// The limit rows: each cell is a value, not a tick. From the server's plan
// `limits` (null = unlimited) and features. Builders never edit the site
// engineer's calendar, on any plan.
export const LIMIT_ROWS = [
  { id: 'locations', labelKey: 'subscription.compare.row.locations' },
  { id: 'leads', labelKey: 'subscription.compare.row.leads' },
  { id: 'video', labelKey: 'subscription.compare.row.video' },
  { id: 'calendarEditing', labelKey: 'subscription.compare.row.calendarEditing' },
]

/** { key, values } for one plan's cell on a limit row. */
export function limitCell(plan, rowId) {
  const limits = plan?.limits || {}
  if (rowId === 'locations') {
    return limits.max_locations === null || limits.max_locations === undefined
      ? { key: 'subscription.compare.unlimited', values: {} }
      : { key: 'subscription.compare.count', values: { count: limits.max_locations } }
  }
  if (rowId === 'leads') {
    return limits.max_leads_per_location
      ? { key: 'subscription.compare.perLocation', values: { count: limits.max_leads_per_location } }
      : { key: 'subscription.compare.unlimited', values: {} }
  }
  if (rowId === 'video') {
    return { key: (plan?.features || []).includes('hd_video') ? 'subscription.compare.video.HD' : 'subscription.compare.video.SD', values: {} }
  }
  return { key: 'subscription.compare.notIncluded', values: {} }
}

/** The catalogue's Free, Professional and Business plans, lowest tier first. */
export function comparisonPlans(catalogue) {
  return (catalogue?.plans || [])
    .filter((plan) => COMPARISON_PLAN_CODES.includes(plan.code))
    .sort((a, b) => a.rank - b.rank)
}

/** 'included' | 'freeMonth' | 'excluded' for one plan on one row. */
export function comparisonCell(plan, row) {
  if (!plan) return 'excluded'
  if (row.always) return 'included'
  const features = plan.features || []
  if (row.features.every((feature) => features.includes(feature))) return 'included'
  if (row.freeMonth && plan.code === 'FREE') return 'freeMonth'
  return 'excluded'
}

/** The tier whose look the builder's screens take: the plan in force, else Free. */
export function currentTier(status) {
  if (status && IN_FORCE.includes(status.status) && COMPARISON_PLAN_CODES.includes(status.plan_code)) return status.plan_code
  return 'FREE'
}

// The features the summaries list, in this order. The three core tools are shown
// as one line; the last two are the Premium portfolio reports (the Portfolio page
// lists them as "not on your plan" when they are missing).
const SUMMARY_LINES = [
  { id: 'core', labelKey: 'subscription.compare.row.core', features: CORE },
  { id: 'project_summary_export', labelKey: 'subscription.feature.project_summary_export', features: ['project_summary_export'] },
  { id: 'bill_adjustments', labelKey: 'subscription.feature.bill_adjustments', features: ['bill_adjustments'] },
  { id: 'advanced_cost_summary', labelKey: 'subscription.feature.advanced_cost_summary', features: ['advanced_cost_summary'] },
  { id: 'consolidated_export', labelKey: 'subscription.feature.consolidated_export', features: ['consolidated_export'] },
]

/**
 * What the builder has now and what their plan lacks, both from the server's
 * status (hasFeature: in force or the free month, and listed in `features`).
 */
export function featureSummary(status) {
  const included = []
  const missing = []
  for (const line of SUMMARY_LINES) {
    (line.features.every((feature) => hasFeature(status, feature)) ? included : missing).push(line)
  }
  return { included, missing }
}
