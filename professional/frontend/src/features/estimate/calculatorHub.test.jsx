/**
 * The calculator hub keeps the chosen calculator in the address (?calc=paint), so a
 * refresh or a link opens the same one and Back returns to the one before. The default
 * (the construction estimate) keeps the short /estimate, and an unknown word reads as it.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedOut } from '../../test/renderApp.jsx'

const FIND = { timeout: 15000 }
const card = (name) => screen.findByRole('button', { name }, FIND)

function openHub(path) {
  installFakeServer({})
  renderApp(path, { auth: signedOut })
}

describe('Calculator hub in the address', () => {
  it('opens the calculator the address names', async () => {
    openHub('/estimate?calc=paint')
    expect(await card('Paint Calculator')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Free Construction Estimate' })).not.toHaveAttribute('aria-current')
  })

  it('records a choice, and Back returns to the one before', async () => {
    const user = userEvent.setup()
    openHub('/estimate')
    expect(await card('Free Construction Estimate')).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: 'Paint Calculator' }))
    expect(location.current.search).toBe('?calc=paint')
    expect(screen.getByRole('button', { name: 'Paint Calculator' })).toHaveAttribute('aria-current', 'page')

    act(() => history.back())
    await waitFor(() => expect(location.current.search).toBe(''))
    expect(screen.getByRole('button', { name: 'Free Construction Estimate' })).toHaveAttribute('aria-current', 'page')
  })

  it('reads an unknown calculator as the construction estimate', async () => {
    openHub('/estimate?calc=nonsense')
    expect(await card('Free Construction Estimate')).toHaveAttribute('aria-current', 'page')
  })
})
