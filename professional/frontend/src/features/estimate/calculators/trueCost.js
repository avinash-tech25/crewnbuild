/**
 * True Cost of Property — the arithmetic, free of React so it can be tested on
 * its own (`node --test src/pages/site/calculators/trueCost.test.js`).
 *
 * Every amount is computed from what the user enters. There is no default
 * property price: until a valid price is entered nothing is calculated.
 *
 * Government charges come ONLY from GOVERNMENT_CHARGES in `propertyCharges.js`, and only for
 * jurisdictions whose rates were checked against the government's own
 * published orders. A location without verified data gets no government
 * charge at all and the result is labelled a partial estimate — a rate is
 * never assumed.
 */

// The verified rates, the state / property / buyer lists and the rupee format
// live in ONE shared module, `propertyCharges.js`, also used by the Stamp Duty
// & Registration calculator. They are re-exported here unchanged, so this
// calculator's imports and behaviour stay exactly as they were.
import { BUYER_TYPES, GOVERNMENT_CHARGES, PROPERTY_TYPES, STATES, formatInr, governmentChargesFor } from './propertyCharges.js'

export { BUYER_TYPES, GOVERNMENT_CHARGES, PROPERTY_TYPES, STATES, formatInr }
export const CHARGE_MODES = ['none', 'percent', 'fixed']

/** The starting state: every amount empty, every optional charge "None". */
export const EMPTY_INPUTS = Object.freeze({
  propertyPrice: '',
  propertyType: 'residential',
  state: '',
  city: '',
  areaType: '',
  buyerType: '',
  homeLoan: 'no',
  downPayment: '',
  brokerageMode: 'none',
  brokerageValue: '',
  legalMode: 'none',
  legalValue: '',
  initialSetup: '',
})

const blank = (value) => value === '' || value === null || value === undefined
const num = (value) => (blank(value) ? NaN : Number(value))

/** A percentage of the price, or a fixed rupee amount, or nothing. */
function optionalCharge(mode, rawValue, price, errorKey, errors) {
  if (mode === 'none') return 0
  if (blank(rawValue)) return 0
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value < 0) { errors[errorKey] = 'errNegative'; return 0 }
  if (mode === 'percent') {
    if (value > 100) { errors[errorKey] = 'errPercentTooHigh'; return 0 }
    return (price * value) / 100
  }
  return value
}

/**
 * Calculates the true purchase cost from the raw (string) inputs.
 * Returns `{ status, errors, result }`:
 *   status 'empty'   — no property price yet; result is null (nothing shown)
 *   status 'invalid' — an input is wrong; result is null
 *   status 'ok'      — result holds every figure, all derived from the inputs
 */
export function calculateTrueCost(inputs) {
  const errors = {}
  if (blank(inputs.propertyPrice)) return { status: 'empty', errors, result: null }

  const price = num(inputs.propertyPrice)
  if (!Number.isFinite(price) || price <= 0) errors.propertyPrice = 'errPropertyPrice'
  if (!inputs.state) errors.state = 'errState'
  if (!String(inputs.city || '').trim()) errors.city = 'errCity'
  if (!inputs.buyerType) errors.buyerType = 'errBuyerType'
  if (!PROPERTY_TYPES.includes(inputs.propertyType)) errors.propertyType = 'errPropertyType'

  const config = GOVERNMENT_CHARGES[inputs.state] || null
  if (config && !config.areaTypes.includes(inputs.areaType)) errors.areaType = 'errAreaType'

  const safePrice = Number.isFinite(price) && price > 0 ? price : 0
  const brokerage = optionalCharge(inputs.brokerageMode, inputs.brokerageValue, safePrice, 'brokerageValue', errors)
  const legal = optionalCharge(inputs.legalMode, inputs.legalValue, safePrice, 'legalValue', errors)

  let initialSetup = 0
  if (!blank(inputs.initialSetup)) {
    initialSetup = Number(inputs.initialSetup)
    if (!Number.isFinite(initialSetup) || initialSetup < 0) { errors.initialSetup = 'errNegative'; initialSetup = 0 }
  }

  const homeLoan = inputs.homeLoan === 'yes'
  let downPayment = 0
  if (homeLoan && !blank(inputs.downPayment)) {
    downPayment = Number(inputs.downPayment)
    if (!Number.isFinite(downPayment) || downPayment < 0) errors.downPayment = 'errNegative'
    else if (downPayment > safePrice) errors.downPayment = 'errDownPaymentTooHigh'
  }

  if (Object.keys(errors).length) return { status: 'invalid', errors, result: null }

  // Government charges: only from the shared verified configuration, never assumed.
  const charges = governmentChargesFor(price, inputs.state, inputs.areaType)
  const { stampDuty, registration } = charges
  const registrationPercent = charges.registrationPercent
  const governmentCharges = charges.total

  const totalCost = price + governmentCharges + brokerage + legal + initialSetup
  const additionalCost = totalCost - price
  const loanAmount = homeLoan ? price - downPayment : 0
  // The loan pays part of the price; it is never added to the cost again.
  const initialCash = homeLoan ? downPayment + governmentCharges + brokerage + legal + initialSetup : totalCost

  return {
    status: 'ok',
    errors,
    result: {
      price,
      stampDuty,
      stampDutyPercent: config ? config.stampDutyPercent : null,
      registration,
      registrationPercent: config ? registrationPercent : null,
      governmentCharges,
      governmentConfigured: Boolean(config),
      partial: !config || !config.complete,
      notIncludedKey: config ? config.notIncludedKey : null,
      sourceKey: config ? config.sourceKey : null,
      brokerage,
      legal,
      initialSetup,
      totalCost,
      additionalCost,
      additionalCostPercent: (additionalCost / price) * 100,
      homeLoan,
      downPayment: homeLoan ? downPayment : null,
      loanAmount,
      initialCash,
    },
  }
}
