/**
 * Site Weather -- current conditions, forecasts and weather alerts for every
 * signed-in account: its own place ("My location", any role, no project
 * needed) and the project sites it may read -- its own projects (House Owner,
 * Builder, Site Engineer), and read-only the sites of a Store Manager's open
 * requests, a Supplier's open orders, or an administrator's scope.
 *
 * A dedicated page reached from the Weather button in each dashboard's top bar,
 * like the Site Engineer's Live Camera page: nothing here touches any dashboard,
 * project, schedule or assignment. Alerts carry recommendations only.
 *
 * Everything comes from /weather (services/weather.js). The server chooses the
 * provider, holds its key, sets every threshold, and says when data is stale or
 * unavailable; this page shows what it is sent and never fills a gap.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSelector } from 'react-redux'
import {
  ArrowLeft, Check, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun,
  Droplets, Eye, Gauge, Haze, History, Info, MapPin, Moon, RefreshCw, Search, ShieldAlert, Sun, Sunrise, Sunset,
  Tornado, TriangleAlert, Umbrella, Wind,
} from 'lucide-react'
import EmptyState from '../../../shared/dashboard/EmptyState.jsx'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { ADMIN_ROLES } from '../../../shared/auth/roles.js'
import { dashboardPath } from '../../../shared/auth/accountPaths.js'
import {
  acknowledgeWeatherAlert, fetchCurrentWeather, fetchDailyForecast, fetchHourlyForecast, fetchWeatherAlertHistory,
  fetchWeatherAlerts, fetchWeatherProjects, saveSiteLocation, searchSiteLocation,
} from '../weatherApi.js'
import { formatDateTime } from '../../../shared/utils/formatters.js'
import {
  MY_SITE, SEVERITY_ORDER, compass, coordinates, historyParams, measure, parseCoordinates, rainAmount, severityStyle,
  siteClock, siteDateTime, siteDayMonth, siteWeekday, sortAlerts,
} from '../weatherHelpers.js'
import { useWeatherText } from '../weatherText.js'

const cardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]'
const inputClass = 'h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-oc-ink outline-none focus:border-ocbrand-400'
const labelClass = 'text-[11px] font-extrabold uppercase tracking-wide text-oc-muted'
const primaryButton = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-extrabold text-oc-ink/75 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
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
      : condition === 'CLEAR' ? (isDay === false ? 'text-indigo-400' : 'text-amber-500')
        : condition === 'PARTLY_CLOUDY' ? 'text-amber-500'
          : condition === 'RAIN' || condition === 'HEAVY_RAIN' || condition === 'DRIZZLE' ? 'text-sky-600'
            : condition === 'DUST' ? 'text-amber-700' : 'text-slate-500'
  return <Icon className={`${className} ${tone}`} aria-hidden="true" />
}

function SeverityChip({ severity }) {
  const text = useWeatherText()
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ${severityStyle(severity).chip}`}>
      {severity === 'SEVERE' ? <ShieldAlert className="h-3 w-3" /> : severity === 'INFO' ? <Info className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
      {text(`weather.severity.${severity}`)}
    </span>
  )
}

function errorMessage(error, fallback) {
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

// ----------------------------------------------------------------- status

function StatusBanner({ status }) {
  const text = useWeatherText()
  const { td } = useLanguage()
  if (!status || (!status.message && !status.stale)) return null
  const tone = status.available ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-700'
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-xs font-bold ${tone}`}>
      <Info className="h-4 w-4 shrink-0" />
      <span>{status.message ? td(status.message) : ''}</span>
      {!status.location_required && (
        <span className="font-semibold opacity-80">
          {status.last_updated_at ? text('weather.lastUpdated', { time: formatDateTime(status.last_updated_at) }) : text('weather.neverUpdated')}
        </span>
      )}
    </div>
  )
}

// ----------------------------------------------------------------- location

function LocationPanel({ projectId, view, onSaved }) {
  const text = useWeatherText()
  const { td } = useLanguage()
  const location = view?.location
  const canEdit = Boolean(view?.can_edit_location)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [manual, setManual] = useState({ latitude: '', longitude: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => { setOpen(false); setResults(null); setNotice(null); setQuery('') }, [projectId])

  const search = async (event) => {
    event?.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      const data = await searchSiteLocation(projectId, query.trim())
      // The suggested place fills an empty box only, never over what is being typed.
      setQuery((current) => (current.trim() ? current : (data.query || current)))
      setResults(data.results || [])
    } catch (error) {
      setResults([])
      setNotice({ error: true, text: errorMessage(error, text('weather.searchFailed')) })
    } finally {
      setBusy(false)
    }
  }

  const save = async (payload) => {
    setBusy(true)
    setNotice(null)
    try {
      await saveSiteLocation(projectId, payload)
      setOpen(false)
      setResults(null)
      setNotice({ text: text('weather.locationSaved') })
      onSaved()
    } catch (error) {
      setNotice({ error: true, text: errorMessage(error, text('weather.locationFailed')) })
    } finally {
      setBusy(false)
    }
  }

  const saveManual = (event) => {
    event.preventDefault()
    const parsed = parseCoordinates(manual.latitude, manual.longitude)
    if (!parsed) {
      setNotice({ error: true, text: text('weather.locationInvalid') })
      return
    }
    save({ ...parsed, location_name: manual.name.trim() || null, source: 'MANUAL' })
  }

  const openEditor = () => {
    setOpen((value) => !value)
    if (!open && results === null) search()
  }

  return (
    <section className={cardClass} aria-label={text('weather.location')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ocbrand-50 text-oc-green"><MapPin className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className={labelClass}>{text('weather.location')}</p>
          {location ? (
            <>
              <p className="truncate text-sm font-extrabold text-oc-ink">{td(location.location_name || coordinates(location))}</p>
              <p className="truncate text-[11px] font-semibold text-oc-muted">
                {coordinates(location)}
                {location.approximate && <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">{text(view?.site === 'personal' ? 'weather.locationApproximateMine' : 'weather.locationApproximate')}</span>}
              </p>
            </>
          ) : (
            <p className="text-sm font-bold text-oc-muted">{text(view?.site === 'personal' ? 'weather.myLocationHint' : 'weather.locationNone')}</p>
          )}
        </div>
        {canEdit ? (
          <button type="button" onClick={openEditor} aria-expanded={open} className={secondaryButton}>
            {open ? text('weather.locationClose') : location ? text('weather.locationChange') : text('weather.locationSet')}
          </button>
        ) : (
          !location && <p className="text-xs font-semibold text-oc-muted">{text('weather.locationReadOnly')}</p>
        )}
      </div>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={`mt-2 text-xs font-bold ${notice.error ? 'text-red-700' : 'text-oc-green'}`}>{notice.text}</p>}
      {open && canEdit && (
        <div className="mt-3 grid gap-4 border-t border-slate-100 pt-3 lg:grid-cols-2">
          <form onSubmit={search} className="space-y-2">
            <label className="block">
              <span className={labelClass}>{text('weather.locationSearch')}</span>
              <div className="mt-1 flex gap-2">
                <input className={inputClass} value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder={text('weather.locationSearch')} />
                <button type="submit" disabled={busy} className={primaryButton}><Search className="h-3.5 w-3.5" />{text('weather.locationSearchButton')}</button>
              </div>
            </label>
            {results && (results.length ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {results.map((place) => (
                  <li key={`${place.latitude},${place.longitude}`} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-extrabold text-oc-ink">{td(place.name)}</span>
                      <span className="block text-[11px] font-semibold text-oc-muted">{coordinates(place)}</span>
                    </span>
                    <button type="button" disabled={busy} className={secondaryButton}
                      onClick={() => save({ latitude: place.latitude, longitude: place.longitude, location_name: place.name, country_code: place.country_code, timezone: place.timezone, source: 'SEARCH' })}>
                      {text('weather.locationUse')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs font-semibold text-oc-muted">{text('weather.locationNoResults')}</p>)}
          </form>
          <form onSubmit={saveManual} className="space-y-2">
            <p className={labelClass}>{text('weather.locationManual')}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-[11px] font-bold text-oc-muted">{text('weather.latitude')}</span>
                <input className={`mt-1 ${inputClass}`} inputMode="decimal" value={manual.latitude} onChange={(event) => setManual((value) => ({ ...value, latitude: event.target.value }))} placeholder="17.38500" /></label>
              <label className="block"><span className="text-[11px] font-bold text-oc-muted">{text('weather.longitude')}</span>
                <input className={`mt-1 ${inputClass}`} inputMode="decimal" value={manual.longitude} onChange={(event) => setManual((value) => ({ ...value, longitude: event.target.value }))} placeholder="78.48670" /></label>
            </div>
            <label className="block"><span className="text-[11px] font-bold text-oc-muted">{text('weather.locationName')}</span>
              <input className={`mt-1 ${inputClass}`} maxLength={255} value={manual.name} onChange={(event) => setManual((value) => ({ ...value, name: event.target.value }))} /></label>
            <button type="submit" disabled={busy} className={primaryButton}>{text('weather.locationSave')}</button>
          </form>
        </div>
      )}
    </section>
  )
}

// ----------------------------------------------------------------- alerts

function AlertCard({ alert, onAcknowledged, showProject = false }) {
  const text = useWeatherText()
  const { td } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openAdvice, setOpenAdvice] = useState(alert.severity === 'WARNING' || alert.severity === 'SEVERE')
  const style = severityStyle(alert.severity)
  const others = (alert.acknowledgements || []).map((row) => row.name).filter(Boolean)

  const acknowledge = async () => {
    setBusy(true)
    setFailed(false)
    try {
      onAcknowledged(await acknowledgeWeatherAlert(alert.id))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`relative overflow-hidden rounded-xl border ps-4 pe-3 py-3 ${style.card}`}>
      <span className={`absolute inset-y-0 start-0 w-1.5 ${style.bar}`} aria-hidden="true" />
      <div className="flex flex-wrap items-start gap-3">
        <ConditionIcon condition={alert.weather_condition || (alert.alert_type === 'WIND' ? 'SQUALL' : alert.alert_type === 'HEAT' ? 'CLEAR' : 'RAIN')} className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={alert.severity} />
            <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-oc-muted ring-1 ring-slate-200">
              {alert.source === 'OFFICIAL' ? text('weather.official') : text('weather.forecastBased')}
            </span>
            {showProject && alert.project_title && <span className="truncate text-[11px] font-extrabold text-oc-deep">{td(alert.project_title)}</span>}
          </div>
          <p className="mt-1 text-sm font-extrabold text-oc-ink">{td(alert.title)}</p>
          <p className="mt-0.5 text-xs font-medium leading-relaxed text-oc-ink/80">{td(alert.message)}</p>
          {alert.expected_start && (
            <p className="mt-1 text-[11px] font-bold text-oc-muted">
              {alert.expected_end
                ? text('weather.expected', { start: siteDateTime(alert.expected_start), end: siteDateTime(alert.expected_end) })
                : text('weather.expectedFrom', { start: siteDateTime(alert.expected_start) })} ({text('weather.siteTime')})
            </p>
          )}
          {alert.recommendations?.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setOpenAdvice((value) => !value)} aria-expanded={openAdvice} className="text-[11px] font-extrabold text-oc-green underline-offset-2 hover:underline">
                {text('weather.recommendations')}
              </button>
              {openAdvice && (
                <>
                  <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs font-medium text-oc-ink/80">
                    {alert.recommendations.map((advice) => <li key={advice}>{td(advice)}</li>)}
                  </ul>
                  <p className="mt-1 text-[10px] font-semibold text-oc-muted">{text('weather.recommendationsNote')}</p>
                </>
              )}
            </div>
          )}
          {others.length > 0 && <p className="mt-1 text-[11px] font-semibold text-oc-muted">{text('weather.acknowledgedBy', { names: others.join(', ') })}</p>}
          {failed && <p role="alert" className="mt-1 text-[11px] font-bold text-red-700">{text('weather.ackFailed')}</p>}
        </div>
        {alert.status === 'ACTIVE' && alert.can_acknowledge !== false && (alert.acknowledged ? (
          <span className="inline-flex h-9 items-center gap-1 rounded-lg bg-white/80 px-3 text-xs font-extrabold text-oc-green ring-1 ring-ocbrand-200"><Check className="h-3.5 w-3.5" />{text('weather.acknowledged')}</span>
        ) : (
          <button type="button" onClick={acknowledge} disabled={busy} className={primaryButton}>{text('weather.acknowledge')}</button>
        ))}
      </div>
    </li>
  )
}

// ----------------------------------------------------------------- current

function Metric({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-oc-green" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[10px] font-extrabold uppercase tracking-wide text-oc-muted">{label}</p>
        <p className="truncate text-sm font-extrabold text-oc-ink">{value}{sub && <span className="ms-1 text-[11px] font-semibold text-oc-muted">{sub}</span>}</p>
      </div>
    </div>
  )
}

function CurrentConditions({ view }) {
  const text = useWeatherText()
  const current = view?.current
  if (!current) return null
  const condition = current.condition || 'UNKNOWN'
  return (
    <section className={cardClass} aria-label={text('weather.observed')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-extrabold text-oc-ink">{text('weather.observed')}</h2>
        <span className="rounded-md bg-ocbrand-50 px-2 py-0.5 text-[11px] font-bold text-oc-green">
          {text('weather.observedAt', { time: siteClock(current.observed_at), zone: view.timezone || text('weather.siteTime') })}
        </span>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="flex items-center gap-4 rounded-2xl bg-[linear-gradient(135deg,#ecf6f1,#f7faf7)] p-4">
          <ConditionIcon condition={condition} isDay={current.is_day} className="h-14 w-14 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-4xl font-extrabold leading-none text-oc-ink">{measure(current.temperature_c, '°C')}</p>
            <p className="mt-1 text-sm font-extrabold text-oc-deep">{condition === 'CLEAR' && current.is_day === false ? text('weather.clearNight') : text(`weather.condition.${condition}`)}</p>
            <p className="text-xs font-semibold text-oc-muted">{text('weather.feelsLike', { value: measure(current.feels_like_c, '°C') })}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric icon={Droplets} label={text('weather.humidity')} value={measure(current.humidity_pct, '%')} />
          <Metric icon={Wind} label={text('weather.wind')} value={measure(current.wind_speed_kmh, 'km/h')}
            sub={[compass(current.wind_direction_deg), typeof current.wind_gust_kmh === 'number' ? text('weather.gusts', { value: measure(current.wind_gust_kmh, 'km/h') }) : ''].filter(Boolean).join(' · ')} />
          <Metric icon={Gauge} label={text('weather.pressure')} value={measure(current.pressure_hpa, 'hPa')} />
          <Metric icon={Eye} label={text('weather.visibility')} value={measure(current.visibility_km, 'km', 1)} />
          <Metric icon={Cloud} label={text('weather.cloud')} value={measure(current.cloud_cover_pct, '%')} />
          <Metric icon={CloudRain} label={text('weather.rainNow')} value={rainAmount(current.precipitation_mm)} />
          <Metric icon={Umbrella} label={text('weather.rainChance')} value={measure(current.precipitation_probability_pct, '%')} />
          <Metric icon={Sunrise} label={text('weather.sunrise')} value={siteClock(current.sunrise)} />
          <Metric icon={Sunset} label={text('weather.sunset')} value={siteClock(current.sunset)} />
        </div>
      </div>
    </section>
  )
}

// ----------------------------------------------------------------- forecasts

function HourlyForecast({ hours }) {
  const text = useWeatherText()
  return (
    <section className={cardClass} aria-label={text('weather.hourly')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-extrabold text-oc-ink">{text('weather.hourly')}</h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-oc-muted">{text('weather.forecastLabel')} · {text('weather.siteTime')}</span>
      </div>
      {hours?.length ? (
        <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {hours.map((hour) => (
            <li key={hour.time} className="flex w-[5.25rem] shrink-0 flex-col items-center gap-1 rounded-xl border border-slate-100 bg-slate-50/70 px-2 py-2.5 text-center">
              <span className="text-[11px] font-extrabold text-oc-muted">{siteClock(hour.time)}</span>
              <ConditionIcon condition={hour.condition} className="h-6 w-6" />
              <span className="text-sm font-extrabold text-oc-ink">{measure(hour.temperature_c, '°')}</span>
              <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-sky-700"><Umbrella className="h-3 w-3" />{measure(hour.precipitation_probability_pct, '%')}</span>
              <span className="text-[10px] font-semibold text-oc-muted">{rainAmount(hour.precipitation_mm)}</span>
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-oc-muted"><Wind className="h-3 w-3" />{measure(hour.wind_speed_kmh)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-3 text-xs font-semibold text-oc-muted">{text('weather.noForecast')}</p>}
    </section>
  )
}

function DailyForecast({ days, extended }) {
  const text = useWeatherText()
  const { language, td } = useLanguage()
  const [all, setAll] = useState(false)
  const shown = all ? days : (days || []).slice(0, 7)
  return (
    <section className={cardClass} aria-label={text('weather.daily')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-extrabold text-oc-ink">{text('weather.daily')}</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-oc-muted">{text('weather.forecastLabel')}</span>
          {extended && (
            <button type="button" onClick={() => setAll((value) => !value)} className={secondaryButton}>
              {all ? text('weather.showFewer') : text('weather.showDays', { count: days.length })}
            </button>
          )}
        </div>
      </div>
      {shown?.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {shown.map((day, index) => (
            <li key={day.date} className="flex flex-col gap-1 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
              <span className="text-xs font-extrabold text-oc-ink">{index === 0 ? text('weather.today') : siteWeekday(day.date, language || 'en')}</span>
              <span className="text-[10px] font-semibold text-oc-muted">{siteDayMonth(day.date)}</span>
              <div className="flex items-center gap-2">
                <ConditionIcon condition={day.condition} className="h-7 w-7 shrink-0" />
                <span className="text-sm font-extrabold text-oc-ink">{measure(day.temp_max_c, '°')}<span className="ms-1 text-xs font-bold text-oc-muted">{measure(day.temp_min_c, '°')}</span></span>
              </div>
              <span className="truncate text-[11px] font-bold text-oc-deep">{day.condition ? text(`weather.condition.${day.condition}`) : text('weather.condition.UNKNOWN')}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700"><Umbrella className="h-3 w-3" />{measure(day.precipitation_probability_pct, '%')} · {rainAmount(day.precipitation_mm)}</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-oc-muted"><Wind className="h-3 w-3" />{measure(day.wind_speed_max_kmh, 'km/h')} {compass(day.wind_direction_deg)}{typeof day.wind_gust_max_kmh === 'number' ? ` · ${text('weather.gusts', { value: measure(day.wind_gust_max_kmh) })}` : ''}</span>
              {day.summary && <span className="line-clamp-2 text-[10px] font-medium text-oc-muted">{td(day.summary)}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-xs font-semibold text-oc-muted">{text('weather.noForecast')}</p>}
    </section>
  )
}

// ----------------------------------------------------------------- history

const EMPTY_FILTERS = { project_id: '', alert_type: '', severity: '', status: '', acknowledged: '', date_from: '', date_to: '' }

function AlertHistory({ projects, alertTypes, reloadKey }) {
  const text = useWeatherText()
  const { td } = useLanguage()
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ alerts: [], total: 0, page_size: 25 })
  const [state, setState] = useState('loading')
  const update = (key) => (event) => { setFilters((value) => ({ ...value, [key]: event.target.value })); setPage(1) }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetchWeatherAlertHistory(historyParams({ ...filters, page }))
      .then((result) => { if (!cancelled) { setData(result); setState('ready') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [filters, page, reloadKey])

  const pages = Math.max(1, Math.ceil((data.total || 0) / (data.page_size || 25)))
  const select = (key, options, anyLabel = text('weather.any')) => (
    <select className={inputClass} value={filters[key]} onChange={update(key)}>
      <option value="">{anyLabel}</option>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  )

  return (
    <section className={cardClass} aria-label={text('weather.history')}>
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-oc-green" />
        <h2 className="font-display text-base font-extrabold text-oc-ink">{text('weather.history')}</h2>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <label className="block"><span className={labelClass}>{text('weather.project')}</span>
          {select('project_id', [[MY_SITE, text('weather.myLocation')], ...projects.map((project) => [project.id, td(project.title)])], text('weather.allProjects'))}</label>
        <label className="block"><span className={labelClass}>{text('weather.filterType')}</span>
          {select('alert_type', alertTypes.map((type) => [type.code, td(type.label)]))}</label>
        <label className="block"><span className={labelClass}>{text('weather.filterSeverity')}</span>
          {select('severity', SEVERITY_ORDER.map((severity) => [severity, text(`weather.severity.${severity}`)]))}</label>
        <label className="block"><span className={labelClass}>{text('weather.filterStatus')}</span>
          {select('status', ['ACTIVE', 'RESOLVED', 'EXPIRED'].map((status) => [status, text(`weather.status.${status}`)]))}</label>
        <label className="block"><span className={labelClass}>{text('weather.filterAck')}</span>
          {select('acknowledged', [['true', text('weather.ack.yes')], ['false', text('weather.ack.no')]])}</label>
        <label className="block"><span className={labelClass}>{text('weather.filterFrom')}</span>
          <input type="date" className={inputClass} value={filters.date_from} onChange={update('date_from')} /></label>
        <label className="block"><span className={labelClass}>{text('weather.filterTo')}</span>
          <input type="date" className={inputClass} value={filters.date_to} onChange={update('date_to')} /></label>
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }} className={secondaryButton}>{text('weather.clearFilters')}</button>
      </div>
      {state === 'error' && <p role="alert" className="mt-3 text-xs font-bold text-red-700">{text('weather.loadFailed')}</p>}
      {state !== 'error' && (data.alerts?.length ? (
        <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {data.alerts.map((alert) => (
            <li key={alert.id} className="grid gap-1 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={alert.severity} />
                  <span className="text-[11px] font-extrabold text-oc-deep">{alert.site === 'personal' ? text('weather.myLocation') : td(alert.project_title || '')}</span>
                  <span className="text-[11px] font-bold text-oc-muted">{td(alert.type_label)}</span>
                  {alert.source === 'OFFICIAL' && <span className="text-[10px] font-extrabold uppercase text-oc-muted">{text('weather.official')}</span>}
                </div>
                <p className="mt-0.5 truncate text-xs font-extrabold text-oc-ink" title={td(alert.title)}>{td(alert.title)}</p>
                <p className="line-clamp-2 text-[11px] font-medium text-oc-ink/75">{td(alert.message)}</p>
                <p className="text-[11px] font-semibold text-oc-muted">
                  {alert.weather_condition && `${text('weather.condition')}: ${text(`weather.condition.${alert.weather_condition}`)} · `}
                  {alert.expected_start && `${alert.expected_end ? text('weather.expected', { start: siteDateTime(alert.expected_start), end: siteDateTime(alert.expected_end) }) : text('weather.expectedFrom', { start: siteDateTime(alert.expected_start) })} · `}
                  {text('weather.generated', { time: formatDateTime(alert.created_at) })}
                  {alert.resolved_at && ` · ${text('weather.resolvedOn', { time: formatDateTime(alert.resolved_at) })}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${alert.status === 'ACTIVE' ? 'bg-ocbrand-50 text-oc-green' : 'bg-slate-100 text-oc-muted'}`}>{text(`weather.status.${alert.status}`)}</span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${alert.acknowledged ? 'bg-ocbrand-50 text-oc-green' : 'bg-slate-100 text-oc-muted'}`}>{alert.acknowledged ? text('weather.ack.yes') : text('weather.ack.no')}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : state === 'ready' ? <p className="mt-3 text-xs font-semibold text-oc-muted">{text('weather.historyEmpty')}</p>
        : <p className="mt-3 text-xs font-semibold text-oc-muted">{text('weather.loading')}</p>)}
      {pages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs font-bold text-oc-muted">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className={secondaryButton}>{text('weather.previous')}</button>
          <span>{text('weather.page', { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className={secondaryButton}>{text('weather.next')}</button>
        </div>
      )}
    </section>
  )
}

// ----------------------------------------------------------------- page

export default function WeatherPage() {
  const text = useWeatherText()
  const { td } = useLanguage()
  const navigate = useNavigate()
  const user = useSelector((state) => state.auth.user)
  const [searchParams, setSearchParams] = useSearchParams()
  const [catalog, setCatalog] = useState({ projects: [], alert_types: [] })
  const [listState, setListState] = useState('loading')
  const [projectId, setProjectId] = useState(searchParams.get('project') || '')
  const [weather, setWeather] = useState({ current: null, hourly: null, daily: null, alerts: null })
  const [weatherState, setWeatherState] = useState('idle')
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const loadProjects = useCallback(() => fetchWeatherProjects()
    .then((data) => {
      setCatalog(data)
      setListState('ready')
      setProjectId((current) => (current === MY_SITE || data.projects.some((project) => String(project.id) === String(current))
        ? current : String(data.projects[0]?.id || MY_SITE)))
    })
    .catch((error) => { setListState(error?.response?.status === 503 ? 'unavailable' : 'error') }), [])

  useEffect(() => { loadProjects() }, [loadProjects])

  useEffect(() => {
    if (!projectId) return undefined
    let cancelled = false
    setWeatherState((state) => (state === 'ready' ? 'refreshing' : 'loading'))
    setLoadError('')
    // The four reads share one fetch on the server (a per-site cache and lock).
    Promise.allSettled([fetchCurrentWeather(projectId), fetchHourlyForecast(projectId), fetchDailyForecast(projectId), fetchWeatherAlerts(projectId)])
      .then(([current, hourly, daily, alerts]) => {
        if (cancelled) return
        if (current.status === 'rejected') {
          setLoadError(errorMessage(current.reason, text('weather.loadFailed')))
          setWeatherState('error')
          return
        }
        setWeather({
          current: current.value,
          hourly: hourly.status === 'fulfilled' ? hourly.value : null,
          daily: daily.status === 'fulfilled' ? daily.value : null,
          alerts: alerts.status === 'fulfilled' ? alerts.value : null,
        })
        setWeatherState('ready')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey])

  // Kept current while the page stays open.
  useEffect(() => {
    const timer = setInterval(() => setReloadKey((value) => value + 1), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const chooseProject = (value) => {
    // The site already shown: nothing to change (clearing it here left the page blank).
    if (String(value) === String(projectId)) return
    setProjectId(value)
    setWeather({ current: null, hourly: null, daily: null, alerts: null })
    setSearchParams(value ? { project: value } : {}, { replace: true })
  }

  const refresh = () => { setReloadKey((value) => value + 1); loadProjects() }

  const replaceAlert = (updated) => setWeather((value) => ({
    ...value,
    alerts: value.alerts ? { ...value.alerts, alerts: value.alerts.alerts.map((alert) => (alert.id === updated.id ? updated : alert)) } : value.alerts,
  }))

  const view = weather.current
  const activeAlerts = useMemo(() => sortAlerts(weather.alerts?.alerts || []), [weather.alerts])
  const project = catalog.projects.find((row) => String(row.id) === String(projectId))

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0b5233,#083e2b)] shadow-[0_18px_50px_-38px_rgba(2,6,23,0.9)]">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6 sm:py-5">
            <button type="button" onClick={() => navigate(!user ? '/' : ADMIN_ROLES.includes(user.role) ? '/admin' : dashboardPath(user))}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15">
              <ArrowLeft className="h-4 w-4" /> {text('weather.back')}
            </button>
            <span aria-hidden="true" className="hidden h-10 w-px bg-white/20 sm:block" />
            <CloudSun className="hidden h-7 w-7 shrink-0 text-white sm:block" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-extrabold leading-tight tracking-tight text-white sm:text-2xl">{text('weather.title')}</h1>
              <p className="mt-1 text-xs leading-5 text-white/75 sm:text-sm">{project ? td(project.title) : projectId === MY_SITE ? text('weather.myLocation') : text('weather.subtitle')}</p>
            </div>
            {listState === 'ready' && (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <select aria-label={text('weather.project')} value={projectId} onChange={(event) => chooseProject(event.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white px-3 text-sm font-bold text-oc-ink outline-none sm:w-64 sm:flex-none">
                  {catalog.projects.map((row) => (
                    <option key={row.id} value={row.id}>
                      {td(row.title)}{row.access && row.access !== 'member' ? ` · ${text(`weather.access.${row.access}`)}` : ''}{row.active_alerts ? ` (${row.active_alerts})` : ''}
                    </option>
                  ))}
                  <option value={MY_SITE}>{text('weather.myLocation')}{catalog.personal?.active_alerts ? ` (${catalog.personal.active_alerts})` : ''}</option>
                </select>
                <button type="button" onClick={refresh} aria-label={text('weather.refresh')} title={text('weather.refresh')}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 text-white transition hover:bg-white/15">
                  <RefreshCw className={`h-4 w-4 ${weatherState === 'loading' || weatherState === 'refreshing' ? 'animate-spin' : ''}`} />
                </button>
              </div>
            )}
          </div>
        </section>

        {listState === 'loading' && <p className="text-sm font-semibold text-oc-muted">{text('weather.loading')}</p>}
        {listState === 'unavailable' && <section className={cardClass}><EmptyState icon={CloudSun} title={text('weather.unavailable')} message={text('weather.loadFailed')} /></section>}
        {listState === 'error' && <section className={cardClass}><EmptyState icon={CloudSun} title={text('weather.loadFailed')} message="" /></section>}
        {listState === 'ready' && projectId && (
          <>
            {weatherState === 'loading' && !view && <p className="text-sm font-semibold text-oc-muted">{text('weather.loading')}</p>}
            {weatherState === 'error' && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{td(loadError)}</p>}
            {view && (
              <>
                <StatusBanner status={view.status} />
                <LocationPanel projectId={projectId} view={view} onSaved={refresh} />
                <section className={cardClass} aria-label={text('weather.activeAlerts')}>
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="h-5 w-5 text-orange-600" />
                    <h2 className="font-display text-base font-extrabold text-oc-ink">{text('weather.activeAlerts')}</h2>
                    {activeAlerts.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-oc-ink">{activeAlerts.length}</span>}
                  </div>
                  {activeAlerts.length ? (
                    <ul className="mt-3 space-y-2">
                      {activeAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} onAcknowledged={replaceAlert} />)}
                    </ul>
                  ) : <p className="mt-2 text-xs font-semibold text-oc-muted">{text('weather.noAlerts')}</p>}
                </section>
                <CurrentConditions view={view} />
                {view.status?.available && <HourlyForecast hours={weather.hourly?.hours} />}
                {view.status?.available && <DailyForecast days={weather.daily?.days || []} extended={Boolean(weather.daily?.extended)} />}
              </>
            )}
          </>
        )}

        {listState === 'ready' && (
          <AlertHistory projects={catalog.projects.filter((row) => (row.access || 'member') === 'member')} alertTypes={catalog.alert_types || []} reloadKey={reloadKey} />
        )}
      </div>
    </div>
  )
}
