/**
 * Weather -- for the technician's current job, or a place they choose.
 *
 * The server picks the current job's location first. Without a job, the place
 * the technician last chose in this browser is used, or they search for one.
 * "Use my current location" asks the browser for the position only when it is
 * pressed, so the phone's location is shared only with permission.
 *
 * Alerts are recommendations from the forecast; nothing here changes a job.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Droplets,
  Haze, LocateFixed, MapPin, Moon, RefreshCw, Search, ShieldAlert, Sun, Tornado, TriangleAlert, Umbrella, Wind,
} from 'lucide-react'
import Logo from '../../../shared/ui/Logo.jsx'
import { Alert, Spinner } from '../../../shared/ui/ui.jsx'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { describeWeatherPlace, fetchTechnicianWeather, searchWeatherPlaces } from '../weatherApi.js'
import {
  CONDITION_LABELS, loadChosenPlace, measure, notableAlerts, placeClock, placeDateTime, placeWeekday, rainAmount,
  saveChosenPlace, severityStyle, sourceLabel,
} from '../weatherFormat.js'

const SHELL = 'mx-auto w-full max-w-[1100px] px-5 sm:px-8'
const REFRESH_MS = 10 * 60 * 1000

const CONDITION_ICONS = {
  CLEAR: Sun, PARTLY_CLOUDY: CloudSun, CLOUDY: Cloud, FOG: CloudFog, DRIZZLE: CloudDrizzle, RAIN: CloudRain,
  HEAVY_RAIN: CloudRainWind, SNOW: CloudSnow, THUNDERSTORM: CloudLightning, SEVERE_THUNDERSTORM: CloudLightning,
  DUST: Haze, SQUALL: Wind, TORNADO: Tornado,
}

function ConditionIcon({ condition, isDay = true, className = 'h-6 w-6' }) {
  const Icon = condition === 'CLEAR' && isDay === false ? Moon : (CONDITION_ICONS[condition] || Cloud)
  const tone = condition === 'SEVERE_THUNDERSTORM' || condition === 'TORNADO' ? 'text-red-600'
    : condition === 'THUNDERSTORM' ? 'text-violet-600'
      : condition === 'CLEAR' || condition === 'PARTLY_CLOUDY' ? 'text-amber-500'
        : ['RAIN', 'HEAVY_RAIN', 'DRIZZLE'].includes(condition) ? 'text-sky-600' : 'text-slate-500'
  return <Icon className={`${className} ${tone}`} aria-hidden="true" />
}

export function WeatherAlertCard({ alert }) {
  const style = severityStyle(alert.severity)
  return (
    <li className={`relative overflow-hidden rounded-xl border py-3 pl-4 pr-3 ${style.card}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${style.bar}`} aria-hidden="true" />
      <div className="flex items-start gap-3">
        <ConditionIcon condition={alert.weather_condition || (alert.alert_type === 'WIND' ? 'SQUALL' : alert.alert_type === 'HEAT' ? 'CLEAR' : 'RAIN')} className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ${style.chip}`}>
            {alert.severity === 'SEVERE' ? <ShieldAlert className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}{style.label}
          </span>
          <p className="mt-1 text-sm font-extrabold text-oc-ink">{alert.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-oc-ink/80">{alert.message}</p>
          {alert.expected_start && (
            <p className="mt-1 text-[11px] font-bold text-oc-muted">
              {alert.expected_end ? `Expected ${placeDateTime(alert.expected_start)} – ${placeDateTime(alert.expected_end)}` : `Expected from ${placeDateTime(alert.expected_start)}`} (local time)
            </p>
          )}
          {alert.recommendations?.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-oc-ink/80">
              {alert.recommendations.map((advice) => <li key={advice}>{advice}</li>)}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}

function LocationCard({ weather, onChoose, onDevice, onJob, busy, notice }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const location = weather?.location

  useEffect(() => { if (weather?.location_required) setOpen(true) }, [weather?.location_required])

  const search = async (event) => {
    event.preventDefault()
    if (query.trim().length < 3) { setError('Type at least 3 letters of a town, area or PIN code.'); return }
    setSearching(true)
    setError('')
    try {
      setResults((await searchWeatherPlaces(query.trim())).results || [])
    } catch (failure) {
      setResults([])
      setError(apiErrorMessage(failure, 'The search did not work. Please try again.'))
    } finally {
      setSearching(false)
    }
  }

  return (
    <section className="card p-4" aria-label="Weather location">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-oc-mint text-oc-green"><MapPin className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">{location ? sourceLabel(location.source) : 'Location'}</p>
          <p className="truncate text-sm font-extrabold text-oc-ink">{location ? location.name : 'No job location yet: choose where to see the weather.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {weather?.job_location_available && location?.source !== 'JOB' && (
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onJob} disabled={busy}>Back to job location</button>
          )}
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onDevice} disabled={busy}><LocateFixed className="h-3.5 w-3.5" /> Use my current location</button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <Search className="h-3.5 w-3.5" /> {open ? 'Close search' : 'Choose a place'}
          </button>
        </div>
      </div>
      {notice && <div className="mt-3"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {open && (
        <form onSubmit={search} className="mt-3 space-y-2 border-t border-oc-line pt-3">
          <label className="field-label" htmlFor="weather-place">Search a town, area or PIN code</label>
          <div className="flex gap-2">
            <input id="weather-place" className="field-input" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. Kondapur, Hyderabad" />
            <button type="submit" className="btn-primary shrink-0 px-4" disabled={searching}>{searching ? <Spinner className="h-4 w-4" /> : 'Search'}</button>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          {results && (results.length ? (
            <ul className="divide-y divide-oc-line rounded-xl border border-oc-line">
              {results.slice(0, 8).map((place) => (
                <li key={`${place.latitude},${place.longitude},${place.name}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 truncate text-xs font-bold text-oc-ink">{place.name}</span>
                  <button type="button" className="btn-ghost shrink-0 px-3 py-1 text-xs" onClick={() => { setOpen(false); setResults(null); onChoose(place) }}>Use this</button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-oc-muted">No places found. Try a nearby town or the PIN code.</p>)}
        </form>
      )}
    </section>
  )
}

function Current({ weather }) {
  const now = weather.current
  if (!now) return null
  const label = now.condition ? (now.condition === 'CLEAR' && now.is_day === false ? 'Clear' : CONDITION_LABELS[now.condition]) : 'Not reported'
  const facts = [
    { icon: Droplets, label: 'Humidity', value: measure(now.humidity_pct, '%') },
    { icon: Wind, label: 'Wind', value: `${measure(now.wind_speed_kmh, ' km/h')}${typeof now.wind_gust_kmh === 'number' ? ` · gusts ${measure(now.wind_gust_kmh)}` : ''}` },
    { icon: Umbrella, label: 'Chance of rain', value: measure(now.precipitation_probability_pct, '%') },
    { icon: CloudRain, label: 'Rainfall (last hour)', value: rainAmount(now.precipitation_mm) },
  ]
  return (
    <section className="card p-4" aria-label="Current weather">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">Now · observed {placeClock(now.observed_at)} local time</p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <ConditionIcon condition={now.condition} isDay={now.is_day} className="h-12 w-12" />
        <div>
          <p className="font-display text-4xl font-extrabold text-oc-ink">{measure(now.temperature_c, '°C')}</p>
          <p className="text-sm font-bold text-oc-deep">{label} · feels like {measure(now.feels_like_c, '°C')}</p>
        </div>
        <dl className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex-1 sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="rounded-xl bg-oc-sunken px-3 py-2">
              <dt className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-oc-muted"><fact.icon className="h-3 w-3" />{fact.label}</dt>
              <dd className="mt-0.5 text-sm font-extrabold text-oc-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function Hourly({ hours }) {
  if (!hours?.length) return null
  return (
    <section className="card p-4" aria-label="Next 24 hours">
      <h2 className="font-display text-base font-extrabold text-oc-ink">Next 24 hours</h2>
      <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {hours.map((hour) => (
          <li key={hour.time} className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1 rounded-xl bg-oc-sunken px-2 py-2 text-center">
            <span className="text-[11px] font-extrabold text-oc-muted">{placeClock(hour.time)}</span>
            <ConditionIcon condition={hour.condition} className="h-5 w-5" />
            <span className="text-sm font-extrabold text-oc-ink">{measure(hour.temperature_c, '°')}</span>
            <span className="text-[10px] font-bold text-sky-700">{measure(hour.precipitation_probability_pct, '%')}</span>
            <span className="text-[10px] font-semibold text-oc-muted">{rainAmount(hour.precipitation_mm)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Daily({ days }) {
  if (!days?.length) return null
  return (
    <section className="card p-4" aria-label="7-day forecast">
      <h2 className="font-display text-base font-extrabold text-oc-ink">7-day forecast</h2>
      <ul className="mt-3 divide-y divide-oc-line">
        {days.map((day, index) => (
          <li key={day.date} className="grid grid-cols-[3.5rem_2rem_minmax(0,1fr)_auto] items-center gap-2 py-2 text-sm">
            <span className="font-extrabold text-oc-ink">{index === 0 ? 'Today' : placeWeekday(day.date)}</span>
            <ConditionIcon condition={day.condition} className="h-6 w-6" />
            <span className="min-w-0 truncate text-xs font-bold text-oc-deep">
              {day.condition ? CONDITION_LABELS[day.condition] : 'Not reported'} · <span className="text-sky-700">{measure(day.precipitation_probability_pct, '%')} · {rainAmount(day.precipitation_mm)}</span>
              <span className="hidden text-oc-muted sm:inline"> · wind {measure(day.wind_speed_max_kmh, ' km/h')}</span>
            </span>
            <span className="font-extrabold text-oc-ink">{measure(day.temp_max_c, '°')} <span className="text-xs text-oc-muted">{measure(day.temp_min_c, '°')}</span></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function WeatherPage() {
  const navigate = useNavigate()
  const [place, setPlace] = useState(undefined)          // undefined: the job's (or the remembered choice)
  const [weather, setWeather] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (target) => {
    setState((value) => (value === 'ready' ? 'refreshing' : 'loading'))
    setError('')
    try {
      let answer = await fetchTechnicianWeather(target || null)
      // No job location: the place chosen earlier in this browser, if any.
      if (!target && answer.location_required) {
        const remembered = loadChosenPlace()
        if (remembered) answer = await fetchTechnicianWeather(remembered)
      }
      setWeather(answer)
      setState('ready')
    } catch (failure) {
      setError(apiErrorMessage(failure, 'Weather could not be loaded. Please try again.'))
      setState('error')
    }
  }, [])

  useEffect(() => { load(place) }, [load, place])
  useEffect(() => {
    const timer = setInterval(() => load(place), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load, place])

  const choose = (chosen) => {
    const next = { name: (chosen.name || '').slice(0, 120), latitude: chosen.latitude, longitude: chosen.longitude, source: 'CHOSEN' }
    saveChosenPlace(next)
    setNotice(null)
    setPlace(next)
  }

  const useDevice = () => {
    if (!navigator.geolocation) {
      setNotice({ tone: 'error', text: 'This browser cannot share its location. Choose a place instead.' })
      return
    }
    setBusy(true)
    setNotice({ tone: 'info', text: 'Allow location access when your browser asks.' })
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords
      let name = 'Your current location'
      try { name = (await describeWeatherPlace(latitude, longitude)).name || name } catch { /* the coordinates still work */ }
      setBusy(false)
      setNotice(null)
      setPlace({ latitude, longitude, name: name.slice(0, 120), source: 'DEVICE' })
    }, () => {
      setBusy(false)
      setNotice({ tone: 'error', text: 'Location access was not allowed. Choose a place instead.' })
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 })
  }

  const alerts = notableAlerts(weather?.alerts)

  return (
    <div className="min-h-screen bg-oc-paper">
      <header className="sticky top-0 z-20 border-b border-oc-line bg-white/90 backdrop-blur-md">
        <div className={`${SHELL} flex h-16 items-center gap-3`}>
          <Logo to="/dashboard" />
          <button type="button" onClick={() => navigate('/dashboard')} className="btn-ghost ml-auto px-3 sm:px-5">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back to dashboard</span><span className="sm:hidden">Back</span>
          </button>
        </div>
      </header>
      <main className={`${SHELL} space-y-4 pb-10 pt-5`}>
        <section className="flex flex-wrap items-center gap-3 rounded-[24px] bg-oc-deep px-5 py-4 text-white sm:px-6">
          <CloudSun className="h-8 w-8 text-oc-amber" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Weather</h1>
            <p className="text-sm text-[#b9d8c5]">Current conditions, forecasts and weather alerts where you work</p>
          </div>
          <button type="button" onClick={() => load(place)} aria-label="Refresh" title="Refresh" className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/10 transition hover:bg-white/15">
            <RefreshCw className={`h-4 w-4 ${state === 'loading' || state === 'refreshing' ? 'animate-spin' : ''}`} />
          </button>
        </section>

        {state === 'loading' && !weather && <div className="grid place-items-center py-10 text-oc-green"><Spinner className="h-7 w-7" /></div>}
        {state === 'error' && <Alert tone="error">{error}</Alert>}

        {weather && (
          <>
            <LocationCard weather={weather} onChoose={choose} onDevice={useDevice} onJob={() => { setNotice(null); setPlace(null) }} busy={busy} notice={notice} />
            {weather.status?.message && !weather.location_required && <Alert tone="info">{weather.status.message}{weather.status.last_updated_at ? ` Last updated ${placeDateTime(weather.status.last_updated_at)} UTC.` : ''}</Alert>}
            {weather.location && (
              <section className="card p-4" aria-label="Weather alerts">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 text-orange-600" />
                  <h2 className="font-display text-base font-extrabold text-oc-ink">Weather alerts</h2>
                  {alerts.length > 0 && <span className="rounded-full bg-oc-sunken px-2 py-0.5 text-[11px] font-extrabold">{alerts.length}</span>}
                </div>
                {alerts.length
                  ? <ul className="mt-3 space-y-2">{alerts.map((alert) => <WeatherAlertCard key={alert.event_key} alert={alert} />)}</ul>
                  : <p className="mt-2 text-xs text-oc-muted">No weather alerts for this place right now.</p>}
              </section>
            )}
            <Current weather={weather} />
            <Hourly hours={weather.hourly} />
            <Daily days={weather.daily} />
          </>
        )}
      </main>
    </div>
  )
}
