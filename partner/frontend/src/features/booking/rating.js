/**
 * Rating display and form helpers. No imports: unit-tested under Node.
 * The tag vocabulary and the star groups always come from the backend's
 * GET /requester/bookings/{id}/rating -- nothing here keeps a copy of them.
 */

/** "positive" | "mixed" | "negative" for a whole number of stars, from the server's map. */
export function groupFor(stars, starGroups) {
  return stars ? starGroups?.[String(stars)] || null : null
}

/** The tags a star count may carry, from the server's options. */
export function optionsFor(stars, starGroups, tagOptions) {
  const group = groupFor(stars, starGroups)
  return group ? tagOptions?.[group] || [] : []
}

/** Selected tags still valid after the stars change (others are dropped). */
export function keepCompatible(selected, stars, starGroups, tagOptions) {
  const allowed = new Set(optionsFor(stars, starGroups, tagOptions).map((option) => option.key))
  return selected.filter((key) => allowed.has(key))
}

export function toggleTag(selected, key) {
  return selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key]
}

/** 4.7 -> "4.7", 5 -> "5.0": the server already rounded; this only formats. */
export function formatAverage(average) {
  const value = Number(average)
  return Number.isFinite(value) ? value.toFixed(1) : ''
}

export function countLabel(count) {
  return `${count} ${count === 1 ? 'rating' : 'ratings'}`
}

/** What to show for a technician's aggregate: never a fake rating when there is none. */
export function ratingSummary(average, count) {
  if (!count || average === null || average === undefined) return { rated: false, text: 'New · No ratings yet', short: 'New' }
  return { rated: true, text: `★ ${formatAverage(average)} · ${countLabel(count)}`, short: `★ ${formatAverage(average)} (${countLabel(count)})` }
}
