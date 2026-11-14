// Labor request rules the screens share, kept free of React so they can be unit
// tested (node --test). The backend re-checks every one of them: availability
// here is only what the last load returned, so a stale number can never let a
// request through -- the API answers 409 and its message is shown instead.

// Mirrors the backend's MAX_WORKERS (app/schemas/labor.py).
export const MAX_WORKERS = 10000

/** Free workers of one trade as the API reported them; never negative, never NaN. */
export function availableCount(service) {
  const value = Number(service?.available_workers)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/**
 * The trades a supplier can be asked for, in the backend's trade order when that
 * list loaded. When it did not, the supplier's own services are still offered
 * (sorted), so a failed trade list never empties the dropdown.
 */
export function offeredServices(services = [], trades = []) {
  const list = Array.isArray(services) ? services : []
  if (!Array.isArray(trades) || !trades.length) {
    return [...list].sort((a, b) => String(a.trade).localeCompare(String(b.trade)))
  }
  const byTrade = Object.fromEntries(list.map((service) => [service.trade, service]))
  return trades.filter((trade) => byTrade[trade]).map((trade) => byTrade[trade])
}

/**
 * Why `rawValue` workers cannot be requested from `service`, as a translation key
 * and its params, or null when the number is fine. Checks, in order: a whole
 * number of at least 1, the 10,000 ceiling, then this trade's free workers.
 */
export function workersRequestError(rawValue, service) {
  const text = String(rawValue ?? '').trim()
  const workers = Number(text)
  if (!text || !Number.isInteger(workers) || workers < 1) return { key: 'labor.error.workersRequired' }
  if (workers > MAX_WORKERS) return { key: 'labor.error.workersMax', params: { count: MAX_WORKERS } }
  const available = availableCount(service)
  if (workers > available) {
    return { key: 'labor.error.workersAvailable', params: { count: available, trade: service?.trade || '' } }
  }
  return null
}

/** Allocation of a decided request: partial when fewer workers were allocated than asked for. */
export function allocationSummary(request) {
  const required = Number(request?.workers_required) || 0
  const rawAllocated = request?.workers_allocated
  if (rawAllocated === null || rawAllocated === undefined || rawAllocated === '') {
    return { allocated: null, required, shortfall: 0, partial: false }
  }
  const allocated = Number(rawAllocated) || 0
  const shortfall = Math.max(required - allocated, 0)
  return { allocated, required, shortfall, partial: shortfall > 0 }
}
