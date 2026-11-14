import { useEffect, useRef, useState } from 'react'
import { retainLiveEvents, releaseLiveEvents, subscribeLiveEvents } from '../../features/notifications/liveEvents.js'

// Hints that arrive close together (a quotation, then a counter-offer, then an
// assignment) become ONE reload, this long after the last of them.
const DEBOUNCE_MS = 300

/** Keeps the shared live-events socket open while the calling component is mounted. */
export function useLiveEventsConnection() {
  useEffect(() => {
    retainLiveEvents()
    return () => releaseLiveEvents()
  }, [])
}

/**
 * Runs `reload` -- an existing loader -- when a live "requests_changed" hint
 * arrives, debounced. Always calls the latest `reload`, so a loader recreated
 * on every render needs no memoising. Nothing happens when the socket is down.
 */
export function useLiveRefresh(reload) {
  const latest = useRef(reload)
  latest.current = reload
  useEffect(() => {
    let timer = null
    const unsubscribe = subscribeLiveEvents(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { latest.current?.() }, DEBOUNCE_MS)
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}

/**
 * A number that goes up (debounced) on each live hint. Add it to an existing
 * effect's dependencies to re-run that effect's own fetch -- for effects that
 * load inline and have no reload function of their own.
 */
export function useLiveVersion() {
  const [version, setVersion] = useState(0)
  useLiveRefresh(() => setVersion((value) => value + 1))
  return version
}

/**
 * A latest-response-wins guard for a loader. `const guard = useLatestOnly()`;
 * at the start of a load `const isLatest = guard()`; before applying a result
 * `if (isLatest()) setState(result)`. An older load that finishes after a newer
 * one then cannot overwrite the newer data.
 */
export function useLatestOnly() {
  const generation = useRef(0)
  return () => {
    generation.current += 1
    const mine = generation.current
    return () => mine === generation.current
  }
}
