/**
 * One project's cameras: Live and Recorded.
 *
 * This is the Site Engineer's Live Camera implementation, lifted out of
 * `pages/engineer/EngineerLiveCamera.jsx` unchanged so that the House Owner and
 * the Builder get exactly the same thing rather than a second, slightly
 * different copy of it. The markup, the class names, the ordering of the
 * sections, the translation keys and the players are all the engineer's; only
 * the data now arrives as props instead of being fetched here.
 *
 * It renders, in this order:
 *   1. the Live / Recorded switch  (only when this component owns the mode)
 *   2. the live player, when a camera is open
 *   3. the recorded search: camera, date, start, end
 *   4. the recorded player, when a segment is open
 *   5. the recorded results
 *   6. the live camera list, with HD/SD and Watch per camera
 *
 * `mode` may be controlled by the parent. The engineer's page keeps its own
 * switch in the header row it has always lived in, and passes `mode` /
 * `onModeChange` so that page's layout is untouched; the Owner's and Builder's
 * panels leave it uncontrolled and get the switch rendered here.
 *
 * Nothing here knows the viewer's role. Every call it makes is project-scoped
 * and authorized by the backend against the signed-in user, so the same
 * component is correct for all three roles.
 */
import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Clock, LayoutGrid, LayoutList, Maximize2, Play, Radio, RefreshCw, Search, ShieldCheck, Video } from 'lucide-react'
import { EmptyState } from '../../../shared/dashboard/RoleDashboardUi.jsx'
import LiveCameraPlayer, { QualitySelector, StatusPill, statusPillLabelKey } from './LiveCameraPlayer.jsx'
import RecordedCameraPlayer from './RecordedCameraPlayer.jsx'
import { searchRecordings } from '../camerasApi.js'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { useSelector } from 'react-redux'
import useBuilderSubscription from '../../billing/subscription/useBuilderSubscription.js'
import UpgradePrompt from '../../billing/subscription/UpgradePrompt.jsx'
import { hasFeature } from '../../billing/subscription/subscriptionFormat.js'
import { promptPlan } from '../../billing/subscription/planLimits.js'

const inputClass = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-brand-500'
const cardClass = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]'

function preferredVariant(channel) {
  if (channel.preferred_stream === 'SUB' && channel.has_sub_stream) return 'SUB'
  if (channel.preferred_stream === 'MAIN' && channel.has_main_stream) return 'MAIN'
  return channel.has_sub_stream ? 'SUB' : 'MAIN'
}

function resolutionOf(channel, variant) {
  const width = variant === 'SUB' ? channel.sub_width : channel.main_width
  const height = variant === 'SUB' ? channel.sub_height : channel.main_height
  return width && height ? `${width}×${height}` : ''
}

function pad(n) {
  return String(n).padStart(2, '0')
}
function segmentLabel(iso) {
  // "2026-09-15T16:57:23" -> "16:57:23" for a compact local-time display.
  return String(iso).slice(11, 19)
}
function durationLabel(seconds, t) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? t('ui.cctv.durationHoursMinutes', { h, m: pad(m) })
    : m > 0
      ? t('ui.cctv.durationMinutesSeconds', { m, s: pad(sec) })
      : t('ui.cctv.durationSeconds', { s: sec })
}

export default function ProjectCameraViewer({
  devices = [],
  projectTitle = '',
  // 'ready' | 'loading' | 'unavailable' | 'error' | 'noProjects'
  status = 'ready',
  onReload = null,
  // Optional: let the parent own the Live/Recorded switch and keep it in its
  // own header row. Uncontrolled, this component renders the switch itself.
  mode: controlledMode = null,
  onModeChange = null,
}) {
  const { t, td } = useLanguage()
  const isControlled = controlledMode !== null && typeof onModeChange === 'function'
  const [ownMode, setOwnMode] = useState('live')
  const mode = isControlled ? controlledMode : ownMode

  // Live mode
  const [activeChannelId, setActiveChannelId] = useState(null)
  const [activeState, setActiveState] = useState('connecting')
  const [qualityByChannel, setQualityByChannel] = useState({})
  // How the camera list is laid out: cards with a preview panel (the default),
  // or the original one-row-per-camera list. Display only.
  const [layout, setLayout] = useState('grid')
  // Recorded mode
  const now = new Date()
  const [recCameraId, setRecCameraId] = useState('')
  const [recDate, setRecDate] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
  const [recStart, setRecStart] = useState(`${pad(new Date(now.getTime() - 30 * 60000).getHours())}:${pad(new Date(now.getTime() - 30 * 60000).getMinutes())}`)
  const [recEnd, setRecEnd] = useState(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
  const [searchStatus, setSearchStatus] = useState('idle')
  const [segments, setSegments] = useState([])
  const [searchError, setSearchError] = useState('')
  const [activeSegment, setActiveSegment] = useState(null)

  const cameras = useMemo(() => (devices || []).flatMap((device) => (device.channels || [])
    .filter((channel) => channel.is_enabled)
    .map((channel) => ({
      channel,
      available: device.is_active && device.status === 'ONLINE',
    }))), [devices])

  // Keep the recorded-mode camera selection valid.
  useEffect(() => {
    if (cameras.length === 0) { setRecCameraId(''); return }
    setRecCameraId((current) => (cameras.some(({ channel }) => channel.id === current) ? current : cameras[0].channel.id))
  }, [cameras])

  // A project change closes whatever was open, so no session outlives its project.
  useEffect(() => {
    setActiveChannelId(null)
    setActiveSegment(null)
    setSegments([])
    setSearchStatus('idle')
  }, [projectTitle, devices])

  const activeCamera = cameras.find(({ channel }) => channel.id === activeChannelId) || null
  const recCamera = cameras.find(({ channel }) => channel.id === recCameraId) || null

  // HD is Premium for builders in India (the server refuses the MAIN stream
  // otherwise); owners, engineers and builders elsewhere keep both. Until the
  // builder's plan is known it is treated as SD.
  const isBuilder = useSelector((state) => state.auth.user?.role) === 'BUILDER'
  const { status: builderStatus } = useBuilderSubscription({ enabled: isBuilder })
  const hdLocked = isBuilder && builderStatus?.region_supported !== false && !hasFeature(builderStatus, 'hd_video')
  const [hdPrompt, setHdPrompt] = useState(false)
  const qualityOf = (channel) => {
    const variant = qualityByChannel[channel.id] || preferredVariant(channel)
    return hdLocked && variant === 'MAIN' && channel.has_sub_stream ? 'SUB' : variant
  }
  const chooseQuality = (channelId, variant) => {
    setQualityByChannel((current) => (current[channelId] === variant ? current : { ...current, [channelId]: variant }))
  }

  // The project's title and the label the installer typed for where this camera
  // points ("Front Gate", "Basement") are both text somebody entered, so they
  // are machine-translated for display. The channel number and the resolution
  // are numbers and stay exactly as they are.
  const cameraSubtitle = (channel) => [
    td(projectTitle),
    td(channel.location_label),
    t('dash.engineer.liveCamera.channel', { number: channel.channel_number }),
    resolutionOf(channel, qualityOf(channel)),
  ].filter(Boolean).join(' · ')

  const openCamera = (channelId) => {
    setActiveState('connecting')
    setActiveChannelId(channelId)
  }

  const switchMode = (next) => {
    if (next === mode) return
    // Leaving a mode closes its active view so the session cleans up.
    setActiveChannelId(null)
    setActiveSegment(null)
    if (isControlled) onModeChange(next)
    else setOwnMode(next)
  }

  const runSearch = async () => {
    if (!recCamera) return
    setActiveSegment(null)
    setSearchError('')
    const start = `${recDate}T${recStart}:00`
    const end = `${recDate}T${recEnd}:00`
    if (!(new Date(end).getTime() > new Date(start).getTime())) {
      setSearchStatus('error')
      setSearchError(t('dash.engineer.recorded.badWindow'))
      return
    }
    setSearchStatus('loading')
    try {
      const result = await searchRecordings(recCamera.channel.id, { start, end })
      const found = Array.isArray(result.segments) ? result.segments : []
      setSegments(found)
      setSearchStatus(found.length > 0 ? 'done' : 'empty')
    } catch (error) {
      const status = error?.response?.status
      setSearchStatus('error')
      setSearchError(status === 403 || status === 404
        ? t('dash.engineer.recorded.unauthorized')
        : t('dash.engineer.recorded.searchError'))
    }
  }

  // Live / Recorded as two buttons with icons, filled green when chosen.
  const modeButton = (value, label, Icon) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => switchMode(value)}
      className={`inline-flex h-10 items-center gap-2 rounded-xl border px-5 text-sm font-bold transition ${
        mode === value ? 'border-oc-green bg-oc-green text-white shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Rendered only when this component owns the mode. The engineer's page
          keeps its switch in the header row it has always been in. */}
      {!isControlled && (
        <div className="grid gap-1 text-xs font-bold text-slate-600">
          <span>{t('dash.engineer.recorded.mode')}</span>
          <div role="group" aria-label={t('dash.engineer.recorded.mode')} className="flex w-fit flex-wrap items-center gap-2">
            {modeButton('live', t('dash.engineer.recorded.live'), Radio)}
            {modeButton('recorded', t('dash.engineer.recorded.recorded'), Clock)}
          </div>
        </div>
      )}

      {mode === 'live' && activeCamera && (
        <LiveCameraPlayer
          key={activeCamera.channel.id}
          channel={activeCamera.channel}
          streamVariant={qualityOf(activeCamera.channel)}
          title={td(activeCamera.channel.name)}
          subtitle={cameraSubtitle(activeCamera.channel)}
          onStateChange={setActiveState}
          onStreamVariantChange={(variant) => chooseQuality(activeCamera.channel.id, variant)}
          onClose={() => setActiveChannelId(null)}
          hdLocked={hdLocked}
          onHdLocked={() => setHdPrompt(true)}
        />
      )}
      {hdLocked && hdPrompt && (
        <div className="mt-3">
          <UpgradePrompt kind="hd" planCode={promptPlan(builderStatus)} status={builderStatus} compact />
        </div>
      )}

      {mode === 'recorded' && (
        <section className={cardClass}>
          <p className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-slate-400">
            <CalendarClock className="h-4 w-4" /> {t('dash.engineer.recorded.searchHeading')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.engineer.recorded.camera')}</span>
              <select className={inputClass} value={recCameraId} onChange={(e) => { setRecCameraId(e.target.value); setActiveSegment(null); setSearchStatus('idle') }} disabled={cameras.length === 0}>
                {cameras.length === 0 && <option value="">{t('dash.engineer.liveCamera.emptyTitle')}</option>}
                {cameras.map(({ channel }) => (
                  <option key={channel.id} value={channel.id}>{td(channel.name)}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.engineer.recorded.date')}</span>
              <input type="date" className={inputClass} value={recDate} onChange={(e) => setRecDate(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.engineer.recorded.start')}</span>
              <input type="time" className={inputClass} value={recStart} onChange={(e) => setRecStart(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600">
              <span>{t('dash.engineer.recorded.end')}</span>
              <input type="time" className={inputClass} value={recEnd} onChange={(e) => setRecEnd(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            onClick={runSearch}
            disabled={!recCamera || searchStatus === 'loading'}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-xs font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Search className="h-4 w-4" /> {searchStatus === 'loading' ? t('dash.engineer.recorded.searching') : t('dash.engineer.recorded.search')}
          </button>
          <p className="mt-3 text-[11px] font-medium text-slate-400">{t('dash.engineer.recorded.timezoneNote')}</p>
        </section>
      )}

      {mode === 'recorded' && activeSegment && recCamera && (
        <RecordedCameraPlayer
          key={`${recCamera.channel.id}:${activeSegment.start_local}:${activeSegment.end_local}`}
          channel={recCamera.channel}
          segment={activeSegment}
          title={td(recCamera.channel.name)}
          subtitle={[td(projectTitle), td(recCamera.channel.location_label), t('dash.engineer.recorded.recordedOn', { date: recDate })].filter(Boolean).join(' · ')}
          onClose={() => setActiveSegment(null)}
        />
      )}

      {mode === 'recorded' && (
        <section className={cardClass}>
          <p className="mb-3 text-xs font-extrabold uppercase tracking-wide text-slate-400">{t('dash.engineer.recorded.resultsHeading')}</p>
          {searchStatus === 'idle' ? (
            <EmptyState title={t('dash.engineer.recorded.idleTitle')} message={t('dash.engineer.recorded.idleBody')} />
          ) : searchStatus === 'loading' ? (
            <p className="px-1 py-6 text-center text-sm font-semibold text-slate-500">{t('dash.engineer.recorded.searching')}</p>
          ) : searchStatus === 'error' ? (
            <p className="px-1 py-6 text-center text-sm font-semibold text-rose-600">{searchError}</p>
          ) : searchStatus === 'empty' ? (
            <EmptyState title={t('dash.engineer.recorded.noneTitle')} message={t('dash.engineer.recorded.noneBody')} />
          ) : (
            <ul className="space-y-2">
              {segments.map((segment) => {
                const isActive = activeSegment && activeSegment.start_local === segment.start_local && activeSegment.end_local === segment.end_local
                return (
                  <li key={`${segment.start_local}-${segment.end_local}`} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${isActive ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-slate-50/60'}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Video className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-slate-950">
                        {segmentLabel(segment.start_local)} – {segmentLabel(segment.end_local)}
                      </p>
                      <p className="truncate text-xs font-semibold text-slate-500">
                        {t('dash.engineer.recorded.duration', { duration: durationLabel(segment.duration_seconds, t) })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSegment(segment)}
                      disabled={isActive}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-extrabold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Play className="h-3.5 w-3.5" /> {t('dash.engineer.recorded.play')}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {mode === 'live' && (
        <section className={cardClass}>
          {/* Heading, and the Grid / List switch. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-base font-extrabold text-oc-ink">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-oc-green text-white"><Video className="h-4 w-4" /></span>
              {t('dash.engineer.liveCamera.listHeading')}
            </h2>
            {status === 'ready' && cameras.length > 0 && (
              <div role="group" className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                {[['grid', LayoutGrid, t('ce.view.grid')], ['list', LayoutList, t('ce.view.list')]].map(([value, Icon, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={layout === value}
                    onClick={() => setLayout(value)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${
                      layout === value ? 'bg-oc-green text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {status === 'noProjects' ? (
            <EmptyState title={t('dash.engineer.liveCamera.noProjectsTitle')} message={t('dash.engineer.liveCamera.noProjectsBody')} />
          ) : status === 'loading' ? (
            <p className="px-1 py-6 text-center text-sm font-semibold text-slate-500">{t('dash.engineer.liveCamera.loading')}</p>
          ) : status === 'unavailable' ? (
            <EmptyState title={t('dash.engineer.liveCamera.unavailableTitle')} message={t('dash.engineer.liveCamera.unavailableBody')} />
          ) : status === 'error' ? (
            <div className="grid place-items-center gap-3 px-1 py-6 text-center">
              <p className="text-sm font-semibold text-rose-600">{t('dash.engineer.liveCamera.loadError')}</p>
              {onReload && (
                <button
                  type="button"
                  onClick={onReload}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-4 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" /> {t('dash.engineer.liveCamera.retry')}
                </button>
              )}
            </div>
          ) : cameras.length === 0 ? (
            <EmptyState title={t('dash.engineer.liveCamera.emptyTitle')} message={t('dash.engineer.liveCamera.emptyBody')} />
          ) : layout === 'grid' ? (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {cameras.map(({ channel, available }) => {
                const isActive = channel.id === activeChannelId
                const pillState = isActive
                  ? (['live', 'connecting', 'reconnecting'].includes(activeState) ? activeState : 'offline')
                  : (available ? 'ready' : 'offline')
                return (
                  <li
                    key={channel.id}
                    className={`flex flex-col rounded-2xl border bg-white p-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] ${isActive ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-200'}`}
                  >
                    {/* Preview panel. There is no still image of a camera, so it
                        shows the camera mark; clicking it (or the expand corner)
                        does exactly what Watch does. */}
                    <button
                      type="button"
                      onClick={() => openCamera(channel.id)}
                      disabled={!available || isActive}
                      title={t('dash.engineer.liveCamera.watch')}
                      aria-label={`${t('dash.engineer.liveCamera.watch')} ${td(channel.name)}`}
                      className="group relative grid aspect-video w-full place-items-center overflow-hidden rounded-xl bg-[radial-gradient(circle_at_30%_20%,#1f4d3a,#0d2219_70%)] text-white/30 transition disabled:cursor-default"
                    >
                      <Video className="h-10 w-10 transition group-enabled:group-hover:scale-110 group-enabled:group-hover:text-white/60" />
                      <span className="absolute start-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white">
                        <span className={`h-2 w-2 rounded-full ${available ? 'animate-pulse bg-red-500' : 'bg-slate-400'}`} />
                        {t(statusPillLabelKey(available ? 'live' : 'offline'))}
                      </span>
                      <span className="absolute end-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-lg bg-black/50 text-white">
                        <Maximize2 className="h-4 w-4" />
                      </span>
                    </button>
                    <p className="mt-3 truncate px-1 text-sm font-extrabold text-oc-ink">{td(channel.name)}</p>
                    <p className="mt-0.5 truncate px-1 text-xs font-medium text-slate-500">{cameraSubtitle(channel)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 px-1 pt-3">
                      <QualitySelector channel={channel} value={qualityOf(channel)} onChange={(variant) => chooseQuality(channel.id, variant)} hdLocked={hdLocked} onHdLocked={() => setHdPrompt(true)} />
                      <span aria-hidden="true" className="h-6 w-px bg-slate-200" />
                      <StatusPill state={pillState} />
                      <button
                        type="button"
                        onClick={() => openCamera(channel.id)}
                        disabled={!available || isActive}
                        title={t('dash.engineer.liveCamera.watch')}
                        className="ms-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-oc-green px-4 text-xs font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        <Play className="h-3.5 w-3.5" /> {t('dash.engineer.liveCamera.watch')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <ul className="space-y-2">
              {cameras.map(({ channel, available }) => {
                const isActive = channel.id === activeChannelId
                const pillState = isActive
                  ? (['live', 'connecting', 'reconnecting'].includes(activeState) ? activeState : 'offline')
                  : (available ? 'ready' : 'offline')
                return (
                  <li
                    key={channel.id}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${isActive ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200 bg-slate-50/60'}`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                      <Video className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-slate-950">{td(channel.name)}</p>
                      <p className="truncate text-xs font-semibold text-slate-500">{cameraSubtitle(channel)}</p>
                    </div>
                    <QualitySelector channel={channel} value={qualityOf(channel)} onChange={(variant) => chooseQuality(channel.id, variant)} hdLocked={hdLocked} onHdLocked={() => setHdPrompt(true)} />
                    <StatusPill state={pillState} />
                    <button
                      type="button"
                      onClick={() => openCamera(channel.id)}
                      disabled={!available || isActive}
                      title={t('dash.engineer.liveCamera.watch')}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-oc-green px-3 text-xs font-extrabold text-white transition hover:bg-oc-deep disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Play className="h-3.5 w-3.5" /> {t('dash.engineer.liveCamera.watch')}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {mode === 'live' && (
        <p className="flex items-start gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs font-medium text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-oc-green" />
          {t('dash.engineer.liveCamera.securityNote')}
        </p>
      )}
    </div>
  )
}
