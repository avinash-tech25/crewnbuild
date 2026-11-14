/**
 * Catalog image and label primitives shared by Admin > Master Catalog and the
 * catalog product detail view: a status chip, a stored image that admits a
 * failed load, and the same image with its empty margin trimmed.
 *
 * Presentation only. It fetches nothing and carries no actions of its own.
 */
import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { imageUrl } from '../../../shared/api/apiClient.js'

export function Chip({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-ocbrand-50 text-ocbrand-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** A stored image as the browser will load it, honest about a failure rather
 *  than showing a broken icon. */
export function StoredImage({ src, alt, className }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-red-50 text-red-400 ${className}`}>
        <ImageOff className="h-5 w-5" />
        <span className="px-2 text-center text-[10px] font-bold">Image could not be loaded</span>
      </div>
    )
  }
  return <img src={imageUrl(src)} alt={alt} onError={() => setFailed(true)} className={className} />
}

// Trimmed versions already worked out, by image URL, so a tile that re-renders
// or re-mounts does not measure the same picture again.
const fittedCache = new Map()

/**
 * The picture cropped to what is actually in it -- the empty or transparent
 * margin around the subject removed -- as a PNG data URL, or null when there
 * is no margin worth trimming. The background is the transparent area when
 * the corners are see-through, else the colour of the corners. Measured on a
 * small copy for speed, then cut from the full-size image.
 */
function trimToContent(image) {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (!width || !height) return null
  const scale = Math.min(1, 200 / Math.max(width, height))
  const sampleWidth = Math.max(1, Math.round(width * scale))
  const sampleHeight = Math.max(1, Math.round(height * scale))
  const sample = document.createElement('canvas')
  sample.width = sampleWidth
  sample.height = sampleHeight
  const context = sample.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight)
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight)
  const offset = (x, y) => (y * sampleWidth + x) * 4
  const corners = [offset(0, 0), offset(sampleWidth - 1, 0), offset(0, sampleHeight - 1), offset(sampleWidth - 1, sampleHeight - 1)]
  const transparent = corners.some((index) => data[index + 3] < 250)
  const background = transparent
    ? null
    : [0, 1, 2].map((channel) => corners.reduce((sum, index) => sum + data[index + channel], 0) / corners.length)
  let minX = sampleWidth
  let minY = sampleHeight
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = offset(x, y)
      const visible = data[index + 3] > 16
      const content = transparent
        ? visible
        : visible && background.some((value, channel) => Math.abs(data[index + channel] - value) > 24)
      if (content) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const left = Math.max(0, Math.floor(minX / scale))
  const top = Math.max(0, Math.floor(minY / scale))
  const right = Math.min(width, Math.ceil((maxX + 1) / scale))
  const bottom = Math.min(height, Math.ceil((maxY + 1) / scale))
  // A photograph that fills its frame has nothing to trim.
  if (right - left >= width * 0.97 && bottom - top >= height * 0.97) return null
  const output = document.createElement('canvas')
  output.width = right - left
  output.height = bottom - top
  output.getContext('2d').drawImage(image, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top)
  return output.toDataURL('image/png')
}

/**
 * StoredImage with the empty margin around the subject trimmed off first, so
 * pictures uploaded with different amounts of space around them (one cement
 * bag tightly cropped, another with wide margins) come out the same size in
 * equal tiles. Pass object-contain plus any padding in className. When the
 * picture cannot be measured -- not readable cross-origin, or it fails -- the
 * plain picture is shown exactly as StoredImage would show it.
 */
export function FittedImage({ src, alt, className }) {
  const url = imageUrl(src)
  const [shown, setShown] = useState(() => fittedCache.get(url) || null)
  useEffect(() => {
    if (!url) return undefined
    if (fittedCache.has(url)) {
      setShown(fittedCache.get(url))
      return undefined
    }
    setShown(null)
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      let trimmed
      try {
        trimmed = trimToContent(image)
      } catch {
        trimmed = null
      }
      fittedCache.set(url, trimmed || url)
      if (!cancelled) setShown(trimmed || url)
    }
    image.onerror = () => { if (!cancelled) setShown(url) }
    image.src = url
    return () => { cancelled = true }
  }, [url])
  if (!shown) return <div aria-hidden="true" className={className} />
  if (shown === url) return <StoredImage src={src} alt={alt} className={className} />
  return <img src={shown} alt={alt} className={className} />
}
