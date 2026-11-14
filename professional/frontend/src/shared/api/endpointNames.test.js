import { describe, expect, it } from 'vitest'
import { createAppStore } from '../../app/store.js'
import { createSubscriptionOrder } from '../../features/billing/subscriptionApi.js'
import { createPaymentOrder } from '../../features/billing/technicianPaymentsApi.js'
import { installFakeServer } from '../../test/fakeServer.js'

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

  it('keep a technician payment and a builder subscription on their own addresses', async () => {
    createAppStore()
    const server = installFakeServer({
      'POST /payments/orders': { data: { payment_order_id: 'tech' } },
      'POST /subscriptions/orders': { data: { subscription_payment_id: 'plan' } },
    })
    await createPaymentOrder('0190a8b2-4c1e-7aa0-9f00-0000000000aa')
    await createSubscriptionOrder('PROFESSIONAL', 'MONTHLY')
    expect(server.calls('POST /payments/orders')).toHaveLength(1)
    expect(server.calls('POST /subscriptions/orders')).toHaveLength(1)
  })
})
