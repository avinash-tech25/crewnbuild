/**
 * A phone number is never shown as a name. The helper itself, and the two screens where
 * a builder's company name saved as his phone number used to show it: the Site
 * Engineer's Discover Builders card and the builder's own Profile Settings heading.
 */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, builderDashboardServer } from '../../features/builder/builderTestData.js'
import { BUILDER_ID, SITE_ENGINEER, engineerDashboardServer } from '../../features/engineer/engineerTestData.js'
import { displayName, looksLikePhone } from './displayName.js'

const FIND = { timeout: 15000 }
const PHONE = '9640677606'

describe('displayName', () => {
  it.each([
    ['9640677606', true],
    ['+91 96406 77606', true],
    ['(080) 2345-6789', true],
    ['Shakra', false],
    ['Builders 24x7', false],
    ['12345', false],
    ['', false],
    [null, false],
  ])('%s looks like a phone number: %s', (value, expected) => {
    expect(looksLikePhone(value)).toBe(expected)
  })

  it('takes the company name, else the person, never a phone number', () => {
    expect(displayName('Shakra Constructions', 'Shakra')).toBe('Shakra Constructions')
    expect(displayName(PHONE, 'Shakra')).toBe('Shakra')
    expect(displayName('', '  ', 'Shakra')).toBe('Shakra')
    expect(displayName(PHONE, '+91 96406 77606')).toBe('')
  })
})

describe('a company name saved as a phone number', () => {
  it("shows the builder's own name on the Site Engineer's Discover Builders card", async () => {
    const user = userEvent.setup()
    const builder = { user_id: BUILDER_ID, name: 'Shakra', company_name: PHONE, pincode: '560001', experience_years: 5, completed_projects: 2, rating: 0 }
    installFakeServer(engineerDashboardServer({ 'GET /contractors/nearby': { data: [builder] } }))
    renderApp('/engineer/find-opportunities', { auth: signedInAs(SITE_ENGINEER) })
    await user.click(await screen.findByRole('button', { name: 'Discover Builders' }, FIND))
    expect(await screen.findByText('Shakra', {}, FIND)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(PHONE)
  })

  it("shows the builder's own name as the heading of his Profile Settings", async () => {
    installFakeServer(
      builderDashboardServer({
        [`GET /contractors/${BUILDER.id}/profile`]: {
          data: { id: BUILDER.id, user_id: BUILDER.id, name: 'Shakra', company_name: PHONE, role: 'BUILDER', projects: [], reviews: [] },
        },
      }),
    )
    renderApp('/contractor/profile-settings', { auth: signedInAs(BUILDER) })
    const heading = await screen.findByRole('heading', { name: 'Shakra' }, FIND)
    expect(within(heading).queryByText(PHONE)).not.toBeInTheDocument()
  })
})
