import { useEffect, useState } from 'react'
import { parseTimestamp } from '../../../shared/constants/tracking.js'

/** 1100 seconds -> "00:18:20". Hours keep counting past 99 rather than wrapping. */
export function formatElapsed(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

/**
 * Time spent on a job, worked out from `started_at` -- the moment the backend
 * recorded Start work. Nothing is counted or stored in the browser, so a refresh,
 * another tab or leaving the dashboard cannot reset it. With `endedAt` it is the
 * fixed length of a finished job; without, it ticks every second.
 */
export default function JobTimer({ startedAt, endedAt = null, className = '' }) {
  const start = parseTimestamp(startedAt)
  const end = parseTimestamp(endedAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (start === null || end !== null) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [start, end])

  if (start === null) return null
  return (
    <span className={`font-display tabular-nums ${className}`} role="timer" aria-live="off">
      {formatElapsed((end ?? now) - start)}
    </span>
  )
}
