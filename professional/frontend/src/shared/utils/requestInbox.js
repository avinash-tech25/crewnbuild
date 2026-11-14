/**
 * "N New Requests": which incoming requests the signed-in user has not yet seen.
 * No imports and no browser objects: unit-tested under Node.
 *
 * A request is identified by a stable key built from the real record -- its
 * source and its id, e.g. "request:42", "labor:7", "purchase:ab12..." -- never
 * by a count. Each dashboard passes only the requests it actually shows as
 * incoming and still pending (the sender's own requests are never passed), so
 * the badge can only ever count real, actionable requests addressed to them.
 *
 * Three pieces:
 *   unreadKeys        the pending incoming requests not yet marked seen; the badge
 *   createArrivalTracker  which of them appeared during this session, each once,
 *                     however often it is reloaded or pushed again; the popup
 *                     and the sound
 *   createSeenStore   the seen set, kept in the browser per user. There is no
 *                     per-request read flag in the database, and none is added.
 */

/** i18n keys for the popup title, singular and plural; both take {count}. */
export const NEW_REQUESTS_KEY_ONE = 'ui.requestInbox.newRequestsReceivedOne'
export const NEW_REQUESTS_KEY_MANY = 'ui.requestInbox.newRequestsReceivedMany'

/**
 * The popup title for `count` requests: { key, count } for t(key, { count }).
 * Pass `t` (from useLanguage) to get the translated string directly; without
 * it the English text is returned ("1 New Request Received", "2 New Requests
 * Received"), which keeps this module usable and testable outside React.
 */
export function newRequestsLabel(count, t = null) {
  const value = Math.max(0, Math.floor(Number(count) || 0))
  const key = value === 1 ? NEW_REQUESTS_KEY_ONE : NEW_REQUESTS_KEY_MANY
  if (typeof t === 'function') return t(key, { count: value })
  return `${value} New Request${value === 1 ? '' : 's'} Received`
}

/** Keys in `currentKeys` not present in `seen`, de-duplicated, order kept. */
export function unreadKeys(currentKeys = [], seen = new Set()) {
  const out = []
  const included = new Set()
  for (const key of currentKeys) {
    if (!key || seen.has(key) || included.has(key)) continue
    included.add(key)
    out.push(key)
  }
  return out
}

/**
 * Arrivals during this session. The first successful load only records what is
 * already there (an old request is shown in the badge but is not an arrival, so
 * it never plays a sound); after that, every key not met before is returned
 * exactly once. A key that leaves the list and comes back (a reconnect, a
 * reload) is not an arrival again.
 */
export function createArrivalTracker() {
  let known = null
  return {
    update(currentKeys = []) {
      const keys = currentKeys.filter(Boolean)
      if (known === null) {
        known = new Set(keys)
        return []
      }
      const arrived = []
      for (const key of keys) {
        if (known.has(key)) continue
        known.add(key)
        arrived.push(key)
      }
      return arrived
    },
    get initialized() {
      return known !== null
    },
  }
}

const SEEN_LIMIT = 1000

/**
 * The seen set for one user in `storage` (localStorage in the app, a stand-in
 * in tests). Unreadable or unavailable storage simply means nothing is
 * remembered: every pending request counts as new again, never the reverse.
 * `namespace` keeps another seen set (the Site Engineer's viewed projects) apart
 * from the requests one; left out, it is the requests set, as before.
 */
export function createSeenStore(storage, userId, namespace = 'crewnbuild_seen_requests') {
  const storageKey = `${namespace}:${userId || 'anonymous'}`
  const load = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(storageKey) || '[]')
      return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [])
    } catch {
      return new Set()
    }
  }
  return {
    load,
    /** Adds `keys` to the stored set and returns the new set. */
    markSeen(keys = []) {
      const seen = load()
      let changed = false
      for (const key of keys) {
        if (!key || seen.has(key)) continue
        seen.add(key)
        changed = true
      }
      if (changed) {
        // Oldest first, so the newest keys survive the cap.
        const list = [...seen].slice(-SEEN_LIMIT)
        try {
          storage?.setItem(storageKey, JSON.stringify(list))
        } catch {
          /* storage full or blocked: the badge just stays until next time */
        }
        return new Set(list)
      }
      return seen
    },
  }
}

// ------------------------------------------------- incoming request builders
//
// One builder per source, each returning [{ key, section }] for the requests
// that are addressed TO the signed-in user and still waiting on them. The
// user's own outgoing requests and anything already answered never qualify.

/** /project-requests/incoming rows: only those this user received and has not answered. */
export function projectRequestItems(rows = [], sectionFor = () => 'requests', types = null) {
  return rows
    .filter((row) => row && row.is_receiver && !row.is_sender && String(row.status || '').toLowerCase() === 'pending')
    .filter((row) => !types || types.includes(row.request_type))
    .map((row) => ({ key: `request:${row.id}`, section: sectionFor(row) }))
}

/** /supplier/material-requests rows, one purchase per request_code, while PENDING. */
export function purchaseRequestItems(rows = [], section = 'purchase') {
  const codes = new Set()
  for (const row of rows) {
    if (row && String(row.status || '').toUpperCase() === 'PENDING') codes.add(row.request_code || `row-${row.id}`)
  }
  return [...codes].map((code) => ({ key: `purchase:${code}`, section }))
}

/** Labor / equipment request rows for the supplier, while PENDING. */
export function supplierJobRequestItems(rows = [], source, section = source) {
  return rows
    .filter((row) => row && String(row.status || '').toUpperCase() === 'PENDING')
    .map((row) => ({ key: `${source}:${row.id}`, section }))
}

/** Builder-to-engineer team requests the engineer received, while PENDING. */
export function teamInviteItems(rows = [], section = 'joinTeam') {
  return rows
    .filter((row) => row && String(row.status || 'PENDING').toUpperCase() === 'PENDING')
    .map((row) => ({ key: `team:${row.relationship_id}`, section }))
}
