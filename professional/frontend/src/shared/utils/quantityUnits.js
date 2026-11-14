// Quantities typed by hand (cart and store requests). Units counted in whole numbers
// -- bags, rods, buckets, pieces -- take no fraction; any other unit (kg, tonne,
// litre, cft ...) is measured and may take up to three decimals, as stored.
// Keep the list identical to the server's (store_manager stock_service.COUNT_UNITS).
const COUNT_UNITS = new Set([
  'bag', 'piece', 'pc', 'no', 'nos', 'number', 'unit', 'rod', 'bar', 'bucket', 'box', 'bundle', 'sheet',
  'packet', 'pack', 'roll', 'drum', 'tin', 'can', 'set', 'pair', 'length', 'coil', 'tile', 'block', 'brick', 'load',
])

export function isCountUnit(unit) {
  const word = String(unit || '').trim().toLowerCase().replace(/\.+$/, '')
  return COUNT_UNITS.has(word)
    || (word.endsWith('es') && COUNT_UNITS.has(word.slice(0, -2)))
    || (word.endsWith('s') && COUNT_UNITS.has(word.slice(0, -1)))
}

/** '' when the text is a quantity this unit accepts; 'invalid' (not a number above
 *  zero with at most three decimals) or 'whole' (a fraction of a counted unit). */
export function quantityProblem(value, unit) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,3})?$/.test(text) || Number(text) <= 0) return 'invalid'
  if (isCountUnit(unit) && !Number.isInteger(Number(text))) return 'whole'
  return ''
}

/** The text a +/- step leads to: one more or one less, never below zero. */
export function stepQuantity(value, delta) {
  const current = Number(String(value ?? '').trim()) || 0
  const next = Math.max(0, Math.round((current + delta) * 1000) / 1000)
  return next ? String(next) : ''
}
