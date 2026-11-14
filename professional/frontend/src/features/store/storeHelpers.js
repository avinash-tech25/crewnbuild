import { quantityProblem } from '../../shared/utils/quantityUnits.js'

// The product categories the Catalog offers, and the words the server's codes
// are shown as. A saved category outside this list is kept as typed.
export const STORE_CATEGORIES = ['Cement', 'Steel', 'Sand', 'Bricks', 'Paint', 'Electrical', 'Plumbing', 'Other']

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER']

export const STOCK_STATE_KEYS = {
  IN_STOCK: 'store.stock.inStock',
  LOW_STOCK: 'store.stock.lowStock',
  OUT_OF_STOCK: 'store.stock.outOfStock',
}

export const MOVEMENT_KEYS = {
  INITIAL: 'store.movement.initial',
  ADJUSTMENT: 'store.movement.adjustment',
  PURCHASE_RECEIPT: 'store.movement.receipt',
  ISSUE: 'store.movement.issue',
}

export function matchesSearch(item, query) {
  const text = String(query || '').trim().toLowerCase()
  if (!text) return true
  // A store product's size (variant) and a supplier listing's (size) are searched too.
  return [item.name, item.brand, item.category, item.subcategory, item.variant, item.size].some((value) => String(value || '').toLowerCase().includes(text))
}

// One Buy goes to one supplier: lines picked from several are grouped so each
// supplier gets its own order, as the cart does.
export function groupLinesBySupplier(lines) {
  const groups = new Map()
  lines.forEach((line) => {
    const key = String(line.supplier_id)
    if (!groups.has(key)) groups.set(key, { supplier_id: line.supplier_id, items: [] })
    groups.get(key).items.push({ product_id: line.id, quantity: Number(line.quantity) })
  })
  return [...groups.values()]
}

// A positive number with no more decimals than the server stores.
export function validQuantity(value, { allowZero = false } = {}) {
  const text = String(value ?? '').trim()
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return false
  return allowZero || Number(text) > 0
}

// Requests' three filters, each reading the stored status only. Pending is what
// still awaits the Store Manager's decision (even while a supplier order covers it);
// Approved is everything approved, however far it has been handed over. Rejected
// and cancelled requests are listed under All. Each row keeps its own status badge.
export const REQUEST_FILTERS = [
  { id: 'ALL', label: 'store.filter.all', match: () => true },
  { id: 'PENDING', label: 'store.filter.pending', match: (request) => request.status === 'PENDING' },
  { id: 'APPROVED', label: 'store.filter.approved', match: (request) => ['APPROVED', 'PARTIALLY_ISSUED', 'ISSUED'].includes(request.status) },
]

export function requestFilterCounts(requests) {
  return Object.fromEntries(REQUEST_FILTERS.map((filter) => [filter.id, requests.filter(filter.match).length]))
}

export function filterRequests(requests, filterId) {
  const filter = REQUEST_FILTERS.find((item) => item.id === filterId) || REQUEST_FILTERS[0]
  return requests.filter(filter.match)
}

// A store request's Request ID: its UUID (public_request_id), the same at every
// stage. The numeric id is only the key the API's own paths use.
export function requestRef(request) {
  return request?.public_request_id || ''
}

// A purchase's Purchase ID: the whole stored code as the server writes it (the
// short reference_code is only its first 8 characters).
export function purchaseRef(purchase) {
  return purchase?.purchase_id || purchase?.reference_code || ''
}

// A payment record's Transaction ID: its UUID (transaction_uuid), set once when the
// record is created. Never the gateway's payment reference, and never the numeric
// id, which is only the key the API's own paths use.
export function transactionRef(payment) {
  return payment?.transaction_uuid || ''
}

// Search by Request ID, in any letter case and with or without a leading #: the
// complete UUID finds exactly that request (as the server's ?search= does), and a
// part of one finds nothing. An empty search keeps every request.
export function searchRequests(requests, query) {
  const text = String(query || '').trim().replace(/^#+/, '').trim().toLowerCase()
  if (!text) return requests
  return requests.filter((request) => requestRef(request).toLowerCase() === text)
}

// What a supplier listing can still supply to a Buy: the server's figure (stock
// less what is already promised), or, before it has answered, the stock itself.
export function supplierAvailable(product) {
  const value = product?.available_quantity ?? product?.supplier_stock ?? 0
  return Math.max(Number(value) || 0, 0)
}

// Why a Buy quantity cannot go in the order, or '' when it can:
// 'none' (the supplier has nothing), 'invalid' / 'whole' (not a quantity this unit
// takes), 'exceeds' (more than the supplier can supply).
export function buyQuantityProblem(quantity, available, unit) {
  if (!(Number(available) > 0)) return 'none'
  const problem = quantityProblem(quantity, unit)
  if (problem) return problem
  return Number(quantity) > Number(available) ? 'exceeds' : ''
}

// A purchase line's worth as ordered, for display: the server's totals are what
// Payments adds up.
export function purchaseLineTotal(line) {
  return line.price == null ? null : Math.round(Number(line.price) * Number(line.quantity) * 100) / 100
}

// What of an order line has not arrived: all of it until received, else the
// part the receipt did not cover. Nothing is owed on a line the supplier rejected.
export function purchaseLineRemaining(line) {
  if (line.status === 'REJECTED') return 0
  return Math.max(Number(line.quantity) - Number(line.received ? line.received_quantity : 0), 0)
}

export function validAmount(value) {
  const text = String(value ?? '').trim()
  return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0
}

// Purchase Overview on the dashboard: the same periods and windows as the
// Supplier's Sales Overview (14 days, 12 weeks, 12 months, 5 years).
export const PURCHASE_RANGES = [
  { id: 'day', buckets: 14 },
  { id: 'week', buckets: 12 },
  { id: 'month', buckets: 12 },
  { id: 'year', buckets: 5 },
]

export function periodStart(value, range) {
  const day = new Date(value)
  day.setHours(0, 0, 0, 0)
  if (range === 'week') day.setDate(day.getDate() - day.getDay())
  if (range === 'month') return new Date(day.getFullYear(), day.getMonth(), 1)
  if (range === 'year') return new Date(day.getFullYear(), 0, 1)
  return day
}

function stepBack(date, range, steps) {
  const copy = new Date(date)
  if (range === 'day') copy.setDate(copy.getDate() - steps)
  else if (range === 'week') copy.setDate(copy.getDate() - steps * 7)
  else if (range === 'month') copy.setMonth(copy.getMonth() - steps)
  else copy.setFullYear(copy.getFullYear() - steps)
  return copy
}

// From the Store Manager's purchases (each with its payments and lines), per period:
//   spent      money actually paid: PAID payments only, on the day they were paid
//              (a CREATED checkout or a FAILED payment paid nothing);
//   purchases  purchases with at least one PAID payment, on the day they were placed;
//   quantity   what those purchases ordered, per unit, leaving out lines the
//              supplier rejected (units are never added across).
export function purchaseOverview(purchases, range, now = new Date()) {
  const config = PURCHASE_RANGES.find((item) => item.id === range) || PURCHASE_RANGES[0]
  const buckets = []
  for (let step = config.buckets - 1; step >= 0; step -= 1) {
    const start = periodStart(stepBack(now, config.id, step), config.id)
    buckets.push({ start, spent: 0, purchases: 0 })
  }
  const index = new Map(buckets.map((bucket) => [bucket.start.getTime(), bucket]))
  const bucketOf = (value) => (value ? index.get(periodStart(value, config.id).getTime()) : undefined)
  const quantity = new Map()
  for (const purchase of purchases || []) {
    const paid = (purchase.payments || []).filter((payment) => payment.status === 'PAID')
    for (const payment of paid) {
      const bucket = bucketOf(payment.paid_at || payment.created_at)
      if (bucket) bucket.spent += Number(payment.amount || 0)
    }
    const placed = paid.length ? bucketOf(purchase.created_at) : undefined
    if (!placed) continue
    placed.purchases += 1
    for (const line of purchase.lines || []) {
      if (line.status === 'REJECTED') continue
      const unit = line.unit || ''
      quantity.set(unit, (quantity.get(unit) || 0) + Number(line.quantity || 0))
    }
  }
  const current = buckets[buckets.length - 1]
  const previous = buckets[buckets.length - 2]
  return {
    buckets: buckets.map((bucket) => ({ ...bucket, spent: Math.round(bucket.spent * 100) / 100 })),
    spent: Math.round(buckets.reduce((sum, bucket) => sum + bucket.spent, 0) * 100) / 100,
    purchases: buckets.reduce((sum, bucket) => sum + bucket.purchases, 0),
    quantity: [...quantity.entries()].map(([unit, total]) => ({ unit, quantity: total })),
    // This period's spending against the one before it, when there was any.
    change: previous && previous.spent > 0 ? Math.round(((current.spent - previous.spent) / previous.spent) * 100) : null,
  }
}
