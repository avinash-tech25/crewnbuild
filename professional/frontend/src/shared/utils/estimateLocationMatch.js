/**
 * Get Estimate only: does the India Post lookup for the entered PIN confirm the
 * selected state AND city?
 *
 * Pure and stateless. It is evaluated on every render from the CURRENT form
 * values and the CURRENT lookup result, so no "verified" flag is ever stored:
 * changing the PIN, the state or the city re-evaluates at once, and a lookup
 * result that belongs to a different PIN never counts (see `lookupPincode`).
 *
 * Matching rules (the backend's estimate_location_check.py applies the same):
 *  - every post office returned is inspected, never just the first;
 *  - the state must equal a returned branch's state ("&" read as "and");
 *  - the city must equal, after normalising, the district, postal division or
 *    block of a branch in that state. Post-office names are NOT used: a branch
 *    name is a locality, not a city;
 *  - the only spelling differences accepted are the approved official renames
 *    in CITY_ALIASES. Nothing is guessed: no match means "unconfirmed".
 */

// Approved official renames. Each group is one city under its names.
export const CITY_ALIASES = [
  ['bengaluru', 'bangalore'],
  ['gurugram', 'gurgaon'],
  ['prayagraj', 'allahabad'],
  ['mysuru', 'mysore'],
  ['mumbai', 'bombay'],
  ['kolkata', 'calcutta'],
]

// Trailing words India Post adds to a division or block that do not change the
// place: "Hyderabad City", "Mumbai G.P.O.", "Vijayawada (Urban)", "Kolkata Central".
const HARMLESS_SUFFIXES = new Set(['city', 'gpo', 'urban', 'rural', 'east', 'west', 'north', 'south', 'central'])

const INDIA_PIN = /^[1-9]\d{5}$/

export const ESTIMATE_LOCATION = {
  VERIFIED: 'verified',
  PENDING: 'verification_pending',
  INVALID_PIN: 'invalid_pin',
  NOT_FOUND: 'pin_not_found',
  STATE_MISMATCH: 'state_mismatch',
  CITY_MISMATCH: 'city_mismatch',
  CITY_UNCONFIRMED: 'city_unconfirmed',
  UNAVAILABLE: 'lookup_unavailable',
}

function basicName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeState(value) {
  return basicName(value)
}

/** A place name reduced for comparison, with any approved rename folded to one name. */
export function normalizeCity(value) {
  const words = basicName(value).split(' ').filter(Boolean)
  while (words.length > 1 && HARMLESS_SUFFIXES.has(words[words.length - 1])) words.pop()
  const name = words.join(' ')
  const group = CITY_ALIASES.find((names) => names.includes(name))
  return group ? group[0] : name
}

function branchPlaces(branch) {
  return [branch?.district, branch?.division, branch?.block].filter(Boolean).map(normalizeCity)
}

/**
 * @param {object} input
 * @param {string} input.country
 * @param {string} input.state        selected state
 * @param {string} input.city         selected city
 * @param {string} input.pincode      entered PIN
 * @param {object} input.lookupState  usePincodeAreaLookup()'s current state
 * @param {string[]} [input.cityOptions] the selected state's dropdown cities, used
 *        only to tell "the PIN is in another listed city" from "unconfirmed"
 * @returns {{ status: string }}
 */
export function evaluateEstimateLocation({ country, state, city, pincode, lookupState, cityOptions = [] }) {
  const pin = String(pincode || '').trim()
  if (String(country || '').trim().toLowerCase() !== 'india') return { status: ESTIMATE_LOCATION.PENDING }
  if (!state || !city) return { status: ESTIMATE_LOCATION.PENDING }
  // Empty, short, long, non-numeric or starting with 0: not an Indian PIN.
  if (!INDIA_PIN.test(pin)) return { status: ESTIMATE_LOCATION.INVALID_PIN }

  const lookup = lookupState || {}
  if (lookup.status === 'loading' || lookup.status === 'idle' || lookup.status === 'incomplete' || !lookup.status) {
    return { status: ESTIMATE_LOCATION.PENDING }
  }
  if (lookup.status === 'invalid') return { status: ESTIMATE_LOCATION.INVALID_PIN }
  if (lookup.status === 'unknown') return { status: ESTIMATE_LOCATION.NOT_FOUND }
  if (lookup.status === 'unmapped') return { status: ESTIMATE_LOCATION.CITY_UNCONFIRMED }
  if (lookup.status !== 'success') return { status: ESTIMATE_LOCATION.UNAVAILABLE }

  // A result for a different PIN (the render between typing and the hook's
  // reset) is never used: it is treated as still pending.
  const lookupPincode = String(lookup.areaDetails?.pincode || '')
  if (lookupPincode !== pin) return { status: ESTIMATE_LOCATION.PENDING }

  const branches = Array.isArray(lookup.branches) ? lookup.branches : []
  const wantedState = normalizeState(state)
  const inState = branches.filter((branch) => normalizeState(branch?.state) === wantedState)
  if (!inState.length) return { status: ESTIMATE_LOCATION.STATE_MISMATCH }

  const wantedCity = normalizeCity(city)
  const places = new Set(inState.flatMap(branchPlaces))
  if (places.has(wantedCity)) return { status: ESTIMATE_LOCATION.VERIFIED }

  // The PIN names another city from this state's own list: a clear mismatch.
  const otherListed = cityOptions.map(normalizeCity).filter((name) => name !== wantedCity)
  if (otherListed.some((name) => places.has(name))) return { status: ESTIMATE_LOCATION.CITY_MISMATCH }
  return { status: ESTIMATE_LOCATION.CITY_UNCONFIRMED }
}
