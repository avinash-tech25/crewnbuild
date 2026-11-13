/**
 * The header weather indicator on the public pages (landing, sign-in, sign-up,
 * and every page that uses the landing header): no account needed.
 *
 * Where: a place the visitor chose earlier in this browsing session; else, if
 * the browser already allows this site the location, the device's position;
 * else nothing until the visitor asks -- "Use my current location" (the browser
 * then asks for permission) or a city search, both in the popover. No place is
 * ever assumed: until one is chosen, no weather is shown as theirs. The place is
 * named in the popover and can be changed there at any time.
 *
 * The weather is /weather/public: general weather and public forecast warnings
 * only. useWeatherFeed refreshes it every 10 minutes and, after a failed fetch,
 * tries again within seconds, keeping the last good report on screen meanwhile.
 */
import { useCallback, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { LocateFixed } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { describePublicPlace, fetchPublicWeather, searchPublicPlaces } from '../weatherApi.js'
import WeatherIndicator, { PlaceSearch } from './WeatherIndicator.jsx'
import { useWeatherFeed } from './useWeatherFeed.js'
import { loadSessionPlace, saveSessionPlace, updatedAt } from './weatherTheme.js'

function usePublicWeather() {
  const [place, setPlace] = useState(() => loadSessionPlace())
  const [locating, setLocating] = useState(false)
  const [notice, setNotice] = useState('')

  const choose = useCallback((next) => {
    saveSessionPlace(next)
    setNotice('')
    setPlace(next)
  }, [])

  const locate = useCallback(() => {
    if (!navigator.geolocation) { setNotice('This browser cannot share its location. Search for your city instead.'); return }
    setLocating(true)
    setNotice('')
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let name = null
      try { name = (await describePublicPlace(coords)).name } catch { /* the weather still works without a name */ }
      setLocating(false)
      choose({ latitude: coords.latitude, longitude: coords.longitude, name: name || 'Your current location', source: 'DEVICE' })
    }, () => {
      setLocating(false)
      setNotice('Location access was not allowed. Search for your city instead.')
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 })
  }, [choose])

  // Only when the browser already allows it: never prompt on page load.
  useEffect(() => {
    if (place || !navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' }).then((status) => { if (status.state === 'granted') locate() }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const key = place ? `public:${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}` : null
  const feed = useWeatherFeed(key, () => fetchPublicWeather(place))

  return { place, feed, locating, notice, choose, locate }
}

export default function PublicWeatherIndicator({ className = '', concealed = false }) {
  const { td } = useLanguage()
  const signedIn = useSelector((state) => Boolean(state.auth?.user))
  const { place, feed, locating, notice, choose, locate } = usePublicWeather()

  const weather = feed.answer
  const available = weather?.status?.available
  const view = !place ? { state: 'idle' } : {
    state: feed.loading && !weather ? 'loading' : available ? 'ready' : 'unavailable',
    retrying: feed.loading,
    refreshFailed: feed.refreshFailed,
    place: place.name || 'Your current location',
    placeNote: place.source === 'DEVICE' ? 'Your current location' : 'Chosen location',
    current: weather?.current,
    today: weather?.today ? { min: weather.today.temp_min_c, max: weather.today.temp_max_c, rain_mm: weather.today.precipitation_mm } : null,
    rainChance: weather?.today?.precipitation_probability_pct ?? weather?.current?.precipitation_probability_pct,
    hours: weather?.next_hours,
    presentation: weather?.presentation,
    warnings: (weather?.warnings || []).map((warning) => ({ ...warning, where: place.name })),
    updated: updatedAt(weather?.status?.last_updated_at),
    stale: weather?.status?.stale,
  }

  return (
    <WeatherIndicator
      view={view}
      className={className}
      concealed={concealed}
      onRetry={feed.retry}
      details={signedIn ? { to: '/weather', label: 'Detailed weather' } : { to: '/login', label: 'Sign in for site forecasts' }}
    >
      {({ collapse }) => (
      <div className="space-y-2" data-testid="weather-location-controls">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-oc-muted">{td(place ? 'Change location' : 'See the weather where you are.')}</p>
        <button type="button" onClick={locate} disabled={locating}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-oc-green/40 bg-oc-mint/40 px-3 text-xs font-extrabold text-oc-deep disabled:opacity-60">
          <LocateFixed className="h-3.5 w-3.5" />{td(locating ? 'Finding you…' : 'Use my current location')}
        </button>
        {notice && <p role="status" className="text-xs font-bold text-amber-800">{td(notice)}</p>}
        <PlaceSearch search={async (text) => (await searchPublicPlaces(text)).results}
          onChoose={(row) => { choose({ latitude: row.latitude, longitude: row.longitude, name: row.name, source: 'SEARCH' }); collapse() }} />
      </div>
      )}
    </WeatherIndicator>
  )
}
