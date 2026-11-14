/**
 * The subscription payments screen's decisions, kept free of React so they can be
 * tested. Every figure shown is the server's (GET /admin/subscription-payments and
 * /summary); this file only formats it and builds the filter query.
 */

export const PAYMENT_STATUSES = [
  { value: 'PAID', label: 'Paid' },
  { value: 'CREATED', label: 'Pending / not completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'DISPUTED', label: 'Disputed' },
]

export const PLAN_OPTIONS = [
  { value: 'PROFESSIONAL', label: 'Professional Pro' },
  { value: 'BUSINESS', label: 'Premium' },
]

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']

const DURATION_LABELS = { MONTHLY: 'Monthly', SIX_MONTHS: '6 months', ANNUAL: 'Annual' }
const COUNTRY_NAMES = { IN: 'India' }
const MINOR_DIGITS = { INR: 2 }

export const STATUS_TONES = {
  PAID: 'bg-ocbrand-50 text-ocbrand-700',
  CREATED: 'bg-slate-100 text-slate-600',
  FAILED: 'bg-red-50 text-red-600',
  REFUNDED: 'bg-amber-50 text-amber-700',
  DISPUTED: 'bg-orange-50 text-orange-700',
}

export const statusLabel = (status) => PAYMENT_STATUSES.find((item) => item.value === status)?.label || status || '—'
export const planLabel = (plan, duration) =>
  `${PLAN_OPTIONS.find((item) => item.value === plan)?.label || plan || '—'}${duration ? ` · ${DURATION_LABELS[duration] || duration}` : ''}`
export const countryName = (code) => COUNTRY_NAMES[code] || code || '—'

// Minor units (paise) to a currency string. null/undefined stays a dash.
export function formatMinor(minor, currency = 'INR') {
  if (minor === null || minor === undefined || Number.isNaN(Number(minor))) return '—'
  const digits = MINOR_DIGITS[currency] ?? 2
  const amount = Number(minor) / 10 ** digits
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)
  } catch {
    return `${amount.toFixed(digits)} ${currency}`
  }
}

// A server timestamp ("...Z") in India time, which is how the months are counted.
export function formatWhen(iso, withTime = true) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

// The query string for the filters: empty values left out, a month only with a year.
export function paymentQuery(filters = {}, offset = 0, limit = 50) {
  const params = {}
  if (filters.year) {
    params.year = Number(filters.year)
    if (filters.month) params.month = Number(filters.month)
  }
  if (filters.plan) params.plan = filters.plan
  if (filters.status) params.status = filters.status
  const email = String(filters.email || '').trim()
  if (email) params.email = email
  if (limit !== null) {
    params.limit = limit
    params.offset = offset
  }
  return params
}

// Which state the payments list is in. An error wins over stale data.
export function paymentsViewState({ data, error, loading }) {
  if (error) return 'error'
  if (!data) return loading ? 'loading' : 'empty'
  return Array.isArray(data.payments) && data.payments.length ? 'list' : 'empty'
}

// The subscription a payment bought, as one line.
export function periodText(period) {
  if (!period) return 'No subscription period'
  const range = `${formatWhen(period.start, false)} → ${formatWhen(period.end, false)}`
  if (period.status === 'REVOKED') return `${range} · revoked${period.revoked_reason ? ` (${period.revoked_reason.toLowerCase().replace('_', ' ')})` : ''}`
  return `${range} · ${period.in_force ? 'in force now' : 'ended'}`
}

export const yearOptions = (now = new Date()) => {
  const current = Number(new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 4))  // India's year
  return Array.from({ length: current - 2024 + 1 }, (_, index) => current - index)
}
