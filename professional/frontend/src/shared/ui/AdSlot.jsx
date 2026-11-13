/**
 * An advert, where a screen has room for one.
 *
 * Drop `<AdSlot placement="home" />` onto a page and it shows whatever the admin
 * console has running there, or nothing at all. Nothing is the common case and
 * has to look like nothing: no empty box, no "advertisement" label with a gap
 * under it, no layout that shifts when one arrives.
 *
 * Views and clicks are reported from here rather than counted when the list is
 * served. An advert fetched but never scrolled to was not seen, and a count that
 * says otherwise is worse than no count — particularly if somebody is being
 * charged against it.
 */

import { useEffect, useRef, useState } from 'react'
import { imageUrl } from '../api/apiClient.js'
import { fetchPlacementAds, recordAdEvent } from '../../features/public-site/adsApi.js'
import { useLanguage } from '../../i18n/LanguageContext.jsx'

// How much of the page an advert is given. Centred when it is not the full
// width, so a narrow advert sits in the column rather than clinging to its left
// edge — which reads as a mistake rather than a choice.
const WIDTH_CLASS = {
  FULL: 'w-full',
  HALF: 'w-full max-w-[520px] mx-auto',
  SMALL: 'w-full max-w-[320px] mx-auto',
}

/** A draft advert the admin console is asking this page to show.
 *
 * The console opens the real page in a frame beside the form so an administrator
 * can see the advert where it will actually be, rather than in a drawn outline.
 * The draft is handed over through sessionStorage, which the frame shares with
 * the console because they are the same origin and the same tab — no endpoint,
 * nothing stored, and nothing that outlives the tab.
 *
 * Only ever consulted when the address says so, so an ordinary visit reads
 * nothing. Somebody who set it in their own browser would be showing themselves
 * a picture of their own choosing, which is not a thing worth defending against.
 */
function draftFromConsole(placement, position) {
  try {
    if (typeof window === 'undefined') return null
    if (!new URLSearchParams(window.location.search).has('advertPreview')) return null
    const draft = JSON.parse(sessionStorage.getItem('crewnbuild_advert_preview') || 'null')
    if (!draft || draft.placement !== placement || (draft.position || 'footer') !== position) return null
    return {
      id: 0,
      title: draft.title || '',
      image_url: draft.image_url,
      link_url: null,
      display_width: draft.display_width || 'FULL',
    }
  } catch {
    return null
  }
}

export default function AdSlot({ placement, country, position = 'footer', className = '' }) {
  const { t, td } = useLanguage()
  const draft = draftFromConsole(placement, position)
  const [adverts, setAdverts] = useState([])
  const containerRef = useRef(null)
  const seen = useRef(new Set())

  useEffect(() => {
    // A preview shows the one advert being drafted, so asking the server what is
    // running here would only put a second, unrelated advert on the screen.
    if (draft) return undefined

    let cancelled = false

    const load = () => {
      fetchPlacementAds(placement, country, position)
        .then((found) => {
          if (!cancelled) setAdverts(found || [])
        })
        // An advert that cannot load is not an error the visitor should meet.
        // The page carries on with nothing where the advert would have been.
        .catch(() => {})
    }

    load()

    // Asked again when the tab is looked at again.
    //
    // Adverts are changed in the admin console, in another tab, while this one
    // sits open — so without this an administrator activates an advert, comes
    // back, and sees the screen exactly as they left it, with no way to tell
    // whether the change saved. Coming back to a tab is the moment to re-ask,
    // and it costs nothing while nobody is looking, which polling would not.
    const refresh = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [placement, country, position, Boolean(draft)])

  // A view is recorded when the advert actually reaches the screen, and once per
  // advert per page — scrolling past it twice is not two views.
  useEffect(() => {
    // Nothing a preview does is a real impression. Counting it would charge an
    // advertiser for the administrator looking at their own advert.
    if (draft) return undefined
    if (!adverts.length || !containerRef.current) return undefined
    if (typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          // Advert ids are UUIDs (R7; they were integers, read with Number()).
          const id = entry.target.dataset.advertId
          if (!id || seen.current.has(id)) return
          seen.current.add(id)
          recordAdEvent(id, placement, 'VIEW').catch(() => {})
        })
      },
      { threshold: 0.5 },
    )

    containerRef.current
      .querySelectorAll('[data-advert-id]')
      .forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [adverts, placement])

  const recordClick = (id) => {
    if (draft) return
    recordAdEvent(id, placement, 'CLICK').catch(() => {})
  }

  const showing = draft ? [draft] : adverts
  if (!showing.length) return null

  return (
    <div ref={containerRef} className={`grid gap-3 ${className}`}>
      {showing.map((advert) => {
        const image = (
          <img
            src={imageUrl(advert.image_url)}
            /* The advertiser's own wording. It is the alt text, so it is what
               a screen reader announces in place of the picture. */
            alt={td(advert.title)}
            loading="lazy"
            className="w-full rounded-2xl border border-oc-line object-cover"
          />
        )
        return (
          <div
            key={advert.id}
            data-advert-id={advert.id}
            className={`relative ${WIDTH_CLASS[advert.display_width] || WIDTH_CLASS.FULL}`}
          >
            {/* Named, quietly, because a picture that is an advert should say so
                rather than be mistaken for the site's own content. */}
            <span className="absolute right-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {t('ui.shared.ad')}
            </span>
            {advert.link_url ? (
              <a
                href={advert.link_url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={() => recordClick(advert.id)}
                className="block"
              >
                {image}
              </a>
            ) : (
              image
            )}
          </div>
        )
      })}
    </div>
  )
}
