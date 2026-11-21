import { act, render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import useUrlDialog from './useUrlDialog.js'
import useUrlState from './useUrlState.js'

const PRODUCT = '0190a8b2-4c1e-7aa0-9f00-0000000000a1'
const seen = { search: '', closeProduct: null, setTab: null }

function Probe() {
  const [, , closeProduct] = useUrlDialog('product')
  const [, setTab] = useUrlState('tab', 'suppliers')
  seen.search = useLocation().search
  seen.closeProduct = closeProduct
  seen.setTab = setTab
  return null
}

describe('two address changes in one tick', () => {
  it('both apply: closing the product dialog and opening the Cart tab', () => {
    render(
      <MemoryRouter initialEntries={[`/engineer/my-supplies?tab=suppliers&product=${PRODUCT}`]}>
        <Probe />
      </MemoryRouter>,
    )
    act(() => {
      // What "Send buy request" does: close the dialog in place, then the parent opens the cart.
      seen.closeProduct({ replace: true })
      seen.setTab('cart')
    })
    const params = new URLSearchParams(seen.search)
    expect(params.get('tab')).toBe('cart')
    expect(params.has('product')).toBe(false) // not brought back by the second change
  })
})
