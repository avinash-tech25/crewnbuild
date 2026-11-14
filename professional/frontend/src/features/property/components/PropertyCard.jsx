/**
 * Display labels for a property listing: bedrooms, area, stored codes and
 * facing, shared by the listing cards, the detail panel and the listing form.
 *
 * Every value is derived from the listing the API returned. There are no
 * placeholder values.
 */
import { formatNumber } from '../../../shared/utils/formatters.js'
import { translatorFrom } from '../../../i18n/translate.js'

/**
 * A listing's bedroom count, or 0 for a plot: a plot has no BHK, even when a
 * count was saved on it before the form stopped asking for one.
 */
export function listingBedrooms(listing) {
  if (listing?.property_type === 'PLOT') return 0
  return Number(listing?.bedrooms || 0)
}

/**
 * "3 BHK", or nothing when the seller did not say.
 *
 * `t` stays accepted, but the label no longer depends on a caller remembering
 * to pass it: the `${bedrooms} BHK` that used to stand in was English in all
 * seven languages. `ui.owner.bhk` carries the phrase, and the count is
 * interpolated into it, so a language that puts the unit first can.
 */
export function bhkLabel(listing, t) {
  const bedrooms = listingBedrooms(listing)
  if (bedrooms <= 0) return ''
  return translatorFrom(t)('ui.owner.bhk', { count: bedrooms })
}

/** The most meaningful area the seller supplied, largest first. */
export function areaLabel(listing, t) {
  const builtUp = Number(listing?.built_up_area || 0)
  const carpet = Number(listing?.carpet_area || 0)
  const land = Number(listing?.land_area || 0)
  // `toLocaleString()` with no locale grouped the digits by whatever language
  // the *browser* was set to, so an Indian listing read on an American laptop
  // showed 1,234,567 rather than 12,34,567. `formatNumber` follows the selected
  // language, and never rounds.
  const area = (value) => `${formatNumber(value)} ${translatorFrom(t)('property.sqft')}`
  if (builtUp > 0) return area(builtUp)
  if (carpet > 0) return area(carpet)
  if (land > 0) return area(land)
  return ''
}

/**
 * A stored code such as SEMI_FURNISHED shown as readable text.
 *
 * English Title Case, built from the code itself — there is no translating this
 * by lookup, because the words are the enum's. It is the last resort only:
 * every caller below hands its result to `td` so an unnamed code is at least
 * machine-translated rather than shown as raw English.
 */
export function readableCode(value) {
  if (!value) return ''
  return String(value)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

/**
 * A stored code shown in the reader's language when a label exists for it
 * (`<prefix>.<CODE>`), else as readable text. The stored value never changes.
 *
 * Passing `td` is what makes the fallback safe: without it a code the key table
 * has not caught up with silently prints as English, and silently is the
 * problem — nothing looks broken, it just is not translated. With it, that same
 * code is machine-translated for display.
 */
export function codeLabel(t, prefix, value, td = null) {
  if (!value) return ''
  const key = `${prefix}.${value}`
  const label = t(key)
  if (label !== key) return label
  const readable = readableCode(value)
  return td ? td(readable) : readable
}

const FACING_KEYS = {
  EAST: 'ui.owner.facingEast',
  WEST: 'ui.owner.facingWest',
  NORTH: 'ui.owner.facingNorth',
  SOUTH: 'ui.owner.facingSouth',
  NORTH_EAST: 'ui.owner.facingNorthEast',
  NORTH_WEST: 'ui.owner.facingNorthWest',
  SOUTH_EAST: 'ui.owner.facingSouthEast',
  SOUTH_WEST: 'ui.owner.facingSouthWest',
}

/** A stored facing code (NORTH_EAST) as a localised direction. */
export function facingLabel(t, value, td = null) {
  if (!value) return ''
  if (FACING_KEYS[value]) return t(FACING_KEYS[value])
  const readable = readableCode(value)
  return td ? td(readable) : readable
}
