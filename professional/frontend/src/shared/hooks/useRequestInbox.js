import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createArrivalTracker, createSeenStore, unreadKeys } from '../utils/requestInbox.js'
import {
  enableNotificationSound,
  notificationSoundStatus,
  playGatedNotificationSound,
  subscribeNotificationSoundStatus,
} from '../utils/notificationSounds.js'

// How long a burst of arrivals keeps adding to the same popup.
const TOAST_MS = 9000

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * The "N New Requests" badge, popup and sound for one dashboard.
 *
 *   items   the requests the dashboard already loaded that are incoming to this
 *           user and still pending: [{ key, section }]. `key` is the stable id
 *           ("request:42", "labor:7"...); `section` names the Requests area that
 *           shows it, so a badge can count per area.
 *   loaded  true once the request data has loaded successfully at least once.
 *
 * Nothing here fetches, polls or opens a socket: the dashboard's existing loads
 * (and their existing live refresh) feed `items`.
 */
export default function useRequestInbox({ userId, items = [], loaded = false }) {
  const store = useMemo(() => createSeenStore(browserStorage(), userId), [userId])
  const [seen, setSeen] = useState(() => store.load())
  useEffect(() => setSeen(store.load()), [store])

  const keys = useMemo(() => items.map((item) => item.key), [items])
  const unread = useMemo(() => unreadKeys(keys, seen), [keys, seen])
  const unreadSet = useMemo(() => new Set(unread), [unread])

  const unreadIn = useCallback(
    (section) => items.filter((item) => item.section === section && unreadSet.has(item.key)).length,
    [items, unreadSet],
  )

  const markSeen = useCallback((keysToMark) => {
    if (!keysToMark?.length) return
    setSeen(store.markSeen(keysToMark))
  }, [store])

  // Arrivals: compared by key against what this session has already met, after
  // the dashboard's own successful load. Bookkeeping lives in the effect, so a
  // re-render can never announce the same request twice.
  const trackerRef = useRef(null)
  if (!trackerRef.current) trackerRef.current = createArrivalTracker()
  const [toast, setToast] = useState({ count: 0, open: false })
  const toastTimerRef = useRef(null)
  const keySignature = keys.join('|')
  useEffect(() => {
    if (!loaded) return
    const arrived = trackerRef.current.update(keys).filter((key) => !seen.has(key))
    if (!arrived.length) return
    playGatedNotificationSound('request')
    setToast((current) => ({ count: (current.open ? current.count : 0) + arrived.length, open: true }))
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast({ count: 0, open: false }), TOAST_MS)
    // `keys` is represented by its signature; `seen` is read as of this arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, loaded])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  const dismissToast = useCallback(() => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ count: 0, open: false })
  }, [])

  const [soundStatus, setSoundStatus] = useState(notificationSoundStatus)
  useEffect(() => {
    setSoundStatus(notificationSoundStatus())
    return subscribeNotificationSoundStatus(setSoundStatus)
  }, [])
  const enableSound = useCallback(async () => setSoundStatus(await enableNotificationSound()), [])

  return { unreadCount: unread.length, unreadKeys: unread, unreadIn, markSeen, toast, dismissToast, soundStatus, enableSound }
}

/**
 * Marks the requests a Requests section is showing as seen -- once each time the
 * section is opened, and only after its list has loaded successfully. A request
 * that arrives while the section stays open is NOT marked: it shows as new and
 * raises the badge again, and opening the section again clears it.
 *
 *   open           the section is the one on screen
 *   loaded         its list loaded successfully (a failed load never clears)
 *   displayedKeys  the keys of the requests the section actually lists
 */
export function useMarkSeenWhenOpened(inbox, { open, loaded, displayedKeys }) {
  const keysRef = useRef(displayedKeys)
  keysRef.current = displayedKeys
  const markSeen = inbox.markSeen
  useEffect(() => {
    if (open && loaded) markSeen(keysRef.current)
  }, [open, loaded, markSeen])
}
