/**
 * Illustrative artwork for catalogue categories.
 *
 * This module knows one thing: which category illustrations have been added to
 * `public/landing/categories/`. It is a manifest of the files that exist, in
 * the same spirit as the role artwork listed in
 * `components/landing/landing/content.js` — not catalogue data. Nothing here
 * decides which categories exist, which products belong to them, how they are
 * counted, ordered or filtered; all of that continues to be derived from the
 * supplier's own products.
 *
 * The association is by filename: a category is illustrated when a file named
 * after its slug has been added. Adding artwork for a new category is dropping
 * `<slug>.jpg` into that folder and naming it here — no component changes, and
 * a category with no file simply falls back to the supplier's own product
 * photographs, exactly as before.
 *
 * Licences and attribution for every file are recorded alongside them in
 * `public/landing/categories/CREDITS.json`.
 */

const ASSET_BASE = '/landing/categories'

// The files present in that folder. Sorted, so it reads as a directory listing.
const AVAILABLE = new Set([
  'aggregates',
  'bricks',
  'cement',
  'construction-chemicals',
  'electrical',
  'hardware',
  'machines',
  'paint',
  'plumbing',
  'roofing',
  'safety',
  'sand',
  'steel-tmt',
  'tiles',
  'waterproofing',
  'wood',
])

/** A category name reduced to a filename-safe key. "Steel/TMT" -> "steel-tmt". */
export function categorySlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The illustration for a category, or an empty string when none has been added.
 * An empty result is the normal case for a category nobody has drawn artwork
 * for, and callers fall back to the supplier's own product images.
 */
export function categoryImage(name) {
  const slug = categorySlug(name)
  return AVAILABLE.has(slug) ? `${ASSET_BASE}/${slug}.jpg` : ''
}
