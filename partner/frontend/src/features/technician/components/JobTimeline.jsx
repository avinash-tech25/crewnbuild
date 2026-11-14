import { Check, X } from 'lucide-react'
import { parseTimestamp } from '../../../shared/constants/tracking.js'

/**
 * The stages a job has actually been through, with the time of each.
 *
 * Every time shown is a timestamp the backend recorded when the status changed
 * (accepted_at, en_route_at, ...). A stage the job has not reached is simply not
 * listed: nothing here is estimated or filled in. On the way stays in even though
 * the mobile reference leaves it out -- it is a real status in this workflow.
 */
const STAGES = [
  { key: 'accepted_at', label: 'Accepted' },
  { key: 'en_route_at', label: 'On the way' },
  { key: 'arrived_at', label: 'Arrived' },
  { key: 'started_at', label: 'In progress' },
  { key: 'completed_at', label: 'Completed' },
  // Only a cancelled job has this; it ends the timeline in grey rather than green.
  { key: 'cancelled_at', label: 'Cancelled', ended: true },
]

/** "9:10 AM", with the date in front when it was not today. */
export function formatStageTime(time) {
  const value = parseTimestamp(time)
  if (value === null) return ''
  const date = new Date(value)
  const clock = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (date.toDateString() === new Date().toDateString()) return clock
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock}`
}

export default function JobTimeline({ job }) {
  const reached = STAGES.filter((stage) => job[stage.key])
  if (reached.length === 0) return null

  return (
    <ol
      aria-label="Job timeline"
      className="grid"
      style={{ gridTemplateColumns: `repeat(${reached.length}, minmax(0, 1fr))` }}
    >
      {reached.map((stage, position) => {
        const last = position === reached.length - 1
        return (
          <li key={stage.key} className="relative flex flex-col items-center text-center">
            {/* The connector to the next stage, drawn from this dot's centre. */}
            {!last && <span aria-hidden="true" className="absolute left-1/2 top-3.5 h-0.5 w-full bg-oc-green" />}
            <span className={`relative grid h-7 w-7 place-items-center rounded-full text-white ring-4 ring-white ${stage.ended ? 'bg-slate-500' : 'bg-oc-green'}`}>
              {stage.ended ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            </span>
            <span className="mt-1.5 text-[11px] font-extrabold leading-tight text-oc-ink sm:text-xs">{stage.label}</span>
            <time dateTime={job[stage.key]} className="text-[11px] text-oc-muted">{formatStageTime(job[stage.key])}</time>
          </li>
        )
      })}
    </ol>
  )
}
