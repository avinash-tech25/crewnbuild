// Material history for the Site Engineer's daily record: what was used, when,
// and what it cost, newest first. Pure functions so the ordering, filtering and
// totals can be tested without rendering the dashboard.
//
// Source: GET /cost-tool/projects/{id}/summary -> materials[].daily_usage. Each
// entry is one site_material_usages row (one per material per daily record).
// A row stores when it was first recorded (recorded_at) but has no update
// timestamp, so "added" vs "updated" is only known for saves made in this
// session (see usageChanges) and is never guessed from the stored data.

const toNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// Stable identity for one usage row. The row id survives re-saves (the backend
// updates the row in place); register + material is the fallback for payloads
// from before the id was exposed.
export const historyEntryKey = (entry) => (entry.id != null ? `id:${entry.id}` : `${entry.registerId ?? ''}|${entry.workDate}|${entry.material}`)

// Flattens every material's daily usage into one list of history entries.
// Rows with no quantity are skipped: each save writes a row for every stock
// material, so most rows are zeros that only record "not used that day".
export function buildMaterialHistory(materials = [], registers = []) {
  const registersById = new Map((registers || []).map((register) => [register.id, register]))
  const registersByDate = new Map((registers || []).map((register) => [register.work_date, register]))
  const entries = []
  for (const material of materials || []) {
    for (const usage of material.daily_usage || []) {
      const quantity = toNumber(usage.quantity_used)
      if (quantity <= 0) continue
      const rate = toNumber(usage.rate)
      const storedAmount = toNumber(usage.total_cost)
      const register = registersById.get(usage.register_id) || registersByDate.get(usage.work_date) || null
      const entry = {
        id: usage.id ?? null,
        registerId: usage.register_id ?? null,
        material: material.material,
        workDate: String(usage.work_date || '').slice(0, 10),
        recordedAt: usage.recorded_at || null,
        quantity,
        unit: usage.unit || material.unit || '',
        // Rate and amount are what was saved on the row. A row saved without a
        // rate has no amount; it is shown as unknown, not as zero.
        rate: rate > 0 ? rate : null,
        amount: storedAmount > 0 ? storedAmount : rate > 0 ? quantity * rate : null,
        workTitle: register?.work_type || '',
      }
      entry.key = historyEntryKey(entry)
      entries.push(entry)
    }
  }
  return entries
}

const timeOf = (iso) => {
  const time = iso ? Date.parse(iso) : NaN
  return Number.isNaN(time) ? 0 : time
}

// Newest first. Entries changed in this session come first (most recent change
// on top); the rest follow by work date, then the time the row was recorded,
// then row id -- never by array position alone.
export function sortLatestFirst(entries = [], touched = {}) {
  return [...entries].sort((first, second) => {
    const firstTouch = touched[first.key]?.at || 0
    const secondTouch = touched[second.key]?.at || 0
    if (firstTouch !== secondTouch) return secondTouch - firstTouch
    if (first.workDate !== second.workDate) return first.workDate < second.workDate ? 1 : -1
    const recorded = timeOf(second.recordedAt) - timeOf(first.recordedAt)
    if (recorded) return recorded
    // Ids are UUIDv7: as text they sort in the order the rows were created.
    return String(second.id ?? '').localeCompare(String(first.id ?? ''))
  })
}

const shiftDateKey = (dateKey, days) => {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const EMPTY_HISTORY_FILTERS = Object.freeze({ search: '', material: '', from: '', to: '', recent: 'all' })

export const hasActiveFilters = (filters = EMPTY_HISTORY_FILTERS) => Boolean(
  String(filters.search || '').trim() || filters.material || filters.from || filters.to || (filters.recent && filters.recent !== 'all'),
)

// recent: 'all' | '7d' | '30d' | 'session' (only what was saved on this screen
// since it opened). Dates are inclusive yyyy-mm-dd keys. `labelOf` lets the
// search also match the material name as shown in the selected language.
export function filterMaterialHistory(entries = [], filters = EMPTY_HISTORY_FILTERS, { todayKey = '', touched = {}, labelOf = null } = {}) {
  const search = String(filters.search || '').trim().toLowerCase()
  const recentFrom = filters.recent === '7d' && todayKey ? shiftDateKey(todayKey, -6)
    : filters.recent === '30d' && todayKey ? shiftDateKey(todayKey, -29)
      : ''
  return entries.filter((entry) => {
    if (filters.material && entry.material !== filters.material) return false
    if (search) {
      const names = [entry.material, labelOf ? labelOf(entry.material) : ''].map((value) => String(value || '').toLowerCase())
      if (!names.some((name) => name.includes(search))) return false
    }
    if (filters.from && entry.workDate < filters.from) return false
    if (filters.to && entry.workDate > filters.to) return false
    if (recentFrom && entry.workDate < recentFrom) return false
    if (filters.recent === 'session' && !touched[entry.key]) return false
    return true
  })
}

// Totals for the entries on screen. Quantities are only added up for a single
// material: adding tons of aggregate to bags of cement means nothing. Cost is
// summed only over entries that carry an amount, and says so when some don't.
export function summarizeMaterialHistory(entries = []) {
  const materials = new Set(entries.map((entry) => entry.material))
  const priced = entries.filter((entry) => entry.amount != null)
  const summary = {
    entryCount: entries.length,
    materialCount: materials.size,
    totalCost: priced.reduce((sum, entry) => sum + entry.amount, 0),
    unpricedCount: entries.length - priced.length,
    quantity: null,
  }
  if (materials.size === 1) {
    const units = new Set(entries.map((entry) => entry.unit))
    if (units.size === 1) summary.quantity = { amount: entries.reduce((sum, entry) => sum + entry.quantity, 0), unit: entries[0].unit }
  }
  return summary
}

// Today's entry table, in words a site engineer can read: how many of the
// project's stock materials were used today and what they cost.
export function todayUsageSummary(materials = [], usedToday = {}) {
  let usedCount = 0
  let cost = 0
  for (const item of materials) {
    const used = toNumber(usedToday[item.material])
    if (used <= 0) continue
    usedCount += 1
    cost += used * toNumber(item.rate)
  }
  return { usedCount, stockCount: materials.length, cost }
}

// What a successful save changed, per material, compared with what the server
// held before it: 'added' when the day had none of it, 'updated' when an
// existing quantity changed. Unchanged and zero quantities are left out.
export function usageChanges(savedBefore = {}, submitted = {}) {
  const changes = {}
  for (const [material, value] of Object.entries(submitted)) {
    const next = toNumber(value)
    const previous = toNumber(savedBefore[material])
    if (next === previous || next <= 0) continue
    changes[material] = previous > 0 ? 'updated' : 'added'
  }
  return changes
}

// The saved material cost is an override only when it differs from what the
// day's usage adds up to. A record saved from the calculated figure keeps
// following the quantities instead of freezing at the first saved value.
export const isMaterialCostOverride = (savedCost, usageCost) => {
  const saved = toNumber(savedCost)
  return saved > 0 && Math.abs(saved - toNumber(usageCost)) > 0.005
}
