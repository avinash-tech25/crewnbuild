let notificationAudioContext

const notificationSoundPatterns = {
  request: [
    { frequency: 660, duration: 0.08 },
    { frequency: 880, duration: 0.12 },
  ],
  contractor: [
    { frequency: 392, duration: 0.1 },
    { frequency: 523, duration: 0.12 },
  ],
  supplier: [
    { frequency: 784, duration: 0.08 },
    { frequency: 659, duration: 0.13 },
  ],
  message: [
    { frequency: 523, duration: 0.07 },
    { frequency: 659, duration: 0.07 },
    { frequency: 784, duration: 0.1 },
  ],
  project: [
    { frequency: 440, duration: 0.1 },
    { frequency: 554, duration: 0.14 },
  ],
  general: [
    { frequency: 600, duration: 0.12 },
  ],
}

function getNotificationAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return null
  if (!notificationAudioContext) {
    notificationAudioContext = new AudioContextClass()
  }
  return notificationAudioContext
}

export async function unlockNotificationAudio() {
  const audioContext = getNotificationAudioContext()
  if (audioContext?.state === 'suspended') {
    await audioContext.resume()
  }
}

export async function playNotificationSound(moduleName = 'general') {
  const audioContext = getNotificationAudioContext()
  if (!audioContext) return
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }

  const pattern = notificationSoundPatterns[moduleName] || notificationSoundPatterns.general
  let startTime = audioContext.currentTime

  pattern.forEach((tone) => {
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(tone.frequency, startTime)
    gainNode.gain.setValueAtTime(0.0001, startTime)
    gainNode.gain.exponentialRampToValueAtTime(0.16, startTime + 0.015)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + tone.duration)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + tone.duration + 0.02)
    startTime += tone.duration + 0.035
  })
}

// ------------------------------------------------------------- shared gate
//
// The bell and the "N New Requests" popup both react to the same arrival. The
// gate lets the first of them sound and suppresses the other for a moment, so
// one request never plays two chimes. Reloads, reconnects and re-renders go
// through the same gate.
const GATE_MS = 2500
let lastGatedSoundAt = 0

/** Plays `moduleName` unless a gated sound played in the last 2.5s. Returns whether it played. */
export function playGatedNotificationSound(moduleName = 'general', now = Date.now()) {
  if (now - lastGatedSoundAt < GATE_MS) return false
  lastGatedSoundAt = now
  playNotificationSound(moduleName).catch(() => {})
  return true
}

// ----------------------------------------------------------- sound status
//
// Browsers keep audio off until the person taps or types on the page. The
// status says which state we are in, so a dashboard can offer "Enable sound"
// instead of failing silently: 'enabled', 'blocked', or 'unavailable'.
const statusListeners = new Set()

export function notificationSoundStatus() {
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return 'unavailable'
  return notificationAudioContext?.state === 'running' ? 'enabled' : 'blocked'
}

function announceSoundStatus() {
  const status = notificationSoundStatus()
  statusListeners.forEach((listener) => listener(status))
}

export function subscribeNotificationSoundStatus(listener) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

/** Call from a click/tap. Plays nothing; resolves to the resulting status. */
export async function enableNotificationSound() {
  try {
    const audioContext = getNotificationAudioContext()
    if (audioContext && !audioContext.onstatechange) audioContext.onstatechange = announceSoundStatus
    if (audioContext?.state === 'suspended') await audioContext.resume()
  } catch {
    /* still blocked; the next tap tries again */
  }
  announceSoundStatus()
  return notificationSoundStatus()
}

// The first tap or key anywhere switches sound on, as the bell's click already
// did; it is the browser's own rule that a gesture is needed first.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const unlockOnGesture = () => {
    enableNotificationSound()
    window.removeEventListener('pointerdown', unlockOnGesture, true)
    window.removeEventListener('keydown', unlockOnGesture, true)
  }
  window.addEventListener('pointerdown', unlockOnGesture, true)
  window.addEventListener('keydown', unlockOnGesture, true)
}
