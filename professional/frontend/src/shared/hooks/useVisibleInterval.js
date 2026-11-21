import { useEffect, useRef } from 'react'

/**
 * A poll that rests while the tab is hidden: `callback` runs every `delay` ms only while
 * the page is visible, and once more as soon as a hidden tab becomes visible again, so the
 * screen catches up at once instead of on the next tick. Nothing runs on mount; call the
 * loader yourself for the first load. The latest `callback` is used on every tick.
 *
 *   useVisibleInterval(refreshCounts, 10000)
 *   useVisibleInterval(refreshThread, 5000, { enabled: Boolean(threadId) })
 *
 * (Belongs in src/shared/hooks; kept here while that folder is out of this change's scope.)
 */
export const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export default function useVisibleInterval(callback, delay, { enabled = true } = {}) {
  const latest = useRef(callback)
  useEffect(() => { latest.current = callback })

  useEffect(() => {
    if (!enabled || !delay) return undefined
    const tick = () => { if (!pageHidden()) latest.current() }
    const timer = window.setInterval(tick, delay)
    const onVisibility = () => { if (document.visibilityState === 'visible') latest.current() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [delay, enabled])
}
