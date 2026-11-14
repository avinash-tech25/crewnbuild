/**
 * The work-preferences form: which services, how far, which hours. Pure data
 * helpers, no imports, unit-tested under Node. The server validates everything
 * again; these only keep the form honest and build the request.
 *
 * Times are India wall-clock times ("HH:MM"). The end of the day is the value
 * END_OF_DAY in the form and `null` on the wire -- never "24:00".
 */

export const RADIUS_CHOICES_KM = [2, 5, 10, 15]
export const NEW_TECHNICIAN_RADIUS_KM = 10
export const END_OF_DAY = 'END'
// The reference screen's default working hours, used when a day is first switched on.
export const DEFAULT_START = '08:00'
export const DEFAULT_END = '20:00'

export const WEEKDAYS = [
  { weekday: 1, label: 'Monday', short: 'Mon' },
  { weekday: 2, label: 'Tuesday', short: 'Tue' },
  { weekday: 3, label: 'Wednesday', short: 'Wed' },
  { weekday: 4, label: 'Thursday', short: 'Thu' },
  { weekday: 5, label: 'Friday', short: 'Fri' },
  { weekday: 6, label: 'Saturday', short: 'Sat' },
  { weekday: 7, label: 'Sunday', short: 'Sun' },
]

const pad = (value) => String(value).padStart(2, '0')
/** Every half hour of the day: "00:00" .. "23:30". */
export const START_TIMES = Array.from({ length: 48 }, (_, index) => `${pad(Math.floor(index / 2))}:${index % 2 ? '30' : '00'}`)
/** "00:30" .. "23:30", then the end of the day. */
export const END_TIMES = [...START_TIMES.slice(1), END_OF_DAY]

/** "08:00" -> "8:00 AM"; END_OF_DAY -> "Midnight (end of day)". */
export function timeLabel(value) {
  if (value === END_OF_DAY || value === null) return 'Midnight (end of day)'
  const [hours, minutes] = String(value).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ''
  const suffix = hours < 12 ? 'AM' : 'PM'
  return `${hours % 12 || 12}:${pad(minutes)} ${suffix}`
}

/** "09:00:00" / "09:00" -> "09:00"; null -> END_OF_DAY. */
function fromServerTime(value, fallback) {
  if (value === null || value === undefined) return fallback
  return String(value).slice(0, 5)
}

function defaultDays() {
  return WEEKDAYS.map(({ weekday }) => ({ weekday, working: true, start: DEFAULT_START, end: DEFAULT_END }))
}

/** A new technician's form: every service, 10 km, no set hours (the reference's defaults). */
export function newTechnicianForm(catalog = []) {
  return {
    serviceIds: catalog.map((service) => service.id),
    radiusKm: NEW_TECHNICIAN_RADIUS_KM,
    scheduleEnabled: false,
    days: defaultDays(),
  }
}

/**
 * The saved preferences as a form. "All services" is shown as every service
 * ticked. A day never saved gets the default hours but stays switched off while
 * a schedule exists, so turning a day on offers sensible times.
 */
export function formFromServer(preferences, catalog = []) {
  const stored = preferences?.working_days || []
  const anyStored = stored.some((day) => day.working)
  const days = WEEKDAYS.map(({ weekday }) => {
    const day = stored.find((entry) => entry.weekday === weekday)
    if (day?.working) return { weekday, working: true, start: fromServerTime(day.start_time, DEFAULT_START), end: fromServerTime(day.end_time, END_OF_DAY) }
    return { weekday, working: !anyStored, start: DEFAULT_START, end: DEFAULT_END }
  })
  return {
    serviceIds: preferences?.offers_all_services ? catalog.map((service) => service.id) : [...(preferences?.service_ids || [])],
    radiusKm: preferences?.service_radius_km ?? null,
    scheduleEnabled: Boolean(preferences?.working_schedule_enabled),
    days,
  }
}

/** Why the form cannot be saved, or '' when it can. */
export function validateForm(form, catalog = []) {
  const known = new Set(catalog.map((service) => service.id))
  if (catalog.length > 0 && !form.serviceIds.some((id) => known.has(id))) return 'Select at least one service you provide.'
  if (form.radiusKm !== null && !RADIUS_CHOICES_KM.includes(Number(form.radiusKm))) return 'Choose a service radius of 2, 5, 10 or 15 km.'
  const working = form.days.filter((day) => day.working)
  if (form.scheduleEnabled && working.length === 0) return 'Choose at least one working day, or turn working hours off.'
  for (const day of working) {
    if (!day.start) return 'Choose a start time for every working day.'
    if (day.end !== END_OF_DAY && day.end <= day.start) {
      const name = WEEKDAYS.find((entry) => entry.weekday === day.weekday)?.label || 'A day'
      return `${name} must end after it starts, on the same day.`
    }
  }
  return ''
}

/**
 * The request body. Every service of the trade ticked is sent as "all services",
 * so services added to the trade later reach the technician too.
 */
export function toPayload(form, catalog = []) {
  const known = catalog.map((service) => service.id)
  const selected = known.filter((id) => form.serviceIds.includes(id))
  const offersAll = known.length === 0 || selected.length === known.length
  return {
    offers_all_services: offersAll,
    service_ids: offersAll ? [] : selected,
    service_radius_km: form.radiusKm === null ? null : Number(form.radiusKm),
    working_schedule_enabled: Boolean(form.scheduleEnabled),
    working_days: form.days.map((day) => ({
      weekday: day.weekday,
      working: Boolean(day.working),
      start_time: day.working ? day.start : null,
      end_time: day.working && day.end !== END_OF_DAY ? day.end : null,
    })),
  }
}

/** One line for a schedule: "Mon–Sun · 8:00 AM – 8:00 PM", or the days listed when they differ. */
export function scheduleSummary(form) {
  if (!form.scheduleEnabled) return 'Any time you are available'
  const working = form.days.filter((day) => day.working)
  if (working.length === 0) return 'No working days'
  const same = working.every((day) => day.start === working[0].start && day.end === working[0].end)
  const names = working.map((day) => WEEKDAYS.find((entry) => entry.weekday === day.weekday).short)
  const span = working.length === 7 ? 'Mon–Sun' : names.join(', ')
  return same ? `${span} · ${timeLabel(working[0].start)} – ${timeLabel(working[0].end)}` : `${span} · hours vary by day`
}
