// Keeps one place's weather answer fresh for a header indicator, and recovers on
// its own from a failed fetch.
//
// A failed request (the API restarting, a dropped connection) or an answer
// saying the provider could not be reached is tried again after 15 s, 30 s, 60 s
// and then every 2 minutes, and at once when the browser comes back online or
// the tab is shown again; a healthy answer is refreshed every 10 minutes. The
// last good answer for the same place stays on screen meanwhile, marked as not
// refreshed, for up to KEEP_GOOD_MS. Nothing is ever made up: with no good
// answer there is no weather to show.
import { useCallback, useEffect, useRef, useState } from 'react'
import { cachedWeather } from './weatherCache.js'

export const REFRESH_MS = 10 * 60 * 1000
export const RETRY_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000]
export const KEEP_GOOD_MS = 3 * 60 * 60 * 1000

// When to look again after `failures` failed attempts in a row.
export function nextLookIn(failures) {
  return failures > 0 ? RETRY_MS[Math.min(failures, RETRY_MS.length) - 1] : REFRESH_MS
}

export function isUsable(answer) {
  return Boolean(answer?.status?.available)
}

// An answer that is complete without weather: no place has been chosen yet.
// Asking again soon would not change it.
export function needsPlace(answer) {
  return Boolean(answer?.location_required || answer?.status?.location_required)
}

// What to show after an attempt: the new answer when it is usable; else the last
// good one for this place while it is recent enough; else the new answer (its own
// message says why there is no weather) or nothing.
export function settle(previousGood, answer, now = Date.now()) {
  if (isUsable(answer)) return { shown: answer, good: answer, refreshFailed: false }
  if (needsPlace(answer)) return { shown: answer, good: null, refreshFailed: false }
  const goodAt = Date.parse(previousGood?.status?.last_updated_at || '')
  if (previousGood && Number.isFinite(goodAt) && now - goodAt <= KEEP_GOOD_MS) {
    return { shown: previousGood, good: previousGood, refreshFailed: true }
  }
  return { shown: answer || null, good: null, refreshFailed: Boolean(previousGood) || !answer }
}

/**
 * `key` names the place (null: nothing to fetch yet); `fetcher` returns its
 * answer. `onError(error)` may return true when it dealt with the error itself
 * (a site the account can no longer read).
 */
export function useWeatherFeed(key, fetcher, { onError = null } = {}) {
  const [state, setState] = useState({ answer: null, loading: Boolean(key), refreshFailed: false })
  const good = useRef(null)
  const failures = useRef(0)
  const timer = useRef(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const load = useCallback(async (force = false) => {
    if (!key) return
    clearTimeout(timer.current)
    let answer = null
    try {
      answer = await cachedWeather(key, () => fetcherRef.current(), { force })
    } catch (error) {
      if (onErrorRef.current?.(error)) return
    }
    const result = settle(good.current, answer)
    good.current = result.good
    failures.current = isUsable(answer) || needsPlace(answer) ? 0 : failures.current + 1
    setState({ answer: result.shown, loading: false, refreshFailed: result.refreshFailed })
    timer.current = setTimeout(() => load(true), nextLookIn(failures.current))
  }, [key])

  useEffect(() => {
    good.current = null
    failures.current = 0
    setState({ answer: null, loading: Boolean(key), refreshFailed: false })
    load()
    const again = () => { if (failures.current > 0) load(true) }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const at = Date.parse(good.current?.status?.last_updated_at || '')
      if (failures.current > 0 || !Number.isFinite(at) || Date.now() - at >= REFRESH_MS) load(true)
    }
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer.current)
      window.removeEventListener('online', again)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, load])

  const retry = useCallback(() => {
    setState((value) => ({ ...value, loading: true }))
    load(true)
  }, [load])

  return { ...state, retry }
}
