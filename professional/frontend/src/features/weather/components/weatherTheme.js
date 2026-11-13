// The weather-aware look, for every page: what each theme the server chose
// (weather_presentation.py) looks like and says. Pure, so it is tested alone.
//
// The theme always comes from the server's reading of real weather against the
// alert thresholds; nothing here decides what the weather is.

export const THEMES = {
  STORM: { label: 'Thunderstorm', icon: 'storm', effect: 'storm', tone: 'border-red-200 bg-red-50/90', accent: 'text-red-700', message: 'Thunderstorm conditions in {place}.' },
  HEAVY_RAIN: { label: 'Heavy rain', icon: 'heavy-rain', effect: 'heavy-rain', tone: 'border-sky-300 bg-sky-50/90', accent: 'text-sky-800', message: 'Heavy rain in {place}.' },
  DUST: { label: 'Dust', icon: 'dust', effect: 'dust', tone: 'border-amber-300 bg-amber-50/90', accent: 'text-amber-800', message: 'Dusty conditions in {place}.' },
  WIND: { label: 'Windy', icon: 'wind', effect: 'wind', tone: 'border-teal-200 bg-teal-50/90', accent: 'text-teal-800', message: 'Strong winds in {place}.' },
  RAIN: { label: 'Rainy', icon: 'rain', effect: 'rain', tone: 'border-sky-200 bg-sky-50/90', accent: 'text-sky-800', message: 'Rain in {place} right now.' },
  LIGHT_RAIN: { label: 'Light rain', icon: 'drizzle', effect: 'light-rain', tone: 'border-sky-100 bg-sky-50/80', accent: 'text-sky-700', message: 'Light rain in {place}.' },
  HOT: { label: 'Hot', icon: 'hot', effect: 'heat', tone: 'border-orange-200 bg-orange-50/90', accent: 'text-orange-700', message: "It's a hot day in {place}." },
  SUNNY: { label: 'Sunny', icon: 'sun', effect: 'sun', tone: 'border-amber-200 bg-amber-50/80', accent: 'text-amber-700', message: 'Sunny skies in {place}.' },
  CLEAR_NIGHT: { label: 'Clear', icon: 'moon', effect: 'none', tone: 'border-indigo-100 bg-indigo-50/70', accent: 'text-indigo-700', message: 'A clear night in {place}.' },
  PARTLY_CLOUDY: { label: 'Partly cloudy', icon: 'partly', effect: 'cloud', tone: 'border-slate-200 bg-white/90', accent: 'text-oc-deep', message: 'Partly cloudy in {place}.' },
  CLOUDY: { label: 'Cloudy', icon: 'cloud', effect: 'cloud', tone: 'border-slate-200 bg-slate-50/90', accent: 'text-slate-700', message: 'Cloudy skies over {place}.' },
  FOG: { label: 'Fog or haze', icon: 'fog', effect: 'cloud', tone: 'border-slate-200 bg-slate-50/90', accent: 'text-slate-700', message: 'Fog or haze in {place}.' },
  SNOW: { label: 'Snow', icon: 'snow', effect: 'none', tone: 'border-slate-200 bg-white/90', accent: 'text-slate-700', message: 'Snow in {place}.' },
  UNKNOWN: { label: 'Weather', icon: 'cloud', effect: 'none', tone: 'border-oc-line bg-white/90', accent: 'text-oc-deep', message: 'Weather for {place}.' },
}

const RAINY = new Set(['STORM', 'HEAVY_RAIN', 'RAIN', 'LIGHT_RAIN'])

export function themeOf(presentation) {
  return THEMES[presentation?.theme] || THEMES.UNKNOWN
}

// "It's a hot day in Hyderabad." plus "Rain expected in your area today." when the
// forecast says so and it is not already raining.
export function weatherMessage(presentation, place) {
  const theme = themeOf(presentation)
  const where = (place || '').split(',')[0].trim() || 'your area'
  const lines = [theme.message.replace('{place}', where)]
  if (presentation?.rain_expected_today && !RAINY.has(presentation.theme)) lines.push('Rain expected in your area today.')
  return lines.join(' ')
}

// "Hyderabad | 32°C | Sunny", or "Hyderabad | Severe Thunderstorm Warning".
export function weatherLine(place, current, presentation) {
  const where = (place || '').split(',')[0].trim()
  const warning = presentation?.warning
  if (warning && warning.severity === 'SEVERE') return [where, warning.title].filter(Boolean).join(' | ')
  const temperature = typeof current?.temperature_c === 'number' ? `${Math.round(current.temperature_c)}°C` : null
  return [where, temperature, themeOf(presentation).label].filter(Boolean).join(' | ')
}

// The icon for one forecast hour's condition (the provider's code, read server-side).
const CONDITION_ICONS = {
  CLEAR: 'sun', PARTLY_CLOUDY: 'partly', CLOUDY: 'cloud', FOG: 'fog', DRIZZLE: 'drizzle', RAIN: 'rain', HEAVY_RAIN: 'heavy-rain',
  SNOW: 'snow', THUNDERSTORM: 'storm', SEVERE_THUNDERSTORM: 'storm', DUST: 'dust', SQUALL: 'wind', TORNADO: 'storm',
}

export function conditionIcon(condition) {
  return { icon: CONDITION_ICONS[condition] || 'cloud' }
}

// "Hyderabad" from "Hyderabad, Telangana".
export function shortPlace(place) {
  return (place || '').split(',')[0].trim()
}

export function temperature(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}°C` : '–'
}

// "NE" for 45°: where the wind blows from.
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function compass(degrees) {
  return typeof degrees === 'number' && Number.isFinite(degrees) ? POINTS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8] : ''
}

export function rainfall(mm) {
  return typeof mm === 'number' && Number.isFinite(mm) ? `${Math.round(mm * 10) / 10} mm` : '–'
}

export function speed(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} km/h` : '–'
}

// "14:00" for a forecast hour, read from the time's own offset (the place's clock).
export function hourLabel(iso) {
  const match = /T(\d{2}):(\d{2})/.exec(iso || '')
  return match ? `${match[1]}:${match[2]}` : '–'
}

// The most serious of a list of WARNING/SEVERE alerts, for the indicator's badge.
export function topSeverity(warnings) {
  const severities = (warnings || []).map((warning) => warning?.severity)
  return severities.includes('SEVERE') ? 'SEVERE' : severities.includes('WARNING') ? 'WARNING' : null
}

export function percent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '–'
}

// "14:30" in the viewer's clock, for "Updated 14:30".
export function updatedAt(iso) {
  if (!iso) return null
  const moment = new Date(iso)
  return Number.isNaN(moment.getTime()) ? null : moment.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// The place a visitor chose on the public pages, kept for this browsing session only.
const PLACE_KEY = 'cnb_public_weather_place'

export function loadSessionPlace(storage = globalThis.sessionStorage) {
  try {
    const place = JSON.parse(storage?.getItem(PLACE_KEY) || 'null')
    return place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? place : null
  } catch {
    return null
  }
}

export function saveSessionPlace(place, storage = globalThis.sessionStorage) {
  try {
    if (place) storage?.setItem(PLACE_KEY, JSON.stringify({ name: place.name, latitude: place.latitude, longitude: place.longitude, source: place.source }))
    else storage?.removeItem(PLACE_KEY)
  } catch {
    /* blocked storage: the place lasts for this page only */
  }
}

// "Severe" and "Warning" alerts are the ones shown across the application.
export function isSerious(severity) {
  return severity === 'WARNING' || severity === 'SEVERE'
}
