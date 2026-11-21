/**
 * Scroll position across navigation, for the whole app (mounted once, inside the router):
 *
 *   - a new page (another path, by a link or a redirect) opens at the top, unless its
 *     address names a section (#id) the page scrolls to itself;
 *   - Back and Forward return to where that page was left;
 *   - a change of query or hash on the same page (a tab, a filter, a legal section) keeps
 *     the scroll position.
 *
 * The browser cannot restore positions by itself here: the next page loads lazily, and while
 * its loading indicator shows, the document is too short to keep the old position. So the
 * position is recorded per history entry (location.key) as the visitor scrolls, and restored
 * once the returning page is tall enough (or after a short wait).
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const positions = new Map()

/** Mount once inside the router. */
export function useScrollMemory() {
  const { key, pathname, hash } = useLocation()
  const navigationType = useNavigationType()
  const current = useRef(key)
  const lastPath = useRef(pathname)

  useEffect(() => {
    current.current = key
    const newPage = lastPath.current !== pathname
    lastPath.current = pathname
    const returning = navigationType === 'POP'
    if (!returning) {
      if (newPage && !hash) window.scrollTo(0, 0)
      return undefined
    }
    const top = positions.get(key)
    if (!top) return undefined
    // Wait until the returning page is drawn and tall enough to scroll that far.
    let frames = 0
    let handle = 0
    const tryRestore = () => {
      const tallEnough = document.documentElement.scrollHeight >= top + window.innerHeight
      if (tallEnough || frames >= 90) {
        window.scrollTo(0, top)
        return
      }
      frames += 1
      handle = window.requestAnimationFrame(tryRestore)
    }
    handle = window.requestAnimationFrame(tryRestore)
    return () => window.cancelAnimationFrame(handle)
    // Once per history entry: `key` changes with every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const record = () => positions.set(current.current, window.scrollY)
    window.addEventListener('scroll', record, { passive: true })
    return () => window.removeEventListener('scroll', record)
  }, [])
}
