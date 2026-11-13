/**
 * Property ROI & Appreciation — the arithmetic only, free of React, tested by
 * `node --test src/pages/site/calculators/propertyRoi.test.js`.
 *
 * Investment performance from the user's own figures: no market price, circle
 * rate, rent, expense or appreciation rate lives here. No tax, loan, EMI or IRR.
 *
 *   yearsOwned            = whole anniversaries + remaining days ÷ days in that anniversary year   (UTC dates)
 *   grossAppreciation     = currentValue − purchasePrice
 *   appreciationPercent   = grossAppreciation ÷ purchasePrice × 100
 *   CAGR                  = (currentValue ÷ purchasePrice)^(1 ÷ yearsOwned) − 1
 *   annualGrossRent       = monthlyRent × (12 − vacancyMonths)
 *   rentalYears           = yearsOwned (rented throughout) | the years entered
 *   totalGrossRent        = annualGrossRent × rentalYears
 *   totalMaintenance      = annualMaintenance × yearsOwned
 *   totalInvestedCost     = purchasePrice + purchaseCosts + totalMaintenance + renovation + otherCosts
 *   sellingCost           = currentValue × sellingCost% ÷ 100            (exit cost — not in totalInvestedCost)
 *   netSaleValue          = currentValue − sellingCost
 *   netProfit             = netSaleValue + totalGrossRent − totalInvestedCost
 *   netRoi                = netProfit ÷ totalInvestedCost × 100
 *   grossYieldOnPurchase  = annualGrossRent ÷ purchasePrice × 100;  grossYieldOnCurrent = annualGrossRent ÷ currentValue × 100
 *   futureValue           = currentValue × (1 + rate ÷ 100)^years       (illustrative, only when both are entered)
 */
import { formatInr } from './propertyCharges.js'
import { parseIsoDate } from './propertyTds.js'

export { formatInr }

export const LIMITS = Object.freeze({ maxVacancyMonths: 12, maxPercent: 100, minFutureRate: -100, maxFutureRate: 100, maxProjectionYears: 100 })

/** Every value starts empty; nothing is assumed. */
export const EMPTY_INPUTS = Object.freeze({
  purchasePrice: '',
  purchaseDate: '',
  purchaseCosts: '',
  currentValue: '',
  currentDate: '',
  monthlyRent: '',
  vacancyMonths: '',
  rentedEntirePeriod: '',
  rentalYears: '',
  annualMaintenance: '',
  renovationCosts: '',
  otherCosts: '',
  sellingCostPercent: '',
  futureRate: '',
  projectionYears: '',
})

const blank = (value) => value === '' || value === null || value === undefined
const DAY = 24 * 60 * 60 * 1000

/** UTC anniversary of `date` in `year`; 29 Feb falls back to 28 Feb in non-leap years. */
function anniversary(date, year) {
  const month = date.getUTCMonth()
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)))
}

/**
 * Ownership period in years between two YYYY-MM-DD dates: whole anniversaries,
 * plus the remaining days as a share of the anniversary year they fall in.
 * Five full anniversaries give exactly 5. Returns null for invalid or non-increasing dates.
 */
export function yearsBetween(fromIso, toIso) {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (!from || !to || to <= from) return null
  let whole = to.getUTCFullYear() - from.getUTCFullYear()
  if (anniversary(from, from.getUTCFullYear() + whole) > to) whole -= 1
  const start = anniversary(from, from.getUTCFullYear() + whole)
  const next = anniversary(from, from.getUTCFullYear() + whole + 1)
  return whole + (to - start) / DAY / ((next - start) / DAY)
}

/**
 * `{ status, errors, missing, result }`:
 *   'empty'      — nothing entered
 *   'incomplete' — purchase price/date, current value/date, or (with rent) the rental period missing
 *   'invalid'    — out-of-range value or date order
 *   'ok'         — the full analysis
 */
export function calculatePropertyRoi(inputs) {
  if (Object.keys(EMPTY_INPUTS).every((field) => blank(inputs[field]))) return { status: 'empty', errors: {}, missing: [], result: null }

  const errors = {}
  const missing = ['purchasePrice', 'purchaseDate', 'currentValue', 'currentDate'].filter((f) => blank(inputs[f]))
  const n = (field) => Number(inputs[field])
  const check = (field, ok, key) => { if (!blank(inputs[field]) && !(Number.isFinite(n(field)) && ok(n(field)))) errors[field] = key }
  check('purchasePrice', (v) => v > 0, 'errPositive')
  check('currentValue', (v) => v > 0, 'errPositive')
  for (const field of ['purchaseCosts', 'monthlyRent', 'annualMaintenance', 'renovationCosts', 'otherCosts']) check(field, (v) => v >= 0, 'errNonNegative')
  check('vacancyMonths', (v) => v >= 0 && v <= LIMITS.maxVacancyMonths, 'errVacancy')
  check('sellingCostPercent', (v) => v >= 0 && v <= LIMITS.maxPercent, 'errPercent')
  check('futureRate', (v) => v > LIMITS.minFutureRate && v <= LIMITS.maxFutureRate, 'errFutureRate')
  check('projectionYears', (v) => v > 0 && v <= LIMITS.maxProjectionYears, 'errProjectionYears')
  for (const field of ['purchaseDate', 'currentDate']) if (!blank(inputs[field]) && !parseIsoDate(inputs[field])) errors[field] = 'errDate'
  const yearsOwned = errors.purchaseDate || errors.currentDate ? null : yearsBetween(inputs.purchaseDate, inputs.currentDate)
  if (!blank(inputs.purchaseDate) && !blank(inputs.currentDate) && !errors.purchaseDate && !errors.currentDate && yearsOwned === null) errors.currentDate = 'errDateOrder'

  const rentEntered = !blank(inputs.monthlyRent) && n('monthlyRent') > 0
  if (rentEntered) {
    if (blank(inputs.rentedEntirePeriod)) missing.push('rentedEntirePeriod')
    else if (!['yes', 'no'].includes(inputs.rentedEntirePeriod)) errors.rentedEntirePeriod = 'errChoice'
    else if (inputs.rentedEntirePeriod === 'no') {
      if (blank(inputs.rentalYears)) missing.push('rentalYears')
      else check('rentalYears', (v) => v >= 0 && (yearsOwned === null || v <= yearsOwned + 1e-9), 'errRentalYears')
    }
  }
  if (Object.keys(errors).length) return { status: 'invalid', errors, missing, result: null }
  if (missing.length) return { status: 'incomplete', errors, missing, result: null }

  const val = (field) => (blank(inputs[field]) ? 0 : n(field))
  const purchasePrice = n('purchasePrice')
  const currentValue = n('currentValue')
  const purchaseCosts = val('purchaseCosts')
  const grossAppreciation = currentValue - purchasePrice
  const appreciationPercent = (grossAppreciation / purchasePrice) * 100
  const cagrPercent = (Math.pow(currentValue / purchasePrice, 1 / yearsOwned) - 1) * 100

  const monthlyRent = val('monthlyRent')
  const vacancyMonths = val('vacancyMonths')
  const annualGrossRent = monthlyRent * (12 - vacancyMonths)
  const rentalYears = !rentEntered ? 0 : inputs.rentedEntirePeriod === 'yes' ? yearsOwned : n('rentalYears')
  const totalGrossRent = annualGrossRent * rentalYears

  const annualMaintenance = val('annualMaintenance')
  const totalMaintenance = annualMaintenance * yearsOwned
  const renovationCosts = val('renovationCosts')
  const otherCosts = val('otherCosts')
  const totalInvestedCost = purchasePrice + purchaseCosts + totalMaintenance + renovationCosts + otherCosts

  const sellingCostPercent = val('sellingCostPercent')
  const sellingCost = (currentValue * sellingCostPercent) / 100
  const netSaleValue = currentValue - sellingCost
  const netProfit = netSaleValue + totalGrossRent - totalInvestedCost
  const netRoi = (netProfit / totalInvestedCost) * 100
  const EPS = 0.005
  const outcome = netProfit > EPS ? 'positive' : netProfit < -EPS ? 'negative' : 'breakEven'

  const projectionEntered = !blank(inputs.futureRate) && !blank(inputs.projectionYears)
  let projection = null
  if (projectionEntered) {
    const ratePercent = n('futureRate')
    const years = n('projectionYears')
    const futureValue = currentValue * Math.pow(1 + ratePercent / 100, years)
    projection = { ratePercent, years, futureValue, futureGrossAppreciation: futureValue - currentValue, futureTotalAppreciation: futureValue - purchasePrice }
  }

  return {
    status: 'ok',
    errors,
    missing,
    result: {
      purchasePrice, purchaseDate: inputs.purchaseDate, currentValue, currentDate: inputs.currentDate, yearsOwned,
      purchaseCosts, grossAppreciation, appreciationPercent, cagrPercent, valueDecreased: currentValue < purchasePrice,
      rentEntered, monthlyRent, vacancyMonths, annualGrossRent, rentalYears, rentedEntirePeriod: rentEntered ? inputs.rentedEntirePeriod : null, totalGrossRent,
      grossYieldOnPurchase: rentEntered ? (annualGrossRent / purchasePrice) * 100 : null,
      grossYieldOnCurrent: rentEntered ? (annualGrossRent / currentValue) * 100 : null,
      annualMaintenance, totalMaintenance, renovationCosts, otherCosts, totalInvestedCost,
      sellingCostPercent, sellingCost, netSaleValue, totalCashBenefit: netSaleValue + totalGrossRent,
      netProfit, netRoi, outcome,
      projectionPartial: !projectionEntered && (!blank(inputs.futureRate) || !blank(inputs.projectionYears)),
      projection,
    },
  }
}

/** ₹ with a sign, for amounts that can be negative. */
export function formatSignedInr(value) {
  const rounded = Math.round(value)
  if (rounded > 0) return `+${formatInr(value)}`
  if (rounded < 0) return `−${formatInr(-value)}`
  return formatInr(0)
}

/** "8.25%" / "−3.10%" — display only; the value is never rounded in the model. */
export function formatPct(value, { signed = false } = {}) {
  const fixed = Math.abs(value).toFixed(2)
  if (Number(fixed) === 0) return '0.00%'
  const sign = value < 0 ? '−' : signed ? '+' : ''
  return `${sign}${fixed}%`
}

/** "6 years" / "5.50 years" for the ownership or rental period. */
export function formatYears(value) {
  return Number.isInteger(Math.round(value * 1e6) / 1e6) ? String(Math.round(value)) : value.toFixed(2)
}
