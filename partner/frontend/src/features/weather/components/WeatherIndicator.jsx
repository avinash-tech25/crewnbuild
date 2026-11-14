// A copy of the Professional app's components/weather/WeatherIndicator.jsx (Partner shares no code with the Professional app); keep the two alike.
/**
 * The compact weather indicator every header carries: a small pill beside the
 * header's own controls -- icon, place, temperature -- that opens a popover with
 * the weather report. It renders whatever weather it is handed; the public
 * pages, the dashboards and Partner each feed it their own answer
 * (PublicWeatherIndicator, AccountWeatherIndicator, Partner's technician one).
 *
 * `view`: { state: 'idle' | 'loading' | 'ready' | 'unavailable', place, placeNote,
 *   current, today: { min, max, rain_mm }, rainChance, hours, presentation,
 *   warnings: [{ severity, title, message, where, to }], updated, stale,
 *   refreshFailed, retrying, message }
 *
 * Pill: the condition's icon, the place and the temperature -- the same on every
 * header. Phones show the icon over the temperature (as narrow as an icon
 * button, so no header gains a row); wider screens add the place. The condition
 * is named in the pill's tooltip and leads the popover: the landing header has
 * no room for it beside its links at any width. A WARNING or
 * SEVERE alert puts a coloured badge on the icon (never animated) and leads the
 * popover. The report is the popover's content; changing the place is a
 * secondary action under it, open by itself only when there is no place yet.
 * The popover is rendered at the end of <body>, so no header's overflow or
 * stacking can clip it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, CloudRain, Droplets, Loader2, MapPin, RefreshCw, Search, Thermometer, Umbrella, Wind, X } from 'lucide-react'
import { AmbientLayer, WeatherIcon, WeatherWarningBanner } from './WeatherAmbient.jsx'
import { compass, conditionIcon, hourLabel, percent, rainfall, shortPlace, speed, temperature, themeOf, topSeverity, weatherLine } from './weatherTheme.js'

const POPOVER_WIDTH = 344
const EDGE = 12

const BADGE = { SEVERE: 'bg-red-600', WARNING: 'bg-orange-500' }
const PILL_ALERT = { SEVERE: 'border-red-300 bg-red-50', WARNING: 'border-orange-300 bg-orange-50' }

function Reading({ icon: Icon, label, value, testId }) {
  const td = (text) => text
  return (
    <div className="flex items-center gap-2 rounded-xl bg-oc-paper/80 px-2.5 py-1.5" data-testid={testId}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-oc-green" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">{td(label)}</p>
        <p className="truncate text-xs font-extrabold text-oc-ink">{value}</p>
      </div>
    </div>
  )
}

// The place search every indicator offers: `search(text)` returns places
// ({ name, latitude, longitude, ... }); the chosen one goes to `onChoose`.
export function PlaceSearch({ search, onChoose, minLength = 2 }) {
  const td = (text) => text
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (query.trim().length < minLength) return
    setBusy(true)
    try { setResults((await search(query.trim())) || []) } catch { setResults([]) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex gap-1.5">
        <input aria-label={td('Search a city or town')} value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder={td('Search a city or town')}
          className="h-9 min-w-0 flex-1 rounded-lg border border-oc-line bg-white px-3 text-sm text-oc-ink outline-none focus:border-oc-green" />
        <button type="submit" disabled={busy} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-oc-deep px-3 text-xs font-extrabold text-white disabled:opacity-60"><Search className="h-3.5 w-3.5" />{td('Search')}</button>
      </div>
      {results && (results.length ? (
        <ul className="max-h-40 divide-y divide-oc-line overflow-y-auto rounded-lg border border-oc-line bg-white" aria-label={td('Places found')}>
          {results.slice(0, 6).map((row) => (
            <li key={`${row.latitude},${row.longitude}`}>
              <button type="button" onClick={() => onChoose(row)}
                className="w-full px-3 py-2 text-start text-xs font-bold text-oc-ink hover:bg-oc-mint/50">{td(row.name)}</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-oc-muted">{td('No places found. Try a nearby town.')}</p>)}
    </form>
  )
}

export default function WeatherIndicator({ view, details = null, onRetry = null, concealed = false, className = '', children = null }) {
  const td = (text) => text
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - EDGE * 2)
    const left = Math.min(Math.max(rect.right - width, EDGE), window.innerWidth - width - EDGE)
    setPosition({ top: rect.bottom + 8, left, width, maxHeight: Math.max(220, window.innerHeight - rect.bottom - 20) })
  }

  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => { if (!open) setChanging(false) }, [open])
  useEffect(() => { if (concealed) setOpen(false) }, [concealed])
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (buttonRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer, { passive: true })
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place)
    }
  }, [open])

  const ready = view.state === 'ready'
  const loading = view.state === 'loading'
  const presentation = ready ? view.presentation : null
  const theme = themeOf(presentation)
  const severity = topSeverity(view.warnings)
  const city = shortPlace(view.place)
  const current = view.current || {}
  const line = ready ? weatherLine(view.place, view.current, { ...presentation, warning: null }).split(' | ').map((part) => td(part)).join(' | ') : ''
  const label = [
    ready ? line : view.state === 'idle' ? td('Weather: choose a location') : [td(city), td(loading ? 'Loading weather…' : 'Live weather is temporarily unavailable.')].filter(Boolean).join(' | '),
    severity ? td(view.warnings[0].title) : null,
  ].filter(Boolean).join(' – ')
  // Changing the place is open by itself only when there is no place to report on.
  const controlsOpen = changing || view.state === 'idle' || view.locationRequired
  const direction = compass(current.wind_direction_deg)
  const range = [view.today?.min, view.today?.max].every((value) => typeof value === 'number')
    ? `${temperature(view.today.min)} / ${temperature(view.today.max)}` : '–'

  return (
    <div className={`relative shrink-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="weather-indicator"
        data-weather-theme={presentation?.theme || 'UNKNOWN'}
        data-weather-state={view.state}
        data-weather-alert={severity || undefined}
        className={`inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-extrabold text-oc-ink shadow-sm transition hover:border-oc-green/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-oc-green/40 max-sm:min-w-[2.5rem] max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:rounded-xl max-sm:px-1.5 ${severity ? PILL_ALERT[severity] : 'border-oc-line bg-white'}`}
      >
        <span className="relative inline-flex shrink-0">
          {loading ? (
            <Loader2 className="h-4 w-4 text-oc-green motion-safe:animate-spin max-sm:h-3.5 max-sm:w-3.5" aria-hidden="true" />
          ) : (
            <WeatherIcon theme={ready ? theme : view.state === 'idle' ? themeOf({ theme: 'PARTLY_CLOUDY' }) : null} className="h-4 w-4 max-sm:h-3.5 max-sm:w-3.5" />
          )}
          {severity && (
            <span aria-hidden="true" data-testid="weather-indicator-badge"
              className={`absolute -end-1.5 -top-1.5 grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-black leading-none text-white ring-2 ring-white ${BADGE[severity]}`}>!</span>
          )}
        </span>
        {ready ? (
          <>
            <span className="hidden max-w-[4.5rem] truncate sm:inline lg:max-w-[8rem]" data-testid="weather-indicator-place">{td(city)}</span>
            <span className="tabular-nums max-sm:text-[10px] max-sm:leading-none" data-testid="weather-indicator-temperature">{temperature(current.temperature_c)}</span>
          </>
        ) : view.state === 'idle' ? (
          <span className="hidden sm:inline">{td('Weather')}</span>
        ) : (
          <>
            {city && <span className="hidden max-w-[4.5rem] truncate sm:inline lg:max-w-[8rem]">{td(city)}</span>}
            <span className="text-oc-muted max-sm:text-[10px] max-sm:leading-none">{loading ? '' : '–'}</span>
          </>
        )}
      </button>

      {open && position && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={td('Weather report')}
          data-testid="weather-popover"
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
          className="z-[80] overflow-y-auto rounded-2xl border border-oc-line bg-white p-3 text-start text-oc-ink shadow-[0_18px_40px_rgba(23,32,28,.22)]"
        >
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-oc-green" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold" data-testid="weather-popover-place">{view.place ? td(view.place) : td('Weather')}</p>
              {view.placeNote && <p className="truncate text-[11px] font-bold text-oc-muted">{td(view.placeNote)}</p>}
            </div>
            <button type="button" onClick={close} aria-label={td('Close')} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-oc-muted hover:bg-oc-paper"><X className="h-4 w-4" /></button>
          </div>

          {(view.warnings || []).length > 0 && (
            <div className="mt-2 space-y-1.5" data-testid="weather-popover-warnings">
              {view.warnings.slice(0, 2).map((warning, index) => (
                <WeatherWarningBanner
                  key={`${warning.title}-${warning.where}-${index}`}
                  compact
                  warning={warning}
                  where={warning.where ? shortPlace(warning.where) : null}
                  more={index === 1 ? view.warnings.length - 2 : 0}
                  action={warning.to ? (
                    <Link to={warning.to} onClick={close} className="inline-flex h-7 shrink-0 items-center gap-0.5 self-center rounded-lg bg-white/80 px-2 text-[11px] font-extrabold text-current ring-1 ring-current/20">
                      {td('View')}<ChevronRight className="h-3 w-3" />
                    </Link>
                  ) : null}
                />
              ))}
            </div>
          )}

          {ready && (
            <div data-testid="weather-report">
              <div data-weather-theme={presentation?.theme || 'UNKNOWN'} className={`wx-ambient mt-2 flex items-center gap-3 rounded-xl border px-3 py-2.5 ${theme.tone}`}>
                <AmbientLayer theme={theme} warning={severity} />
                <WeatherIcon theme={theme} className="h-9 w-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-extrabold leading-none tabular-nums" data-testid="weather-popover-temperature">{temperature(current.temperature_c)}</p>
                  <p className="mt-1 text-xs font-extrabold text-oc-deep" data-testid="weather-popover-condition">{td(theme.label)}</p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Reading icon={Thermometer} label="Feels like" value={temperature(current.feels_like_c)} testId="weather-feels-like" />
                <Reading icon={Thermometer} label="Min / Max today" value={range} testId="weather-range" />
                <Reading icon={Droplets} label="Humidity" value={percent(current.humidity_pct)} testId="weather-humidity" />
                <Reading icon={Wind} label="Wind" value={[speed(current.wind_speed_kmh), direction].filter(Boolean).join(' ')} testId="weather-wind" />
                <Reading icon={Umbrella} label="Chance of rain" value={percent(view.rainChance)} testId="weather-rain-chance" />
                <Reading icon={CloudRain} label="Rainfall today" value={rainfall(view.today?.rain_mm)} testId="weather-rainfall" />
              </div>
              {(view.hours || []).length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-oc-muted">{td('Next hours')}</p>
                  <ol aria-label={td('Next hours')} className="mt-1 grid grid-cols-6 gap-1 text-center" data-testid="weather-popover-hours">
                    {view.hours.slice(0, 6).map((hour) => (
                      <li key={hour.time} className="rounded-lg bg-oc-paper/80 px-0.5 py-1">
                        <p className="text-[10px] font-bold text-oc-muted">{hourLabel(hour.time)}</p>
                        <WeatherIcon theme={conditionIcon(hour.condition)} className="mx-auto my-0.5 h-3.5 w-3.5" />
                        <p className="text-[11px] font-extrabold tabular-nums">{temperature(hour.temperature_c)}</p>
                        <p className="text-[10px] font-bold text-sky-700">{percent(hour.precipitation_probability_pct)}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <p className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-oc-muted" data-testid="weather-updated">
                <span className="min-w-0 flex-1">
                  {view.updated ? `${td('Updated')} ${view.updated}` : ''}
                  {view.stale || view.refreshFailed ? ` · ${td('last successful update; live data could not be refreshed')}` : ''}
                </span>
                {(view.stale || view.refreshFailed) && onRetry && (
                  <button type="button" onClick={onRetry} aria-label={td('Refresh')} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-oc-line text-oc-deep">
                    <RefreshCw className={`h-3 w-3 ${view.retrying ? 'motion-safe:animate-spin' : ''}`} />
                  </button>
                )}
              </p>
            </div>
          )}
          {view.state === 'idle' && view.message && (
            <p className="mt-2 text-xs font-bold text-oc-ink" data-testid="weather-needs-place">{td(view.message)}</p>
          )}
          {loading && (
            <p className="mt-3 flex items-center gap-2 text-sm font-bold text-oc-muted" role="status">
              <Loader2 className="h-4 w-4 text-oc-green motion-safe:animate-spin" aria-hidden="true" />{td('Loading live weather…')}
            </p>
          )}
          {view.state === 'unavailable' && (
            <div className="mt-2 rounded-xl border border-oc-line bg-oc-paper/80 px-3 py-2.5" data-testid="weather-unavailable" role="status">
              <p className="text-xs font-bold text-oc-ink">{td(view.message || 'Live weather is temporarily unavailable.')}</p>
              {!view.locationRequired && <p className="mt-0.5 text-[11px] text-oc-muted">{td('It will be tried again automatically.')}</p>}
              {onRetry && !view.locationRequired && (
                <button type="button" onClick={onRetry} disabled={view.retrying}
                  className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-oc-line bg-white px-3 text-xs font-extrabold text-oc-deep disabled:opacity-60">
                  <RefreshCw className={`h-3.5 w-3.5 ${view.retrying ? 'motion-safe:animate-spin' : ''}`} />{td('Try again')}
                </button>
              )}
            </div>
          )}

          {children && (
            <div className="mt-2 border-t border-oc-line pt-2">
              {controlsOpen ? (
                typeof children === 'function' ? children({ close, collapse: () => setChanging(false) }) : children
              ) : (
                <button type="button" onClick={() => setChanging(true)} aria-expanded="false" data-testid="weather-change-location"
                  className="inline-flex items-center gap-1 text-xs font-extrabold text-oc-green hover:underline">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />{td('Change location')}<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {details && (
            <Link to={details.to} onClick={close} data-testid="weather-popover-details"
              className="mt-2 flex h-9 items-center justify-center gap-1 rounded-xl bg-oc-green px-3 text-xs font-extrabold text-white hover:bg-oc-deep">
              {td(details.label)}<ChevronRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
