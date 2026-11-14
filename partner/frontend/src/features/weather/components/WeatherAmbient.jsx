// A copy of the Professional app's components/weather/WeatherAmbient.jsx (Partner shares no code with the Professional app); keep the two alike.
// Shared pieces of the weather-aware look: the icon for a theme, the subtle
// effect layer behind a card, and the warning banner. Used by the public weather
// card and the dashboards' weather strip, so every page looks the same.
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudRainWind, CloudSnow, CloudSun, Haze, Moon, ShieldAlert, Sun, Thermometer, TriangleAlert, Wind } from 'lucide-react'
import './weatherAmbient.css'

const ICONS = {
  storm: CloudLightning, 'heavy-rain': CloudRainWind, rain: CloudRain, drizzle: CloudDrizzle, dust: Haze, wind: Wind,
  hot: Thermometer, sun: Sun, moon: Moon, partly: CloudSun, cloud: Cloud, fog: CloudFog, snow: CloudSnow,
}

export function WeatherIcon({ theme, className = 'h-5 w-5' }) {
  const Icon = ICONS[theme?.icon] || Cloud
  return <Icon className={`${className} ${theme?.accent || 'text-oc-deep'}`} aria-hidden="true" />
}

// The decorative layer: under the content, off with reduced motion, and left out
// entirely while a warning is shown so nothing competes with it.
export function AmbientLayer({ theme, warning }) {
  if (warning || !theme || theme.effect === 'none') return null
  return <span className={`wx-effect wx-effect-${theme.effect}`} aria-hidden="true" />
}

// A WARNING or SEVERE alert, above everything else and never animated. Compact
// (the header popover): the message is cut to two lines, whole on hover and on
// the Weather page.
export function WeatherWarningBanner({ warning, where, more = 0, action = null, compact = false }) {
  const td = (text) => text
  if (!warning) return null
  const severe = warning.severity === 'SEVERE'
  const Icon = severe ? ShieldAlert : TriangleAlert
  return (
    <div role="alert" className={`flex flex-wrap items-start rounded-xl border-2 ${compact ? 'gap-2 px-2.5 py-2' : 'gap-3 px-3 py-2.5'} ${severe ? 'border-red-300 bg-red-50 text-red-900' : 'border-orange-300 bg-orange-50 text-orange-900'}`}>
      <Icon className={`mt-0.5 shrink-0 ${compact ? 'h-4 w-4' : 'h-5 w-5'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={`font-extrabold ${compact ? 'text-xs' : 'text-sm'}`}>
          {td(warning.title)}{where ? <span className="font-bold opacity-80"> – {td(where)}</span> : null}
        </p>
        <p title={compact ? td(warning.message) : undefined} className={`mt-0.5 font-medium leading-relaxed opacity-90 ${compact ? 'line-clamp-2 text-[11px]' : 'text-xs'}`}>{td(warning.message)}</p>
        <p className="mt-0.5 text-[11px] font-bold opacity-80">
          {td(severe ? 'Follow local safety instructions.' : 'Take appropriate precautions.')}
          {more > 0 ? ` ${td('{count} more weather alerts').replace('{count}', more)}` : ''}
        </p>
      </div>
      {action}
    </div>
  )
}
