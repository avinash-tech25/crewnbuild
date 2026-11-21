import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderApp, signedOut } from '../../test/renderApp.jsx'
import { STILL_LOADING_DELAY } from '../../shared/ui/BrandLoader.jsx'

// The Crew&Build loader (ported from the old app) while a lazy page's code downloads.
describe('the loading screen', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the brand loader while a lazy page loads, then says it is still loading', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // The landing page is lazy: on the first render only the Suspense fallback is there.
    renderApp('/', { auth: signedOut })

    const loader = screen.getByRole('status', { name: 'Loading' })
    expect(loader).toHaveClass('brand-loader--page')
    expect(loader.querySelector('.brand-loader__visual')).toHaveAttribute('aria-hidden', 'true')
    expect(loader.querySelector('svg.crew-motion')).not.toBeNull()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('Still loading the application…')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(STILL_LOADING_DELAY - 1))
    expect(screen.queryByText('Still loading the application…')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('Still loading the application…')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})
