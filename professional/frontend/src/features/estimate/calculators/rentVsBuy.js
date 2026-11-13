/**
 * Rent vs Buy — 10-Year Decision Engine. The arithmetic only, free of React,
 * tested by `node --test src/pages/site/calculators/rentVsBuy.test.js`.
 *
 * Reuses, never re-implements:
 *   • EMI and amortization — `calculateEmi` / `buildSchedule` from homeLoan.js
 *     (Calculator #1's formula: EMI = P·r·(1+r)^n / ((1+r)^n − 1), P/n at 0%).
 *   • Stamp duty & registration — `governmentChargesFor` from propertyCharges.js
 *     (the one verified rate source shared with Calculators #2 and #3).
 *
 * Horizon: exactly 10 years (120 months), whatever the loan tenure. A longer
 * loan is NOT treated as paid off: the balance left after month 120 is carried.
 *
 * Model, for each year y = 1…10 (the headline uses y = 10):
 *   Rent
 *     monthly rent in year y   = R × (1 + g)^(y−1)            (rises once a year)
 *     total rent to year y     = Σ 12 × monthly rent           (not R × 120)
 *   Buy
 *     upfront                  = down payment + stamp duty + registration + purchase costs
 *     EMI paid to year y       = Σ (principal + interest) actually paid in those years
 *     maintenance in year y    = base × (1 + m)^(y−1)          (m = 0 when left blank → constant)
 *     total buy outflows       = upfront + EMI paid + maintenance paid
 *     property value           = price × (1 + a)^y
 *     selling cost             = property value × selling %
 *     net sale equity          = property value − remaining loan − selling cost
 *     opportunity cost         = DP × (1 + i)^y − DP            (growth the down payment forgoes)
 *     NET BUY COST             = total buy outflows − net sale equity + opportunity cost
 *   NET RENT COST              = total rent
 *
 * Why opportunity cost appears ONCE, on the buy side: the renter keeps the down
 * payment and its growth; the buyer gives that growth up. Counting it as a buy
 * cost AND subtracting the down payment's future value from rent would credit
 * the same growth twice. (Equivalent view: rent − growth vs buy without it —
 * the difference between the two options is identical.)
 *
 * Not modelled (shown to the user): property tax, home insurance, GST / other
 * taxes, income-tax benefits on home loans, investing any monthly difference
 * between EMI + maintenance and rent, and opportunity cost on the stamp duty,
 * registration and purchase costs.
 */
import { buildSchedule, calculateEmi } from './homeLoan.js'
import { STATES, chargeConfigFor, formatInr, governmentChargesFor } from './propertyCharges.js'

export { STATES, chargeConfigFor, formatInr }

export const HORIZON_YEARS = 10
export const TENURE_LIMITS = { min: 1, max: 30 }
// "Both options are financially close" when the net costs differ by no more
// than this share of the property price. Stated to the user with the verdict.
export const CLOSE_CALL_SHARE_OF_PRICE = 0.01
export const MAINTENANCE_MODES = ['percent', 'amount']

/** Every financial input starts empty; nothing is calculated until they are filled in. */
export const EMPTY_INPUTS = Object.freeze({
  propertyPrice: '',
  downPayment: '',
  interestRate: '',
  tenureYears: '',
  appreciation: '',
  monthlyRent: '',
  rentIncrease: '',
  state: '',
  areaType: '',
  purchaseCosts: '',
  maintenanceMode: 'percent',
  maintenanceValue: '',
  maintenanceIncrease: '',
  sellingCostPercent: '',
  investmentReturn: '',
})

const REQUIRED = ['propertyPrice', 'downPayment', 'interestRate', 'tenureYears', 'appreciation', 'monthlyRent', 'rentIncrease', 'state', 'sellingCostPercent', 'investmentReturn']
const blank = (value) => value === '' || value === null || value === undefined

/** Validates; returns `{ errors, values }`. Blank required fields are reported as `missing`. */
export function validateRentVsBuy(inputs) {
  const errors = {}
  const missing = REQUIRED.filter((field) => blank(inputs[field]))
  const n = (field) => Number(inputs[field])
  const positive = (field, key) => { if (!blank(inputs[field]) && !(Number.isFinite(n(field)) && n(field) > 0)) errors[field] = key }
  const percent = (field, max = 100) => {
    if (blank(inputs[field])) return
    if (!Number.isFinite(n(field)) || n(field) < 0) errors[field] = 'errPercent'
    else if (n(field) > max) errors[field] = 'errPercentTooHigh'
  }
  positive('propertyPrice', 'errPositive')
  positive('downPayment', 'errPositive')
  positive('monthlyRent', 'errPositive')
  if (!errors.propertyPrice && !errors.downPayment && !blank(inputs.propertyPrice) && !blank(inputs.downPayment) && n('downPayment') > n('propertyPrice')) {
    errors.downPayment = 'errDownPaymentTooHigh'
  }
  if (!blank(inputs.tenureYears) && !(Number.isInteger(n('tenureYears')) && n('tenureYears') >= TENURE_LIMITS.min && n('tenureYears') <= TENURE_LIMITS.max)) errors.tenureYears = 'errTenure'
  percent('interestRate', 30)
  percent('appreciation', 50)
  percent('rentIncrease', 50)
  percent('sellingCostPercent', 100)
  percent('investmentReturn', 50)
  percent('maintenanceIncrease', 50)
  const config = chargeConfigFor(inputs.state)
  if (config && !config.areaTypes.includes(inputs.areaType)) {
    if (blank(inputs.areaType)) missing.push('areaType'); else errors.areaType = 'errAreaType'
  }
  if (!blank(inputs.purchaseCosts) && !(Number.isFinite(n('purchaseCosts')) && n('purchaseCosts') >= 0)) errors.purchaseCosts = 'errNonNegative'
  if (!blank(inputs.maintenanceValue)) {
    if (!(Number.isFinite(n('maintenanceValue')) && n('maintenanceValue') >= 0)) errors.maintenanceValue = 'errNonNegative'
    else if (inputs.maintenanceMode === 'percent' && n('maintenanceValue') > 100) errors.maintenanceValue = 'errPercentTooHigh'
  }
  if (!MAINTENANCE_MODES.includes(inputs.maintenanceMode)) errors.maintenanceMode = 'errMaintenanceMode'
  return { errors, missing }
}

/**
 * `{ status, errors, missing, result }`:
 *   'empty'      — nothing typed yet
 *   'incomplete' — some required value is still blank (no comparison shown)
 *   'invalid'    — a value is out of range
 *   'ok'         — the full 10-year comparison
 */
export function calculateRentVsBuy(inputs) {
  const typed = Object.keys(EMPTY_INPUTS).some((key) => !['maintenanceMode', 'state', 'areaType'].includes(key) && !blank(inputs[key]))
  if (!typed) return { status: 'empty', errors: {}, missing: [], result: null }
  const { errors, missing } = validateRentVsBuy(inputs)
  if (Object.keys(errors).length) return { status: 'invalid', errors, missing, result: null }
  if (missing.length) return { status: 'incomplete', errors, missing, result: null }

  const price = Number(inputs.propertyPrice)
  const downPayment = Number(inputs.downPayment)
  const rate = Number(inputs.interestRate)
  const tenure = Number(inputs.tenureYears)
  const appreciation = Number(inputs.appreciation) / 100
  const rent = Number(inputs.monthlyRent)
  const rentIncrease = Number(inputs.rentIncrease) / 100
  const sellingShare = Number(inputs.sellingCostPercent) / 100
  const investment = Number(inputs.investmentReturn) / 100
  const purchaseCosts = blank(inputs.purchaseCosts) ? 0 : Number(inputs.purchaseCosts)
  const maintenanceBlank = blank(inputs.maintenanceValue)
  const maintenanceBase = maintenanceBlank ? 0 : inputs.maintenanceMode === 'percent' ? (price * Number(inputs.maintenanceValue)) / 100 : Number(inputs.maintenanceValue)
  const maintenanceGrowth = blank(inputs.maintenanceIncrease) ? 0 : Number(inputs.maintenanceIncrease) / 100

  const loan = price - downPayment
  const emi = calculateEmi(loan, rate, tenure) // Calculator #1's formula
  const schedule = buildSchedule(loan, rate, tenure).rows // Calculator #1's amortization
  const charges = governmentChargesFor(price, inputs.state, inputs.areaType) // shared verified rates
  const upfront = downPayment + charges.stampDuty + charges.registration + purchaseCosts

  const years = []
  let cumulativeRent = 0
  let emiPaid = 0
  let interestPaid = 0
  let principalPaid = 0
  let maintenancePaid = 0
  for (let y = 1; y <= HORIZON_YEARS; y += 1) {
    const monthlyRent = rent * (1 + rentIncrease) ** (y - 1)
    const annualRent = monthlyRent * 12
    cumulativeRent += annualRent
    const loanYear = schedule[y - 1] // undefined once the loan has ended
    const yearPrincipal = loanYear ? loanYear.principalPaid : 0
    const yearInterest = loanYear ? loanYear.interestPaid : 0
    principalPaid += yearPrincipal
    interestPaid += yearInterest
    emiPaid += yearPrincipal + yearInterest
    const remainingLoan = loanYear ? loanYear.closing : 0
    const maintenance = maintenanceBase * (1 + maintenanceGrowth) ** (y - 1)
    maintenancePaid += maintenance
    const propertyValue = price * (1 + appreciation) ** y
    const sellingCost = propertyValue * sellingShare
    const netSaleEquity = propertyValue - remainingLoan - sellingCost
    const downPaymentFutureValue = downPayment * (1 + investment) ** y
    const opportunityCost = downPaymentFutureValue - downPayment
    const buyOutflows = upfront + emiPaid + maintenancePaid
    const netBuyCost = buyOutflows - netSaleEquity + opportunityCost
    const netRentCost = cumulativeRent
    years.push({
      year: y, monthlyRent, annualRent, cumulativeRent, propertyValue, remainingLoan, sellingCost, netSaleEquity,
      emiPaid, interestPaid, principalPaid, maintenance, maintenancePaid, buyOutflows,
      downPaymentFutureValue, opportunityCost, netBuyCost, netRentCost, buyAhead: netBuyCost < netRentCost,
    })
  }

  const end = years[HORIZON_YEARS - 1]
  const difference = end.netRentCost - end.netBuyCost // > 0: buying is lower-cost
  const closeThreshold = price * CLOSE_CALL_SHARE_OF_PRICE
  const verdict = Math.abs(difference) <= closeThreshold ? 'close' : difference > 0 ? 'buy' : 'rent'
  // Break-even: the first year from which buying stays lower-cost through year 10.
  let breakEvenYear = null
  for (let y = HORIZON_YEARS; y >= 1 && years[y - 1].buyAhead; y -= 1) breakEvenYear = y

  return {
    status: 'ok',
    errors,
    missing,
    result: {
      price, downPayment, loan, emi, rate, tenure,
      stampDuty: charges.stampDuty,
      registration: charges.registration,
      stampDutyPercent: charges.stampDutyPercent,
      registrationPercent: charges.registrationPercent,
      chargesConfigured: charges.configured,
      chargesPartial: !charges.configured || !charges.complete,
      notIncludedKey: charges.notIncludedKey,
      purchaseCosts,
      upfront,
      maintenanceBase,
      maintenanceBlank,
      maintenanceConstant: maintenanceGrowth === 0,
      months: HORIZON_YEARS * 12,
      emiMonthsPaid: Math.min(tenure, HORIZON_YEARS) * 12,
      loanEndsWithinHorizon: tenure <= HORIZON_YEARS,
      years,
      totalRent: end.cumulativeRent,
      emiPaid: end.emiPaid,
      interestPaid: end.interestPaid,
      principalPaid: end.principalPaid,
      remainingLoan: end.remainingLoan,
      maintenancePaid: end.maintenancePaid,
      buyOutflows: end.buyOutflows,
      propertyValue: end.propertyValue,
      sellingCost: end.sellingCost,
      netSaleEquity: end.netSaleEquity,
      downPaymentFutureValue: end.downPaymentFutureValue,
      opportunityCost: end.opportunityCost,
      netBuyCost: end.netBuyCost,
      netRentCost: end.netRentCost,
      difference,
      closeThreshold,
      verdict,
      breakEvenYear,
    },
  }
}

/** Indian-grouped rupees with a sign, for net figures that can be negative (a net gain). */
export function formatSignedInr(value) {
  return value < 0 ? `−${formatInr(-value)}` : formatInr(value)
}
