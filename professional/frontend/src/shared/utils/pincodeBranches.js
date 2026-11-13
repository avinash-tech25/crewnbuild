// Decisions about the India Post branches a pincode lookup returns. The lookup
// response also carries top-level `area` / `display` / `city` values, but those
// are only the first branch India Post happens to list; a form that lets the
// user pick a branch must never treat them as the user's choice.

export function lookupBranchList(areaDetails) {
  return Array.isArray(areaDetails?.post_offices) ? areaDetails.post_offices : []
}

// A pincode with exactly one branch has nothing to choose between.
export function onlyBranchOf(branches) {
  return Array.isArray(branches) && branches.length === 1 ? branches[0] : null
}

// A value every branch agrees on (e.g. the state), or '' when they differ.
export function sharedBranchValue(branches, field) {
  const values = new Set((branches || []).map((branch) => String(branch?.[field] || '').trim()).filter(Boolean))
  return values.size === 1 ? [...values][0] : ''
}

// The address a pincode or post office fills in: it follows while the field is
// empty or still holds what was last filled in (`lastAutoAddress`); text the
// user typed is kept. Pure, so it is safe inside a React state updater.
export function followAutoAddress(currentAddress, display, lastAutoAddress) {
  const ownAddress = Boolean(String(currentAddress || '').trim()) && currentAddress !== lastAutoAddress
  return ownAddress ? currentAddress : display
}

export function findBranchByDisplay(branches, display) {
  const wanted = String(display || '').trim()
  return wanted ? (branches || []).find((branch) => branch.display === wanted) || null : null
}
