/**
 * The short chime a technician hears when a new job request arrives.
 *
 * Browsers will not let a page make a sound until the person has interacted
 * with it, and that rule is not something to work around: it is what stops a
 * background tab from making noise. So the audio is armed by a real interaction
 * -- the tap that opened the dashboard, or the first tap anywhere on it -- and
 * before that a request arrives silently rather than throwing.
 *
 * The tone is synthesised rather than loaded from a file: two short notes, no
 * asset to ship, and nothing to fail to download on a weak connection.
 */

let context = null
let armed = false

// The gap between repeats while a request is waiting. The chime itself runs a
// shade under 0.3s, so this rings a little over once a second: unmistakably an
// alert that is still going, rather than a solid tone nobody could sit through
// for a whole minute.
const ALERT_REPEAT_MS = 1400
let alertTimer = null

function AudioContextClass() {
  return typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext
}

/** Called from a real user interaction. Safe to call repeatedly. */
export function armNotificationSound() {
  const Constructor = AudioContextClass()
  if (!Constructor) return false
  try {
    if (!context) context = new Constructor()
    watch(context)
    // Created suspended when the page has not been interacted with yet.
    if (context.state === 'suspended') void context.resume().then(notifyStatus, notifyStatus)
    armed = true
    notifyStatus()
    return true
  } catch {
    // No audio on this device, or it is blocked. Job requests still arrive.
    return false
  }
}

export function notificationSoundReady() {
  return armed && context !== null && context.state === 'running'
}

// ------------------------------------------------------------- sound status
//
// What the dashboard shows: 'enabled' (the browser is letting the chime play),
// 'blocked' (it needs a tap first), or 'unavailable' (no Web Audio here, or the
// browser refused it outright).
const listeners = new Set()
let unavailable = false

export function soundStatus() {
  if (unavailable || !AudioContextClass()) return 'unavailable'
  return notificationSoundReady() ? 'enabled' : 'blocked'
}

function notifyStatus() {
  const status = soundStatus()
  listeners.forEach((listener) => listener(status))
}

/** Calls `listener(status)` whenever the status changes. Returns an unsubscribe. */
export function subscribeSoundStatus(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function watch(audioContext) {
  // A browser can suspend the context again (another tab took audio, the
  // device slept); the control then shows "Enable sound" instead of lying.
  if (audioContext && !audioContext.onstatechange) audioContext.onstatechange = notifyStatus
}

/**
 * The Enable sound button. Must be called from the click/tap itself: that is the
 * one moment the browser lets a page start audio. Plays nothing; it only lets a
 * later request be heard. Resolves to the resulting status.
 */
export async function enableNotificationSound() {
  const Constructor = AudioContextClass()
  if (!Constructor) {
    notifyStatus()
    return 'unavailable'
  }
  try {
    if (!context) context = new Constructor()
    watch(context)
    armed = true
    if (context.state === 'suspended') await context.resume()
  } catch {
    // resume() refused: still blocked, try again on the next tap. A constructor
    // that throws means this browser will not give the page audio at all.
    if (!context) unavailable = true
  }
  notifyStatus()
  return soundStatus()
}

/** Test-only: forget all module state between cases. */
export function __resetNotificationSoundForTests() {
  stopNewJobAlert()
  context = null
  armed = false
  unavailable = false
  listeners.clear()
}

/**
 * One short two-note chime. Never loops, and does nothing at all when the
 * browser has not allowed sound yet.
 */
export function playNewJobSound() {
  if (!armed || !context) return false
  try {
    if (context.state === 'suspended') void context.resume()
    const now = context.currentTime
    // Two rising notes, 120ms apart: recognisable without being an alarm.
    for (const [index, frequency] of [880, 1320].entries()) {
      const startAt = now + index * 0.12
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, startAt)
      // A quick fade in and out; a raw square edge clicks.
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.18)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Ring until told to stop, for a request that is waiting on an answer.
 *
 * Safe to call on every render, on a reconnection, or on a second request
 * arriving while the first is still up: one timer exists at a time, and a call
 * made while it is already running does nothing. That is what stops a poll or a
 * replayed socket frame from stacking alerts on top of each other.
 *
 * It deliberately does NOT check whether audio is armed yet. `playNewJobSound`
 * already no-ops while the browser is withholding permission, so starting the
 * timer anyway means the alert becomes audible the moment the technician
 * touches the page, rather than staying silent for a request that is still
 * waiting.
 */
export function startNewJobAlert() {
  if (alertTimer !== null) return
  playNewJobSound()
  alertTimer = window.setInterval(playNewJobSound, ALERT_REPEAT_MS)
}

/** Silence immediately. Safe to call when nothing is ringing. */
export function stopNewJobAlert() {
  if (alertTimer === null) return
  window.clearInterval(alertTimer)
  alertTimer = null
}
