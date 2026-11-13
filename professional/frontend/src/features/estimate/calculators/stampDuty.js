/**
 * Stamp Duty & Registration — the arithmetic, free of React so it can be
 * tested on its own (`node --test src/pages/site/calculators/stampDuty.test.js`).
 *
 * One question: roughly how much government stamp duty and registration is
 * paid on this purchase? Every rate comes from the shared, verified
 * configuration in `propertyCharges.js` (the same one the True Cost of
 * Property calculator uses); nothing here holds a rate or an amount.
 *
 *   Stamp duty        = stamp-duty rate × property value
 *   Registration fee  = registration rate × property value
 *   Total             = stamp duty + registration fee
 *   Effective %       = total ÷ property value × 100
 *
 * There is no default value: until the property value is entered nothing is
 * calculated. A state without verified rates is reported as not configured,
 * never given an assumed rate.
 */
import { BUYER_TYPES, PROPERTY_TYPES, STATES, chargeConfigFor, formatInr, governmentChargesFor } from './propertyCharges.js'

export { BUYER_TYPES, PROPERTY_TYPES, STATES, chargeConfigFor, formatInr }

/** The starting state: no value, no state, no location. */
export const EMPTY_INPUTS = Object.freeze({
  propertyValue: '',
  state: '',
  city: '',
  areaType: '',
  propertyType: 'residential',
  buyerType: '',
})

const blank = (value) => value === '' || value === null || value === undefined

/**
 * Returns `{ status, errors, result }`:
 *   'empty'   — no property value yet (cleared value returns here too)
 *   'invalid' — something required is missing or wrong; result is null
 *   'ok'      — `result` holds the charges, the rates used and the status flags
 */
export function calculateStampDuty(inputs) {
  const errors = {}
  if (blank(inputs.propertyValue)) return { status: 'empty', errors, result: null }

  const value = Number(inputs.propertyValue)
  if (!Number.isFinite(value) || value <= 0) errors.propertyValue = 'errPropertyValue'
  if (!inputs.state) errors.state = 'errState'
  if (!String(inputs.city || '').trim()) errors.city = 'errCity'
  if (!PROPERTY_TYPES.includes(inputs.propertyType)) errors.propertyType = 'errPropertyType'
  if (inputs.buyerType && !BUYER_TYPES.includes(inputs.buyerType)) errors.buyerType = 'errBuyerType'
  const config = chargeConfigFor(inputs.state)
  if (config && !config.areaTypes.includes(inputs.areaType)) errors.areaType = 'errAreaType'
  if (Object.keys(errors).length) return { status: 'invalid', errors, result: null }

  // Property type and buyer type are recorded but do not change the rate: the
  // verified configuration has one rate for each, and no concession is invented.
  const charges = governmentChargesFor(value, inputs.state, inputs.areaType)
  return {
    status: 'ok',
    errors,
    result: {
      value,
      configured: charges.configured,
      partial: !charges.configured || !charges.complete,
      stampDutyPercent: charges.stampDutyPercent,
      registrationPercent: charges.registrationPercent,
      stampDuty: charges.stampDuty,
      registration: charges.registration,
      total: charges.total,
      effectivePercent: charges.configured ? (charges.total / value) * 100 : null,
      notIncludedKey: charges.notIncludedKey,
      sourceKey: charges.sourceKey,
    },
  }
}
