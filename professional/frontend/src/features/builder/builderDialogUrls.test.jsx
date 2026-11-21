/**
 * Builder dialogs in the address: a homeowner lead's details (?client=<project uuid>) and
 * a site engineer's profile (?engineer=<user uuid>). Opening adds a history entry, Back
 * closes it, and the address alone (a refresh or a link) opens it again.
 */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs } from '../../test/renderApp.jsx'
import { BUILDER, PROJECT_ID, anOwnerLead, builderDashboardServer } from './builderTestData.js'

const FIND = { timeout: 15000 }
const ENGINEER_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000e1'
const ENGINEER = {
  user_id: ENGINEER_ID, name: 'Kiran Kumar', pincode: '560001', address: '1 MG Road, Bengaluru', experience_years: 4,
  project_count: 0, assigned_projects: [], specialization: 'Site Engineer', created_at: '2026-11-01T10:00:00+05:30',
}

function open(path) {
  installFakeServer(builderDashboardServer({
    'GET /contractors/find-clients': { data: [anOwnerLead()] },
    'GET /engineers/my-team': { data: { active: [ENGINEER], pending_requests: [], invitations: [], outgoing_requests: [] } },
  }))
  renderApp(path, { auth: signedInAs(BUILDER) })
}

const param = (name) => new URLSearchParams(location.current.search).get(name)
const dialogShown = () => waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument(), FIND)

describe('Builder dialogs in the address', () => {
  it("a homeowner lead: ?client=<uuid>, Back closes it, the link reopens it", async () => {
    const user = userEvent.setup()
    open('/contractor/find-clients')
    await user.click(await screen.findByText('Asha Rao', {}, FIND))
    await waitFor(() => expect(param('client')).toBe(PROJECT_ID))
    await dialogShown()

    act(() => history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(param('client')).toBeNull()
  })

  it('opens a homeowner lead straight from the address', async () => {
    open(`/contractor/find-clients?client=${PROJECT_ID}`)
    await dialogShown()
  })

  it("a site engineer's profile: ?engineer=<uuid>, Back closes it, the link reopens it", async () => {
    const user = userEvent.setup()
    open('/contractor/my-site-engineers')
    const [name] = await screen.findAllByText('Kiran Kumar', {}, FIND)
    await user.click(name)
    await waitFor(() => expect(param('engineer')).toBe(ENGINEER_ID))
    await dialogShown()

    act(() => history.back())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it("opens a site engineer's profile straight from the address", async () => {
    open(`/contractor/my-site-engineers?engineer=${ENGINEER_ID}`)
    await dialogShown()
  })
})
