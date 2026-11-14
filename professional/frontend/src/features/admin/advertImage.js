/**
 * Shrink an advert's picture before it is uploaded.
 *
 * The pictures administrators actually have to hand are screenshots and
 * generated artwork — a 2 MB PNG is normal, and one of those on the landing
 * page is a second of waiting for every visitor who has not been before. The
 * banner it ends up as is under 1200 pixels wide, so the rest of that file is
 * detail nobody ever sees.
 *
 * Done here rather than on the server because the server cannot: re-encoding an
 * image needs an imaging library, and adding one to the backend for this would
 * be a dependency the whole team then carries. The browser already has a decoder
 * and an encoder, and doing it before the upload means the large version never
 * crosses the network at all.
 *
 * The original is kept whenever shrinking does not actually help — a small file,
 * a picture already narrower than the target, or a re-encode that came out
 * bigger than what it replaced.
 */

// Wide enough for a full-width banner on a large screen at 2x, and no wider.
const MAX_WIDTH = 1600

// The widths offered when a picture is kept whole. Halving the width quarters
// the pixels, which is where nearly all of the weight goes — far more than any
// amount of fiddling with quality.
export const WIDTH_CHOICES = [
  { width: 1600, label: 'Large' },
  { width: 1200, label: 'Medium' },
  { width: 800, label: 'Small' },
]
// Below this a picture is already small enough that re-encoding it only risks
// making it worse.
const LEAVE_ALONE_BYTES = 300 * 1024
const QUALITY = 0.82

/** WebP keeps transparency, which JPEG would flatten to black. */
const PREFERRED_TYPE = 'image/webp'

function renameFor(name, type) {
  const extension = type === 'image/webp' ? '.webp' : '.jpg'
  return `${name.replace(/\.[^.]+$/, '')}${extension}`
}

function encode(canvas, type) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, QUALITY)
  })
}

export async function shrinkAdvertImage(file, maxWidth = MAX_WIDTH, force = false) {
  // `force` is set when somebody has asked for a particular width. Without it a
  // picture already under the threshold is left alone, which is right for the
  // automatic path and wrong when the width was chosen on purpose.
  if (!file || (!force && file.size <= LEAVE_ALONE_BYTES)) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Undecodable here is not a reason to refuse the upload: let the server
    // give its own answer about it.
    return file
  }

  try {
    const scale = Math.min(1, maxWidth / bitmap.width)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

    let blob = await encode(canvas, PREFERRED_TYPE)
    // A browser that cannot write WebP hands back a PNG instead of failing, and
    // a PNG of a photograph is usually larger than the file we started with.
    // JPEG is the fallback, and only for pictures that were opaque anyway.
    if ((!blob || blob.type !== PREFERRED_TYPE) && file.type === 'image/jpeg') {
      blob = await encode(canvas, 'image/jpeg')
    }
    if (!blob || (!force && blob.size >= file.size)) return file

    return new File([blob], renameFor(file.name, blob.type), { type: blob.type })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}
