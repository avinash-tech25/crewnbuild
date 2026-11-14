// A copy of the Professional app's components/weather/weatherCache.js (Partner shares no code with the Professional app); keep the two alike.
// One copy of each weather answer for the whole page: the header indicator is
// mounted again on every page change, and without this each mount would ask the
// server again. A fresh answer is reused for `maxAgeMs`; a request already under
// way is shared rather than repeated. Neither a failure nor an answer saying the
// weather is unavailable is kept, so the next look asks again.

const entries = new Map()

const usable = (value) => value?.status?.available !== false

export function cachedWeather(key, load, { maxAgeMs = 5 * 60 * 1000, force = false, now = Date.now, keep = usable } = {}) {
  const entry = entries.get(key)
  if (!force && entry?.promise) return entry.promise
  if (!force && entry && 'value' in entry && now() - entry.at < maxAgeMs) return Promise.resolve(entry.value)
  const promise = Promise.resolve()
    .then(load)
    .then((value) => {
      if (keep(value)) entries.set(key, { at: now(), value })
      else entries.delete(key)
      return value
    }, (error) => {
      entries.delete(key)
      throw error
    })
  entries.set(key, { ...entry, promise })
  return promise
}

// Forget every answer whose key starts with `prefix` (all of them without one).
export function forgetWeather(prefix = '') {
  for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key)
}
