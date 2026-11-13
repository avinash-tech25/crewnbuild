/**
 * Property TDS — Income-tax Act, 2025, section 393(1) [Table: Sl. No. 3(i)]
 * (formerly section 194-IA of the Income-tax Act, 1961). Arithmetic and rule
 * checks only, free of React, tested by
 * `node --test src/pages/site/calculators/propertyTds.test.js`.
 *
 * Verified from official Income Tax Department sources (read 2026-10-08):
 *  - s.393(1) item 3(i): 1% of the consideration or the stamp duty value, whichever is higher;
 *    threshold ₹50 lakh; Note 1 — consideration is the aggregate paid by all transferees to all
 *    transferors for the threshold.  https://www.incometaxindia.gov.in/w/section-393-5
 *  - Threshold test on the higher of the two values: Note 3 and the Department's FAQ.
 *    Exactly ₹50 lakh is NOT decided here: s.393(1)(a) says "exceeds" while Note 3 says
 *    "equal to or greater than" (and is captioned for item 3(iii)), so that case is flagged.
 *  - s.397(2)(b)(i): no valid PAN → the higher of the Act rate, the rate in force, or 20%
 *    ("20% in any other case"; 5% only for items 8(ii)/8(v)).  https://www.incometaxindia.gov.in/w/section-397-6
 *  - s.397(1)(c)(i): no TAN needed for a deduction under item 3(i).
 *  - Rules 218(3) & 219(5): pay with Form 141 within thirty days from the end of the month of deduction.
 *  - s.393(1)(c): deduction at credit or payment, whichever is earlier.
 *  - Form 132 FAQ: certificate within 15 days from the due date for furnishing Form 141.
 *  - Transition FAQ: earlier event on or before 31-03-2026 → Income-tax Act, 1961 applies.
 *
 *   tdsBase         = max(salePrice, stampDutyValue)
 *   applicability   = base < threshold → not applicable;  base = threshold → needs verification;  base > threshold → applicable
 *   rate            = 1%  (PAN furnished)  |  max(1%, 20%) = 20%  (PAN not furnished)
 *   tds             = tdsBase × rate ÷ 100
 *   netToSeller     = salePrice − tds
 *   deductionDate   = earlier of the payment date and the credit date entered
 *   paymentDeadline = last day of the deduction month + 30 days   (Form 141)
 *   form132Due      = paymentDeadline + 15 days
 * Stamp duty / registration are NOT calculated here (see the Stamp Duty calculator).
 */
import { formatInr } from './propertyCharges.js'

export { formatInr }

// Verified rule values — not transaction defaults.
export const RULES = Object.freeze({
  ratePercent: 1,
  noPanFloorPercent: 20,
  threshold: 50_00_000,
  newActFrom: '2026-04-01',
  paymentDaysAfterMonthEnd: 30,
  certificateDaysAfterDue: 15,
})

export const OFFICIAL_LINKS = Object.freeze({
  section393: 'https://www.incometaxindia.gov.in/w/section-393-5',
  section397: 'https://www.incometaxindia.gov.in/w/section-397-6',
  rule218: 'https://www.incometaxindia.gov.in/w/rule-218-1',
  rule219: 'https://www.incometaxindia.gov.in/w/rule-219-1',
  form141Faq: 'https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/form-141-faqs',
  form132Faq: 'https://www.incometaxindia.gov.in/documents/d/guest/form-132-faqs',
  formsGuidance: 'https://www.incometaxindia.gov.in/faqs-and-guidance-notes-on-forms-as-per-income-tax-rules-2026',
  section194IA: 'https://www.incometaxindia.gov.in/w/tds-purchase-of-immovable-property',
})

/** Every value starts empty; PAN must be chosen explicitly. */
export const EMPTY_INPUTS = Object.freeze({
  salePrice: '',
  stampDutyValue: '',
  panAvailable: '',
  paymentDate: '',
  creditDate: '',
})

const blank = (value) => value === '' || value === null || value === undefined
const DAY = 24 * 60 * 60 * 1000

/** A real calendar date in YYYY-MM-DD (rejects 2026-02-30 etc.), or null. */
export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null
}

const toIso = (date) => date.toISOString().slice(0, 10)

/** Rule 218(3)/219(5): thirty days from the end of the month in which the deduction is made. */
export function paymentDeadline(deductionIso) {
  const date = parseIsoDate(deductionIso)
  if (!date) return null
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  return toIso(new Date(monthEnd.getTime() + RULES.paymentDaysAfterMonthEnd * DAY))
}

/** Form 132: within fifteen days from the due date for furnishing Form 141. */
export function certificateDeadline(deductionIso) {
  const due = paymentDeadline(deductionIso)
  return due ? toIso(new Date(parseIsoDate(due).getTime() + RULES.certificateDaysAfterDue * DAY)) : null
}

/** "8 Oct 2026" for display. */
export function formatDate(iso) {
  const date = parseIsoDate(iso)
  return date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
}

/** Rupees with paise when the amount is not whole (e.g. 1% of a decimal price). */
export function formatRupees(value) {
  const amount = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
  return `₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`
}

/**
 * `{ status, errors, missing, result }`:
 *   'empty'     — nothing entered
 *   'incomplete'— sale price, stamp duty value, PAN choice or a date still missing
 *   'invalid'   — out-of-range number or impossible date
 *   'previous'  — deduction on or before 31-03-2026: the 1961 Act applies, nothing is calculated
 *   'ok'        — result.applicability: 'notApplicable' | 'boundary' | 'applicable'
 */
export function calculatePropertyTds(inputs) {
  if (Object.keys(EMPTY_INPUTS).every((field) => blank(inputs[field]))) return { status: 'empty', errors: {}, missing: [], result: null }

  const errors = {}
  const missing = []
  for (const field of ['salePrice', 'stampDutyValue']) {
    if (blank(inputs[field])) missing.push(field)
    else if (!(Number.isFinite(Number(inputs[field])) && Number(inputs[field]) > 0)) errors[field] = 'errPositive'
  }
  if (blank(inputs.panAvailable)) missing.push('panAvailable')
  else if (!['yes', 'no'].includes(inputs.panAvailable)) errors.panAvailable = 'errPan'
  for (const field of ['paymentDate', 'creditDate']) {
    if (!blank(inputs[field]) && !parseIsoDate(inputs[field])) errors[field] = 'errDate'
  }
  if (blank(inputs.paymentDate) && blank(inputs.creditDate)) missing.push('date')
  if (Object.keys(errors).length) return { status: 'invalid', errors, missing, result: null }

  // s.393(1)(c): the earlier of credit and payment. Known even before the amounts are complete.
  const deductionDate = [inputs.paymentDate, inputs.creditDate].filter((d) => !blank(d)).sort()[0] || null
  if (deductionDate && deductionDate < RULES.newActFrom) {
    return { status: 'previous', errors, missing, result: { deductionDate } }
  }
  if (missing.length) return { status: 'incomplete', errors, missing, result: null }

  const salePrice = Number(inputs.salePrice)
  const stampDutyValue = Number(inputs.stampDutyValue)
  const tdsBase = Math.max(salePrice, stampDutyValue)
  const baseSource = stampDutyValue > salePrice ? 'stampDutyValue' : salePrice > stampDutyValue ? 'salePrice' : 'equal'
  const applicability = tdsBase < RULES.threshold ? 'notApplicable' : tdsBase === RULES.threshold ? 'boundary' : 'applicable'
  const panAvailable = inputs.panAvailable === 'yes'
  const ratePercent = panAvailable ? RULES.ratePercent : Math.max(RULES.ratePercent, RULES.noPanFloorPercent)
  const tds = applicability === 'applicable' ? (tdsBase * ratePercent) / 100 : null
  const netToSeller = tds === null ? null : salePrice - tds

  return {
    status: 'ok',
    errors,
    missing,
    result: {
      salePrice,
      stampDutyValue,
      tdsBase,
      baseSource,
      threshold: RULES.threshold,
      applicability,
      panAvailable,
      ratePercent,
      tds,
      netToSeller,
      tdsExceedsPrice: netToSeller !== null && netToSeller < 0,
      deductionDate,
      deductionFrom: inputs.paymentDate && inputs.creditDate
        ? (inputs.paymentDate === inputs.creditDate ? 'both' : deductionDate === inputs.creditDate ? 'credit' : 'payment')
        : inputs.creditDate ? 'credit' : 'payment',
      paymentDeadline: paymentDeadline(deductionDate),
      certificateDeadline: certificateDeadline(deductionDate),
      tanRequired: false, // s.397(1)(c)(i)
    },
  }
}
