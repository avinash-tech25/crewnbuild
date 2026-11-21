import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * useSearchParams, but a functional update sees every change made since the last render.
 *
 * React Router hands a functional update the query string of the LAST RENDER, so two writes
 * in one tick (close a product dialog, then switch to the Cart tab) both start from the old
 * address and the second one brings back what the first removed. The query string written
 * last is kept here until the tick ends, and the next write in the same tick builds on it.
 */
let pending = null

export default function useSearchParamsLatest() {
  const [params, setParams] = useSearchParams()
  const setLatest = useCallback(
    (update, options) => {
      setParams((current) => {
        const base = pending !== null ? new URLSearchParams(pending) : current
        const next = typeof update === 'function' ? update(base) : update
        const written = new URLSearchParams(next).toString()
        if (pending === null) queueMicrotask(() => { pending = null })
        pending = written
        return next
      }, options)
    },
    [setParams],
  )
  return [params, setLatest]
}
