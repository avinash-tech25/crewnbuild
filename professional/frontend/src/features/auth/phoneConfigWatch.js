// Which sign-up and sign-in form a deployment uses is the API's decision, so a
// failed request is not an answer: treating it as "WhatsApp is off" put the
// e-mail and password forms in front of visitors whenever the API was restarting
// or unreachable. Keep asking, and let the page move on once it has an answer.
export const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000]

// A proxy can answer 200 with a web page, and another server can answer at all.
export function isPhoneConfig(value) {
  return typeof value?.enabled === 'boolean'
}

export function watchPhoneConfig(read, onChange, timers = globalThis) {
  let stopped = false
  let settled = false
  let reading = false
  let timer = null
  let failures = 0

  const attempt = async () => {
    if (stopped || settled || reading) return
    timers.clearTimeout(timer)
    reading = true
    let config = null
    try {
      config = await read()
    } catch {
      /* no answer: asked again below */
    }
    reading = false
    if (stopped) return
    if (isPhoneConfig(config)) {
      settled = true
      onChange({ config, unreachable: false })
      return
    }
    onChange({ config: null, unreachable: true })
    timer = timers.setTimeout(attempt, RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)])
    failures += 1
  }

  attempt()
  return {
    retry: attempt,
    stop() {
      stopped = true
      timers.clearTimeout(timer)
    },
  }
}
