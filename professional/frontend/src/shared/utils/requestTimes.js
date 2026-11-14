/**
 * Request timestamps for lists such as the Builder dashboard's Recent Requests.
 *
 * The API sends `created_at` as ISO 8601 with an explicit offset
 * ("2026-10-23T12:17:13+05:30"), so it names one instant wherever the browser
 * is. These helpers order and label requests by that instant -- never by the
 * text, which sorts alphabetically, and never by guessing a zone.
 */
import { formatDate, formatRelativeTime } from './formatters.js'

// Epoch values below this are seconds, above it milliseconds (1e11 ms is 1973;
// 1e11 s is far in the future), so a seconds value is never read as 1970.
const SECONDS_LIMIT = 1e11

// A clock a little ahead of the server's still reads as "now".
const FUTURE_TOLERANCE_MS = 60 * 1000

/** The instant a timestamp names, in milliseconds, or null when it names none. */
export function timestampMs(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value < SECONDS_LIMIT ? value * 1000 : value
  }
  const parsed = Date.parse(String(value))
  return Number.isNaN(parsed) ? null : parsed
}

/** The `count` newest requests, newest first; requests with no usable time last. */
export function newestRequests(requests, count = 3) {
  return (Array.isArray(requests) ? requests : [])
    .map((request, index) => ({ request, index, at: timestampMs(request?.created_at) }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.index - b.index
      if (a.at === null) return 1
      if (b.at === null) return -1
      return b.at - a.at || a.index - b.index
    })
    .slice(0, count)
    .map((entry) => entry.request)
}

/**
 * "5 minutes ago" for a request's creation time. Missing or malformed: ''. A
 * time clearly in the future (a wrong clock or bad data) shows its date rather
 * than "in 3 hours", which would be meaningless for something already created.
 */
export function requestAgeLabel(value, now = Date.now()) {
  const at = timestampMs(value)
  if (at === null) return ''
  if (at - now > FUTURE_TOLERANCE_MS) return formatDate(new Date(at), '')
  return formatRelativeTime(new Date(Math.min(at, now)), '', now)
}
