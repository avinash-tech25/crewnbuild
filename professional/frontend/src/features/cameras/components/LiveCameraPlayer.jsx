/**
 * One live camera view, played from a backend playback session.
 *
 *   start   POST   /cctv/channels/{channel_id}/playback  -> playback_url, playback_token
 *   play    hls.js loads playback_url and sends the token as
 *           `Authorization: Bearer <token>` on every request. The media gateway
 *           refuses a request without it, and refuses a token in the URL.
 *   renew   POST   /cctv/playback/{session_id}/renew every 45 seconds while open
 *   end     DELETE /cctv/playback/{session_id} when the view closes, the camera,
 *           quality or project changes, the page is left, or the tab is closed
 *   quality `streamVariant` is the stream the session is opened for: MAIN is
 *           shown as HD and SUB as SD. Changing it ends the current session,
 *           waits briefly for that DELETE, and opens a new session for the
 *           chosen stream. A stream that cannot be played is reported for that
 *           quality; the other stream is never tried in its place.
 *
 * The token lives only in this component's effect closure. It is never put in
 * React state, Redux, storage, a URL or a log line.
 *
 * Native HLS (a <video src> pointed at the playlist) cannot send an
 * Authorization header, so playback needs Media Source Extensions through
 * hls.js; a browser without them is told so rather than shown a broken player.
 *
 * LIVE is shown only once the <video> element is actually playing frames.
 */
import { useEffect, useRef, useState } from 'react'
import { loadHls } from '../loadHls.js'

// Set by loadHls() when the first stream starts.
let Hls = null
import { Maximize2, Minimize2, RefreshCw, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import {
  endPlaybackSession,
  endPlaybackSessionOnPageExit,
  renewPlaybackSession,
  startPlaybackSession,
} from '../camerasApi.js'

const RENEW_INTERVAL_MS = 45_000
const RENEW_RETRY_MS = 8_000
const MAX_RENEW_RETRIES = 2
// A fatal network error while the camera stream is starting (or a brief
// gateway hiccup) is retried a few times before the view gives up.
const NETWORK_RETRY_MS = 2_000
const MAX_NETWORK_RECOVERIES = 3

// Player states. `connecting` and `reconnecting` are transient; the rest after
// `live` end the session and offer a reconnect.
const TERMINAL_STATES = new Set(['failed', 'expired', 'unauthorized', 'offline', 'limit', 'unavailable', 'unsupported'])

const OFFLINE_CODES = new Set(['CCTV_DEVICE_NOT_ONLINE', 'CCTV_DEVICE_INACTIVE', 'CCTV_CHANNEL_DISABLED'])

// A switch closes the previous session before asking for the next one, so rapid
// switching does not pile up open sessions against the per-user limit. The wait
// is capped: a DELETE that never answers must not block the new view.
const SESSION_END_WAIT_MS = 2_000
let lastSessionEnd = Promise.resolve()

function trackSessionEnd(request) {
  lastSessionEnd = request.catch(() => {})
}

function previousSessionEnded() {
  let timer
  const cap = new Promise((resolve) => {
    timer = window.setTimeout(resolve, SESSION_END_WAIT_MS)
  })
  return Promise.race([lastSessionEnd, cap]).finally(() => window.clearTimeout(timer))
}

function stateForApiError(error) {
  const status = error?.response?.status
  const code = error?.response?.data?.detail?.code
  if (!status) return 'failed'
  if (code === 'CCTV_PLAYBACK_SESSION_EXPIRED' || code === 'CCTV_PLAYBACK_SESSION_ENDED') return 'expired'
  // The channel has no stream for the requested quality: that quality failed,
  // the camera itself is not offline.
  if (code === 'CCTV_STREAM_NOT_CONFIGURED') return 'failed'
  if (OFFLINE_CODES.has(code)) return 'offline'
  if (code === 'CCTV_PLAYBACK_SESSION_LIMIT') return 'limit'
  if (code === 'CCTV_MEDIA_GATEWAY_NOT_CONFIGURED') return 'unavailable'
  if (status === 401 || status === 403 || status === 404) return 'unauthorized'
  return 'failed'
}

// A failed view names the quality that failed, so a user who picked HD is never
// left wondering whether SD was played instead (it is not).
function overlayMessageKey(state, streamVariant) {
  if (state === 'failed' && streamVariant === 'MAIN') return 'dash.engineer.liveCamera.player.hdUnavailable'
  if (state === 'failed' && streamVariant === 'SUB') return 'dash.engineer.liveCamera.player.sdUnavailable'
  return `dash.engineer.liveCamera.player.${state}`
}

export const STATUS_PILL_CLASSES = {
  live: { pill: 'bg-rose-50 text-rose-600 ring-rose-200', dot: 'bg-rose-500' },
  connecting: { pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  reconnecting: { pill: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  ready: { pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  offline: { pill: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-400' },
}

export function statusPillLabelKey(state) {
  if (state === 'live') return 'dash.engineer.liveCamera.statusLive'
  if (state === 'connecting') return 'dash.engineer.liveCamera.statusConnecting'
  if (state === 'reconnecting') return 'dash.engineer.liveCamera.statusReconnecting'
  if (state === 'ready') return 'dash.engineer.liveCamera.statusReady'
  return 'dash.engineer.liveCamera.statusOffline'
}

export function StatusPill({ state }) {
  const { t } = useLanguage()
  const classes = STATUS_PILL_CLASSES[state] || STATUS_PILL_CLASSES.offline
  return (
    <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-extrabold uppercase tracking-wide ring-1 ${classes.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${classes.dot} ${state === 'live' ? 'animate-pulse' : ''}`} />
      {t(statusPillLabelKey(state))}
    </span>
  )
}

// HD is the channel's MAIN stream and SD its SUB stream, whatever resolution
// the recorder is set to. A quality the channel has no stream for is disabled.
const QUALITY_OPTIONS = [
  { variant: 'MAIN', labelKey: 'dash.engineer.liveCamera.qualityHd', hintKey: 'dash.engineer.liveCamera.qualityHdHint', configured: (channel) => Boolean(channel.has_main_stream) },
  { variant: 'SUB', labelKey: 'dash.engineer.liveCamera.qualitySd', hintKey: 'dash.engineer.liveCamera.qualitySdHint', configured: (channel) => Boolean(channel.has_sub_stream) },
]

// `hdLocked`: a builder whose plan has SD only (HD is Premium; the server refuses
// the MAIN stream too). HD then opens the plan prompt (`onHdLocked`) instead.
export function QualitySelector({ channel, value, onChange, hdLocked = false, onHdLocked = null }) {
  const { t } = useLanguage()
  return (
    <div
      role="group"
      aria-label={t('dash.engineer.liveCamera.quality')}
      className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5"
    >
      {QUALITY_OPTIONS.map((option) => {
        const configured = option.configured(channel)
        const selected = value === option.variant
        const locked = hdLocked && option.variant === 'MAIN'
        return (
          <button
            key={option.variant}
            type="button"
            aria-pressed={selected}
            disabled={!configured || (locked && !onHdLocked)}
            title={locked ? t('subscription.limit.reached.hd') : t(configured ? option.hintKey : 'dash.engineer.liveCamera.qualityNotConfigured')}
            onClick={() => {
              if (locked) { onHdLocked?.(); return }
              if (!selected) onChange(option.variant)
            }}
            className={`h-7 min-w-9 rounded-md px-2 text-[11px] font-extrabold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? 'bg-brand-600 text-white shadow-sm' : locked ? 'text-slate-400 line-through decoration-slate-300 hover:bg-white' : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )
}

export default function LiveCameraPlayer({ channel, streamVariant, title, subtitle, onStateChange, onStreamVariantChange, onClose, hdLocked = false, onHdLocked = null }) {
  const { t, td } = useLanguage()
  const containerRef = useRef(null)
  const videoRef = useRef(null)
  const stateRef = useRef('connecting')
  const onStateChangeRef = useRef(onStateChange)
  const [state, setState] = useState('connecting')
  const [attempt, setAttempt] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  onStateChangeRef.current = onStateChange

  useEffect(() => {
    const video = videoRef.current
    let cancelled = false
    let hls = null
    let sessionId = null
    let token = null
    let expiresAt = 0
    let renewTimer = null
    let mediaRecoveries = 0
    let networkRecoveries = 0
    let recoveringNetwork = false
    let playbackUrl = ''

    const report = (next) => {
      if (cancelled) return
      stateRef.current = next
      setState(next)
      onStateChangeRef.current?.(next)
    }

    const destroyPlayer = () => {
      window.clearTimeout(renewTimer)
      renewTimer = null
      if (hls) {
        hls.destroy()
        hls = null
      }
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }

    const endSession = () => {
      const id = sessionId
      sessionId = null
      token = null
      if (id) trackSessionEnd(endPlaybackSession(id))
    }

    const stop = (next) => {
      destroyPlayer()
      endSession()
      report(next)
    }

    const scheduleRenewal = (delay = RENEW_INTERVAL_MS, retriesLeft = MAX_RENEW_RETRIES) => {
      window.clearTimeout(renewTimer)
      renewTimer = window.setTimeout(async () => {
        if (cancelled || !sessionId) return
        try {
          const renewed = await renewPlaybackSession(sessionId)
          if (cancelled || !sessionId) return
          expiresAt = Date.parse(renewed.expires_at) || expiresAt
          if (stateRef.current === 'reconnecting') {
            report(video && !video.paused && video.readyState > 2 ? 'live' : 'connecting')
          }
          scheduleRenewal()
        } catch (error) {
          if (cancelled || !sessionId) return
          // A network hiccup gets a couple of quick retries while the session is
          // still valid on the server; any answer from the API is final.
          if (!error?.response && retriesLeft > 0 && Date.now() + RENEW_RETRY_MS < expiresAt) {
            report('reconnecting')
            scheduleRenewal(RENEW_RETRY_MS, retriesLeft - 1)
            return
          }
          stop(error?.response ? stateForApiError(error) : 'expired')
        }
      }, delay)
    }

    // Read once hls.js is loaded (it is, before any stream can fail).
    const isManifestError = (details) => [
      Hls.ErrorDetails.MANIFEST_LOAD_ERROR,
      Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT,
      Hls.ErrorDetails.MANIFEST_PARSING_ERROR,
    ].includes(details)

    const recoverNetwork = async (data) => {
      if (networkRecoveries >= MAX_NETWORK_RECOVERIES) {
        stop('failed')
        return
      }
      networkRecoveries += 1
      // Only the backend can say whether the session itself is still valid; a
      // refused request is not taken as proof that it ended. Renewing checks it
      // (and extends it) in one call.
      try {
        const renewed = await renewPlaybackSession(sessionId)
        expiresAt = Date.parse(renewed.expires_at) || expiresAt
      } catch (error) {
        if (!cancelled && sessionId) stop(error?.response ? stateForApiError(error) : 'failed')
        return
      }
      if (cancelled || !hls) return
      recoveringNetwork = true
      report(stateRef.current === 'live' ? 'reconnecting' : 'connecting')
      window.setTimeout(() => {
        if (cancelled || !hls) return
        if (isManifestError(data.details)) hls.loadSource(playbackUrl)
        else hls.startLoad()
      }, NETWORK_RETRY_MS)
    }

    const start = async () => {
      report('connecting')
      if (!video) return
      // Downloaded on first playback (see loadHls).
      try {
        Hls = await loadHls()
      } catch {
        report('failed')
        return
      }
      if (cancelled) return
      if (!Hls.isSupported()) {
        report('unsupported')
        return
      }
      // The session this view replaces (another quality or camera) is closed first.
      await previousSessionEnded()
      if (cancelled) return
      let session
      try {
        session = await startPlaybackSession(channel.id, { transport: 'LL_HLS', streamVariant })
      } catch (error) {
        report(stateForApiError(error))
        return
      }
      if (cancelled) {
        // The user moved on while this session was being opened: close it
        // instead of letting a stale stream start.
        trackSessionEnd(endPlaybackSession(session.session_id))
        return
      }
      sessionId = session.session_id
      token = session.playback_token
      playbackUrl = session.playback_url
      expiresAt = Date.parse(session.expires_at) || Date.now() + 120_000

      hls = new Hls({
        // hls.js 1.3's inline Web Worker does not survive Vite's dependency
        // pre-bundling (it throws before transmuxing anything). The gateway
        // serves fMP4, which hls.js passes through, so the main thread is fine.
        enableWorker: false,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 4,
        xhrSetup: (xhr) => {
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        },
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data?.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
          mediaRecoveries += 1
          hls.recoverMediaError()
          return
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          recoverNetwork(data)
          return
        }
        stop('failed')
      })
      hls.loadSource(session.playback_url)
      hls.attachMedia(video)
      scheduleRenewal()
    }

    const onPlaying = () => {
      if (!cancelled && sessionId && video.videoWidth > 0) {
        networkRecoveries = 0
        recoveringNetwork = false
        report('live')
      }
    }
    // Frames advancing again after a stream recovery also count as playback.
    const onTimeUpdate = () => {
      const current = stateRef.current
      const waitingForFrames = current === 'connecting' || (current === 'reconnecting' && recoveringNetwork)
      if (!cancelled && sessionId && waitingForFrames && !video.paused && video.videoWidth > 0 && video.readyState > 2) {
        networkRecoveries = 0
        recoveringNetwork = false
        report('live')
      }
    }
    const onWaiting = () => {
      if (!cancelled && stateRef.current === 'live') report('connecting')
    }
    // A live view has no pause control, so any pause came from the browser (for
    // example a muted video in a hidden or occluded tab): resume while open.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && hls && video?.paused) video.play().catch(() => {})
    }
    const onPause = () => {
      if (!cancelled && hls && document.visibilityState === 'visible') video.play().catch(() => {})
    }
    const onPageHide = () => {
      const id = sessionId
      if (!id) return
      sessionId = null
      token = null
      endPlaybackSessionOnPageExit(id)
    }

    video?.addEventListener('playing', onPlaying)
    video?.addEventListener('timeupdate', onTimeUpdate)
    video?.addEventListener('waiting', onWaiting)
    video?.addEventListener('pause', onPause)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onPageHide)
    start()

    return () => {
      cancelled = true
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisible)
      video?.removeEventListener('playing', onPlaying)
      video?.removeEventListener('timeupdate', onTimeUpdate)
      video?.removeEventListener('waiting', onWaiting)
      video?.removeEventListener('pause', onPause)
      destroyPlayer()
      endSession()
    }
  }, [channel.id, streamVariant, attempt])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else containerRef.current?.requestFullscreen?.().catch(() => {})
  }

  const pillState = state === 'live' || state === 'connecting' || state === 'reconnecting' ? state : 'offline'
  const showOverlay = state !== 'live'
  const terminal = TERMINAL_STATES.has(state)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* The camera's own name and the project it belongs to, both typed by
            people. Display only -- nothing about the session changes. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-slate-950">{td(title)}</p>
          {subtitle && <p className="truncate text-xs font-semibold text-slate-500">{td(subtitle)}</p>}
        </div>
        {onStreamVariantChange && (
          <QualitySelector channel={channel} value={streamVariant} onChange={onStreamVariantChange} hdLocked={hdLocked} onHdLocked={onHdLocked} />
        )}
        <StatusPill state={pillState} />
        <button
          type="button"
          onClick={toggleFullscreen}
          title={t(fullscreen ? 'dash.engineer.liveCamera.exitFullscreen' : 'dash.engineer.liveCamera.fullscreen')}
          aria-label={t(fullscreen ? 'dash.engineer.liveCamera.exitFullscreen' : 'dash.engineer.liveCamera.fullscreen')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t('dash.engineer.liveCamera.close')}
          aria-label={t('dash.engineer.liveCamera.close')}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full object-contain" muted autoPlay playsInline disablePictureInPicture />
        {showOverlay && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 px-6 text-center">
            <div className="max-w-sm">
              {!terminal && <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin text-white/80" />}
              <p className="text-sm font-bold text-white" data-player-state={state}>
                {t(overlayMessageKey(state, streamVariant))}
              </p>
              {terminal && state !== 'unsupported' && (
                <button
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-xs font-extrabold text-slate-900 transition hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4" /> {t('dash.engineer.liveCamera.reconnect')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
