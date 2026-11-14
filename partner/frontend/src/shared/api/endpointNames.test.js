import { describe, expect, it } from 'vitest'

// Every feature injects its endpoints into the one API. RTK Query keeps the first of two
// endpoints with the same name and drops the second, so a duplicate silently sends one
// feature's calls to another's address. The names must be unique across the app, and
// every requester endpoint must go out on the booking client, never the technician's.
const SOURCES = import.meta.glob('../../**/*.js', { query: '?raw', import: 'default', eager: true })

function endpoints() {
  const found = []
  for (const [path, source] of Object.entries(SOURCES)) {
    if (path.endsWith('.test.js') || !source.includes('injectEndpoints')) continue
    const block = source.slice(source.indexOf('injectEndpoints'))
    for (const match of block.matchAll(/^\s{4}(\w+): build\.(?:query|mutation)\(([\s\S]*?)\),?\s*$/gm)) {
      found.push({ name: match[1], body: match[2], path })
    }
  }
  return found
}

describe('API endpoint names', () => {
  it('are unique across every feature', () => {
    const owners = new Map()
    const duplicates = []
    for (const { name, path } of endpoints()) {
      if (owners.has(name)) duplicates.push(`${name}: ${owners.get(name)} and ${path}`)
      else owners.set(name, path)
    }
    expect(owners.size).toBeGreaterThan(40)
    expect(duplicates).toEqual([])
  })

  it("send every requester endpoint with the booking session, and every technician one without it", () => {
    const wrong = endpoints().filter(({ name, body }) => {
      const requesterCall = /^requester/.test(name)
      const saysRequester = body.includes("principal: 'requester'")
      return requesterCall !== saysRequester
    })
    expect(wrong.map(({ name }) => name)).toEqual([])
  })
})
