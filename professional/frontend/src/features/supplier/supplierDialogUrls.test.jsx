/**
 * Supplier dialogs in the address: a client's profile opened from Find Clients is
 * ?client=<uuid> (the project's, or the client's own id when the card names no project),
 * so Back closes it and a refresh or a link opens it again. A tab count of 0 keeps its
 * place (hidden), so a count arriving never moves the tabs.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER_ID, MATERIAL, SUPPLIER, aBuilderClient, supplierDashboardServer } from './supplierTestData.js'

const FIND = { timeout: 15000 }

function openSupplier(path) {
  installFakeServer(supplierDashboardServer(MATERIAL, {
    'GET /suppliers/find-clients': { data: [aBuilderClient()] },
  }))
  renderApp(path, { auth: signedInAs(SUPPLIER) })
}

// The client profile window (the shared dialog layer).
const profileWindow = () => document.querySelector('.z-dialog')

describe('Supplier client profile in the address', () => {
  it('opens with ?client=<uuid>, closes with Back', async () => {
    const user = userEvent.setup()
    openSupplier('/supplier/find-clients')
    const cards = await screen.findByTestId('supplier-builder-client-cards', {}, FIND)
    await user.click(within(cards).getAllByText('Ravi Builders')[0])
    await waitFor(() => expect(new URLSearchParams(location.current.search).get('client')).toBe(BUILDER_ID))
    await waitFor(() => expect(profileWindow()).not.toBeNull())

    act(() => history.back())
    await waitFor(() => expect(profileWindow()).toBeNull())
    expect(location.current.search).toBe('')
  })

  it('opens the profile straight from the address (a refresh or a link)', async () => {
    openSupplier(`/supplier/find-clients?client=${BUILDER_ID}`)
    await waitFor(() => expect(profileWindow()).not.toBeNull(), FIND)
  })
})

describe('Supplier tab counts', () => {
  it('keeps the slot of a count of 0, hidden from sight and from screen readers', async () => {
    openSupplier('/supplier/find-clients')
    await screen.findByTestId('supplier-builder-client-cards', {}, FIND)
    const owners = screen.getByRole('button', { name: 'Homeowner' })
    const emptyCount = within(owners).getByText('0')
    expect(emptyCount).toHaveClass('invisible', 'tabular-nums')
    expect(emptyCount).toHaveAttribute('aria-hidden', 'true')
    const builders = screen.getByRole('button', { name: 'Builder1' })
    expect(within(builders).getByText('1')).not.toHaveClass('invisible')
  })
})
