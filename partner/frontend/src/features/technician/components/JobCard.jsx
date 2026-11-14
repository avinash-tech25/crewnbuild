import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, CheckCircle2, Clock, House, IndianRupee, MapPin, Navigation, Phone, Play, Timer, Truck, User, Wrench } from 'lucide-react'
import { Spinner, StatusPill, formatDate } from '../../../shared/ui/ui.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import { SHARING_STATUSES, formatDistance } from '../../../shared/constants/tracking.js'
import { workBillApi } from '../workBillApi.js'
import { formatRupees } from '../../../shared/utils/money.js'
import JobExecution from './JobExecution.jsx'
import WorkBill from './WorkBill.jsx'
import JobNavigation from './JobNavigation.jsx'
import JobTimeline, { formatStageTime } from './JobTimeline.jsx'
import JobTimer from './JobTimer.jsx'
import LiveLocationStatus from './LiveLocationStatus.jsx'
import StartWorkOtp from './StartWorkOtp.jsx'

// Labels for the actions the server lists in `next_actions`; the server also enforces them.
// What a technician can do to a job they hold.
//
// `arrived` is deliberately absent. Arrival is not an announcement: the backend
// sets it from the real remaining distance once the technician is actually at the
// address. A button here would let somebody say they had arrived while still half
// a kilometre away, which is exactly what used to happen.
const ACTIONS = {
  'en-route': { label: 'Start journey', icon: Truck, className: 'btn-primary' },
  start: { label: 'Start work', icon: Play, className: 'btn-primary' },
  complete: { label: 'Mark completed', icon: Check, className: 'btn-primary' },
  // Handing the job back before arriving. The booking goes straight back to
  // dispatch; it counts against the technician's ranking, so it asks first.
  cancel: { label: "Can't make it", icon: Ban, className: 'btn-ghost' },
}

// Fixed reasons only: nothing typed by hand reaches the audit trail.
const HAND_BACK_REASONS = [
  ['VEHICLE_ISSUE', 'Vehicle problem'],
  ['EMERGENCY', 'Personal emergency'],
  ['TOO_FAR', 'Too far away'],
  ['CUSTOMER_UNREACHABLE', 'Customer not reachable'],
  ['OTHER', 'Other reason'],
]

// On site and after: the checklist, photos and notes of the work (Stage A).
const EXECUTION_STATUSES = ['ARRIVED', 'IN_PROGRESS', 'COMPLETED']
// The work bill is started once the work is, and kept with the job afterwards.
const BILL_STATUSES = ['IN_PROGRESS', 'COMPLETED']

function parseUtc(value) {
  if (!value) return null
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
}

/** Seconds left to answer an offer; the server expires it on its own clock regardless. */
function useSecondsLeft(expiresAt) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  const expiry = parseUtc(expiresAt)
  return expiry ? Math.max(0, Math.round((expiry.getTime() - now) / 1000)) : null
}

/** The strip across the top of the card: what stage the job is at, in one line. */
function StageBanner({ job }) {
  if (job.status === 'IN_PROGRESS' && job.started_at) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-indigo-50 px-5 py-2.5 text-indigo-900">
        <Wrench className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Service in progress</span>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-extrabold" data-testid="job-timer">
          <Timer className="h-4 w-4" /> <JobTimer startedAt={job.started_at} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-700">Job timer</span>
        </span>
      </div>
    )
  }
  if (job.status === 'COMPLETED') {
    return (
      <div className="flex items-center gap-2 bg-emerald-50 px-5 py-2.5 text-emerald-900">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Job completed</span>
        {job.completed_at && <span className="ml-auto text-xs font-bold">{formatStageTime(job.completed_at)}</span>}
      </div>
    )
  }
  if (job.status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2 bg-slate-100 px-5 py-2.5 text-slate-700" data-testid="cancelled-banner">
        <Ban className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Job cancelled</span>
        {job.cancelled_at && <span className="ml-auto text-xs font-bold">Cancelled {formatStageTime(job.cancelled_at)}</span>}
      </div>
    )
  }
  if (SHARING_STATUSES.includes(job.status)) {
    return (
      <div className="flex items-center gap-2 bg-oc-mint px-5 py-2.5 text-oc-deep">
        <Navigation className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">
          {job.status === 'ARRIVED'
            ? 'You have arrived'
            : job.status === 'ACCEPTED'
              ? "Job accepted. Start your journey when you're ready."
              : "Head to the customer's location"}
        </span>
      </div>
    )
  }
  return null
}

export default function JobCard({ job, onAction, onStarted, location }) {
  const [busyAction, setBusyAction] = useState('')
  const [handingBack, setHandingBack] = useState(false)
  const [handBackReason, setHandBackReason] = useState('OTHER')
  // Start work asks for the customer's Start Work code first (the server insists).
  const [enteringOtp, setEnteringOtp] = useState(false)
  const secondsLeft = useSecondsLeft(job.offer_expires_at)
  const expired = secondsLeft === 0
  // Reported by the map below once it has a road route.
  const [routeDistanceMeters, setRouteDistanceMeters] = useState(null)

  const type = technicianTypeByCode(job.technician_type)
  const tradeLabel = type?.label ?? job.technician_type
  const showsMap = SHARING_STATUSES.includes(job.status)
  const hasPrice = job.quoted_amount !== null && job.quoted_amount !== undefined

  // `match_label` is how this job was *matched*: a straight-line distance frozen
  // when it was offered. It is the only thing there is until a route exists, and
  // the wrong thing to keep showing beside one.
  const distanceLabel =
    routeDistanceMeters === null || routeDistanceMeters === undefined
      ? job.match_label
      : `${formatDistance(routeDistanceMeters)} away`

  // What is still open on the job (unticked steps, no after photo), reported by
  // the execution panel. Completing is never blocked: the technician is only asked.
  const [openItems, setOpenItems] = useState(null)
  const [confirmingComplete, setConfirmingComplete] = useState(false)
  const showsExecution = EXECUTION_STATUSES.includes(job.status)

  // The navigation view the technician's own location stream last returned, if it
  // is for this job; newer than anything the card loaded itself.
  const liveNavigation = location?.activeJob?.booking_id === job.id ? location.activeJob : null

  const run = async (action, { confirmed = false } = {}) => {
    if (action === 'start') {
      setEnteringOtp(true)
      return
    }
    if (action === 'cancel' && !confirmed) {
      setHandingBack(true)
      return
    }
    if (action === 'complete' && !confirmed && openItems?.length) {
      setConfirmingComplete(true)
      return
    }
    setConfirmingComplete(false)
    setBusyAction(action)
    try {
      await onAction(job, action, action === 'cancel' ? handBackReason : undefined)
    } finally {
      setBusyAction('')
      setHandingBack(false)
    }
  }

  // The next step. On site it follows the checklist, photos and notes it concludes
  // (see footer); before that it stays in the details column, as it always was.
  const actions = job.next_actions.length > 0 && !expired && (enteringOtp && job.next_actions.includes('start') ? (
    <StartWorkOtp
      job={job}
      onCancel={() => setEnteringOtp(false)}
      onStarted={(started) => { setEnteringOtp(false); onStarted?.(started) }}
    />
  ) : (
    <div className="space-y-3">
      {confirmingComplete && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alertdialog" aria-label="Complete this job?" data-testid="complete-anyway">
          <p className="flex items-center gap-2 font-extrabold"><AlertTriangle className="h-4 w-4" /> Complete this job anyway?</p>
          <ul className="mt-1 list-disc pl-6">{openItems.map((item) => <li key={item}>{item}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-4 py-2" disabled={Boolean(busyAction)} onClick={() => run('complete', { confirmed: true })}>
              {busyAction === 'complete' ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Complete anyway
            </button>
            <button type="button" className="btn-ghost px-4 py-2" onClick={() => setConfirmingComplete(false)}>Keep working</button>
          </div>
        </div>
      )}
      {handingBack && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alertdialog" aria-label="Hand this job back?" data-testid="hand-back">
          <p className="flex items-center gap-2 font-extrabold"><AlertTriangle className="h-4 w-4" /> Hand this job back?</p>
          <p className="mt-1">The customer is matched with another technician straight away. Handing jobs back lowers your ranking for new requests.</p>
          <label className="mt-2 block text-xs font-bold uppercase tracking-wide">
            Reason
            <select className="input mt-1" value={handBackReason} onChange={(event) => setHandBackReason(event.target.value)}>
              {HAND_BACK_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-4 py-2" disabled={Boolean(busyAction)} onClick={() => run('cancel', { confirmed: true })}>
              {busyAction === 'cancel' ? <Spinner className="h-4 w-4" /> : <Ban className="h-4 w-4" />} Hand it back
            </button>
            <button type="button" className="btn-ghost px-4 py-2" onClick={() => setHandingBack(false)}>Keep the job</button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {job.next_actions.map((action) => {
          const meta = ACTIONS[action]
          if (!meta) return null
          const Icon = meta.icon
          return (
            <button key={action} type="button" className={meta.className} disabled={Boolean(busyAction) || (action === 'complete' && confirmingComplete) || (action === 'cancel' && handingBack)} onClick={() => run(action)}>
              {busyAction === action ? <Spinner className="h-4 w-4" /> : <Icon className="h-4 w-4" />} {meta.label}
            </button>
          )
        })}
      </div>
    </div>
  ))

  const details = (
    <div className="min-w-0 space-y-4">
      {/* What the job is. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-extrabold leading-snug text-oc-ink">{job.service_name || `${tradeLabel} job`}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-oc-mint px-2.5 py-0.5 text-xs font-extrabold text-oc-green">{tradeLabel}</span>
            {job.description && (
              <span className="inline-flex items-center gap-1 rounded-full bg-oc-sunken px-2.5 py-0.5 text-xs font-bold text-oc-ink">
                <House className="h-3 w-3" /> {job.description}
              </span>
            )}
            <StatusPill status={job.status} />
          </div>
          <p className="mt-1.5 text-xs text-oc-muted">{job.requester_type_label} booking · {formatDate(job.requested_at)}</p>
        </div>
        {hasPrice && (
          <div className="rounded-xl border border-oc-line bg-oc-sunken px-3 py-2 text-right">
            <p className="flex items-center justify-end gap-1 text-[11px] font-bold uppercase tracking-wide text-oc-muted">
              <IndianRupee className="h-3 w-3" /> Service price
            </p>
            <p className="font-display text-lg font-extrabold text-oc-ink">{formatRupees(job.quoted_amount)}</p>
          </div>
        )}
      </div>

      {/* Who and where -- this is a job the technician holds, so the backend has
          already decided these may be shown (first name and phone after accepting). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-oc-line p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-oc-mint text-oc-green"><User className="h-5 w-5" /></span>
          {job.requester_name ? (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-extrabold text-oc-ink">{job.requester_name}</p>
              <p className="text-xs text-oc-muted">{job.requester_type_label}</p>
            </div>
          ) : job.status === 'CANCELLED' ? (
            <p className="flex-1 text-xs text-oc-muted">This job was cancelled, so the customer's name and phone number are no longer shared.</p>
          ) : (
            <p className="flex-1 text-xs text-oc-muted">Name and phone number are shared once you accept.</p>
          )}
          {job.requester_phone && (
            <a href={`tel:${job.requester_phone}`} className="btn-ghost shrink-0 px-3 py-2" aria-label={`Call ${job.requester_name || 'the customer'}`}>
              <Phone className="h-4 w-4" /> <span className="hidden sm:inline">Call</span>
            </a>
          )}
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-oc-line p-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-oc-mint text-oc-green"><MapPin className="h-5 w-5" /></span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-oc-ink">{job.service_address}{job.service_area ? `, ${job.service_area}` : ''}</p>
            <p className="text-xs text-oc-muted">PIN {job.pincode}</p>
            {/* Once arrived, a remaining distance ("0.00 km away") says nothing useful. */}
            {job.status === 'ARRIVED' ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-oc-green"><CheckCircle2 className="h-3.5 w-3.5" /> At service location</p>
            ) : distanceLabel && showsMap && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-oc-green"><Navigation className="h-3.5 w-3.5" /> {distanceLabel}</p>
            )}
          </div>
        </div>
      </div>

      {job.status === 'COMPLETED' && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Detail icon={Play} label="Started" value={job.started_at ? formatStageTime(job.started_at) : '—'} />
          <Detail icon={CheckCircle2} label="Completed" value={job.completed_at ? formatStageTime(job.completed_at) : '—'} />
          {job.started_at && job.completed_at && (
            <Detail icon={Clock} label="Time on job" value={<JobTimer startedAt={job.started_at} endedAt={job.completed_at} />} />
          )}
        </dl>
      )}

      <div className="rounded-xl border border-oc-line bg-white px-2 py-3">
        <JobTimeline job={job} />
      </div>

      {/* The location stream runs for the whole job on its own; this is its state. */}
      {location && showsMap && <LiveLocationStatus location={location} navigation={liveNavigation} />}

      {!showsExecution && actions}
    </div>
  )

  // On site and after: the work itself, then the next step.
  const footer = showsExecution && (
    <div className="space-y-4 px-5 pb-5">
      <JobExecution job={job} onSummary={setOpenItems} />
      {BILL_STATUSES.includes(job.status) && <WorkBill jobId={job.id} status={job.status} api={workBillApi} />}
      {actions}
    </div>
  )

  return (
    <article className="card overflow-hidden" data-testid="job-card" data-status={job.status}>
      <StageBanner job={job} />
      {showsMap ? (
        // Where the job is and how to get there, beside the details on a wide
        // screen. Only for a job already held: an unaccepted request has no map,
        // because it carries no location.
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {details}
          <JobNavigation
            job={job}
            live={liveNavigation}
            following={Boolean(location?.tracking && job.status !== 'ACCEPTED')}
            onRouteDistance={setRouteDistanceMeters}
          />
        </div>
      ) : (
        <div className="p-5">{details}</div>
      )}
      {footer}
    </article>
  )
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-oc-line bg-white px-3 py-2">
      <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-oc-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className="mt-0.5 font-display text-sm font-extrabold text-oc-ink">{value}</dd>
    </div>
  )
}
