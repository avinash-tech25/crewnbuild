/**
 * One recorded-playback view, played from a backend recorded-playback session.
 *
 *   start  POST /cctv/channels/{id}/recordings/playback  {start,end,speed}
 *          -> playback_url, playback_token   (same secure shape as live)
 *   renew  POST /cctv/playback/{session_id}/renew  every 45s
 *   end    DELETE /cctv/playback/{session_id}  on close/change/unmount/pagehide
 *
 * Speed is DVR-side: the recorder replays faster (RTSP Scale), so the media
 * timeline itself advances at 1.5x/2x/3x — the browser never fakes it with
 * playbackRate. Because speed and seek are properties of the replay session,
 * changing either opens a NEW session for the chosen speed / start time (always
 * an explicit [start, end] window; never open-ended). Pause/resume act on the
 * buffered video locally.
 *
 * The token lives only in this effect's closure — never in state, storage, a URL
 * or a log line. Cleanup ends the session exactly like the live player.
 */
import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Pause, Play, RotateCcw, X } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext.jsx'
import { StatusPill } from './LiveCameraPlayer.jsx'
import {
  endPlaybackSession,
  endPlaybackSessionOnPageExit,
  renewPlaybackSession,
  startRecordedPlayback,
} from '../camerasApi.js'

const RENEW_INTERVAL_MS = 45_000
const SPEEDS = ['1', '1.5', '2', '3']
const TERMINAL_STATES = new Set(['ended', 'failed', 'expired', 'unauthorized', 'offline', 'unavailable', 'unsupported'])
const OFFLINE_CODES = new Set(['CCTV_DEVICE_NOT_ONLINE', 'CCTV_DEVICE_INACTIVE', 'CCTV_CHANNEL_DISABLED', 'CCTV_STREAM_NOT_CONFIGURED'])

function stateForApiError(error) {
  const status = error?.response?.status
  const code = error?.response?.data?.detail?.code
  if (!status) return 'failed'
  if (code === 'CCTV_PLAYBACK_SESSION_EXPIRED' || code === 'CCTV_PLAYBACK_SESSION_ENDED') return 'expired'
  if (code === 'CCTV_RECORDING_SEARCH_FAILED' || code === 'CCTV_MEDIA_GATEWAY_ERROR') return 'failed'
  if (OFFLINE_CODES.has(code)) return 'offline'
  if (code === 'CCTV_MEDIA_GATEWAY_NOT_CONFIGURED') return 'unavailable'
  if (status === 401 || status === 403 || status === 404) return 'unauthorized'
  return 'failed'
}

function pad(n) {
  return String(Math.floor(n)).padStart(2, '0')
}
function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`
}
// A naive local datetime -> "YYYY-MM-DDTHH:MM:SS" in the browser's local time,
// which on this office machine is the DVR's local time.
function toLocalIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default function RecordedCameraPlayer({ channel, segment, title, subtitle, onClose }) {
  const { t, td } = useLanguage()
  const videoRef = useRef(null)
  const [speed, setSpeed] = useState('1')
  const [seekOffset, setSeekOffset] = useState(0) // footage seconds from window start
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState('connecting')
  const [paused, setPaused] = useState(false)
  const [position, setPosition] = useState(0) // footage seconds from window start

  const windowStart = new Date(segment.start_local)
  const windowEnd = new Date(segment.end_local)
  const windowSeconds = Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / 1000))
  const seekOffsetRef = useRef(seekOffset)
  seekOffsetRef.current = seekOffset

  useEffect(() => {
    const video = videoRef.current
    let cancelled = false
    let hls = null
    let sessionId = null
    let token = null
    let renewTimer = null
    const baseOffset = seekOffsetRef.current

    const report = (next) => { if (!cancelled) setState(next) }

    const destroyPlayer = () => {
      window.clearTimeout(renewTimer)
      renewTimer = null
      if (hls) { hls.destroy(); hls = null }
      if (video) { video.pause(); video.removeAttribute('src'); video.load() }
    }
    const endSession = () => {
      const id = sessionId
      sessionId = null
      token = null
      if (id) endPlaybackSession(id).catch(() => {})
    }
    const stop = (next) => { destroyPlayer(); endSession(); report(next) }

    const scheduleRenewal = () => {
      window.clearTimeout(renewTimer)
      renewTimer = window.setTimeout(async () => {
        if (cancelled || !sessionId) return
        try {
          await renewPlaybackSession(sessionId)
          scheduleRenewal()
        } catch (error) {
          if (!cancelled && sessionId) stop(error?.response ? stateForApiError(error) : 'expired')
        }
      }, RENEW_INTERVAL_MS)
    }

    const start = async () => {
      report('connecting')
      setPaused(false)
      if (!video) return
      if (!Hls.isSupported()) { report('unsupported'); return }
      const effectiveStart = new Date(windowStart.getTime() + baseOffset * 1000)
      let session
      try {
        session = await startRecordedPlayback(channel.id, {
          start: toLocalIso(effectiveStart),
          end: toLocalIso(windowEnd),
          speed,
          streamVariant: 'MAIN',
        })
      } catch (error) {
        report(stateForApiError(error))
        return
      }
      if (cancelled) { endPlaybackSession(session.session_id).catch(() => {}); return }
      sessionId = session.session_id
      token = session.playback_token
      // Recorded playback is VOD-like: keep a long back-buffer so the user can
      // scrub backwards within what has been delivered.
      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        backBufferLength: 3600,
        liveDurationInfinity: true,
        manifestLoadingMaxRetry: 3,
        fragLoadingMaxRetry: 4,
        xhrSetup: (xhr) => { if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`) },
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => { applyRate(); video.play().catch(() => {}) })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || !data?.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return }
        stop('failed')
      })
      hls.loadSource(session.playback_url)
      hls.attachMedia(video)
      scheduleRenewal()
    }

    // Speed is delivered on both sides: the gateway pulls the recording at N×
    // (rtspScale, so the buffer fills N× faster) and the browser consumes at N×
    // (playbackRate). Real frames, truly at N× — not a browser-only fast-forward
    // that would stall, because the faster source keeps the buffer ahead.
    const applyRate = () => { if (video) video.playbackRate = Number(speed) || 1 }
    const onPlaying = () => { if (!cancelled && video.videoWidth > 0) { applyRate(); report('playing'); setPaused(false) } }
    const onTimeUpdate = () => {
      if (cancelled) return
      setPosition(baseOffset + (video.currentTime || 0))
      if (video.videoWidth > 0 && !video.paused && video.readyState > 2 && state !== 'playing') report('playing')
    }
    const onPause = () => { if (!cancelled) setPaused(true) }
    const onEnded = () => { if (!cancelled) report('ended') }
    const onPageHide = () => { const id = sessionId; if (id) { sessionId = null; token = null; endPlaybackSessionOnPageExit(id) } }

    video?.addEventListener('playing', onPlaying)
    video?.addEventListener('timeupdate', onTimeUpdate)
    video?.addEventListener('pause', onPause)
    video?.addEventListener('ended', onEnded)
    window.addEventListener('pagehide', onPageHide)
    start()

    return () => {
      cancelled = true
      window.removeEventListener('pagehide', onPageHide)
      video?.removeEventListener('playing', onPlaying)
      video?.removeEventListener('timeupdate', onTimeUpdate)
      video?.removeEventListener('pause', onPause)
      video?.removeEventListener('ended', onEnded)
      destroyPlayer()
      endSession()
    }
    // Speed and seek are session properties: changing either re-opens the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, segment.start_local, segment.end_local, speed, seekOffset, attempt])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }
  const onScrubCommit = (event) => {
    const next = Math.min(windowSeconds - 1, Math.max(0, Number(event.target.value) || 0))
    setPosition(next)
    setSeekOffset(next) // re-opens the replay session at this footage time
  }

  const terminal = TERMINAL_STATES.has(state)
  const pillState = state === 'playing' ? 'live' : state === 'connecting' ? 'connecting' : 'offline'
  const showOverlay = state !== 'playing'

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_-30px_rgba(15,23,42,0.35)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {/* Camera name and project, both typed by people. Display only. */}
          <p className="truncate text-sm font-extrabold text-slate-950">{td(title)}</p>
          {subtitle && <p className="truncate text-xs font-semibold text-slate-500">{td(subtitle)}</p>}
        </div>
        <StatusPill state={pillState} />
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

      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-full w-full object-contain" muted autoPlay playsInline disablePictureInPicture />
        {showOverlay && (
          <div className="absolute inset-0 grid place-items-center bg-black/60 px-6 text-center">
            <div className="max-w-sm">
              {!terminal && <RotateCcw className="mx-auto mb-2 h-6 w-6 animate-spin text-white/80" />}
              <p className="text-sm font-bold text-white" data-player-state={state}>
                {t(`dash.engineer.recorded.player.${state}`)}
              </p>
              {terminal && state !== 'unsupported' && (
                <button
                  type="button"
                  onClick={() => { setSeekOffset(0); setAttempt((v) => v + 1) }}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-xs font-extrabold text-slate-900 transition hover:bg-slate-100"
                >
                  <RotateCcw className="h-4 w-4" /> {t('dash.engineer.recorded.restart')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Timeline + transport controls */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            disabled={state !== 'playing' && !paused}
            title={t(paused ? 'dash.engineer.recorded.resume' : 'dash.engineer.recorded.pause')}
            aria-label={t(paused ? 'dash.engineer.recorded.resume' : 'dash.engineer.recorded.pause')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 disabled:bg-slate-300"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] font-bold text-slate-600 tabular-nums">{clock(position)}</span>
          <input
            type="range"
            min={0}
            max={windowSeconds}
            step={1}
            value={Math.min(position, windowSeconds)}
            onChange={(e) => setPosition(Number(e.target.value))}
            onMouseUp={onScrubCommit}
            onTouchEnd={onScrubCommit}
            onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) onScrubCommit(e) }}
            aria-label={t('dash.engineer.recorded.seek')}
            className="h-1.5 flex-1 cursor-pointer accent-brand-600"
          />
          <span className="w-16 shrink-0 font-mono text-[11px] font-bold text-slate-400 tabular-nums">{clock(windowSeconds)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{t('dash.engineer.recorded.speed')}</span>
          <div role="group" aria-label={t('dash.engineer.recorded.speed')} className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={speed === option}
                onClick={() => { if (speed !== option) setSpeed(option) }}
                className={`h-7 min-w-10 rounded-md px-2 text-[11px] font-extrabold tabular-nums transition ${
                  speed === option ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
