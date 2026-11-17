/**
 * Remembers how far each page in this tab's history was scrolled, so a "Back" button can
 * return the visitor to the same place: the landing page's footer, not its top.
 *
 * The browser cannot do this by itself here: the next page loads lazily, and while its
 * loading indicator shows, the document is too short to keep the old position, so the
 * position is lost before the new page appears. `useScrollMemory` (mounted once, inside the
 * router) records the position per history entry (location.key) as the visitor scrolls;
 * `useBackNavigation` goes back one entry and restores that entry's position once the page
 * is tall enough (or after a short wait).
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const positions = new Map()
let pendingRestore = false

/** Mount once inside the router. */
export function useScrollMemory() {
  const { key } = useLocation()
  const current = useRef(key)

  useEffect(() => {
    current.current = key
    if (!pendingRestore) return undefined
    pendingRestore = false
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
  }, [key])

  useEffect(() => {
    const record = () => positions.set(current.current, window.scrollY)
    window.addEventListener('scroll', record, { passive: true })
    return () => window.removeEventListener('scroll', record)
  }, [])
}

/**
 * Back to the page the visitor came from on this site, at its scroll position; the landing
 * page when there is none (opened directly, or from another site).
 *
 * In the browser the router numbers its history entries (history.state.idx): a page entered
 * from this site has idx > 0, and replacing the address (a #section switch) keeps it. Where
 * that number is missing (an in-memory router), whether the page was entered by a link is
 * decided when it first renders: the router's first entry has the key 'default'.
 */
export function useBackNavigation() {
  const navigate = useNavigate()
  const { key } = useLocation()
  const [enteredFromSite] = useState(() => key !== 'default')

  return () => {
    const index = window.history.state?.idx
    const hasPrevious = typeof index === 'number' ? index > 0 : enteredFromSite
    if (!hasPrevious) {
      navigate('/')
      return
    }
    pendingRestore = true
    navigate(-1)
  }
}
