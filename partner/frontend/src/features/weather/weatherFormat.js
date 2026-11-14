// Pure helpers for the Weather page and the dashboard's weather banner.

export const SEVERITY_ORDER = ['INFO', 'WATCH', 'WARNING', 'SEVERE']
const PLACE_KEY = 'partner_weather_place'
const DASH = '–'

export const SEVERITY_STYLE = {
  INFO: { chip: 'bg-sky-50 text-sky-700 ring-sky-200', card: 'border-sky-200 bg-sky-50', bar: 'bg-sky-400', label: 'Info' },
  WATCH: { chip: 'bg-amber-50 text-amber-800 ring-amber-200', card: 'border-amber-200 bg-amber-50', bar: 'bg-amber-400', label: 'Watch' },
  WARNING: { chip: 'bg-orange-50 text-orange-800 ring-orange-200', card: 'border-orange-200 bg-orange-50', bar: 'bg-orange-500', label: 'Warning' },
  SEVERE: { chip: 'bg-red-50 text-red-700 ring-red-200', card: 'border-red-200 bg-red-50', bar: 'bg-red-600', label: 'Severe' },
}

export const CONDITION_LABELS = {
  CLEAR: 'Sunny', PARTLY_CLOUDY: 'Partly cloudy', CLOUDY: 'Cloudy', FOG: 'Fog or haze', DRIZZLE: 'Drizzle', RAIN: 'Rainy',
  HEAVY_RAIN: 'Heavy rain', SNOW: 'Snow', THUNDERSTORM: 'Thunderstorm', SEVERE_THUNDERSTORM: 'Severe thunderstorm',
  DUST: 'Dust', SQUALL: 'Squall', TORNADO: 'Tornado',
}

export function severityStyle(severity) {
  return SEVERITY_STYLE[severity] || SEVERITY_STYLE.INFO
}

// The alerts worth interrupting someone for: WATCH and above, most serious first.
export function notableAlerts(alerts) {
  return (alerts || [])
    .filter((alert) => SEVERITY_ORDER.indexOf(alert?.severity) >= 1)
    .sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity))
}

// "14:05", read from the time's own offset (the place's), never the browser's clock.
export function placeClock(iso) {
  const match = /T(\d{2}):(\d{2})/.exec(iso || '')
  return match ? `${match[1]}:${match[2]}` : DASH
}

// "Tue" for "2026-11-10".
export function placeWeekday(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '')
  if (!match) return DASH
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })
}

// "10 Nov, 14:05" in the place's own time.
export function placeDateTime(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || '')
  if (!match) return DASH
  const month = new Date(Date.UTC(2000, Number(match[2]) - 1, 1)).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })
  return `${match[3]} ${month}, ${match[4]}:${match[5]}`
}

// A number with its unit, or a dash when the provider sent nothing.
export function measure(value, unit = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 10) / 10}${unit}` : DASH
}

export function rainAmount(mm) {
  return typeof mm === 'number' && Number.isFinite(mm) ? `${Math.round(mm * 10) / 10} mm` : DASH
}

// The place a technician chose, kept in this browser only. Storage can be blocked.
export function loadChosenPlace(storage = globalThis.localStorage) {
  try {
    const place = JSON.parse(storage?.getItem(PLACE_KEY) || 'null')
    return place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? { ...place, source: 'CHOSEN' } : null
  } catch {
    return null
  }
}

export function saveChosenPlace(place, storage = globalThis.localStorage) {
  try {
    if (place) storage?.setItem(PLACE_KEY, JSON.stringify({ name: place.name, latitude: place.latitude, longitude: place.longitude }))
    else storage?.removeItem(PLACE_KEY)
  } catch {
    /* blocked storage: the choice simply lasts for this visit */
  }
}

export function sourceLabel(source) {
  return source === 'JOB' ? 'Current job location' : source === 'DEVICE' ? 'Your current location' : 'Chosen location'
}
