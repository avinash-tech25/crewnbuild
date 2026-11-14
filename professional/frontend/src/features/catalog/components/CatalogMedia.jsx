/**
 * Master Catalog product media, as every product view shows it: the canonical
 * images the country's administrator uploaded, and the product video.
 *
 * Read-only by design. Nothing here uploads, replaces or deletes -- that lives
 * only in Admin > Master Catalog. The addresses are the catalog's own
 * "/files/{id}", so a supplier and a buyer see the very same files.
 */
import { useEffect, useState } from 'react'
import { ImageOff, PlayCircle } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'

/** Main image with a row of thumbnails; clicking a thumbnail shows it large. */
export function CatalogGallery({ images = [], alt = '', noImageLabel = 'No image', mainClassName = '', compact = false }) {
  const [active, setActive] = useState(0)
  const [broken, setBroken] = useState({})
  useEffect(() => setActive(0), [images.map((image) => image.image_url).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!images.length) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-slate-400 ${mainClassName}`}>
        <ImageOff className="h-6 w-6" />
        <span className="text-[11px] font-bold">{noImageLabel}</span>
      </div>
    )
  }

  const current = images[Math.min(active, images.length - 1)]
  return (
    <div className="w-full">
      {broken[current.image_url] ? (
        <div className={`flex flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-slate-400 ${mainClassName}`}>
          <ImageOff className="h-6 w-6" />
        </div>
      ) : (
        <img
          src={imageUrl(current.image_url)}
          alt={current.alt_text || alt}
          onError={() => setBroken((state) => ({ ...state, [current.image_url]: true }))}
          className={`rounded-xl bg-white object-contain ${mainClassName}`}
        />
      )}
      {images.length > 1 && (
        <div className={`mt-2 flex flex-wrap gap-1.5 ${compact ? '' : 'justify-center'}`}>
          {images.map((image, index) => (
            <button
              key={image.id ?? image.image_url}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`Image ${index + 1}`}
              className={`overflow-hidden rounded-lg border-2 transition ${
                index === active ? 'border-brand-500' : 'border-transparent opacity-75 hover:opacity-100'
              }`}
            >
              <img src={imageUrl(image.image_url)} alt="" className={`${compact ? 'h-10 w-10' : 'h-14 w-14'} bg-white object-cover`} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The product video, with ordinary controls. Never autoplays; renders nothing without a video. */
export function CatalogVideo({ videoUrl, label = 'Product video', className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [videoUrl])
  if (!videoUrl || failed) return null
  return (
    <div className={className}>
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide text-graphite/40">
        <PlayCircle className="h-3.5 w-3.5" /> {label}
      </p>
      <video
        src={imageUrl(videoUrl)}
        controls
        preload="metadata"
        playsInline
        onError={() => setFailed(true)}
        className="w-full rounded-xl bg-black"
      />
    </div>
  )
}

/**
 * Long text shown short first, with "Show more" / "Show less". Presentation
 * only: the full text is always what was received, never cut in the data.
 */
export function ExpandableText({ text, limit = 180, moreLabel = 'Show more', lessLabel = 'Show less', className = '' }) {
  const [open, setOpen] = useState(false)
  const value = String(text || '').trim()
  if (!value) return null
  const long = value.length > limit
  const shown = !long || open ? value : `${value.slice(0, value.lastIndexOf(' ', limit) > limit * 0.6 ? value.lastIndexOf(' ', limit) : limit).trimEnd()}…`
  return (
    <p className={`whitespace-pre-line ${className}`}>
      {shown}
      {long && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => setOpen((state) => !state)}
            className="font-extrabold text-brand-700 hover:underline"
          >
            {open ? lessLabel : moreLabel}
          </button>
        </>
      )}
    </p>
  )
}

/** "120 Bags", "1 Bag", "12.5 Tonnes" -- the catalog unit's own names, never guessed. */
export function unitQuantity(quantity, unit) {
  const amount = Number(quantity || 0)
  const formatted = amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  if (!unit) return formatted
  const name = amount === 1 ? unit.name : unit.plural_name || unit.name
  return `${formatted} ${name}`.trim()
}

/** How a unit measures, in words: "Sold by Bag", "Sold by weight (Tonne)".
 *  From the unit's family: PACK, COUNT, WEIGHT, LENGTH, AREA, VOLUME or OTHER. */
export function sellingBasis(unit) {
  if (!unit) return ''
  const family = unit.unit_family
  if (family && !['COUNT', 'PACK', 'OTHER'].includes(family)) return `Sold by ${family.toLowerCase()} (${unit.name})`
  return `Sold by ${unit.name}`
}
