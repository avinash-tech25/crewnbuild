// Figures for the back of an owner's project card, read from the `dashboard`
// block of the existing cost summary (GET /cost-tool/projects/{id}/summary).
//
// Nothing is estimated here. The backend already defines every amount:
// `estimated_budget` is the confirmed contract value once there is one and the
// owner's budget until then; `spent_budget` is material + labour + equipment +
// other expenses recorded by the site. This only guards against missing or
// invalid values and a zero budget.

const amount = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

// The spending categories the cost summary records, in display order.
export const SPEND_CATEGORIES = [
  { key: 'material_cost', labelKey: 'owner.analysis.material', color: '#126b45' },
  { key: 'labour_cost', labelKey: 'owner.analysis.labour', color: '#1683E8' },
  { key: 'machinery_cost', labelKey: 'owner.analysis.equipment', color: '#F58A00' },
  { key: 'expenses', labelKey: 'owner.analysis.other', color: '#9146D8' },
]

export function analysisFigures(dashboard) {
  if (!dashboard || typeof dashboard !== 'object') return null
  const budgetValue = amount(dashboard.estimated_budget)
  const budget = budgetValue > 0 ? budgetValue : null
  const categories = SPEND_CATEGORIES.map((category) => ({ ...category, value: amount(dashboard[category.key]) }))
  const spent = categories.reduce((total, category) => total + category.value, 0)
  return {
    budget,
    spent,
    // Null without a budget: there is nothing to subtract from or divide by.
    remaining: budget === null ? null : budget - spent,
    utilization: budget === null ? null : Math.round((spent / budget) * 1000) / 10,
    overrun: budget !== null && spent > budget ? spent - budget : 0,
    // Only categories with recorded spend are drawn.
    categories: categories.filter((category) => category.value > 0),
  }
}

// Subscription refusals the API sends as {detail: {code, message}}: the builder's
// own plan, or (for the owner) the project's builder's plan.
const SUBSCRIPTION_CODES = new Set([
  'SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_EXPIRED', 'PLAN_UPGRADE_REQUIRED', 'FREE_ACCESS_EXPIRED', 'BUILDER_SUBSCRIPTION_EXPIRED',
])

/**
 * Why the analysis did not load, keeping the backend's own words. `kind` picks
 * the message key (owner.analysis.err.<kind>); `message` is the server's detail,
 * shown as well so the real reason is never hidden.
 */
export function analysisError(error) {
  const response = error?.response
  if (!response) return { kind: 'network', status: null, code: null, message: error?.message || '' }
  const status = Number(response.status) || null
  const detail = response.data?.detail
  const code = detail && typeof detail === 'object' ? detail.code || null : null
  const message = typeof detail === 'string' ? detail : (detail && typeof detail === 'object' ? detail.message || '' : '')
  let kind = 'unknown'
  if (code && SUBSCRIPTION_CODES.has(code)) kind = 'subscription'
  else if (status === 401) kind = 'session'
  else if (status === 403) kind = 'forbidden'
  else if (status === 404) kind = 'notFound'
  else if (status >= 500) kind = 'server'
  return { kind, status, code, message }
}

/** A 200 that carries no dashboard block: nothing to draw. */
export const MISSING_ANALYSIS = { kind: 'missing', status: 200, code: null, message: '' }

// ---------------------------------------------------------------------------
// The project's Project Analysis tab. Every helper below reads the same cost
// summary (or the project payload) and only regroups what is already stored;
// none of them estimates, projects or fills in a value.
// ---------------------------------------------------------------------------

const quantity = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// A daily record's own recorded cost, in the four categories the summary adds up.
const registerCost = (register) => amount(register.material_cost)
  + amount(register.labour_cost)
  + amount(register.equipment_cost)
  + amount(register.total_expenses)

/**
 * Spend per work date and the running total, from the daily site records'
 * stored cost totals. Only dates that have a record appear; a day with no
 * record adds nothing, so the running total simply holds between them.
 */
export function spendingTrend(registers) {
  const byDate = new Map()
  for (const register of registers || []) {
    if (!register?.work_date) continue
    const day = String(register.work_date).slice(0, 10)
    byDate.set(day, (byDate.get(day) || 0) + registerCost(register))
  }
  let running = 0
  return [...byDate.keys()].sort().map((date) => {
    const daily = byDate.get(date)
    running += daily
    return { date, daily, cumulative: running }
  })
}

/**
 * Progress per BOQ work item: the completed quantity to date against the
 * planned quantity, as the backend already computes it on each daily record
 * (boq_activity). The latest record of each item carries its cumulative
 * figure. Items without a planned quantity have no percentage and are left
 * out rather than shown as 0%.
 */
export function workItemProgress(registers) {
  const latest = new Map()
  for (const register of registers || []) {
    const activity = register?.boq_activity
    const reference = String(activity?.boq_reference || '').trim()
    const planned = quantity(activity?.planned_quantity)
    if (!reference || planned <= 0 || activity.activity_progress_percent == null) continue
    const day = String(register.work_date || '')
    const previous = latest.get(reference)
    if (previous && (previous.day > day || (previous.day === day && previous.id > register.id))) continue
    latest.set(reference, {
      reference,
      label: String(activity.activity_category || register.work_type || reference).trim(),
      percent: Math.max(0, Math.min(100, quantity(activity.activity_progress_percent))),
      planned,
      completed: quantity(activity.completed_to_date),
      unit: activity.activity_unit || '',
      day,
      id: register.id,
    })
  }
  return [...latest.values()]
    .map((item) => ({ ...item, status: item.percent >= 100 ? 'completed' : item.percent > 0 ? 'ongoing' : 'notStarted' }))
    .sort((a, b) => b.percent - a.percent || a.label.localeCompare(b.label))
}

/**
 * Planned against actual for each spending category. A planned amount exists
 * only where the project's accepted estimate recorded one (materials and
 * labour); every other category's planned figure is null ("Not set").
 */
export function budgetRows(project, dashboard) {
  const planned = { material_cost: project?.material_estimate, labour_cost: project?.labour_estimate }
  return SPEND_CATEGORIES.map((category) => {
    const actual = amount(dashboard?.[category.key])
    const plannedNumber = Number(planned[category.key])
    const plannedValue = Number.isFinite(plannedNumber) && plannedNumber > 0 ? plannedNumber : null
    return {
      ...category,
      planned: plannedValue,
      actual,
      remaining: plannedValue === null ? null : plannedValue - actual,
      percent: plannedValue === null ? null : Math.round((actual / plannedValue) * 1000) / 10,
    }
  })
}

/**
 * Each material as the site records it: received on site, recorded as used,
 * and still in stock -- all in the material's own unit. Received stock is
 * never treated as used.
 */
export function materialRows(materials) {
  return (materials || []).map((item) => {
    const received = quantity(item.received)
    const used = quantity(item.total_used)
    return {
      key: item.id ?? item.material,
      material: item.material,
      unit: item.unit || '',
      received,
      used,
      remaining: quantity(item.remaining),
      percentUsed: received > 0 ? Math.round((used / received) * 1000) / 10 : null,
      status: item.stock_status || 'IN_STOCK',
    }
  })
}

/** The latest recorded expenses, newest first. */
export function recentExpenses(expenses, limit = 6) {
  return [...(expenses || [])]
    .sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')) || quantity(b.id) - quantity(a.id))
    .slice(0, limit)
}
