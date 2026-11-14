import { Check, Clock, CopyCheck, MapPinned, Wrench } from 'lucide-react'
import { Spinner } from '../../../shared/ui/ui.jsx'
import { serviceImage } from '../../../shared/constants/serviceImages.js'
import {
  END_TIMES,
  RADIUS_CHOICES_KM,
  START_TIMES,
  WEEKDAYS,
  scheduleSummary,
  timeLabel,
} from '../workPreferences.js'

/**
 * Services, service radius and working hours -- the reference's "Your services"
 * and "Experience & radius" screens. One component for the last registration
 * step and the Profile screen, so the two can never drift apart.
 *
 * `form` is the shape of workPreferences.js; `onChange(next)` receives a whole
 * new form. `catalog` is the trade's live services, or null while loading.
 * `showServices={false}` leaves the services picker out (registration keeps the
 * form's own selection; the technician narrows it later in Profile).
 */
export default function WorkPreferencesFields({ catalog, catalogError, form, onChange, tradeLabel = 'your trade', showServices = true }) {
  const set = (changes) => onChange({ ...form, ...changes })
  const setDay = (weekday, changes) => set({ days: form.days.map((day) => (day.weekday === weekday ? { ...day, ...changes } : day)) })
  const allSelected = Boolean(catalog?.length) && catalog.every((service) => form.serviceIds.includes(service.id))
  const toggleService = (id) => set({
    serviceIds: form.serviceIds.includes(id) ? form.serviceIds.filter((value) => value !== id) : [...form.serviceIds, id],
  })
  const copyFirstDay = () => {
    const first = form.days.find((day) => day.working) || form.days[0]
    set({ days: form.days.map((day) => ({ ...day, working: true, start: first.start, end: first.end })) })
  }

  return (
    <div className="space-y-5" data-testid="work-preferences-fields">
      {/* ---------------------------------------------------------- services */}
      {showServices && (
      <fieldset className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="field-label mb-0 flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Your services</legend>
          {Boolean(catalog?.length) && (
            <button
              type="button"
              className="text-xs font-extrabold text-oc-green hover:underline"
              onClick={() => set({ serviceIds: allSelected ? [] : catalog.map((service) => service.id) })}
              data-testid="services-toggle-all"
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-oc-muted">Select the {tradeLabel.toLowerCase()} services you provide. You are offered only these jobs.</p>
        {catalogError ? (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{catalogError}</p>
        ) : catalog === null ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-oc-muted"><Spinner className="h-4 w-4" /> Loading services…</p>
        ) : catalog.length === 0 ? (
          <p className="mt-2 rounded-xl bg-oc-sunken px-3 py-2 text-sm text-oc-muted">No individual services are listed for this trade yet: you are offered all of its jobs.</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 lg:grid-cols-4">
            {catalog.map((service) => {
              const checked = form.serviceIds.includes(service.id)
              const image = serviceImage(service)
              return (
                <li key={service.id}>
                  <label
                    className={`relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white text-left transition ${
                      checked ? 'border-oc-green ring-2 ring-oc-green/30' : 'border-oc-line hover:border-oc-green/60'
                    }`}
                    data-testid="service-option"
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleService(service.id)} />
                    <span className="aspect-[4/3] w-full bg-oc-sunken">
                      {image && <img src={image} alt="" className="h-full w-full object-cover" />}
                    </span>
                    <span className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md border-2 ${checked ? 'border-oc-green bg-oc-green text-white' : 'border-white bg-white/80 text-transparent'}`}>
                      <Check className="h-4 w-4" />
                    </span>
                    <span className="px-2.5 py-2 text-xs font-extrabold leading-snug text-oc-ink">{service.service_name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>
      )}

      {/* ------------------------------------------------------------ radius */}
      <label className="block">
        <span className="field-label flex items-center gap-1.5"><MapPinned className="h-3.5 w-3.5" /> Service radius</span>
        <select
          className="field-input"
          value={form.radiusKm === null ? '' : String(form.radiusKm)}
          onChange={(event) => set({ radiusKm: event.target.value === '' ? null : Number(event.target.value) })}
          data-testid="radius-select"
        >
          {form.radiusKm === null && <option value="">No personal limit (up to 15 km)</option>}
          {RADIUS_CHOICES_KM.map((km) => <option key={km} value={km}>{km} km</option>)}
        </select>
        <span className="mt-1 block text-xs text-oc-muted">How far you are willing to travel for a job, measured from where you are.</span>
      </label>

      {/* ----------------------------------------------------- working hours */}
      <fieldset className="min-w-0">
        <legend className="field-label flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Working hours</legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-oc-line bg-white px-3.5 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-oc-green"
            checked={form.scheduleEnabled}
            onChange={(event) => set({ scheduleEnabled: event.target.checked })}
            data-testid="schedule-toggle"
          />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-oc-ink">Only offer me jobs during set hours</span>
            <span className="block text-xs text-oc-muted" data-testid="schedule-summary">{scheduleSummary(form)} · India time</span>
          </span>
        </label>

        {form.scheduleEnabled && (
          <div className="mt-2 space-y-2" data-testid="schedule-days">
            <ul className="divide-y divide-oc-line rounded-2xl border border-oc-line bg-white">
              {form.days.map((day) => {
                const name = WEEKDAYS.find((entry) => entry.weekday === day.weekday)
                return (
                  <li key={day.weekday} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[130px_minmax(0,1fr)]" data-testid="schedule-day">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-oc-ink">
                      <input type="checkbox" className="h-4 w-4 accent-oc-green" checked={day.working} onChange={(event) => setDay(day.weekday, { working: event.target.checked })} />
                      <span>{name.label}</span>
                    </label>
                    {day.working ? (
                      <span className="col-span-2 flex min-w-0 items-center gap-1.5 sm:col-span-1">
                        <select className="field-input min-w-0 py-2" aria-label={`${name.label} start`} value={day.start} onChange={(event) => setDay(day.weekday, { start: event.target.value })}>
                          {START_TIMES.map((value) => <option key={value} value={value}>{timeLabel(value)}</option>)}
                        </select>
                        <span className="text-xs text-oc-muted">to</span>
                        <select className="field-input min-w-0 py-2" aria-label={`${name.label} end`} value={day.end} onChange={(event) => setDay(day.weekday, { end: event.target.value })}>
                          {END_TIMES.map((value) => <option key={value} value={value}>{timeLabel(value)}</option>)}
                        </select>
                      </span>
                    ) : (
                      <span className="text-right text-xs font-bold text-oc-muted sm:text-left">Off</span>
                    )}
                  </li>
                )
              })}
            </ul>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={copyFirstDay} data-testid="schedule-copy">
              <CopyCheck className="h-3.5 w-3.5" /> Use the first day&apos;s hours for every day
            </button>
            <p className="text-xs text-oc-muted">One window per day, ending the same day. Your Available switch still decides whether you get jobs at all.</p>
          </div>
        )}
      </fieldset>
    </div>
  )
}
