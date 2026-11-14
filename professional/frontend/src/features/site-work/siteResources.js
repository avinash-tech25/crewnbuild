// Labour and equipment for one calendar date in the Site Engineer workspace.
// Pure functions over the existing supply-flow payloads:
//   GET /projects/{id}/labor-requests      + /labor-requests/{id}/daily-records
//   GET /projects/{id}/equipment-requests  + /equipment-requests/{id}/usage
// Nothing here invents a rate. Labour requests carry no agreed rate today, so
// labour has attendance but no calculated cost; equipment rentals carry the
// price agreed when the request was made (unit_price per rate_unit).

const dateKey = (value) => String(value || '').slice(0, 10)
const toNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// Requests that were agreed: accepted, or accepted and since completed.
export const AGREED_STATUSES = new Set(['ACCEPTED', 'COMPLETED'])

// The request's own period: start date through end date (an open-ended labour
// request has no end date).
export function requestCoversDate(request, date) {
  const day = dateKey(date)
  const start = dateKey(request?.start_date)
  const end = dateKey(request?.end_date)
  if (!day || !start || day < start) return false
  return !end || day <= end
}

// Labour cards for a date: every agreed labour request whose period covers it.
export function labourRequestsForDate(requests = [], date) {
  return (requests || [])
    .filter((request) => AGREED_STATUSES.has(request.status) && requestCoversDate(request, date))
    .sort((first, second) => String(first.supplier_name || '').localeCompare(String(second.supplier_name || '')) || String(first.trade).localeCompare(String(second.trade)) || String(first.id).localeCompare(String(second.id)))
}

// Rentals on a date: agreed RENT requests whose rental period covers it.
export function rentalsForDate(requests = [], date) {
  return (requests || [])
    .filter((request) => request.request_kind === 'RENT' && AGREED_STATUSES.has(request.status) && requestCoversDate(request, date))
    .sort((first, second) => String(first.item_name || '').localeCompare(String(second.item_name || '')) || String(first.id).localeCompare(String(second.id)))
}

// Purchases are history, never a daily charge.
export function agreedPurchases(requests = []) {
  return (requests || []).filter((request) => request.request_kind === 'BUY' && AGREED_STATUSES.has(request.status))
}

// A past or present date with something the engineer could record against:
// lets the calendar open dates inside a request or rental period.
export function hasResourceOnDate(labourRequests = [], equipmentRequests = [], date) {
  return labourRequestsForDate(labourRequests, date).length > 0 || rentalsForDate(equipmentRequests, date).length > 0
}

// Mirrors the backend rules for writing attendance / usage on a date:
// the request's own engineer, an ACCEPTED request, a date inside its period
// and not in the future. Everyone else (builders included) reads only.
export function canRecordOnDate(request, { userId, role, date, todayKey }) {
  if (role !== 'ENGINEER' || !request || request.status !== 'ACCEPTED') return false
  if (String(request.engineer_id) !== String(userId)) return false
  const day = dateKey(date)
  return requestCoversDate(request, day) && Boolean(todayKey) && day <= dateKey(todayKey)
}

// Same checks the backend makes on PUT /labor-requests/{id}/daily-records/{date}.
// Returns { key, values } for the first problem (a translation key), or null.
export function attendanceProblem(form, allocated) {
  const counts = ['present_count', 'absent_count', 'half_day_count', 'overtime_workers'].map((field) => Number(form?.[field] || 0))
  const [present, absent, halfDay, overtimeWorkers] = counts
  const overtimeHours = Number(form?.overtime_hours || 0)
  if (counts.some((value) => !Number.isInteger(value) || value < 0) || Number.isNaN(overtimeHours) || overtimeHours < 0) return { key: 'labor.error.counts', values: {} }
  const total = present + absent + halfDay
  if (total > toNumber(allocated)) return { key: 'labor.error.countsExceed', values: { total, allocated: toNumber(allocated) } }
  if (overtimeWorkers > present + halfDay) return { key: 'labor.error.overtimeExceed', values: {} }
  if (overtimeHours > 0 && overtimeWorkers === 0) return { key: 'se.res.errOvertimeWorkers', values: {} }
  return null
}

// The day's charge for one rental under the agreed contract.
//   DAY  -> quantity x agreed daily price, for every day of the rental period,
//           used or not.
//   HOUR -> the hours logged for the day x agreed hourly price. The contract
//           stores no committed hours, so the logged hours are the only
//           billable hours the system has (hours_used covers all units).
//   WEEK / MONTH -> not priced per day: the system defines no rule for
//           splitting a week or month across days or for part periods.
//   Returned (completed) before this date -> not priced: no rule says whether
//           the rest of the agreed period is still charged.
// Returns { amount (number | null), basis }.
export function rentalChargeForDate(rental, date, hoursUsed = null) {
  const day = dateKey(date)
  const price = toNumber(rental?.unit_price)
  const returnedOn = rental?.status === 'COMPLETED' ? dateKey(rental.completed_at) : ''
  if (returnedOn && day > returnedOn) return { amount: null, basis: 'returnedEarly' }
  switch (rental?.rate_unit) {
    case 'DAY':
      return { amount: toNumber(rental.quantity) * price, basis: 'day' }
    case 'HOUR':
      return hoursUsed == null ? { amount: 0, basis: 'hoursNotLogged' } : { amount: toNumber(hoursUsed) * price, basis: 'hours' }
    case 'WEEK':
    case 'MONTH':
      return { amount: null, basis: 'periodRuleMissing' }
    default:
      return { amount: null, basis: 'unknownUnit' }
  }
}

// Recorded payments for the day's registers, kept apart from accrued cost.
// site_payments has no supplier link, so they are listed by the party name
// that was typed, never matched to a supplier.
export function splitPayments(payments = []) {
  const paidOut = (payments || []).filter((payment) => String(payment.direction).toUpperCase() === 'OUT')
  const receivedIn = (payments || []).filter((payment) => String(payment.direction).toUpperCase() === 'IN')
  const sum = (rows) => rows.reduce((total, row) => total + toNumber(row.amount), 0)
  return { paidOut, receivedIn, paidOutTotal: sum(paidOut), receivedInTotal: sum(receivedIn) }
}

// The day's accrued spend. Stock received and payments are never part of it.
// Rentals without a defined daily rule are counted as unpriced, not as zero.
export function dailyCostSummary({ materialCost = 0, labourCost = 0, otherEquipmentCost = 0, otherExpenses = 0, rentalCharges = [] } = {}) {
  const priced = rentalCharges.filter((charge) => charge.amount != null)
  const rentalCost = priced.reduce((total, charge) => total + toNumber(charge.amount), 0)
  const parts = { material: toNumber(materialCost), labour: toNumber(labourCost), rental: rentalCost, otherEquipment: toNumber(otherEquipmentCost), otherExpenses: toNumber(otherExpenses) }
  return { ...parts, total: Object.values(parts).reduce((total, value) => total + value, 0), unpricedRentals: rentalCharges.length - priced.length }
}

// The saved record for a request on a date, if any.
export const recordForDate = (records = [], date, field = 'work_date') => (records || []).find((record) => dateKey(record[field]) === dateKey(date)) || null
