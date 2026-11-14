// Shared analytics helpers: money and quantity formatting, chart axis dates,
// unit labels and the daily-expenditure line chart used by the engineer
// overview and the supplier analytics dashboard.
import { formatMoney as countryFormatMoney } from '../../../shared/utils/countryConfig.js'
import { formatDate } from '../../../shared/utils/formatters.js'

export const money = (value, country) => countryFormatMoney(value, country)
export const formatQty = (value) => { const number = Number(value || 0); return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2))) }
// Chart axis ticks. `String(work_date).slice(5)` produced "09-18" in all seven
// languages; this reads as the selected language's own short date, kept to day
// and month so a tick still fits under a point.
const AXIS_DATE_OPTIONS = { day: '2-digit', month: 'short' }
export const axisDateLabel = (value) => formatDate(value, '', AXIS_DATE_OPTIONS)
// Units are stored as the supplier or engineer typed them. Symbols read the same
// everywhere and must never be machine-translated; unit words are.
const UNIT_SYMBOLS = new Set(['m', 'm2', 'm3', 'mm', 'cm', 'km', 'sqm', 'sqft', 'cum', 'cft', 'rmt', 'kg', 'g', 'mt', 'l', 'ltr', 'ml', '%'])
const UNIT_WORD_KEYS = { ton: 'opt.unit.ton', bags: 'opt.unit.bags', nos: 'opt.unit.nos' }
export const unitLabelFrom = (t, td) => (unit) => {
  const value = String(unit || '')
  if (!value) return ''
  if (UNIT_WORD_KEYS[value]) return t(UNIT_WORD_KEYS[value])
  return UNIT_SYMBOLS.has(value.toLowerCase()) ? value : td(value)
}

export function DailyLine({ series, country }) {
  if (!series.length) return null
  const width = 600
  const height = 170
  const padX = 34
  const padTop = 26
  const padBottom = 26
  const maxValue = Math.max(...series.map((point) => point.total), 1)
  const innerWidth = width - padX * 2
  const innerHeight = height - padTop - padBottom
  const stepX = series.length > 1 ? innerWidth / (series.length - 1) : 0
  const points = series.map((point, index) => ({
    x: padX + index * stepX,
    y: padTop + innerHeight - (point.total / maxValue) * innerHeight,
    ...point,
  }))
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  const areaPath = `${path} L${points[points.length - 1].x},${padTop + innerHeight} L${points[0].x},${padTop + innerHeight} Z`
  const labelEvery = Math.ceil(series.length / 6)
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      <defs>
        <linearGradient id="analyticsLineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2e7d55" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#2e7d55" stopOpacity="0" />
        </linearGradient>
      </defs>
      {series.length > 12 && <text x={padX} y={padTop - 2} className="fill-slate-400 text-[10px] font-bold">{money(maxValue, country)}</text>}
      <text x={padX - 8} y={padTop + innerHeight + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-bold">{money(0, country)}</text>
      <line x1={padX} y1={padTop + innerHeight} x2={width - padX} y2={padTop + innerHeight} stroke="#e2e8f0" strokeWidth="1" />
      <path d={areaPath} fill="url(#analyticsLineFill)" />
      <path d={path} fill="none" stroke="#2e7d55" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((point, index) => (
        <g key={index}>
          <circle cx={point.x} cy={point.y} r="3.5" fill="#fff" stroke="#2e7d55" strokeWidth="2" />
          {series.length <= 12 && (
            <text x={point.x} y={point.y - 9} textAnchor="middle" className="fill-slate-600 text-[9px] font-bold">{money(point.total, country)}</text>
          )}
        </g>
      ))}
      {points.map((point, index) => (
        (index % labelEvery === 0 || index === points.length - 1) && (
          <text key={`label-${index}`} x={point.x} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[9px] font-bold">{point.label}</text>
        )
      ))}
    </svg>
  )
}
