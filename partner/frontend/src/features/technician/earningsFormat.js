/**
 * Display helpers for technician earnings. Amounts are only ever DISPLAYED here:
 * every figure is computed and stored by the server (Decimal, rounded half-up to
 * the paisa) and arrives as an exact decimal string. No imports: unit-tested under Node.
 */

/** "0%", "15%", "12.5%", "7.33%" -- the stored rate, without invented precision. */
export function formatPercent(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return ''
  return `${Number(value.toFixed(2))}%`
}

/** True when a commission of exactly zero applies, so the UI can say so plainly. */
export function isZeroCommission(rate) {
  return Number(rate) === 0
}

/** The service an earning was for, even when its name was never known. */
export function earningTitle(earning) {
  return earning?.service_name || 'Completed job'
}

// ------------------------------------------------------------ this week, by day
// Only a picture of recorded earnings the server already returned: each bar is
// the sum of those records' `net_amount` on one India day. Nothing is estimated.
// India time is a fixed UTC+05:30 (as on the server), and the week starts on
// Monday, the same boundaries the summary's "This Week" uses.

const DAY_MS = 86400000
const INDIA_OFFSET_MS = 5.5 * 3600000
export const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A server timestamp (UTC, usually without a zone suffix) in epoch ms. */
export function utcMillis(value) {
  if (!value) return NaN
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
}

/** Monday 00:00 India time of the week holding `nowMs`, in epoch ms. */
export function indiaWeekStart(nowMs) {
  const local = new Date(nowMs + INDIA_OFFSET_MS)
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - INDIA_OFFSET_MS
  const mondayBased = (local.getUTCDay() + 6) % 7
  return midnight - mondayBased * DAY_MS
}

/** Whole paise of a decimal string, so sums are exact. */
export function toPaise(amount) {
  const value = Number(amount)
  return Number.isFinite(value) ? Math.round(value * 100) : 0
}

/**
 * Seven days, Monday first: { label, paise, isToday, isFuture }, plus the total.
 * Earnings outside this India week are ignored.
 */
export function weeklySeries(items, nowMs) {
  const start = indiaWeekStart(nowMs)
  const todayIndex = Math.floor((nowMs - start) / DAY_MS)
  const days = WEEK_DAYS.map((label, index) => ({ label, paise: 0, isToday: index === todayIndex, isFuture: index > todayIndex }))
  for (const item of items || []) {
    const at = utcMillis(item?.earned_at)
    if (!Number.isFinite(at)) continue
    const index = Math.floor((at - start) / DAY_MS)
    if (index >= 0 && index < 7) days[index].paise += toPaise(item.net_amount)
  }
  return { days, totalPaise: days.reduce((total, day) => total + day.paise, 0) }
}

/**
 * Whether a newest-first history holds every earning of this week: the server
 * has no more pages, or the oldest record loaded is from before the week began.
 */
export function coversWeek(items, hasMore, nowMs) {
  if (!hasMore) return true
  const oldest = items?.length ? utcMillis(items[items.length - 1].earned_at) : NaN
  return Number.isFinite(oldest) && oldest < indiaWeekStart(nowMs)
}

export const SUMMARY_CARDS = [
  { key: 'today_net', label: 'Today' },
  { key: 'week_net', label: 'This Week' },
  { key: 'month_net', label: 'This Month' },
  { key: 'total_net', label: 'Total Earnings' },
]
