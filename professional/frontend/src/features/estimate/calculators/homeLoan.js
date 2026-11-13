/**
 * Home Loan EMI & Eligibility — the arithmetic, kept free of React so it can be
 * tested on its own (`node --test src/pages/site/calculators/homeLoan.test.js`).
 *
 * EMI (reducing balance, monthly rest):
 *   r   = annual rate / 12 / 100
 *   n   = tenure in years × 12
 *   EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)
 * and, at 0% interest, simply P / n (no division by zero).
 *
 * Eligibility is an ESTIMATE, not a lender's rule: it assumes total monthly
 * EMIs should stay within MAX_EMI_SHARE_OF_INCOME of monthly income, takes the
 * existing EMIs out of that, and finds the loan the remaining EMI supports at
 * the chosen rate and tenure (the EMI formula solved for P).
 */

// The affordability assumption, shown to the user with the result. Many Indian
// lenders work with a fixed-obligation-to-income ratio somewhere around 40–60%;
// 50% is used here as a transparent middle value, not as any bank's policy.
export const MAX_EMI_SHARE_OF_INCOME = 0.5

export const LIMITS = {
  minRate: 0.1, // % per annum
  maxRate: 30,
  minTenure: 1, // years
  maxTenure: 30,
}

// A realistic example, used only as the starting values; every field is editable.
export const DEFAULT_INPUTS = {
  propertyValue: '6000000',
  downPayment: '1200000',
  interestRate: '8.5',
  tenureYears: '20',
  monthlyIncome: '150000',
  existingEmis: '10000',
}

const monthlyRate = (annualRatePercent) => annualRatePercent / 12 / 100

/** Monthly EMI for principal P at an annual % rate over `years`. 0 for no loan. */
export function calculateEmi(principal, annualRatePercent, years) {
  const n = Math.round(years * 12)
  if (!(principal > 0) || !(n > 0)) return 0
  const r = monthlyRate(annualRatePercent)
  if (r === 0) return principal / n
  const growth = (1 + r) ** n
  return (principal * r * growth) / (growth - 1)
}

/** The principal a given monthly EMI supports: the EMI formula solved for P. */
export function principalForEmi(emi, annualRatePercent, years) {
  const n = Math.round(years * 12)
  if (!(emi > 0) || !(n > 0)) return 0
  const r = monthlyRate(annualRatePercent)
  if (r === 0) return emi * n
  const growth = (1 + r) ** n
  return (emi * (growth - 1)) / (r * growth)
}

/**
 * Month-by-month repayment, grouped by loan year. Each month's interest is the
 * running balance × r and the rest of the EMI repays principal; the final
 * month repays exactly what is left, so principal paid always sums to P.
 */
export function buildSchedule(principal, annualRatePercent, years) {
  const n = Math.round(years * 12)
  const emi = calculateEmi(principal, annualRatePercent, years)
  const r = monthlyRate(annualRatePercent)
  const rows = []
  let balance = principal > 0 ? principal : 0
  let totalPaid = 0
  let totalInterest = 0
  for (let year = 1; balance > 0 && year <= Math.ceil(n / 12); year += 1) {
    const opening = balance
    let principalPaid = 0
    let interestPaid = 0
    for (let month = 1; month <= 12 && (year - 1) * 12 + month <= n; month += 1) {
      const interest = balance * r
      const isLast = (year - 1) * 12 + month === n
      const principalPart = isLast ? balance : Math.min(emi - interest, balance)
      balance -= principalPart
      principalPaid += principalPart
      interestPaid += interest
      totalPaid += principalPart + interest
      totalInterest += interest
    }
    rows.push({ year, opening, principalPaid, interestPaid, closing: Math.max(balance, 0) })
  }
  return { emi, rows, totalPaid, totalInterest }
}

const toNumber = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value))

/**
 * Validates the raw (string) inputs. Returns error keys per field (they block
 * the result) and warning keys (shown alongside a result).
 */
export function validateHomeLoan(inputs) {
  const v = {
    propertyValue: toNumber(inputs.propertyValue),
    downPayment: toNumber(inputs.downPayment),
    interestRate: toNumber(inputs.interestRate),
    tenureYears: toNumber(inputs.tenureYears),
    monthlyIncome: toNumber(inputs.monthlyIncome),
    existingEmis: inputs.existingEmis === '' || inputs.existingEmis === undefined ? 0 : Number(inputs.existingEmis),
  }
  const errors = {}
  if (!Number.isFinite(v.propertyValue) || v.propertyValue <= 0) errors.propertyValue = 'errPropertyValue'
  if (!Number.isFinite(v.downPayment) || v.downPayment < 0) errors.downPayment = 'errDownPayment'
  else if (!errors.propertyValue && v.downPayment > v.propertyValue) errors.downPayment = 'errDownPaymentTooHigh'
  if (!Number.isFinite(v.interestRate) || v.interestRate < LIMITS.minRate || v.interestRate > LIMITS.maxRate) errors.interestRate = 'errInterestRate'
  if (!Number.isInteger(v.tenureYears) || v.tenureYears < LIMITS.minTenure || v.tenureYears > LIMITS.maxTenure) errors.tenureYears = 'errTenure'
  if (!Number.isFinite(v.monthlyIncome) || v.monthlyIncome <= 0) errors.monthlyIncome = 'errMonthlyIncome'
  if (!Number.isFinite(v.existingEmis) || v.existingEmis < 0) errors.existingEmis = 'errExistingEmis'
  const warnings = []
  if (!errors.monthlyIncome && !errors.existingEmis && v.existingEmis >= v.monthlyIncome) warnings.push('warnExistingExceedsIncome')
  else if (!errors.monthlyIncome && !errors.existingEmis && v.existingEmis >= v.monthlyIncome * MAX_EMI_SHARE_OF_INCOME) warnings.push('warnNoEmiRoom')
  return { values: v, errors, warnings }
}

/** Everything the result screen shows, or `{ errors }` when an input is invalid. */
export function calculateHomeLoan(inputs) {
  const { values: v, errors, warnings } = validateHomeLoan(inputs)
  if (Object.keys(errors).length) return { errors, warnings, result: null }

  const loanAmount = Math.max(v.propertyValue - v.downPayment, 0)
  const schedule = buildSchedule(loanAmount, v.interestRate, v.tenureYears)
  const months = v.tenureYears * 12
  const totalPayable = schedule.emi * months
  const totalInterest = Math.max(totalPayable - loanAmount, 0)

  const maxTotalEmi = v.monthlyIncome * MAX_EMI_SHARE_OF_INCOME
  const availableEmi = Math.max(maxTotalEmi - v.existingEmis, 0)
  const eligibleLoan = principalForEmi(availableEmi, v.interestRate, v.tenureYears)

  return {
    errors: {},
    warnings,
    result: {
      ...v,
      loanAmount,
      months,
      emi: schedule.emi,
      totalInterest,
      totalPayable,
      schedule: schedule.rows,
      scheduleTotalPaid: schedule.totalPaid,
      scheduleTotalInterest: schedule.totalInterest,
      ltvPercent: (loanAmount / v.propertyValue) * 100,
      downPaymentPercent: (v.downPayment / v.propertyValue) * 100,
      maxTotalEmi,
      availableEmi,
      eligibleLoan,
      withinEligibility: loanAmount <= eligibleLoan + 0.5,
      eligibilityGap: Math.max(loanAmount - eligibleLoan, 0),
    },
  }
}

/** ₹ with Indian digit grouping, whole rupees: ₹42,500 · ₹12,35,000 · ₹1,24,50,000. */
export function formatInr(value) {
  const amount = Number.isFinite(value) ? Math.round(value) : 0
  return `${amount < 0 ? '−' : ''}₹${Math.abs(amount).toLocaleString('en-IN')}`
}

/** A percentage with one decimal, e.g. 80.0%. */
export function formatPercent(value, digits = 1) {
  return `${(Number.isFinite(value) ? value : 0).toFixed(digits)}%`
}
