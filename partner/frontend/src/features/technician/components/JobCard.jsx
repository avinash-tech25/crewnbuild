import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, CheckCircle2, Clock, House, Navigation, Phone, Play, Timer, Truck, User, Wrench } from 'lucide-react'
import { Spinner, formatDate } from '../../../shared/ui/ui.jsx'
import { CardChip, CardStatus, ListCard, cardButtonClass } from '../../../shared/ui/ListCard.jsx'
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
  'en-route': { label: 'Start journey', icon: Truck, variant: 'primary' },
  start: { label: 'Start work', icon: Play, variant: 'primary' },
  complete: { label: 'Mark completed', icon: Check, variant: 'primary' },
  // Handing the job back before arriving. The booking goes straight back to
  // dispatch; it counts against the technician's ranking, so it asks first.
  cancel: { label: "Can't make it", icon: Ban, variant: 'danger' },
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

/** The strip at the top of the card's body: what stage the job is at, in one line. */
function StageBanner({ job }) {
  if (job.status === 'IN_PROGRESS' && job.started_at) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-indigo-50 px-3 py-2.5 text-indigo-900">
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
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-emerald-900">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Job completed</span>
        {job.completed_at && <span className="ml-auto text-xs font-bold">{formatStageTime(job.completed_at)}</span>}
      </div>
    )
  }
  if (job.status === 'CANCELLED') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-slate-700" data-testid="cancelled-banner">
        <Ban className="h-4 w-4" />
        <span className="font-display text-sm font-extrabold uppercase tracking-wide">Job cancelled</span>
        {job.cancelled_at && <span className="ml-auto text-xs font-bold">Cancelled {formatStageTime(job.cancelled_at)}</span>}
      </div>
    )
  }
  if (SHARING_STATUSES.includes(job.status)) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-oc-mint px-3 py-2.5 text-oc-deep">
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

  // The next step's buttons sit in the card's footer: "Can't make it" in red text on
  // the left, the step forward filled on the right. While the Start Work code is asked
  // for, the code form takes their place (in the body, above the footer).
  const asksForCode = enteringOtp && job.next_actions.includes('start')
  const showsButtons = job.next_actions.length > 0 && !expired && !asksForCode
  const actionButton = (action) => {
    const meta = ACTIONS[action]
    if (!meta) return null
    const Icon = meta.icon
    return (
      <button key={action} type="button" className={cardButtonClass(meta.variant)} disabled={Boolean(busyAction) || (action === 'complete' && confirmingComplete) || (action === 'cancel' && handingBack)} onClick={() => run(action)}>
        {busyAction === action ? <Spinner className="h-4 w-4" /> : <Icon className="h-4 w-4" />} {meta.label}
      </button>
    )
  }
  const handBackButton = showsButtons && job.next_actions.includes('cancel') ? actionButton('cancel') : null
  const forwardButtons = showsButtons ? job.next_actions.filter((action) => action !== 'cancel').map(actionButton).filter(Boolean) : []
  const callLink = job.requester_phone ? (
    <a href={`tel:${job.requester_phone}`} className={cardButtonClass('secondary')} aria-label={`Call ${job.requester_name || 'the customer'}`}>
      <Phone className="h-4 w-4" /> Call
    </a>
  ) : null

  // What answering a step asks first: the Start Work code, or a confirmation.
  const answering = job.next_actions.length > 0 && !expired && (asksForCode ? (
    <StartWorkOtp
      job={job}
      onCancel={() => setEnteringOtp(false)}
      onStarted={(started) => { setEnteringOtp(false); onStarted?.(started) }}
    />
  ) : (confirmingComplete || handingBack) && (
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
    </div>
  ))

  // Who and where -- this is a job the technician holds, so the backend has already
  // decided these may be shown (first name and phone after accepting).
  const rows = [
    hasPrice && { key: 'price', label: 'Service price', value: formatRupees(job.quoted_amount) },
    job.requester_name && { key: 'customer', label: 'Customer', value: job.requester_name },
    { key: 'address', label: 'Address', value: `${job.service_address}${job.service_area ? `, ${job.service_area}` : ''}` },
    { key: 'pin', label: 'PIN', value: job.pincode },
  ]
  const chips = [
    <CardChip key="trade" tone="green">{tradeLabel}</CardChip>,
    job.description && <CardChip key="area" icon={House}>{job.description}</CardChip>,
    // Once arrived, a remaining distance ("0.00 km away") says nothing useful.
    job.status === 'ARRIVED'
      ? <CardChip key="where" tone="green" icon={CheckCircle2}>At service location</CardChip>
      : distanceLabel && showsMap && <CardChip key="where" tone="green" icon={Navigation}>{distanceLabel}</CardChip>,
  ]

  return (
    <ListCard
      testId="job-card"
      dataStatus={job.status}
      title={job.service_name || `${tradeLabel} job`}
      subtitle={`${job.requester_type_label} booking · ${formatDate(job.requested_at)}`}
      status={<CardStatus status={job.status}>{String(job.status || '').replaceAll('_', ' ').toLowerCase()}</CardStatus>}
      rows={rows}
      chips={chips}
      secondary={(handBackButton || callLink) && <>{callLink}{handBackButton}</>}
      primary={forwardButtons.length > 0 && forwardButtons}
    >
      <StageBanner job={job} />

      {!job.requester_name && (
        <p className="flex items-start gap-2 rounded-xl bg-oc-sunken px-3 py-2 text-xs text-oc-muted">
          <User className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {job.status === 'CANCELLED'
            ? "This job was cancelled, so the customer's name and phone number are no longer shared."
            : 'Name and phone number are shared once you accept.'}
        </p>
      )}

      {job.status === 'COMPLETED' && (
        <dl className="grid grid-cols-2 gap-2">
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

      {/* Where the job is and how to get there. Only for a job already held: an
          unaccepted request has no map, because it carries no location. */}
      {showsMap && (
        <JobNavigation
          job={job}
          live={liveNavigation}
          following={Boolean(location?.tracking && job.status !== 'ACCEPTED')}
          onRouteDistance={setRouteDistanceMeters}
        />
      )}

      {/* On site and after: the work itself, then the next step. */}
      {showsExecution && <JobExecution job={job} onSummary={setOpenItems} />}
      {showsExecution && BILL_STATUSES.includes(job.status) && <WorkBill jobId={job.id} status={job.status} api={workBillApi} />}

      {answering}
    </ListCard>
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
