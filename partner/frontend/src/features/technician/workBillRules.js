/**
 * The rules the work-bill screen checks before it asks the server.
 *
 * They mirror the backend so an obvious mistake is shown at once. The server
 * decides: it computes every amount itself (no amount is ever sent), and every
 * refusal it sends is shown as it sends it.
 *
 * Money is handled in whole paise (integers), never as binary fractions, and a
 * line amount is rounded half-up to the paisa as on the server:
 *
 *     amount = round(quantity * unit_price, 2)
 *
 * No imports: this module is loaded by the unit tests under plain Node.
 */

export const KIND_MATERIAL = 'MATERIAL'
export const KIND_LABOUR = 'LABOUR'
export const KIND_BILL = 'BILL'

export const BILL_NOTES_MAX_LENGTH = 2000
export const NAME_MAX_LENGTH = 120
export const UNIT_MAX_LENGTH = 16
export const DESCRIPTION_MAX_LENGTH = 500
export const MAX_QUANTITY = '9999.99'
export const MAX_UNIT_PRICE = '999999.99'
// ₹10,00,000 per line, in paise.
export const MAX_LINE_PAISE = 100000000

export const UNIT_SUGGESTIONS = {
  [KIND_MATERIAL]: ['pcs', 'm', 'ft', 'kg', 'L', 'box', 'set', 'roll', 'bag'],
  [KIND_LABOUR]: ['hr', 'day', 'job', 'visit'],
}

// Used only if the server's own limits are missing from a response.
const FALLBACK_LIMITS = { items: 50, material_photos: 3, attachments: 6 }

export function billLimit(bill, key) {
  return bill?.limits?.[key] ?? FALLBACK_LIMITS[key]
}

/** "12.5" -> 1250 hundredths. Null unless a plain non-negative number with at most two decimals. */
export function toHundredths(value) {
  const text = String(value ?? '').trim()
  const match = /^(\d{0,9})(?:\.(\d{1,2}))?$/.exec(text)
  if (!match || (match[1] === '' && match[2] === undefined)) return null
  return Number(match[1] || 0) * 100 + Number((match[2] || '').padEnd(2, '0'))
}

/** Quantity (in hundredths) x price (in paise), rounded half-up to the paisa. */
export function lineAmountPaise(quantity, unitPrice) {
  const q = toHundredths(quantity)
  const p = toHundredths(unitPrice)
  if (q === null || p === null) return null
  return Math.floor((q * p + 50) / 100)
}

export function paiseToAmount(paise) {
  return (paise / 100).toFixed(2)
}

/** "2.50" -> "2.5", "3.00" -> "3": how a quantity reads, without invented precision. */
export function formatQuantity(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value ?? '')
  return String(Number(number.toFixed(2)))
}

export function emptyItem(kind, today) {
  return {
    name: '', quantity: '1', unit: kind === KIND_LABOUR ? 'hr' : 'pcs', unit_price: '',
    work_date: kind === KIND_LABOUR ? today : '', description: '',
  }
}

export function itemForm(item) {
  return {
    name: item.name, quantity: formatQuantity(item.quantity), unit: item.unit, unit_price: formatQuantity(item.unit_price),
    work_date: item.work_date || '', description: item.description || '',
  }
}

/** Field -> message for everything the server would refuse; empty when the line is fine. */
export function itemProblems(form, kind, { today } = {}) {
  const problems = {}
  const name = form.name.trim()
  if (!name) problems.name = kind === KIND_LABOUR ? 'Enter the kind of work.' : 'Enter the material name.'
  else if (name.length > NAME_MAX_LENGTH) problems.name = `At most ${NAME_MAX_LENGTH} characters.`

  const quantity = toHundredths(form.quantity)
  if (quantity === null) problems.quantity = 'Enter a number with at most two decimals.'
  else if (quantity === 0) problems.quantity = 'Must be more than 0.'
  else if (quantity > toHundredths(MAX_QUANTITY)) problems.quantity = `At most ${MAX_QUANTITY}.`

  const unit = form.unit.trim()
  if (!unit) problems.unit = 'Enter a unit.'
  else if (unit.length > UNIT_MAX_LENGTH) problems.unit = `At most ${UNIT_MAX_LENGTH} characters.`

  const price = toHundredths(form.unit_price)
  if (price === null) problems.unit_price = 'Enter an amount in rupees, e.g. 90 or 90.50.'
  else if (price > toHundredths(MAX_UNIT_PRICE)) problems.unit_price = 'That amount is too large.'

  if (!problems.quantity && !problems.unit_price && lineAmountPaise(form.quantity, form.unit_price) > MAX_LINE_PAISE) {
    problems.unit_price = 'One line can come to at most ₹10,00,000.'
  }
  if (form.description.trim().length > DESCRIPTION_MAX_LENGTH) problems.description = `At most ${DESCRIPTION_MAX_LENGTH} characters.`
  if (kind === KIND_LABOUR && form.work_date && today && form.work_date > today) problems.work_date = 'The date cannot be in the future.'
  return problems
}

/** Exactly the body the server accepts. The amount is never sent: the server works it out. */
export function itemPayload(form, kind, { withKind = true } = {}) {
  const body = {
    name: form.name.trim(),
    quantity: form.quantity.trim(),
    unit: form.unit.trim(),
    unit_price: form.unit_price.trim(),
    description: form.description.trim() || null,
    work_date: kind === KIND_LABOUR && form.work_date ? form.work_date : null,
  }
  return withKind ? { kind, ...body } : body
}

/** India's date today as YYYY-MM-DD: the server checks work dates in India time. */
export function indiaToday(now = new Date()) {
  const india = new Date(now.getTime() + 330 * 60000)
  return india.toISOString().slice(0, 10)
}

export function billStatusLabel(bill) {
  if (bill?.status === 'FINALIZED') return 'Submitted'
  if (bill?.status === 'DRAFT') return 'Draft'
  return 'Not started'
}
