/**
 * Dates, times and numbers in the selected language.
 *
 * These replace the `toLocaleDateString('en-IN', ...)` calls scattered through
 * the dashboards, which printed "Sep" and "AM" in all seven languages, and the
 * bare `toLocaleDateString()` calls, which followed the *browser's* language
 * rather than the one the user picked -- so a Hindi interface on an American
 * laptop showed American dates.
 *
 * Digits stay Latin everywhere, including Arabic. Arabic's own numerals are
 * correct Arabic, but a price, a phone number or a reference has to stay
 * recognisable and comparable against what is stored, so the locale is pinned
 * to `-u-nu-latn`. Month and day names still translate.
 */

import { getActiveLanguage } from '../../i18n/activeLanguage.js'

// The app's language codes are not all complete locale tags. Pin each to a
// region so date order and grouping are defined rather than left to the engine.
const LOCALE_BY_LANGUAGE = {
  en: 'en-IN',
  hi: 'hi-IN',
  te: 'te-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  ar: 'ar-u-nu-latn',
}

export function activeLocale() {
  return LOCALE_BY_LANGUAGE[getActiveLanguage()] || 'en-IN'
}

function asDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * A date in the selected language, or `fallback` when there is no usable value.
 * The caller supplies the fallback because "not set" is interface copy and
 * belongs in the key table, not here.
 */
export function formatDate(value, fallback = '', options = undefined) {
  const date = asDate(value)
  if (!date) return fallback
  try {
    return date.toLocaleDateString(activeLocale(), options || { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return date.toLocaleDateString(undefined, options)
  }
}

// A calendar date with no time ("YYYY-MM-DD"), such as a project's start_date
// or end_date. Read as that day where the reader is: `new Date('2026-10-26')`
// would be UTC midnight, which is 25 October anywhere west of Greenwich.
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseCalendarDate(value) {
  const parts = typeof value === 'string' ? CALENDAR_DATE.exec(value) : null
  return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null
}

/** formatDate for a value that may be a calendar date; anything else as before. */
export function formatCalendarDate(value, fallback = '', options = undefined) {
  return formatDate(parseCalendarDate(value) || value, fallback, options)
}

/** Today as a calendar date ("YYYY-MM-DD") where the reader is. */
export function todayCalendarDate(now = new Date()) {
  const pad = (number) => String(number).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function formatTime(value, fallback = '') {
  const date = asDate(value)
  if (!date) return fallback
  try {
    return date.toLocaleTimeString(activeLocale(), { hour: 'numeric', minute: '2-digit' })
  } catch {
    return date.toLocaleTimeString()
  }
}

export function formatDateTime(value, fallback = '') {
  const date = asDate(value)
  if (!date) return fallback
  try {
    return date.toLocaleString(activeLocale(), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return date.toLocaleString()
  }
}

/** A number with the selected language's grouping. Never rounds. */
export function formatNumber(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  try {
    return numeric.toLocaleString(activeLocale())
  } catch {
    return String(numeric)
  }
}

/**
 * "3 days ago" in the selected language.
 *
 * `Intl.RelativeTimeFormat` is used rather than picking between a singular and
 * a plural key, because the two-form choice that works for English is wrong for
 * Arabic, which has six. The engine knows each language's rule; the key table
 * cannot express it.
 */
export function formatRelativeTime(value, fallback = '', now = Date.now()) {
  const date = asDate(value)
  if (!date) return fallback

  // `now` is the reference instant in milliseconds; callers pass it only to pin
  // the clock (tests), everyone else gets the real one.
  const elapsedSeconds = Math.round((date.getTime() - now) / 1000)
  const magnitude = Math.abs(elapsedSeconds)
  const divisions = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [2592000, 'day', 86400],
    [31536000, 'month', 2592000],
    [Infinity, 'year', 31536000],
  ]

  try {
    const formatter = new Intl.RelativeTimeFormat(activeLocale(), { numeric: 'auto' })
    for (const [limit, unit, divisor] of divisions) {
      if (magnitude < limit) {
        // Under a minute reads better as the language's own "now" than as a
        // second count that is stale by the time it is painted.
        if (unit === 'second' && magnitude < 45) return formatter.format(0, 'second')
        return formatter.format(Math.round(elapsedSeconds / divisor), unit)
      }
    }
  } catch {
    // No Intl support for this locale: fall through.
  }
  return formatDate(date, fallback)
}

/**
 * Weekday names in the selected language, for calendars that build their
 * own grid rather than formatting a whole date.
 */
export function weekdayName(weekdayIndex, options = { weekday: 'short' }) {
  try {
    // 2000-01-02 was a Sunday, so the index maps straight onto the week.
    return new Date(2000, 0, 2 + weekdayIndex).toLocaleDateString(activeLocale(), options)
  } catch {
    return String(weekdayIndex)
  }
}
