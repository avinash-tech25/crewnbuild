/**
 * Government charges on a property purchase — the ONE authoritative source of
 * verified stamp-duty and registration rates, shared by the True Cost of
 * Property calculator (`trueCost.js`) and the Stamp Duty & Registration
 * calculator (`stampDuty.js`). No other file may hold a rate.
 *
 * Only jurisdictions whose rates were checked against the government's own
 * published orders are configured. Any other state gets no government charge
 * at all and every result for it is a partial estimate — a rate is never
 * assumed, and there is no India-wide default.
 */

/*
 * Telangana — verified against the Registration & Stamps Department's
 * published orders (registration.telangana.gov.in):
 *
 * • Stamp duty, "Sale" (Article 47-A, Schedule I-A, Indian Stamp Act 1899):
 *   5.5% — G.O.Ms.No.59, Revenue (Registration) Department, dated 20-07-2021,
 *   in force from 22-07-2021. The order sets one rate for "Sale"; it draws no
 *   distinction by buyer (e.g. women) or by residential / commercial property.
 *
 * • Registration fee, "Sale Deeds" (Table of Fees, Section 78, Registration
 *   Act 1908, in force from 02-09-2021, superseding G.O.Ms.No.60 of 20-07-2021):
 *   0.5% for property in any area except a Gram Panchayat; 2% for property in a
 *   Gram Panchayat. No cap is listed for sale deeds.
 *
 * NOT included: transfer duty. The department's Duty Fee Calculator shows a
 * separate "Transfer Duty" line, but its rate was not verified from an official
 * order here, so it is not charged and every Telangana result says so.
 *
 * Both charges are levied on the market value (guideline value) or the
 * consideration, whichever is higher; the calculators apply them to the value
 * the user enters, and say so.
 *
 * `notIncludedKey` / `sourceKey` are message names; each calculator words them
 * in its own translation namespace.
 */
export const GOVERNMENT_CHARGES = {
  Telangana: {
    stampDutyPercent: 5.5,
    registrationPercentByArea: { urban: 0.5, gramPanchayat: 2 },
    areaTypes: ['urban', 'gramPanchayat'],
    complete: false, // transfer duty not verified, so never a complete figure
    notIncludedKey: 'transferDutyNotIncluded',
    sourceKey: 'sourceTelangana',
  },
}

export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
]
export const PROPERTY_TYPES = ['residential', 'commercial']
export const BUYER_TYPES = ['individualMale', 'individualFemale', 'joint', 'company']

/** The verified configuration for a state, or null when none exists. */
export const chargeConfigFor = (state) => GOVERNMENT_CHARGES[state] || null

/**
 * Stamp duty and registration on `value` for a state and local-body area, from
 * the verified configuration only. Unconfigured state → every charge 0 and
 * `configured: false`. The caller validates `value` (> 0) and `areaType`.
 * No intermediate rounding: amounts are rounded only for display.
 */
export function governmentChargesFor(value, state, areaType) {
  const config = chargeConfigFor(state)
  if (!config) {
    return {
      configured: false, complete: false, stampDutyPercent: null, registrationPercent: null,
      stampDuty: 0, registration: 0, total: 0, notIncludedKey: null, sourceKey: null,
    }
  }
  const registrationPercent = config.registrationPercentByArea[areaType]
  const stampDuty = (value * config.stampDutyPercent) / 100
  const registration = (value * registrationPercent) / 100
  return {
    configured: true,
    complete: config.complete,
    stampDutyPercent: config.stampDutyPercent,
    registrationPercent,
    stampDuty,
    registration,
    total: stampDuty + registration,
    notIncludedKey: config.notIncludedKey,
    sourceKey: config.sourceKey,
  }
}

/** ₹ with Indian digit grouping, whole rupees: ₹42,500 · ₹12,35,000 · ₹1,24,50,000. */
export function formatInr(value) {
  const amount = Number.isFinite(value) ? Math.round(value) : 0
  return `₹${Math.abs(amount).toLocaleString('en-IN')}`
}
