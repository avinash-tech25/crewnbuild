// A builder's India service location is saved as "<district> - <pincode>" in the
// existing comma-separated list, so it must never contain a comma. The server
// reads the six-digit pincode back out of each entry to match leads
// (backend app/subscription/lead_locations.py); an entry without one stays a
// display-only area name.

const PINCODE = /(?<!\d)([1-9]\d{5})(?!\d)/

/** The entry for a pincode lookup result (GET /locations/pincode/{pincode}), or '' without a pincode. */
export function pincodeLocationEntry(area) {
  const pincode = String(area?.pincode || '').trim()
  if (!PINCODE.test(pincode)) return ''
  const place = String(area?.district || area?.city || area?.area || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  return place ? `${place} - ${pincode}` : pincode
}

/**
 * The entry for one post office the builder picked from a pincode lookup's
 * `post_offices`: "<post office> - <city> - <district> - <state> - <pincode>",
 * each part once, no commas. Ends with the pincode, so leads still match on it.
 * '' when the branch carries no valid pincode.
 */
export function branchLocationEntry(branch) {
  const pincode = String(branch?.pincode || '').trim()
  if (!PINCODE.test(pincode) || pincode.length !== 6) return ''
  const parts = []
  for (const value of [branch?.name, branch?.city, branch?.district, branch?.state]) {
    // Commas would split the saved list; digits could be read as a pincode.
    const part = String(value || '').replace(/,/g, ' ').replace(/\d{6,}/g, '').replace(/\s+/g, ' ').trim()
    if (part && !parts.some((existing) => existing.toLowerCase() === part.toLowerCase())) parts.push(part)
  }
  return [...parts, pincode].join(' - ')
}

/** The pincode an entry carries, or null. */
export function locationEntryPincode(entry) {
  const match = PINCODE.exec(String(entry || ''))
  return match ? match[1] : null
}
