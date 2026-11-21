/**
 * The dashboards' polls rest in a hidden tab: no tick runs while document.visibilityState
 * is 'hidden', and the poll runs once as soon as the tab is visible again.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useVisibleInterval from './useVisibleInterval.js'

let visibility = 'visible'
const setVisibility = (value) => {
  visibility = value
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('useVisibleInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    visibility = 'visible'
  })

  it('polls on its interval while visible, never on mount', () => {
    const poll = vi.fn()
    renderHook(() => useVisibleInterval(poll, 10000))
    expect(poll).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(30000) })
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('does not poll while hidden, and polls once on becoming visible', () => {
    const poll = vi.fn()
    renderHook(() => useVisibleInterval(poll, 10000))
    setVisibility('hidden')
    act(() => { vi.advanceTimersByTime(60000) })
    expect(poll).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(poll).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(10000) })
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('uses the latest callback, and stops when disabled or unmounted', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ callback, enabled }) => useVisibleInterval(callback, 5000, { enabled }), {
      initialProps: { callback: first, enabled: true },
    })
    rerender({ callback: second, enabled: true })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    rerender({ callback: second, enabled: false })
    act(() => { vi.advanceTimersByTime(20000) })
    setVisibility('hidden')
    setVisibility('visible')
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
  })
})
