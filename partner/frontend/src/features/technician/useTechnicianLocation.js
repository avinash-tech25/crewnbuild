import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GPS_FIX_MAX_AGE_MS,
  GPS_MESSAGES,
  GPS_PUMP_MS,
  GPS_QUICK_FIX_OPTIONS,
  GPS_WATCH_OPTIONS,
  LOCATION_HEARTBEAT_MS,
  LOCATION_UPDATE_INTERVAL_MS,
  isUsableFix,
} from '../../shared/constants/tracking.js'
import { apiErrorCode, apiErrorMessage } from '../../shared/api/apiClient.js'
import { fetchPresence, forgetTechnicianLocation, publishTechnicianLocation } from './dispatchApi.js'
import { createLocationScheduler } from './locationScheduler.js'

/**
 * The technician's live location: ONE watcher, ONE send loop, ONE endpoint.
 *
 * It replaces two hooks that used to run side by side (a 20-second "presence"
 * heartbeat and a separate journey watcher), which meant two GPS watchers and two
 * request streams while on a job.
 *
 *   active (available, or holding a job)
 *      watchPosition (high accuracy) -> scheduler.offer(fix)     newest fix only
 *      pump, every second            -> scheduler.next()         ~every 3 s, one in flight
 *      POST /technicians/me/location -> presence + the job's navigation view
 *   not active (offline / paused with no job / signed out / unmounted)
 *      watcher cleared, pump cleared, wake lock released -- nothing keeps running
 *
 * The browser does the positioning (watchPosition), so no new fix is computed every
 * three seconds; the scheduler only decides when the newest one goes out. The
 * cadence comes from the server (update_interval_seconds), and a session counter
 * makes every callback from a previous start a no-op, so a fast toggle can never
 * leave two loops running or a late answer overwrite a newer one.
 */

const IDLE_GPS = { accuracy: null, fixAt: null, sentAt: null, sentCount: 0 }
// The session has ended or the account may no longer work: stop for good.
const FATAL_STATUSES = new Set([401, 403])

function fixFrom(position) {
  const { latitude, longitude, accuracy, heading, speed, altitude } = position.coords
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    // Browsers report null or NaN for these while stationary.
    heading: Number.isFinite(heading) && heading >= 0 && heading <= 360 ? heading : null,
    speed: Number.isFinite(speed) && speed >= 0 ? speed : null,
    altitude: Number.isFinite(altitude) ? altitude : null,
    timestamp: position.timestamp,
  }
}

export default function useTechnicianLocation({ active, keepAwake = false } = {}) {
  const [permission, setPermission] = useState('unknown') // unknown | granted | denied | unsupported
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [presence, setPresence] = useState(null)
  const [activeJob, setActiveJob] = useState(null)
  const [gps, setGps] = useState(IDLE_GPS)
  const [tracking, setTracking] = useState(false)

  const sessionRef = useRef(0)
  const watchRef = useRef(null)
  const pumpRef = useRef(null)
  const wakeLockRef = useRef(null)
  const schedulerRef = useRef(null)
  if (schedulerRef.current === null) {
    schedulerRef.current = createLocationScheduler({
      intervalMs: LOCATION_UPDATE_INTERVAL_MS,
      heartbeatMs: LOCATION_HEARTBEAT_MS,
      maxFixAgeMs: GPS_FIX_MAX_AGE_MS,
    })
  }

  /** Everything this hook has running, taken down. Safe to call at any time. */
  const teardown = useCallback(() => {
    sessionRef.current += 1
    if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    window.clearInterval(pumpRef.current)
    pumpRef.current = null
    schedulerRef.current.reset()
    setTracking(false)
  }, [])

  const send = useCallback((session) => {
    const scheduler = schedulerRef.current
    const fix = scheduler.next()
    if (!fix || sessionRef.current !== session) return
    scheduler.sending(fix)
    publishTechnicianLocation(fix)
      .then((answer) => {
        if (sessionRef.current !== session) return
        scheduler.settled(true)
        scheduler.setInterval((answer.update_interval_seconds ?? 0) * 1000)
        setPresence(answer)
        setActiveJob(answer.active_job ?? null)
        setError('')
        setWarning('')
        setGps((current) => ({ ...current, sentAt: Date.now(), sentCount: current.sentCount + 1 }))
      })
      .catch((requestError) => {
        if (sessionRef.current !== session) return
        scheduler.settled(false)
        const status = requestError?.response?.status
        const code = apiErrorCode(requestError)
        if (FATAL_STATUSES.has(status)) {
          teardown()
          setError(apiErrorMessage(requestError, 'Your session has ended. Sign in again to keep receiving jobs.'))
        } else if (code === 'LOCATION_OUT_OF_ORDER') {
          // A newer fix already arrived; nothing to tell the technician.
        } else if (code === 'LOCATION_JUMP_REJECTED' || code === 'LOCATION_IMPRECISE' || code === 'LOCATION_CLOCK_SKEW') {
          setWarning(apiErrorMessage(requestError, GPS_MESSAGES.imprecise))
        } else {
          // Offline for a moment, or the server is restarting: the loop keeps
          // going and the next fix goes out as soon as a request succeeds.
          setError(apiErrorMessage(requestError, 'Your location could not be sent. Retrying…'))
        }
      })
  }, [teardown])

  useEffect(() => {
    if (!active) {
      teardown()
      return undefined
    }
    // A phone gives no position at all on an insecure page, and says so in a way
    // nobody can act on. Name the real problem instead.
    if (!window.isSecureContext) {
      setPermission('unsupported')
      setError(GPS_MESSAGES.insecure)
      return undefined
    }
    if (!('geolocation' in navigator)) {
      setPermission('unsupported')
      setError(GPS_MESSAGES.unsupported)
      return undefined
    }

    teardown()
    const session = sessionRef.current
    setTracking(true)
    setGps(IDLE_GPS)

    // When the newest fix arrived, and when a fresh one was last asked for (see the pump).
    let lastFixAt = Date.now()
    let lastAskAt = 0

    const onFix = (position) => {
      if (sessionRef.current !== session) return
      if (!isUsableFix(position)) {
        // A city-sized guess from the IP address would put this technician at the
        // wrong end of the state. Wait for a real fix.
        setWarning(GPS_MESSAGES.imprecise)
        return
      }
      const fix = fixFrom(position)
      if (!schedulerRef.current.offer(fix)) return
      lastFixAt = Date.now()
      setPermission('granted')
      setGps((current) => ({ ...current, accuracy: fix.accuracy, fixAt: Date.now() }))
      send(session)
    }

    const onFailure = (positionError) => {
      if (sessionRef.current !== session) return
      if (positionError.code === positionError.PERMISSION_DENIED) {
        // Only a refusal stops tracking; a weak signal is temporary.
        setPermission('denied')
        setError(GPS_MESSAGES.denied)
        teardown()
      } else if (positionError.code === positionError.POSITION_UNAVAILABLE) {
        setWarning(GPS_MESSAGES.unavailable)
      } else {
        setWarning(GPS_MESSAGES.timeout)
      }
    }

    // Both share the one permission prompt: the quick fix makes the technician
    // reachable at once, the watch keeps the position current.
    navigator.geolocation.getCurrentPosition(onFix, (positionError) => {
      if (positionError.code === positionError.PERMISSION_DENIED) onFailure(positionError)
    }, GPS_QUICK_FIX_OPTIONS)
    watchRef.current = navigator.geolocation.watchPosition(onFix, onFailure, GPS_WATCH_OPTIONS)
    pumpRef.current = window.setInterval(() => {
      // A device standing still stops reporting, and a fix older than GPS_FIX_MAX_AGE_MS
      // is never re-sent: the server would then call this technician stale and dispatch
      // would pass them over. Halfway there, restart the watch: a new watch makes the
      // browser locate the device afresh (a one-off request would only wait for the
      // running watch, which has nothing new to say). No fix, still nothing is sent.
      const now = Date.now()
      if (now - Math.max(lastFixAt, lastAskAt) >= GPS_FIX_MAX_AGE_MS / 2) {
        lastAskAt = now
        navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = navigator.geolocation.watchPosition(onFix, onFailure, GPS_WATCH_OPTIONS)
      }
      send(session)
    }, GPS_PUMP_MS)

    fetchPresence()
      .then((current) => {
        if (sessionRef.current === session) setPresence(current)
      })
      .catch(() => {})

    // Coming back to the tab (phones throttle background pages): send at once.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || sessionRef.current !== session) return
      schedulerRef.current.nudge()
      send(session)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      teardown()
    }
  }, [active, send, teardown])

  // On a job, keep the screen awake: a phone that sleeps suspends the page, and
  // with it the watch. Its own effect, so taking a job never restarts the GPS.
  useEffect(() => {
    if (!active || !keepAwake || !navigator.wakeLock) return undefined
    let released = false
    const acquire = async () => {
      if (released || (wakeLockRef.current && !wakeLockRef.current.released)) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (released) lock.release().catch(() => {})
        else wakeLockRef.current = lock
      } catch {
        // Unsupported or refused (battery saver). Tracking still works while the screen is on.
      }
    }
    // The OS drops a wake lock whenever the page is hidden; take it back.
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire() }
    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [active, keepAwake])

  /**
   * Signing out or leaving work: stop everything first, then have the server
   * forget the position and withdraw any offer still being decided.
   */
  const stop = useCallback(async () => {
    teardown()
    setActiveJob(null)
    try {
      setPresence(await forgetTechnicianLocation())
    } catch {
      // Signing out anyway: the position goes stale on its own within seconds.
    }
  }, [teardown])

  return {
    permission,
    error,
    warning,
    presence,
    activeJob,
    gps,
    tracking,
    // The backend decides this; it is not inferred from the browser alone.
    ready: Boolean(presence?.ready_for_nearby_jobs),
    stop,
  }
}
