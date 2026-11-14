import { useEffect, useRef, useState } from 'react'

/**
 * Object URLs for private job photos, fetched with the technician's own session.
 *
 * A private photo has no public address: it is fetched through the authenticated
 * content endpoint as a blob and shown from an object URL made in this tab. The
 * session travels in its HttpOnly cookie, never in the image address.
 *
 * Every URL made here is revoked when its photo leaves the list and when the
 * component using the hook goes away, so blobs do not pile up in memory.
 *
 * Returns { [mediaId]: url | 'error' }; a photo still loading is absent.
 */
export function usePrivatePhotos(loadBlob, mediaIds) {
  const [urls, setUrls] = useState({})
  const known = useRef({}) // id -> url | 'error' | null (loading)
  const key = mediaIds.join(',')

  useEffect(() => {
    const wanted = new Set(key ? key.split(',') : [])
    for (const [id, url] of Object.entries(known.current)) {
      if (!wanted.has(id)) {
        if (url && url !== 'error') URL.revokeObjectURL(url)
        delete known.current[id]
      }
    }
    const controller = new AbortController()
    const publish = () => setUrls(Object.fromEntries(Object.entries(known.current).filter(([, url]) => url)))
    for (const id of wanted) {
      if (id in known.current) continue
      known.current[id] = null
      loadBlob(id, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return
          known.current[id] = URL.createObjectURL(blob)
          publish()
        })
        .catch(() => {
          if (controller.signal.aborted) return
          known.current[id] = 'error'
          publish()
        })
    }
    publish()
    return () => {
      controller.abort()
      // Loads cut short here are started again by the next run.
      for (const [id, url] of Object.entries(known.current)) if (url === null) delete known.current[id]
    }
  }, [key, loadBlob])

  useEffect(() => () => {
    for (const url of Object.values(known.current)) if (url && url !== 'error') URL.revokeObjectURL(url)
    known.current = {}
  }, [])

  return urls
}
