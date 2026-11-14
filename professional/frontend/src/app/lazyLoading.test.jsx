import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LazyConstructionVilla from '../features/public-site/components/landing/LazyConstructionVilla.jsx'

// The real villa needs WebGL; a stand-in shows whether it was loaded.
vi.mock('../features/public-site/components/landing/ConstructionVilla.jsx', () => ({
  default: () => <div data-testid="villa-scene" />,
}))
vi.mock('hls.js', () => ({ default: { isSupported: () => true } }))

describe('the 3D villa on the home page', () => {
  const realObserver = window.IntersectionObserver
  afterEach(() => {
    window.IntersectionObserver = realObserver
  })

  it('holds its place with an empty box, and loads only when it comes near the screen', async () => {
    let reportVisibility = null
    window.IntersectionObserver = class {
      constructor(callback) {
        reportVisibility = (isIntersecting) => callback([{ isIntersecting }])
      }
      observe() {}
      disconnect() {}
    }
    const { container } = render(<LazyConstructionVilla isNight={false} />)
    expect(screen.queryByTestId('villa-scene')).not.toBeInTheDocument()
    expect(container.querySelector('.h-\\[420px\\]')).toBeInTheDocument()

    act(() => reportVisibility(false))
    expect(screen.queryByTestId('villa-scene')).not.toBeInTheDocument()

    act(() => reportVisibility(true))
    expect(await screen.findByTestId('villa-scene')).toBeInTheDocument()
  })
})

describe('the camera video library', () => {
  it('is loaded on first playback and then reused', async () => {
    const { loadHls } = await import('../features/cameras/loadHls.js')
    const first = await loadHls()
    expect(first.isSupported()).toBe(true)
    expect(await loadHls()).toBe(first)
  })
})
