import { describe, expect, it } from 'vitest'
import { CHOSEN_PLACE_DAYS, loadChosenPlace, saveChosenPlace } from './weatherFormat.js'

function memoryStorage() {
  const items = new Map()
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    size: () => items.size,
  }
}

const DAY = 24 * 60 * 60 * 1000
const PLACE = { name: 'Gachibowli', latitude: 17.44, longitude: 78.35 }

describe('the weather place a technician chose', () => {
  it('is kept for 30 days, then forgotten', () => {
    expect(CHOSEN_PLACE_DAYS).toBe(30)
    const storage = memoryStorage()
    const saved = Date.UTC(2026, 10, 1)
    saveChosenPlace(PLACE, storage, saved)
    expect(loadChosenPlace(storage, saved + 29 * DAY)).toEqual({ ...PLACE, source: 'CHOSEN' })
    expect(loadChosenPlace(storage, saved + 31 * DAY)).toBeNull()
    expect(storage.size()).toBe(0) // removed from the browser, not only ignored
  })

  it('forgets a place saved before choices carried a date', () => {
    const storage = memoryStorage()
    storage.setItem('partner_weather_place', JSON.stringify(PLACE)) // the old format: no savedAt
    expect(loadChosenPlace(storage)).toBeNull()
    expect(storage.size()).toBe(0)
  })
})
