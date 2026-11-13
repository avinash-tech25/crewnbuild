import { useCallback, useEffect, useRef, useState } from 'react'
import { SUBSCRIPTION_CHANGED_EVENT, fetchMySubscription } from '../subscriptionApi.js'
import { msUntilChange } from './subscriptionFormat.js'

// The builder's subscription as the SERVER reports it. Re-read on mount, when the
// window regains focus, after any purchase (SUBSCRIPTION_CHANGED_EVENT) and at the
// moment the plan in force is due to end, so the badge and locked states never
// outlive an expiry. Nothing is cached for authorization: the backend decides.
const MAX_TIMER_MS = 2 ** 31 - 1

export default function useBuilderSubscription({ enabled = true } = {}) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)
  const latest = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return null
    const call = ++latest.current
    setLoading(true)
    try {
      const next = await fetchMySubscription()
      if (call === latest.current) { setStatus(next); setError(null) }
      return next
    } catch (failure) {
      if (call === latest.current) setError(failure)
      return null
    } finally {
      if (call === latest.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!enabled) return undefined
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener(SUBSCRIPTION_CHANGED_EVENT, onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(SUBSCRIPTION_CHANGED_EVENT, onFocus)
    }
  }, [enabled, refresh])

  useEffect(() => {
    const wait = msUntilChange(status)
    if (wait === null) return undefined
    const timer = window.setTimeout(() => refresh(), Math.min(wait + 1000, MAX_TIMER_MS))
    return () => window.clearTimeout(timer)
  }, [status, refresh])

  return { status, loading, error, refresh }
}
