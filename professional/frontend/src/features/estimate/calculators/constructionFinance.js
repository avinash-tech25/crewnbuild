/**
 * Construction Finance Planner — construction cash-flow arithmetic only, free
 * of React, tested by `node --test src/pages/site/calculators/constructionFinance.test.js`.
 *
 * "How much money will I need at each construction stage, how much funding do
 * I have, and where could I face a funding gap?" It is NOT an EMI calculator
 * and holds no stage percentage, budget or rate: every amount is the user's.
 *
 *   contingency          = budget × contingency% ÷ 100           (blank → 0)
 *   planningBudget       = budget + contingency
 *   totalFunding         = ownFunds + constructionLoan + otherFunds   (blank loan / other → 0)
 *   fundingGap           = max(planningBudget − totalFunding, 0)
 *   fundingSurplus       = max(totalFunding − planningBudget, 0)
 *   fundingCoverage      = totalFunding ÷ planningBudget × 100     (shown capped at "100%+")
 *
 * Stages — one source of truth per stage: the value read through `stageMode`.
 *   mode 'percent' → stageAmount = planningBudget × stage% ÷ 100
 *   mode 'amount'  → stageAmount = the amount entered
 *   allocated   = Σ stageAmount;   unallocated = planningBudget − allocated
 *   Allocation above 100% (or above the planning budget) is invalid: no stage plan.
 *   Switching mode converts the stored values (`convertStageValues`).
 *
 * Funding waterfall (a planning assumption — no bank disbursement rule is modelled):
 *   loanAvailableBy(k) = loan                         when the loan is available from the start
 *                      = loan × Σ draw%₁…ₖ ÷ 100       when it is drawn progressively
 *   fundingAvailable(k)= ownFunds + otherFunds + loanAvailableBy(k)
 *   cumulativeCost(k)  = Σ stageAmount₁…ₖ
 *   remaining(k)       = fundingAvailable(k) − cumulativeCost(k)
 *   gap(k)             = max(−remaining(k), 0)        → "Funded" / "Funding Gap"
 *   peakFundingRequirement = max cumulativeCost(k)    (the most money needed by any point in the sequence)
 *   peakGap            = max gap(k);  firstGapStage = first k with remaining(k) < 0
 * Own funds and other funds are treated as available from the start; the loan as chosen.
 */
import { formatInr } from './propertyCharges.js'

export { formatInr }

export const STAGES = ['planning', 'foundation', 'structure', 'masonry', 'roofing', 'electricalPlumbing', 'flooring', 'painting', 'doorsWindows', 'finishing']
export const STAGE_MODES = ['percent', 'amount']
export const LOAN_METHODS = ['start', 'progressive']
export const DURATION_LIMITS = { min: 1, max: 120 } // months

const emptyStages = () => Object.fromEntries(STAGES.map((stage) => [stage, '']))

/** Every amount starts empty; the selectors start at neutral choices. */
export const EMPTY_INPUTS = Object.freeze({
  budget: '',
  durationMonths: '',
  startMonth: '',
  ownFunds: '',
  constructionLoan: '',
  otherFunds: '',
  contingencyPercent: '',
  stageMode: 'percent',
  stages: Object.freeze(emptyStages()),
  loanMethod: 'start',
  loanDraws: Object.freeze(emptyStages()),
})

const blank = (value) => value === '' || value === null || value === undefined
const num = (value) => Number(value)
const round2 = (value) => String(Math.round(value * 100) / 100)

/** Planning budget from the raw inputs, or null while it cannot be computed. */
export function planningBudgetOf(inputs) {
  const budget = num(inputs.budget)
  if (blank(inputs.budget) || !Number.isFinite(budget) || budget <= 0) return null
  const contingency = blank(inputs.contingencyPercent) ? 0 : num(inputs.contingencyPercent)
  if (!Number.isFinite(contingency) || contingency < 0) return null
  return budget + (budget * contingency) / 100
}

/**
 * Converts the stored stage values when the mode changes, using the planning
 * budget. Without a usable budget nothing can be converted, so values clear
 * rather than being guessed. Blank stays blank.
 */
export function convertStageValues(stages, fromMode, toMode, planningBudget) {
  if (fromMode === toMode) return { ...stages }
  return Object.fromEntries(STAGES.map((stage) => {
    const value = stages[stage]
    if (blank(value) || !Number.isFinite(num(value)) || !(planningBudget > 0)) return [stage, '']
    return [stage, round2(toMode === 'amount' ? (planningBudget * num(value)) / 100 : (num(value) / planningBudget) * 100)]
  }))
}

/**
 * `{ status, errors, missing, result }`:
 *   'empty'      — nothing entered
 *   'incomplete' — budget, duration or own funds still blank
 *   'invalid'    — a value is out of range
 *   'ok'         — funding summary; `result.plan` is the stage cash flow, or null
 *                  with `result.planIssue` explaining why (no stages / over-allocated / draws > 100%)
 */
export function calculateConstructionFinance(inputs) {
  const stages = inputs.stages || {}
  const draws = inputs.loanDraws || {}
  const anything = ['budget', 'durationMonths', 'ownFunds', 'constructionLoan', 'otherFunds', 'contingencyPercent'].some((f) => !blank(inputs[f]))
    || STAGES.some((s) => !blank(stages[s]) || !blank(draws[s]))
  if (!anything) return { status: 'empty', errors: {}, missing: [], result: null }

  const errors = {}
  const missing = ['budget', 'durationMonths', 'ownFunds'].filter((f) => blank(inputs[f]))
  const check = (field, ok, key) => { if (!blank(inputs[field]) && !ok(num(inputs[field]))) errors[field] = key }
  check('budget', (v) => Number.isFinite(v) && v > 0, 'errPositive')
  check('durationMonths', (v) => Number.isInteger(v) && v >= DURATION_LIMITS.min && v <= DURATION_LIMITS.max, 'errDuration')
  for (const field of ['ownFunds', 'constructionLoan', 'otherFunds']) check(field, (v) => Number.isFinite(v) && v >= 0, 'errNonNegative')
  check('contingencyPercent', (v) => Number.isFinite(v) && v >= 0 && v <= 100, 'errPercent')
  if (!STAGE_MODES.includes(inputs.stageMode)) errors.stageMode = 'errMode'
  if (!LOAN_METHODS.includes(inputs.loanMethod)) errors.loanMethod = 'errMode'
  if (!blank(inputs.startMonth) && !/^\d{4}-\d{2}$/.test(String(inputs.startMonth))) errors.startMonth = 'errStartMonth'
  for (const stage of STAGES) {
    if (!blank(stages[stage]) && !(Number.isFinite(num(stages[stage])) && num(stages[stage]) >= 0)) errors[`stage.${stage}`] = 'errNonNegative'
    if (inputs.loanMethod === 'progressive' && !blank(draws[stage]) && !(Number.isFinite(num(draws[stage])) && num(draws[stage]) >= 0)) errors[`draw.${stage}`] = 'errNonNegative'
  }
  if (Object.keys(errors).length) return { status: 'invalid', errors, missing, result: null }
  if (missing.length) return { status: 'incomplete', errors, missing, result: null }

  const budget = num(inputs.budget)
  const contingencyEntered = !blank(inputs.contingencyPercent)
  const contingencyPercent = contingencyEntered ? num(inputs.contingencyPercent) : 0
  const contingency = (budget * contingencyPercent) / 100
  const planningBudget = budget + contingency
  const ownFunds = num(inputs.ownFunds)
  const loanEntered = !blank(inputs.constructionLoan)
  const constructionLoan = loanEntered ? num(inputs.constructionLoan) : 0
  const otherEntered = !blank(inputs.otherFunds)
  const otherFunds = otherEntered ? num(inputs.otherFunds) : 0
  const totalFunding = ownFunds + constructionLoan + otherFunds
  const fundingGap = Math.max(planningBudget - totalFunding, 0)
  const fundingSurplus = Math.max(totalFunding - planningBudget, 0)
  const fundingCoverage = (totalFunding / planningBudget) * 100

  // ---- stages
  const stageAmounts = STAGES.map((stage) => {
    if (blank(stages[stage])) return { stage, entered: false, value: null, amount: 0 }
    const value = num(stages[stage])
    const amount = inputs.stageMode === 'percent' ? (planningBudget * value) / 100 : value
    return { stage, entered: true, value, amount }
  })
  const enteredStages = stageAmounts.filter((item) => item.entered)
  const allocated = stageAmounts.reduce((sum, item) => sum + item.amount, 0)
  const allocatedPercent = inputs.stageMode === 'percent'
    ? stageAmounts.reduce((sum, item) => sum + (item.entered ? item.value : 0), 0)
    : (allocated / planningBudget) * 100
  const EPS = 1e-9
  const overAllocated = inputs.stageMode === 'percent' ? allocatedPercent > 100 + EPS : allocated > planningBudget + EPS * planningBudget
  const fullyAllocated = !overAllocated && Math.abs(allocated - planningBudget) <= EPS * planningBudget + 0.005
  const unallocated = overAllocated ? 0 : Math.max(planningBudget - allocated, 0)

  const progressive = inputs.loanMethod === 'progressive'
  const drawPercents = STAGES.map((stage) => (progressive && !blank(draws[stage]) ? num(draws[stage]) : 0))
  const drawTotalPercent = drawPercents.reduce((sum, value) => sum + value, 0)
  const drawsOver = progressive && drawTotalPercent > 100 + EPS
  const loanPartlyUndrawn = progressive && !drawsOver && drawTotalPercent < 100 - EPS && constructionLoan > 0

  let planIssue = null
  if (!enteredStages.length) planIssue = 'noStages'
  else if (overAllocated) planIssue = 'overAllocated'
  else if (drawsOver) planIssue = 'drawsOver'

  let plan = null
  if (!planIssue) {
    let cumulativeCost = 0
    let cumulativeDraw = 0
    const rows = stageAmounts.map((item, index) => {
      cumulativeCost += item.amount
      cumulativeDraw += drawPercents[index]
      const loanAvailable = progressive ? (constructionLoan * cumulativeDraw) / 100 : constructionLoan
      const fundingAvailable = ownFunds + otherFunds + loanAvailable
      const remaining = fundingAvailable - cumulativeCost
      return {
        stage: item.stage, entered: item.entered, amount: item.amount,
        percentOfBudget: (item.amount / planningBudget) * 100,
        cumulativeCost, loanAvailable, fundingAvailable, remaining,
        gap: Math.max(-remaining, 0), status: remaining < 0 ? 'gap' : 'funded',
      }
    })
    const firstGap = rows.find((row) => row.status === 'gap') || null
    plan = {
      rows,
      peakFundingRequirement: Math.max(...rows.map((row) => row.cumulativeCost)),
      peakGap: Math.max(0, ...rows.map((row) => row.gap)),
      firstGapStage: firstGap ? firstGap.stage : null,
      finalRemaining: rows[rows.length - 1].remaining,
    }
  }

  return {
    status: 'ok',
    errors,
    missing,
    result: {
      budget, durationMonths: num(inputs.durationMonths), startMonth: blank(inputs.startMonth) ? null : String(inputs.startMonth),
      contingencyEntered, contingencyPercent, contingency, planningBudget,
      ownFunds, constructionLoan, loanEntered, otherFunds, otherEntered, totalFunding,
      fundingGap, fundingSurplus, fundingCoverage, fullyFunded: totalFunding >= planningBudget,
      stageMode: inputs.stageMode, stageAmounts, allocated, allocatedPercent, overAllocated, fullyAllocated, unallocated,
      loanMethod: inputs.loanMethod, drawTotalPercent, drawsOver, loanPartlyUndrawn,
      planIssue, plan,
    },
  }
}

/** Indian-grouped rupees with a minus sign for negative remaining funds. */
export function formatSignedInr(value) {
  return value < 0 ? `−${formatInr(-value)}` : formatInr(value)
}

/** "Mar 2027 – Feb 2028" for a YYYY-MM start and a duration in months, or null. */
export function plannedPeriod(startMonth, durationMonths) {
  if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth) || !(durationMonths >= 1)) return null
  const [year, month] = startMonth.split('-').map(Number)
  const label = (y, m) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const endIndex = month - 1 + durationMonths - 1
  return `${label(year, month)} – ${label(year + Math.floor(endIndex / 12), (endIndex % 12) + 1)}`
}
