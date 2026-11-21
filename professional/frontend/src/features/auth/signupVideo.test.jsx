import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedOut } from '../../test/renderApp.jsx'

const SLOW = { timeout: 15000 }
const PHONE_CONFIG = { 'GET /auth/phone/config': { data: { enabled: false, login: false, dial_code: '+91', digits: 10 } } }

// A controllable IntersectionObserver: the test decides when the panel comes on screen.
let observers = []
class FakeIntersectionObserver {
  constructor(callback) {
    this.callback = callback
    this.targets = []
    observers.push(this)
  }
  observe(target) { this.targets.push(target) }
  disconnect() { this.targets = [] }
  show() { this.callback(this.targets.map((target) => ({ target, isIntersecting: true }))) }
}

function prefersReducedMotion(reduce) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
}

let play
let load
beforeEach(() => {
  observers = []
  globalThis.IntersectionObserver = FakeIntersectionObserver
  play = vi.fn(() => Promise.resolve())
  load = vi.fn()
  window.HTMLMediaElement.prototype.play = play
  window.HTMLMediaElement.prototype.load = load
})

const sourcesOf = (video) => [...video.querySelectorAll('source')].map((s) => [s.getAttribute('src'), s.getAttribute('type')])

afterEach(() => {
  delete globalThis.IntersectionObserver
})

async function panelVideo() {
  installFakeServer({ ...PHONE_CONFIG })
  renderApp('/signup?role=OWNER', { auth: signedOut })
  return screen.findByTestId('auth-panel-video', {}, SLOW)
}

describe('the sign-up panel video', () => {
  it('shows the poster until the panel is on screen, then plays the video muted, inline and looping', async () => {
    prefersReducedMotion(false)
    const video = await panelVideo()
    expect(video).toHaveAttribute('poster', '/landing/mini-city.png')
    expect(video).not.toHaveAttribute('src')
    expect(sourcesOf(video)).toEqual([]) // nothing downloaded before the panel is on screen
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(true)
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('preload', 'none')
    expect(video).toHaveAttribute('aria-hidden', 'true')
    expect(play).not.toHaveBeenCalled()

    act(() => observers.forEach((observer) => observer.show()))
    // WebM first, MP4 for browsers without VP9; both from this site (CSP 'self').
    expect(sourcesOf(video)).toEqual([['/landing/signup.webm', 'video/webm'], ['/landing/signup.mp4', 'video/mp4']])
    expect(load).toHaveBeenCalled()
    expect(play).toHaveBeenCalled()
    // The scrim over it is the old sign-up page's: 0.55.
    expect(video.nextElementSibling.style.opacity).toBe('0.55')
  })

  it('shows only the poster to visitors who prefer reduced motion', async () => {
    prefersReducedMotion(true)
    const video = await panelVideo()
    act(() => observers.forEach((observer) => observer.show()))
    expect(video).toHaveAttribute('poster', '/landing/mini-city.png')
    expect(sourcesOf(video)).toEqual([])
    expect(play).not.toHaveBeenCalled()
  })
})
