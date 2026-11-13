import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { setCsrfToken } from '../shared/api/apiClient.js'
import { resetSessionCheckForTests } from '../shared/auth/authSlice.js'

// What jsdom lacks and the screens use.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
for (const name of ['IntersectionObserver', 'ResizeObserver']) {
  if (!window[name]) {
    window[name] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  }
}
window.scrollTo = () => {}

beforeEach(() => {
  // Sign-out ends the session with a keepalive fetch; record it instead.
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  setCsrfToken('')
  resetSessionCheckForTests()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})
