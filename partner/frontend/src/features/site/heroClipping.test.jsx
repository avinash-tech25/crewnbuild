/**
 * Regression guard: the landing hero's text must never be pushed past its container's edge.
 *
 * The hero section clips its overflow, and a negative start offset on the text column
 * (lg:-ms-8 xl:-ms-12) pulled the heading and the trade tabs under that clip at 1440 px
 * during the entrance animation. jsdom has no layout engine, so this checks the cause: no
 * element between any hero text and the clipping section carries a negative margin, inset
 * or translate-x, on every slide. The real-browser measurement of every slide at 360, 768,
 * 1024, 1440 and 1920 px is in scripts/check-clipping.html.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedOut } from '../../test/renderApp.jsx'

const FIND = { timeout: 8000 }
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
  it('keeps every slide\'s heading and trade tabs inside the container', async () => {
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
      const lines = [screen.getByRole('heading', { level: 1 }), ...within(clip).getAllByRole('tab'), ...within(clip).queryAllByRole('link')]
      for (const line of lines) expect(offendingClasses(line, clip)).toEqual([])
    }
  }, 30000)
})
