import { useEffect, useMemo, useRef, useState } from 'react'
import { createSeenStore, unreadKeys } from '../utils/requestInbox.js'

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * A "new since you last looked" badge over a list the dashboard already loads,
 * using the same per-user seen store as the New Requests badge
 * (utils/requestInbox.js), under its own namespace.
 *
 *   keys    stable keys of what the list holds, from its last SUCCESSFUL load
 *   open    the section showing that list is on screen
 *   loaded  the list's latest load succeeded; a failed load never marks anything
 *
 * Opening the section marks what it shows as seen, once per opening, so the
 * badge clears and stays cleared after a refresh. Something that arrives later
 * (a new key) counts again. Returns the unread count.
 */
export default function useSeenBadge({ userId, namespace, keys, open, loaded }) {
  const store = useMemo(() => createSeenStore(browserStorage(), userId, namespace), [userId, namespace])
  const [seen, setSeen] = useState(() => store.load())
  useEffect(() => setSeen(store.load()), [store])

  const keysRef = useRef(keys)
  keysRef.current = keys
  useEffect(() => {
    if (open && loaded && keysRef.current.length) setSeen(store.markSeen(keysRef.current))
  }, [open, loaded, store])

  return useMemo(() => unreadKeys(keys, seen).length, [keys, seen])
}
