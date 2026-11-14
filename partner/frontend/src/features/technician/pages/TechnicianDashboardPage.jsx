import { useCallback, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Ban, BellRing, BriefcaseBusiness, Volume2, VolumeX, ChevronRight, Coffee, IndianRupee, CheckCircle2, CircleCheckBig, Inbox, LocateFixed, LogOut, MapPin, MessageSquare, Power, Radio, ShieldAlert, ShieldCheck, UserRound, Wallet } from 'lucide-react'
import Logo from '../../../shared/ui/Logo.jsx'
import { Alert, EmptyState, Spinner } from '../../../shared/ui/ui.jsx'
import { technicianTypeByCode } from '../../../shared/constants/technicianTypes.js'
import useJobOffers from '../useJobOffers.js'
import useTechnicianLocation from '../useTechnicianLocation.js'
import { logout, setUser } from '../../../shared/auth/authSlice.js'
import { apiErrorMessage } from '../../../shared/api/apiClient.js'
import { actOnJob, fetchDashboardSummary, fetchJobs, handBackJob, updateAvailability } from '../technicianApi.js'
import { armNotificationSound, enableNotificationSound, soundStatus, subscribeSoundStatus } from '../notificationSound.js'
import { requestJobNotificationPermission } from '../jobNotifications.js'
import { earningsApi } from '../earningsApi.js'
import { formatRupees } from '../../../shared/utils/money.js'
import BankAccountSection from '../components/BankAccountSection.jsx'
import ChangePasswordSection from '../components/ChangePasswordSection.jsx'
import EarningsPanel from '../components/EarningsPanel.jsx'
import JobCard from '../components/JobCard.jsx'
import OfferCard from '../components/OfferCard.jsx'
import ProfilePanel from '../components/ProfilePanel.jsx'
import VerifiedSuccess from '../components/VerifiedSuccess.jsx'
import TechnicianWeatherIndicator from '../../weather/components/TechnicianWeatherIndicator.jsx'
import WorkPreferencesSection from '../components/WorkPreferencesSection.jsx'
import { ratingSummary } from '../../booking/rating.js'
import { isVerifiedProfessional, markVerifiedSuccessSeen, shouldShowVerifiedSuccess } from '../verification.js'

// The dashboard is denser than the marketing pages, so it uses a wider shell than
// container-x (max-w-6xl). Capped rather than full-bleed so the cards keep a sane
// measure and a deliberate gutter remains on very wide monitors.
const SHELL = 'mx-auto w-full max-w-[1560px] px-5 sm:px-8'

const TABS = [
  { id: 'new', label: 'New Requests', icon: Inbox, empty: 'No job requests right now.', emptyBody: 'Stay available with the app open: a booking near you appears here the moment it is made, with a sound.' },
  { id: 'accepted', label: 'Accepted Jobs', icon: CircleCheckBig, empty: 'No accepted jobs.', emptyBody: 'Jobs you accept wait here until you set off.' },
  { id: 'active', label: 'Active Jobs', icon: BriefcaseBusiness, empty: 'No active jobs.', emptyBody: 'Jobs you are travelling to or working on.' },
  { id: 'completed', label: 'Completed Jobs', icon: CheckCircle2, empty: 'No completed jobs yet.', emptyBody: 'Finished jobs are kept here.' },
  { id: 'cancelled', label: 'Cancelled Jobs', icon: Ban, empty: 'No cancelled jobs.', emptyBody: 'Jobs you accepted that were cancelled afterwards are kept here.' },
  { id: 'earnings', label: 'Earnings', icon: IndianRupee },
  { id: 'profile', label: 'Profile', icon: UserRound },
]

const ACTION_MESSAGES = {
  'en-route': 'Journey started. The customer can see you moving, and the job marks itself as arrived when you get there.',
  start: 'Work started.',
  complete: 'Job completed. It is now in Completed Jobs.',
  cancel: 'Job handed back. The customer is being matched with another technician.',
}

// What the technician says about working now. ON_JOB and BUSY are not choices:
// the server derives them from jobs and offers.
const WORK_STATUS_OPTIONS = [
  { id: 'AVAILABLE', label: 'Available', icon: Power, note: 'New bookings near you can be offered to you.' },
  { id: 'PAUSED', label: 'On a break', icon: Coffee, note: 'No new bookings while you rest. Jobs you hold carry on.' },
  { id: 'OFFLINE', label: 'Offline', icon: Ban, note: 'No new bookings will be offered to you.' },
]

function workStatusOf(user) {
  return user?.work_status ?? (user?.is_available ? 'AVAILABLE' : 'OFFLINE')
}

const SUMMARY_KEYS = { new: 'new_requests', accepted: 'accepted_jobs', active: 'active_jobs', completed: 'completed_jobs', cancelled: 'cancelled_jobs' }
const JOB_TABS = ['new', 'accepted', 'active', 'completed', 'cancelled']

// The phone-style bar at the bottom of small screens. It only switches the same
// sections as the tab bar above; Messages has no feature behind it yet, so it is
// shown switched off rather than leading anywhere.
const BOTTOM_NAV = [
  { id: 'jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { id: 'earnings', label: 'Earnings', icon: IndianRupee },
  { id: 'messages', label: 'Messages', icon: MessageSquare, soon: true },
  { id: 'profile', label: 'Profile', icon: UserRound },
]

function OverviewRow({ icon: Icon, label, value, detail, tone = 'bg-oc-mint text-oc-green', onClick, testid }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left ${onClick ? 'transition hover:bg-oc-sunken' : ''}`}
      data-testid={testid}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-oc-muted">{label}</span>
        <span className="block truncate font-display text-sm font-extrabold text-oc-ink">{value}</span>
        {detail && <span className="block truncate text-xs text-oc-muted">{detail}</span>}
      </span>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-oc-muted" />}
    </Tag>
  )
}

function StatCard({ icon: Icon, label, value, accent, onClick, active, className = '', testid }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`card flex min-w-0 items-center gap-2.5 p-2.5 text-left transition hover:-translate-y-0.5 sm:gap-3 sm:p-3 ${active ? 'ring-2 ring-oc-green' : ''} ${className}`}
    >
      <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl sm:h-[38px] sm:w-[38px] ${accent}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block font-display text-lg font-extrabold leading-tight text-oc-ink sm:text-xl">{value}</span>
        <span className="block text-[11px] font-bold uppercase leading-tight tracking-wide text-oc-muted sm:text-xs">{label}</span>
      </span>
    </button>
  )
}

export default function TechnicianDashboard() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const user = useSelector((state) => state.auth.user)
  const [tab, setTab] = useState('new')
  const [summary, setSummary] = useState(null)
  const [jobs, setJobs] = useState([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [savingAvailability, setSavingAvailability] = useState(false)
  const [notice, setNotice] = useState({ tone: 'info', text: '' })
  const typeMeta = technicianTypeByCode(user?.technician_type) || technicianTypeByCode('PLUMBER')

  const workStatus = workStatusOf(user)
  // Holding a job (accepted, travelling or working): the customer needs the
  // location for the whole job, whatever the availability switch says.
  const holdsJob = ((summary?.accepted_jobs ?? 0) + (summary?.active_jobs ?? 0)) > 0

  // The one location stream. It runs while the technician is available or holds a
  // job, and stops by itself when neither is true, on sign out, or on unmount --
  // one watcher, one send loop, never two.
  const location = useTechnicianLocation({
    active: Boolean(user) && (workStatus === 'AVAILABLE' || holdsJob),
    keepAwake: holdsJob,
  })

  const refreshSummary = useCallback(() => fetchDashboardSummary().then(setSummary).catch(() => {}), [])

  // Today's recorded net earnings, from the existing earnings summary. Only shown,
  // never worked out here; a failure just leaves the card showing a dash.
  const [todayNet, setTodayNet] = useState(null)
  const refreshToday = useCallback(() => earningsApi.summary().then((totals) => setTodayNet(totals.today_net)).catch(() => {}), [])

  // "You're verified", once, the first time this account is seen verified.
  const [showVerified, setShowVerified] = useState(() => shouldShowVerifiedSuccess(user))
  useEffect(() => {
    if (shouldShowVerifiedSuccess(user)) setShowVerified(true)
  }, [user])
  const closeVerified = useCallback(() => {
    markVerifiedSuccessSeen(user?.id)
    setShowVerified(false)
  }, [user?.id])

  // Winning a job request: it becomes a job this technician holds.
  const onOfferAccepted = useCallback(async () => {
    setNotice({ tone: 'success', text: 'Job accepted. The customer can see you, and the address is on the job card.' })
    setTab('accepted')
    await refreshSummary()
  }, [refreshSummary])

  const loadJobs = useCallback(async (bucket, quiet = false) => {
    // 'new' is job REQUESTS, which arrive over the dispatch socket, and 'profile'
    // is not a list of work at all.
    if (bucket === 'profile' || bucket === 'new' || bucket === 'earnings') return
    if (!quiet) setLoadingJobs(true)
    try {
      setJobs(await fetchJobs(bucket))
    } catch (error) {
      if (!quiet) setNotice({ tone: 'error', text: apiErrorMessage(error, 'Unable to load jobs.') })
    } finally {
      if (!quiet) setLoadingJobs(false)
    }
  }, [])

  // A job this technician had accepted was cancelled by the customer: it leaves
  // Accepted / Active at once and is kept under Cancelled Jobs.
  const onJobCancelled = useCallback(() => {
    setNotice({ tone: 'error', text: 'A job you accepted has been cancelled. You can find it under Cancelled Jobs.' })
    refreshSummary()
    loadJobs(tab, true)
  }, [refreshSummary, loadJobs, tab])

  // Requests arrive over the dispatch socket, so nothing needs refreshing to see one.
  // Only while the server says this technician can be dispatched right now.
  const dispatchOffers = useJobOffers({ enabled: location.ready, onAccepted: onOfferAccepted, onJobCancelled })

  // The account and its email + password session were confirmed with the server by the
  // dashboard route guard before this page rendered.
  useEffect(() => {
    refreshSummary()
    refreshToday()
  }, [refreshSummary, refreshToday])

  // A browser will not let a page make a sound until somebody has interacted with
  // it, which is the rule that stops background tabs making noise. The first tap
  // anywhere on the dashboard arms the chime; before that a request arrives
  // silently rather than failing.
  useEffect(() => {
    const arm = () => armNotificationSound()
    arm()
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    return () => {
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
    }
  }, [])

  // The visible sound state, and the explicit Enable sound tap for a browser that
  // is still holding audio back. A request already waiting rings as soon as it is
  // allowed: its repeating alert is running, only silent until now.
  const [sound, setSound] = useState(soundStatus)
  const [soundNote, setSoundNote] = useState('')
  useEffect(() => {
    setSound(soundStatus())
    return subscribeSoundStatus(setSound)
  }, [])
  // Runs on the button's pointerdown (and Enter/Space): that is the same tap the
  // page-wide first-tap arming above listens for, and arming can switch sound on
  // and hide this button before a click would ever arrive.
  const enableSound = async () => {
    const result = await enableNotificationSound()
    setSound(result)
    setSoundNote(result === 'enabled'
      ? 'Sound is on. New job requests will ring on this screen.'
      : result === 'unavailable'
        ? 'This browser cannot play alert sounds. Keep this screen open to see new requests.'
        : 'The browser is still blocking sound. Tap Enable sound again, or check the site sound setting.')
    // Same tap: offer a system notification for requests that arrive while this
    // tab is in the background, where the browser supports it.
    void requestJobNotificationPermission()
  }

  useEffect(() => { loadJobs(tab) }, [tab, loadJobs])

  // Offers arrive without the technician doing anything, and expire in minutes.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      refreshSummary()
      loadJobs(tab, true)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [tab, refreshSummary, loadJobs])

  const handleAction = async (job, action, reason) => {
    setNotice({ tone: 'info', text: '' })
    try {
      if (action === 'cancel') await handBackJob(job.id, reason)
      else await actOnJob(job.id, action)
      setNotice({ tone: 'success', text: ACTION_MESSAGES[action] })
      // The location is already streaming (it started when the job was accepted);
      // the journey only changes what the customer is told.
      if (action === 'en-route') setTab('active')
      // Completing a priced job is when the server records its earning.
      if (action === 'complete') refreshToday()
    } catch (error) {
      setNotice({ tone: 'error', text: apiErrorMessage(error, 'That action could not be completed.') })
    }
    await Promise.all([loadJobs(tab), refreshSummary()])
  }

  // The customer's Start Work code was right: the job is IN_PROGRESS.
  const handleStarted = async () => {
    setNotice({ tone: 'success', text: ACTION_MESSAGES.start })
    await Promise.all([loadJobs(tab), refreshSummary()])
  }

  // OFFLINE and PAUSED withdraw any offer still being decided, on the server; going
  // OFFLINE with no job also forgets the stored position there. The location
  // stream follows `workStatus` by itself.
  const setWorkStatus = async (status) => {
    if (status === workStatus) return
    setSavingAvailability(true)
    try {
      dispatch(setUser(await updateAvailability(status)))
      refreshSummary()
    } catch (error) {
      setNotice({ tone: 'error', text: apiErrorMessage(error, 'Unable to change availability.') })
    } finally {
      setSavingAvailability(false)
    }
  }
  const toggleAvailability = () => setWorkStatus(workStatus === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE')

  const signOut = async () => {
    // Stop the GPS watcher and the send loop first, then have the server forget the
    // position and withdraw pending offers -- before the session token is dropped.
    await location.stop()
    dispatch(logout())
    navigate('/login', { replace: true })
  }

  if (!user) return null
  const available = workStatus === 'AVAILABLE'
  const statusOption = WORK_STATUS_OPTIONS.find((option) => option.id === workStatus) ?? WORK_STATUS_OPTIONS[2]
  const activeTab = TABS.find((item) => item.id === tab)
  const pending = summary?.pending_requirements || []
  const selectTab = (id) => { setNotice({ tone: 'info', text: '' }); setTab(id) }

  // Quick overview: only what the dashboard already knows. No schedule, service
  // radius or bonus is shown -- Partner does not have them.
  const activeCount = summary?.active_jobs ?? 0
  const acceptedCount = summary?.accepted_jobs ?? 0
  const currentJob = !summary
    ? { value: '–' }
    : activeCount > 0
      ? { value: `${activeCount} active ${activeCount === 1 ? 'job' : 'jobs'}`, detail: 'Travelling or working now', tab: 'active' }
      : acceptedCount > 0
        ? { value: `${acceptedCount} accepted, not started`, detail: 'Start the journey when you set off', tab: 'accepted' }
        : { value: 'No job in hand', detail: 'Accepted jobs appear here' }
  const receiving = workStatus === 'PAUSED'
    ? { value: 'Paused', detail: 'You are on a break', tone: 'bg-amber-100 text-amber-700' }
    : !available
    ? { value: 'Off', detail: 'You are offline', tone: 'bg-slate-100 text-slate-500' }
    : summary && !summary.can_receive_jobs
      ? { value: 'Not yet', detail: 'Complete the requirements above', tone: 'bg-amber-100 text-amber-700' }
      : summary?.within_working_hours === false
        ? { value: 'Off now', detail: 'Outside your working hours', tone: 'bg-slate-100 text-slate-500' }
        : holdsJob
          ? { value: 'Paused while on a job', detail: 'New requests resume when this job is done', tone: 'bg-indigo-100 text-indigo-700' }
        : !location.ready
          ? { value: 'Waiting for your location', detail: location.presence?.message || 'Allow location to be matched to nearby jobs', tone: 'bg-amber-100 text-amber-700' }
          : {
              value: 'On',
              detail: summary?.working_schedule_enabled ? 'Within your working hours' : 'Nearby bookings can be offered to you',
              tone: 'bg-oc-mint text-oc-green',
            }
  const radiusKm = summary?.service_radius_km ?? null
  // The technician's own aggregate only -- no individual rating, tag or customer.
  const rating = summary ? ratingSummary(summary.average_rating, summary.rating_count) : null
  const bottomActive = JOB_TABS.includes(tab) ? 'jobs' : tab

  return (
    <div className="min-h-screen bg-oc-paper">
      {showVerified && (
        <VerifiedSuccess
          user={user}
          typeMeta={typeMeta}
          available={available}
          saving={savingAvailability}
          canReceiveJobs={Boolean(summary?.can_receive_jobs)}
          onGoAvailable={toggleAvailability}
          onContinue={closeVerified}
        />
      )}
      <header className="sticky top-0 z-20 border-b border-oc-line bg-white/90 backdrop-blur-md">
        <div className={`${SHELL} flex h-16 items-center gap-4`}>
          <Logo to="/dashboard" />
          <span className="hidden rounded-full bg-oc-mint px-3 py-1 text-xs font-extrabold text-oc-green sm:inline">{typeMeta.label} dashboard</span>
          <TechnicianWeatherIndicator className="ml-auto" />
          <button type="button" onClick={signOut} className="btn-ghost">
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </header>

      <main className={`${SHELL} space-y-4 pb-28 pt-5 md:pb-5`}>
        <section className="relative overflow-hidden rounded-[24px] bg-oc-deep px-5 py-4 text-white sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_30%,rgba(244,183,64,.25),transparent_35%),radial-gradient(circle_at_10%_90%,rgba(95,182,130,.25),transparent_40%)]" />
          <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <img src={typeMeta.heroImage} alt={`3D ${typeMeta.label.toLowerCase()}`} className="h-20 w-auto drop-shadow-[0_14px_14px_rgba(0,0,0,.35)]" />
            <div className="flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-oc-amber">
                {typeMeta.label}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 normal-case tracking-normal text-white" data-testid="availability-chip">
                  <span className={`h-2 w-2 rounded-full ${available ? 'bg-emerald-400' : workStatus === 'PAUSED' ? 'bg-amber-300' : 'bg-slate-300'}`} />
                  {available ? 'Available now' : statusOption.label}
                </span>
                {rating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 normal-case tracking-normal text-white" data-testid="dashboard-rating">
                    {rating.text}
                  </span>
                )}
                {isVerifiedProfessional(user) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 normal-case tracking-normal text-white">
                    <ShieldCheck className="h-3.5 w-3.5" /> Verified Professional
                  </span>
                )}
              </p>
              <h1 className="mt-0.5 text-xl font-extrabold tracking-tight sm:text-2xl">Welcome, {(user.name || 'Technician').split(' ')[0]}</h1>
              <p className="mt-1 text-sm text-[#b9d8c5]">Serving {user.location} · PIN {user.pincode}</p>
            </div>
            <div className="w-full rounded-2xl border border-white/15 bg-white/10 p-3 sm:w-auto" data-testid="work-status">
              <p className="text-xs font-bold uppercase tracking-wide text-[#b9d8c5]">Availability</p>
              <div className="mt-1.5 flex gap-1 rounded-xl bg-black/15 p-1" role="radiogroup" aria-label="Availability">
                {WORK_STATUS_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={workStatus === option.id}
                    disabled={savingAvailability}
                    onClick={() => setWorkStatus(option.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-extrabold transition ${
                      workStatus === option.id ? 'bg-oc-amber text-oc-deep' : 'text-white/80 hover:bg-white/10'
                    }`}
                    data-testid={`work-status-${option.id.toLowerCase()}`}
                  >
                    <option.icon className="h-4 w-4" /> {option.label}
                  </button>
                ))}
                {savingAvailability && <Spinner className="ml-1 h-4 w-4 self-center" />}
              </div>
              <p className="mt-1 text-[11px] text-[#b9d8c5]">{statusOption.note}</p>
            </div>
          </div>
        </section>

        {location.permission !== 'granted' && location.error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="location-permission">
            <LocateFixed className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-extrabold">Location access is required to receive nearby jobs.</p>
              <p className="mt-1">{location.error}</p>
            </div>
          </div>
        )}

        {summary && !summary.can_receive_jobs && pending.length > 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-extrabold">You will not be offered jobs yet</p>
              <ul className="mt-1 list-disc pl-5">{pending.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          </div>
        )}

        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={Wallet} label="Today's earnings" value={todayNet === null ? '–' : formatRupees(todayNet)} accent="bg-oc-mint text-oc-green" onClick={() => selectTab('earnings')} active={tab === 'earnings'} testid="stat-today-earnings" />
          <StatCard icon={CheckCircle2} label="Completed jobs" value={summary?.completed_jobs ?? '–'} accent="bg-emerald-100 text-emerald-700" onClick={() => setTab('completed')} active={tab === 'completed'} />
          <StatCard icon={BellRing} label="New requests" value={dispatchOffers.offers.length || (summary?.new_requests ?? '–')} accent="bg-amber-100 text-amber-700" onClick={() => setTab('new')} active={tab === 'new'} />
          <StatCard icon={CircleCheckBig} label="Accepted jobs" value={summary?.accepted_jobs ?? '–'} accent="bg-sky-100 text-sky-700" onClick={() => setTab('accepted')} active={tab === 'accepted'} />
          <StatCard icon={BriefcaseBusiness} label="Active jobs" value={summary?.active_jobs ?? '–'} accent="bg-indigo-100 text-indigo-700" onClick={() => setTab('active')} active={tab === 'active'} />
          <StatCard icon={Power} label={statusOption.label} value={available ? 'On' : 'Off'} accent={available ? 'bg-oc-mint text-oc-green' : 'bg-slate-100 text-slate-500'} onClick={toggleAvailability} />
        </section>

        <section className="card overflow-hidden" aria-labelledby="quick-overview-title" data-testid="quick-overview">
          <h2 id="quick-overview-title" className="border-b border-oc-line px-4 py-2.5 font-display text-sm font-extrabold text-oc-ink">Quick overview</h2>
          <div className="grid divide-y divide-oc-line md:grid-cols-3 md:divide-x md:divide-y-0">
            <OverviewRow
              icon={BriefcaseBusiness}
              label="Current job"
              value={currentJob.value}
              detail={currentJob.detail}
              tone="bg-indigo-100 text-indigo-700"
              onClick={currentJob.tab ? () => selectTab(currentJob.tab) : undefined}
              testid="overview-current-job"
            />
            <OverviewRow icon={Radio} label="Receiving job requests" value={receiving.value} detail={receiving.detail} tone={receiving.tone} testid="overview-receiving" />
            <OverviewRow
              icon={MapPin}
              label={radiusKm ? 'Service area' : 'Service location'}
              value={radiusKm ? `Within ${radiusKm} km` : user.location || '–'}
              detail={radiusKm ? user.location : user.pincode ? `PIN ${user.pincode}` : undefined}
              onClick={() => selectTab('profile')}
              testid="overview-location"
            />
          </div>
        </section>

        <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-oc-line bg-white p-1" aria-label="Dashboard sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { setNotice({ tone: 'info', text: '' }); setTab(item.id) }}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold transition ${
                tab === item.id ? 'bg-oc-green text-white' : 'text-oc-muted hover:bg-oc-sunken hover:text-oc-ink'
              }`}
            >
              <item.icon className="h-4 w-4" /> {item.label}
              {(item.id === 'new' ? dispatchOffers.offers.length : summary?.[SUMMARY_KEYS[item.id]] ?? 0) > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] ${tab === item.id ? 'bg-white/25' : 'bg-oc-mint text-oc-green'}`}>
                  {item.id === 'new' ? dispatchOffers.offers.length : summary[SUMMARY_KEYS[item.id]]}
                </span>
              )}
            </button>
          ))}
        </nav>

        <Alert tone={notice.tone}>{notice.text}</Alert>

        {/* New job request sound: on, needs a tap, or not available here. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {sound === 'enabled' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-oc-mint px-3 py-1 text-xs font-extrabold text-oc-green">
              <Volume2 className="h-3.5 w-3.5" /> Sound enabled
            </span>
          ) : sound === 'blocked' ? (
            <button
              type="button"
              onPointerDown={enableSound}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); enableSound() } }}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-extrabold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-200"
            >
              <VolumeX className="h-3.5 w-3.5" /> Enable sound for new job requests
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              <VolumeX className="h-3.5 w-3.5" /> Sound unavailable in this browser
            </span>
          )}
          {soundNote && <span className="text-xs font-semibold text-slate-500">{soundNote}</span>}
        </div>

        {tab === 'profile' ? (
          <div className="space-y-5">
            <ProfilePanel key={user.id} user={user} typeMeta={typeMeta} onUpdated={(updated) => dispatch(setUser(updated))} rating={rating} />
            <WorkPreferencesSection key={`work-${user.id}`} typeMeta={typeMeta} onSaved={refreshSummary} />
            <BankAccountSection key={`bank-${user.id}`} />
            <ChangePasswordSection key={`security-${user.id}`} />
          </div>
        ) : tab === 'earnings' ? (
          <EarningsPanel key={`earnings-${user.id}`} />
        ) : tab === 'new' ? (
          <div className="space-y-3">
            <Alert tone="error">{dispatchOffers.error}</Alert>
            {dispatchOffers.offers.length === 0 ? (
              <EmptyState icon={Inbox} title={activeTab.empty}>{activeTab.emptyBody}</EmptyState>
            ) : (
              dispatchOffers.offers.map((offer) => (
                <OfferCard
                  key={offer.booking_id}
                  offer={offer}
                  busy={dispatchOffers.busyId === offer.booking_id}
                  onAnswer={dispatchOffers.answer}
                />
              ))
            )}
          </div>
        ) : loadingJobs ? (
          <div className="flex justify-center py-16 text-oc-green"><Spinner className="h-8 w-8" /></div>
        ) : jobs.length === 0 ? (
          <EmptyState icon={activeTab.icon} title={activeTab.empty}>{activeTab.emptyBody}</EmptyState>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onAction={handleAction}
                onStarted={handleStarted}
                location={location}
              />
            ))}
          </div>
        )}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-oc-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        aria-label="Main"
        data-testid="bottom-nav"
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          {BOTTOM_NAV.map((item) => {
            const current = bottomActive === item.id
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.soon}
                aria-current={current ? 'page' : undefined}
                title={item.soon ? 'Messages are coming soon' : undefined}
                onClick={() => selectTab(item.id === 'jobs' ? (JOB_TABS.includes(tab) ? tab : 'new') : item.id)}
                className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-extrabold transition disabled:cursor-not-allowed ${
                  item.soon ? 'text-slate-300' : current ? 'text-oc-green' : 'text-oc-muted'
                }`}
                data-testid={`bottom-nav-${item.id}`}
              >
                {current && <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-oc-green" />}
                <item.icon className="h-5 w-5" />
                {item.label}
                {item.soon && <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Soon</span>}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
