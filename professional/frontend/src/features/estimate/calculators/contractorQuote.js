/**
 * Contractor Quote Verification — the arithmetic only, free of React, tested by
 * `node --test src/pages/site/calculators/contractorQuote.test.js`.
 *
 * Answers: "I have a contractor's quotation — what is its ₹/sq.ft, how is the
 * amount distributed, and how does it compare with MY OWN benchmark?"
 *
 * It holds no construction rate, price or per-city figure: the only reference is the
 * benchmark the user enters. It never calls a quote fair, wrong or inflated —
 * it reports arithmetic distance from that benchmark.
 *
 * One source of truth for the quote: `quoteValue` read through `quoteBasis`.
 *   basis 'total' → totalQuote = quoteValue,          quotedRate = totalQuote ÷ area
 *   basis 'rate'  → quotedRate = quoteValue,          totalQuote = quotedRate × area
 * Switching basis converts that one value (`convertQuoteValue`), so a total and a
 * rate can never disagree.
 *
 *   benchmarkTotal          = benchmarkRate × area
 *   quoteDifference         = totalQuote − benchmarkTotal
 *   differencePerSqft       = quotedRate − benchmarkRate
 *   differencePercent       = differencePerSqft ÷ benchmarkRate × 100   (= quoteDifference ÷ benchmarkTotal × 100)
 *   breakdownTotal          = material + labour + electrical + plumbing + flooring + painting + other   (blank = 0)
 *   remainingAmount         = totalQuote − breakdownTotal
 *   breakdownCoveragePercent= breakdownTotal ÷ totalQuote × 100
 *   categoryPercent         = category ÷ totalQuote × 100
 *   estimatedMargin         = totalQuote × margin% ÷ 100   (only when the user enters a margin)
 */
import { formatInr } from './propertyCharges.js'

export { formatInr }

export const CONSTRUCTION_TYPES = ['RESIDENTIAL', 'COMMERCIAL'] // the app's India building types
export const QUOTE_BASES = ['total', 'rate']
export const TRISTATE = ['unknown', 'yes', 'no']
export const COST_CATEGORIES = ['material', 'labour', 'electrical', 'plumbing', 'flooring', 'painting', 'other']
// Distance from the user's own benchmark, in % of it. Labels describe arithmetic only.
export const STATUS_THRESHOLDS = { close: 5, moderate: 10 }

/** Every amount starts empty; the selectors start at neutral choices. */
export const EMPTY_INPUTS = Object.freeze({
  area: '',
  floors: '',
  constructionType: 'RESIDENTIAL',
  quoteBasis: 'total',
  quoteValue: '',
  benchmarkRate: '',
  material: '',
  labour: '',
  electrical: '',
  plumbing: '',
  flooring: '',
  painting: '',
  other: '',
  marginPercent: '',
  gstIncluded: 'unknown',
  contingencyIncluded: 'unknown',
})

const blank = (value) => value === '' || value === null || value === undefined
const positiveNumber = (value) => !blank(value) && Number.isFinite(Number(value)) && Number(value) > 0

/**
 * Converts the single quote value when the basis changes, using the area.
 * Without a usable area (or value) there is nothing to convert from, so the
 * value is cleared rather than guessed.
 */
export function convertQuoteValue(value, fromBasis, toBasis, area) {
  if (fromBasis === toBasis) return value
  if (!positiveNumber(value) || !positiveNumber(area)) return ''
  const converted = toBasis === 'rate' ? Number(value) / Number(area) : Number(value) * Number(area)
  return String(Math.round(converted * 100) / 100)
}

/** Status of the quote against the user's benchmark, from the % difference. */
export function classifyQuote(differencePercent) {
  if (differencePercent <= 0) return 'below'
  if (differencePercent <= STATUS_THRESHOLDS.close) return 'close'
  if (differencePercent <= STATUS_THRESHOLDS.moderate) return 'moderate'
  return 'above'
}

/**
 * `{ status, errors, missing, result }`:
 *   'empty'      — nothing entered yet
 *   'incomplete' — a required value (area, floors, quote, benchmark) is blank
 *   'invalid'    — a value is out of range (zero, negative, not a number)
 *   'ok'         — the full verification
 */
export function calculateContractorQuote(inputs) {
  const amountFields = ['area', 'floors', 'quoteValue', 'benchmarkRate', 'marginPercent', ...COST_CATEGORIES]
  if (amountFields.every((field) => blank(inputs[field]))) return { status: 'empty', errors: {}, missing: [], result: null }

  const errors = {}
  const missing = ['area', 'floors', 'quoteValue', 'benchmarkRate'].filter((field) => blank(inputs[field]))
  const check = (field, ok, key) => { if (!blank(inputs[field]) && !ok(Number(inputs[field]))) errors[field] = key }
  check('area', (v) => Number.isFinite(v) && v > 0, 'errPositive')
  check('floors', (v) => Number.isInteger(v) && v >= 1, 'errFloors')
  check('quoteValue', (v) => Number.isFinite(v) && v > 0, 'errPositive')
  check('benchmarkRate', (v) => Number.isFinite(v) && v > 0, 'errPositive')
  for (const field of COST_CATEGORIES) check(field, (v) => Number.isFinite(v) && v >= 0, 'errNonNegative')
  check('marginPercent', (v) => Number.isFinite(v) && v >= 0 && v <= 100, 'errPercent')
  if (!CONSTRUCTION_TYPES.includes(inputs.constructionType)) errors.constructionType = 'errConstructionType'
  if (!QUOTE_BASES.includes(inputs.quoteBasis)) errors.quoteBasis = 'errQuoteBasis'
  if (Object.keys(errors).length) return { status: 'invalid', errors, missing, result: null }
  if (missing.length) return { status: 'incomplete', errors, missing, result: null }

  const area = Number(inputs.area)
  const quoteValue = Number(inputs.quoteValue)
  const totalQuote = inputs.quoteBasis === 'total' ? quoteValue : quoteValue * area
  const quotedRate = inputs.quoteBasis === 'rate' ? quoteValue : quoteValue / area
  const benchmarkRate = Number(inputs.benchmarkRate)
  const benchmarkTotal = benchmarkRate * area
  const differencePerSqft = quotedRate - benchmarkRate
  const quoteDifference = totalQuote - benchmarkTotal
  const differencePercent = (differencePerSqft / benchmarkRate) * 100

  const categories = COST_CATEGORIES
    .filter((key) => !blank(inputs[key]) && Number(inputs[key]) > 0)
    .map((key) => ({ key, amount: Number(inputs[key]), percentOfQuote: (Number(inputs[key]) / totalQuote) * 100 }))
  const breakdownTotal = categories.reduce((sum, item) => sum + item.amount, 0)
  const remainingAmount = totalQuote - breakdownTotal
  const breakdownEntered = categories.length > 0
  const marginEntered = !blank(inputs.marginPercent)

  return {
    status: 'ok',
    errors,
    missing,
    result: {
      area,
      floors: Number(inputs.floors),
      constructionType: inputs.constructionType,
      quoteBasis: inputs.quoteBasis,
      totalQuote,
      quotedRate,
      benchmarkRate,
      benchmarkTotal,
      differencePerSqft,
      quoteDifference,
      differencePercent,
      quoteStatus: classifyQuote(differencePercent),
      categories,
      breakdownEntered,
      breakdownTotal,
      remainingAmount,
      breakdownCoveragePercent: (breakdownTotal / totalQuote) * 100,
      breakdownExceedsQuote: breakdownTotal > totalQuote,
      partialBreakdown: breakdownEntered && breakdownTotal < totalQuote,
      marginEntered,
      marginPercent: marginEntered ? Number(inputs.marginPercent) : null,
      estimatedMargin: marginEntered ? (totalQuote * Number(inputs.marginPercent)) / 100 : null,
      gstIncluded: TRISTATE.includes(inputs.gstIncluded) ? inputs.gstIncluded : 'unknown',
      contingencyIncluded: TRISTATE.includes(inputs.contingencyIncluded) ? inputs.contingencyIncluded : 'unknown',
    },
  }
}

/** ₹ with a sign for differences that can be negative. */
export function formatSignedInr(value) {
  if (value > 0) return `+${formatInr(value)}`
  if (value < 0) return `−${formatInr(-value)}`
  return formatInr(0)
}

/** A signed percentage with two decimals. */
export function formatSignedPercent(value) {
  const fixed = Math.abs(value).toFixed(2)
  if (Number(fixed) === 0) return '0.00%'
  return `${value > 0 ? '+' : '−'}${fixed}%`
}
