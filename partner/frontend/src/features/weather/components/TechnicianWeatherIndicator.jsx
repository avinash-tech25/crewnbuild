import { Link } from 'react-router-dom'
import WeatherIndicator, { PlaceSearch } from './WeatherIndicator.jsx'
import { updatedAt } from './weatherTheme.js'
import { useWeatherFeed } from './useWeatherFeed.js'
import { fetchTechnicianWeather, searchWeatherPlaces } from '../weatherApi.js'
import { loadChosenPlace, notableAlerts, saveChosenPlace, sourceLabel } from '../weatherFormat.js'

// The current job's weather; with no job, the place chosen on the Weather page.
async function technicianWeather() {
  const answer = await fetchTechnicianWeather()
  const remembered = answer.location_required ? loadChosenPlace() : null
  return remembered ? fetchTechnicianWeather(remembered) : answer
}

/**
 * The technician dashboard header's weather indicator: the weather where the
 * technician works now -- the current job's location, or with no job the place
 * chosen here or on the Weather page (kept in this browser) -- with the report
 * in its popover. WARNING and SEVERE alerts there put a badge on it.
 * useWeatherFeed refreshes it every 10 minutes and tries again within seconds
 * after a failed fetch, keeping the last good report meanwhile.
 */
export default function TechnicianWeatherIndicator({ className = '' }) {
  const feed = useWeatherFeed('technician:now', technicianWeather)
  const answer = feed.answer
  const location = answer?.location
  const available = answer?.status?.available
  const today = answer?.daily?.[0]
  const view = feed.loading && !answer ? { state: 'loading' } : !answer ? { state: 'unavailable', retrying: feed.loading }
    : !location ? { state: 'idle', message: 'No current job: choose a place to see its weather.' } : {
    state: available ? 'ready' : 'unavailable',
    retrying: feed.loading,
    refreshFailed: feed.refreshFailed,
    place: location.name,
    placeNote: sourceLabel(location.source),
    current: answer.current,
    today: today ? { min: today.temp_min_c, max: today.temp_max_c, rain_mm: today.precipitation_mm } : null,
    rainChance: today?.precipitation_probability_pct ?? answer.current?.precipitation_probability_pct,
    hours: (answer.hourly || []).slice(0, 6),
    presentation: answer.presentation,
    warnings: notableAlerts(answer.alerts).filter((alert) => alert.severity === 'WARNING' || alert.severity === 'SEVERE')
      .map((alert) => ({ ...alert, where: location.name })),
    updated: updatedAt(answer.status?.last_updated_at),
    stale: answer.status?.stale,
  }

  return (
    <WeatherIndicator view={view} className={className} onRetry={feed.retry} details={{ to: '/weather', label: 'Detailed weather' }}>
      {({ close, collapse }) => (
        <div className="space-y-1.5" data-testid="weather-location-controls">
          {location?.source === 'JOB' ? (
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">Weather follows your current job.</p>
          ) : (
            <>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">Change location</p>
              <PlaceSearch
                minLength={3}
                search={async (text) => (await searchWeatherPlaces(text)).results}
                onChoose={(row) => {
                  saveChosenPlace({ name: (row.name || '').slice(0, 120), latitude: row.latitude, longitude: row.longitude, source: 'CHOSEN' })
                  feed.retry()
                  collapse()
                }}
              />
            </>
          )}
          <Link to="/weather" onClick={close} className="inline-flex text-xs font-extrabold text-oc-green hover:underline">Use my device location on the Weather page</Link>
        </div>
      )}
    </WeatherIndicator>
  )
}
