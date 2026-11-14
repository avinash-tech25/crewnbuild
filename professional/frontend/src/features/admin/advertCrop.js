/**
 * The shape each slot actually is, and how to cut a picture to it.
 *
 * A slot is much wider than it is tall. A picture that is not is either
 * letterboxed with empty bands or has its middle cropped by the browser in a
 * place nobody chose — and the administrator who uploaded it cannot see which
 * until it is live. Choosing the crop here means what is stored is what appears.
 *
 * The cutting is done in the browser, before the upload, for the same reason the
 * resizing is: re-encoding an image on the server needs an imaging library, and
 * doing it here means the large original never crosses the network at all.
 */

// Wide and short at the top of a page; a little taller above the footer, where
// there is room for it and the eye is not trying to get past it.
export const SLOT_SHAPES = {
  top: { ratio: 4, label: 'Wide banner' },
  footer: { ratio: 3, label: 'Above the footer' },
}

// The width every advert is written out at. Enough for a full-width slot on a
// large screen at 2x, and no more.
const OUTPUT_WIDTH = 1600
const QUALITY = 0.82

export function shapeFor(position) {
  return SLOT_SHAPES[position] || SLOT_SHAPES.footer
}

/**
 * Cut `file` to `ratio`, taking the region the viewer chose.
 *
 * `region` is in the picture's own pixels: {x, y, width, height}. Given none,
 * the middle of the picture is taken, which is the sane default for a photograph
 * and what a browser would have done anyway — only now it is recorded rather
 * than guessed at render time.
 */
export async function cropAdvertImage(file, ratio, region = null) {
  if (!file || typeof createImageBitmap !== 'function') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  try {
    const area = region || centredRegion(bitmap.width, bitmap.height, ratio)
    const width = Math.min(OUTPUT_WIDTH, Math.round(area.width))
    const height = Math.max(1, Math.round(width / ratio))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas
      .getContext('2d')
      .drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, width, height)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
    if (!blob) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: blob.type })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}

/** The largest region of this shape that fits, centred. */
export function centredRegion(imageWidth, imageHeight, ratio) {
  let width = imageWidth
  let height = width / ratio
  if (height > imageHeight) {
    height = imageHeight
    width = height * ratio
  }
  return {
    x: Math.round((imageWidth - width) / 2),
    y: Math.round((imageHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}
