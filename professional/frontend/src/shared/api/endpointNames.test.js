import { describe, expect, it } from 'vitest'

// Every feature injects its endpoints into the one API. RTK Query keeps the first of two
// endpoints with the same name and drops the second, so a duplicate silently sends one
// feature's calls to another's address. The names must be unique across the app.
const SOURCES = import.meta.glob('../../**/*.js', { query: '?raw', import: 'default', eager: true })

describe('API endpoint names', () => {
  it('are unique across every feature', () => {
    const owners = new Map()
    const duplicates = []
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.js') || !source.includes('injectEndpoints')) continue
      const block = source.slice(source.indexOf('injectEndpoints'))
      for (const [, name] of block.matchAll(/^\s{4}(\w+): build\.(?:query|mutation)/gm)) {
        if (owners.has(name)) duplicates.push(`${name}: ${owners.get(name)} and ${path}`)
        else owners.set(name, path)
      }
    }
    expect(owners.size).toBeGreaterThan(100)
    expect(duplicates).toEqual([])
  })
})
