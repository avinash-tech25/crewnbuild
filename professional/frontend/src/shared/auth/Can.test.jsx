import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { createAppStore } from '../../app/store.js'
import { anAccount } from '../../test/fakeServer.js'
import { initialAuthState } from './authSlice.js'
import Can from './Can.jsx'
import { accessRole } from './roles.js'

function renderAs(user, element) {
  const store = createAppStore({ auth: { ...initialAuthState, user, sessionStatus: user ? 'verified' : 'anonymous' } })
  return render(<Provider store={store}>{element}</Provider>)
}

const bookButton = (
  <Can permission="handoff:create">
    <button type="button">Book Technician</button>
  </Can>
)

describe('role-aware rendering', () => {
  it.each([
    ['OWNER', {}, true],
    ['ENGINEER', { engineer_profile: { specialization: 'Site Engineer' } }, true],
    ['ENGINEER', { engineer_profile: { specialization: 'Store Manager' } }, false],
    ['BUILDER', {}, false],
    ['SUPPLIER', {}, false],
    ['GLOBAL_SUPER_ADMIN', {}, false],
  ])('%s %o sees the Book Technician button: %s', (role, extra, visible) => {
    renderAs(anAccount({ role, ...extra }), bookButton)
    expect(Boolean(screen.queryByRole('button', { name: 'Book Technician' }))).toBe(visible)
  })

  it('shows nothing to a signed-out visitor', () => {
    renderAs(null, bookButton)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('can also gate by role', () => {
    renderAs(anAccount({ role: 'BUILDER' }), <Can roles={['BUILDER']}>builder only</Can>)
    expect(screen.getByText('builder only')).toBeInTheDocument()
  })

  it('maps an engineer to the category role the server uses', () => {
    expect(accessRole(anAccount({ role: 'ENGINEER', engineer_profile: { specialization: ' store manager ' } }))).toBe('STORE_MANAGER')
    expect(accessRole(anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer' } }))).toBe('SITE_ENGINEER')
    expect(accessRole(anAccount({ role: 'ENGINEER', engineer_profile: null }))).toBe('ENGINEER')
    expect(accessRole(anAccount({ role: 'BUILDER' }))).toBe('BUILDER')
  })
})
