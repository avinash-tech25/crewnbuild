/**
 * Regression guard: the landing hero's text must never be pushed past its container's edge.
 *
 * The hero section clips its overflow (so the background art can bleed), and a negative
 * start offset on the text column once pulled the heading, the role badge, the slide
 * buttons and the estimate button under that clip ("re you planning to build a house?").
 * jsdom has no layout engine, so this checks the cause: no element between any hero text
 * and the clipping section carries a negative margin, negative inset or negative
 * translate-x, on every slide. The real-browser measurement of every slide at 360, 768,
 * 1024, 1440 and 1920 px is in scripts/check-clipping.html.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedOut } from '../../test/renderApp.jsx'

const FIND = { timeout: 15000 }
// -ms-4, -ml-[12px], wide:-ms-…, -start-2, -left-3, -translate-x-…, ms-[calc(…-…)] that can go below 0.
const PUSHES_OUT = /(^|:)-(m[sl]|mx|start|left|inset-x|translate-x)-|(^|:)m[sl]-\[calc\(/

function offendingClasses(from, clip) {
  const found = []
  for (let node = from; node && node !== clip.parentElement; node = node.parentElement) {
    for (const name of String(node.className?.baseVal ?? node.className).split(/\s+/)) {
      if (PUSHES_OUT.test(name)) found.push(`${node.tagName.toLowerCase()}: ${name}`)
    }
  }
  return found
}

describe('the landing hero', () => {
  it('keeps every slide\'s heading, badge, slide buttons and estimate button inside the container', async () => {
    const user = userEvent.setup()
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    const heading = await screen.findByRole('heading', { level: 1 }, FIND)
    const clip = heading.closest('[class*="overflow-hidden"]')
    expect(clip).not.toBeNull()

    const tabs = within(clip).getAllByRole('tab')
    expect(tabs.length).toBeGreaterThan(1)
    for (const tab of tabs) {
      await user.click(tab)
      const lines = [
        screen.getByRole('heading', { level: 1 }),
        ...within(clip).getAllByRole('tab'),
        ...within(clip).getAllByRole('link'),
      ]
      for (const line of lines) expect(offendingClasses(line, clip)).toEqual([])
    }
  }, 30000)
})
