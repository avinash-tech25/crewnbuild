/**
 * The header weather indicator on every dashboard (it sits beside the language
 * selector, where each dashboard places WeatherNavButton).
 *
 * Which place: the one this account picked in the popover (kept in this browser
 * per account); else the server's default -- the project an Owner, Builder or
 * Site Engineer works on, or the account's own place (a Store Manager's store,
 * a Supplier's business, an administrator's registered area). The popover
 * lists every site the account may read (/weather/projects, the Weather page's
 * own list and rules), and /weather/summary refuses a site it may not; a place
 * can also be searched and saved as the account's own ("My location"). With no
 * place at all it looks and behaves like the public pages before a place is
 * chosen. Badge and warnings: the most serious active WARNING/SEVERE alerts
 * across those sites.
 */
import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Check, MapPin } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { fetchWeatherProjects, fetchWeatherSummary, saveSiteLocation, searchSiteLocation } from '../weatherApi.js'
import WeatherIndicator, { PlaceSearch } from './WeatherIndicator.jsx'
import { cachedWeather, forgetWeather } from './weatherCache.js'
import { updatedAt } from './weatherTheme.js'
import { useWeatherFeed } from './useWeatherFeed.js'

function choiceKey(userId) {
  return `cnb_weather_site:${userId}`
}

function loadChoice(userId) {
  try {
    const value = globalThis.localStorage?.getItem(choiceKey(userId))
    return value === 'me' || /^\d+$/.test(value || '') ? value : null
  } catch {
    return null
  }
}

function saveChoice(userId, site) {
  try {
    if (site) globalThis.localStorage?.setItem(choiceKey(userId), site)
    else globalThis.localStorage?.removeItem(choiceKey(userId))
  } catch {
    /* blocked storage: the choice lasts for this page only */
  }
}

// The sites this account may read, loaded when the popover opens.
function SitePicker({ userId, current, onPick }) {
  const { td } = useLanguage()
  const [catalog, setCatalog] = useState(null)
  useEffect(() => {
    let cancelled = false
    cachedWeather(`projects:${userId}`, fetchWeatherProjects)
      .then((data) => { if (!cancelled) setCatalog(data) })
      .catch(() => { if (!cancelled) setCatalog({ projects: [], failed: true }) })
    return () => { cancelled = true }
  }, [userId])

  const rows = [
    { key: 'me', title: td('My location'), note: catalog?.personal?.location?.location_name || td('Not set yet') },
    ...(catalog?.projects || []).map((project) => ({
      key: String(project.id),
      title: td(project.title),
      note: [project.location?.location_name || project.city, project.access && String(project.access).toUpperCase() !== 'MEMBER' ? td('read-only') : null].filter(Boolean).join(' · '),
    })),
  ]
  return (
    <div data-testid="weather-location-controls">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">{td('Show weather for')}</p>
      {!catalog ? (
        <p className="mt-1 text-xs font-bold text-oc-muted">{td('Loading…')}</p>
      ) : (
        <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto" aria-label={td('Show weather for')}>
          {rows.map((row) => (
            <li key={row.key}>
              <button type="button" onClick={() => onPick(row.key)} aria-pressed={String(current) === row.key}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-start ${String(current) === row.key ? 'border-oc-green/50 bg-oc-mint/50' : 'border-oc-line bg-white hover:bg-oc-paper'}`}>
                <MapPin className="h-3.5 w-3.5 shrink-0 text-oc-green" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-extrabold text-oc-ink">{row.title}</span>
                  {row.note && <span className="block truncate text-[11px] font-semibold text-oc-muted">{row.note}</span>}
                </span>
                {String(current) === row.key && <Check className="h-4 w-4 shrink-0 text-oc-green" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">{td('Set My location')}</p>
      <div className="mt-1">
        <PlaceSearch
          search={async (text) => (await searchSiteLocation('me', text)).results}
          onChoose={async (row) => {
            await saveSiteLocation('me', {
              latitude: row.latitude, longitude: row.longitude, location_name: (row.name || '').slice(0, 255),
              country_code: row.country_code || null, timezone: row.timezone || null, source: 'SEARCH',
            })
            forgetWeather(`projects:${userId}`)
            onPick('me')
          }}
        />
      </div>
    </div>
  )
}

export default function AccountWeatherIndicator({ className = '' }) {
  const userId = useSelector((state) => state.auth?.user?.id)
  const [site, setSite] = useState(() => loadChoice(userId))
  const feed = useWeatherFeed(userId ? `summary:${userId}:${site || 'default'}` : null, () => fetchWeatherSummary(site), {
    // A picked site the account can no longer read: back to the default.
    onError: (error) => {
      if (!site || ![403, 404].includes(error?.response?.status)) return false
      saveChoice(userId, null)
      setSite(null)
      return true
    },
  })

  const pick = (next) => {
    saveChoice(userId, next)
    forgetWeather(`summary:${userId}:`)
    if (next === site) feed.retry()          // the same site with a new place: ask again
    else setSite(next)
  }

  const summary = feed.answer
  const chosen = summary?.site
  const available = summary?.status?.available
  const locationRequired = Boolean(summary?.status?.location_required)
  const placeName = summary?.location?.location_name || chosen?.label || ''
  const view = feed.loading && !summary ? { state: 'loading' } : !summary ? { state: 'unavailable', retrying: feed.loading }
    : locationRequired ? { state: 'idle', message: 'Choose a place to see its weather.' } : {
    state: available ? 'ready' : 'unavailable',
    retrying: feed.loading,
    refreshFailed: feed.refreshFailed,
    place: placeName,
    placeNote: chosen?.key === 'me' ? 'My location' : chosen?.label,
    current: summary.current,
    today: summary.today ? { min: summary.today.temp_min_c, max: summary.today.temp_max_c, rain_mm: summary.today.precipitation_mm } : null,
    rainChance: summary.today?.precipitation_probability_pct ?? summary.current?.precipitation_probability_pct,
    hours: summary.next_hours,
    presentation: summary.presentation,
    warnings: (summary.alerts || []).map((alert) => ({
      ...alert,
      where: alert.site === 'personal' ? 'My location' : alert.site_label,
      to: `/weather?project=${alert.project_id || 'me'}`,
    })),
    updated: updatedAt(summary.status?.last_updated_at),
    stale: summary.status?.stale,
  }

  return (
    <WeatherIndicator
      view={view}
      className={className}
      onRetry={feed.retry}
      details={{ to: chosen ? `/weather?project=${chosen.key}` : '/weather', label: 'Detailed weather' }}
    >
      {({ close }) => <SitePicker userId={userId} current={chosen?.key ?? site} onPick={(key) => { pick(key); close() }} />}
    </WeatherIndicator>
  )
}
