import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { BUILDER_ID, OWNER, PROJECT_ID, REQUEST_ID, aProject, aQuotation, ownerDashboardServer } from './ownerTestData.js'

const FIND = { timeout: 15000 }
const CONVERSATION_ID = '0190a8b2-4c1e-7aa0-9f00-0000000000d1'

const aConversation = () => ({
  id: CONVERSATION_ID,
  title: 'Asha Rao and Ravi Builders',
  participant: { id: BUILDER_ID, name: 'Ravi Builders', primary_name: 'Ravi Builders', role: 'BUILDER', profile_image_url: null },
  latest_message: 'Shall we meet on site?',
  latest_message_time: '10:00 AM',
  latest_message_at: '2026-11-02T10:00:00+05:30',
  unread_count: 0,
})

function openOwner(path, routes = {}) {
  const server = installFakeServer(ownerDashboardServer(routes))
  const view = renderApp(path, { auth: signedInAs(OWNER) })
  return { server, ...view }
}

describe('House Owner dashboard: access', () => {
  it.each(['/owner', '/owner/projects', '/owner/messages', '/owner/profile', '/owner/buy-sell'])('%s asks a signed-out visitor to sign in first', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: path })
  })

  it.each([
    ['BUILDER', {}, '/contractor'],
    ['SUPPLIER', {}, '/supplier'],
    ['ENGINEER', { engineer_profile: { specialization: 'Site Engineer' } }, '/engineer'],
    ['GLOBAL_SUPER_ADMIN', {}, '/admin'],
  ])('is closed to a %s, who goes to their own home', async (role, extra, home) => {
    installFakeServer({})
    renderApp('/owner/projects', { auth: signedInAs(anAccount({ role, ...extra })) })
    await waitFor(() => expect(location.current.pathname).toBe(home))
  })
})

describe('House Owner dashboard: home', () => {
  it('greets the owner and shows their projects from the server', async () => {
    const { server } = openOwner('/owner', { 'GET /owners/projects': { data: [aProject()] } })
    expect(await screen.findByText('Welcome, Asha Rao!', {}, FIND)).toBeInTheDocument()
    expect((await screen.findAllByText('Rao Family Home')).length).toBeGreaterThan(0)
    expect(server.calls('GET /owners/projects').length).toBeGreaterThan(0)
  })

  it('offers Book Technician to the owner and opens the Partner trade page for it', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue({ closed: false, focus: vi.fn(), postMessage: vi.fn() })
    openOwner('/owner')
    await user.click(await screen.findByTestId('owner-trade-plumber', {}, FIND))
    expect(open).toHaveBeenCalledWith('http://partner.test/book-technician/plumber', 'crewnbuild-partner-booking')
    open.mockRestore()
  })
})

describe('House Owner dashboard: projects', () => {
  it('lists the projects and deletes one after the owner confirms', async () => {
    const user = userEvent.setup()
    let projects = [aProject()]
    const { server } = openOwner('/owner/projects', {
      'GET /owners/projects': () => ({ data: projects }),
      [`DELETE /projects/${PROJECT_ID}`]: () => {
        projects = []
        return { data: { message: 'Project deleted' } }
      },
    })
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Delete$/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Delete/ }))
    await waitFor(() => expect(server.calls(`DELETE /projects/${PROJECT_ID}`)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Rao Family Home')).not.toBeInTheDocument())
  })

  it("shows a builder's quotation on the project and sends the owner's counter offer", async () => {
    const user = userEvent.setup()
    const { server } = openOwner(`/owner/projects/${PROJECT_ID}/requests`, {
      'GET /owners/projects': { data: [aProject()] },
      'GET /project-requests/incoming': { data: [aQuotation()] },
      [`GET /projects/${PROJECT_ID}/award`]: { data: { award: null } },
      [`GET /projects/${PROJECT_ID}/photos`]: { data: [] },
      'GET /contractors/nearby': { data: [] },
      'POST /project-requests/assign': { data: { message: 'Counter offer sent' } },
    })
    expect(await screen.findByText('Ravi Builders', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText(/42,00,000/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Negotiate' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('spinbutton'), '4000000')
    await user.type(within(dialog).getByRole('textbox'), 'Within budget please')
    await user.click(within(dialog).getByRole('button', { name: 'SEND COUNTER OFFER' }))
    await waitFor(() => expect(server.calls('POST /project-requests/assign')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /project-requests/assign')[0].data)).toEqual({
      request_id: REQUEST_ID,
      offer_amount: 4000000,
      offer_note: 'Within budget please',
    })
  })
})

describe('House Owner dashboard: live camera', () => {
  it('opens the project camera panel when its tab is chosen (downloaded only then)', async () => {
    const user = userEvent.setup()
    const { server } = openOwner(`/owner/projects/${PROJECT_ID}/requests`, {
      'GET /owners/projects': { data: [aProject()] },
      [`GET /projects/${PROJECT_ID}/award`]: { data: { award: null } },
      [`GET /projects/${PROJECT_ID}/photos`]: { data: [] },
      'GET /contractors/nearby': { data: [] },
      'GET /project-requests/incoming': { data: [aQuotation()] },
      [`GET /cctv/projects/${PROJECT_ID}/camera-setup`]: { data: { configured: false, verified: false, project_title: 'Rao Family Home' } },
    })
    await user.click(await screen.findByRole('tab', { name: 'Live Camera' }, FIND))
    await waitFor(() => expect(server.calls(`GET /cctv/projects/${PROJECT_ID}/camera-setup`)).toHaveLength(1), FIND)
  })
})

describe('House Owner dashboard: messages', () => {
  it('opens a conversation and sends a message', async () => {
    const user = userEvent.setup()
    const { server } = openOwner('/owner/messages', {
      'GET /messages/conversations': { data: [aConversation()] },
      [`GET /messages/conversation/${CONVERSATION_ID}`]: { data: [] },
      'POST /messages/send': { data: { id: '0190a8b2-4c1e-7aa0-9f00-0000000000e1' } },
    })
    await user.click((await screen.findAllByText('Ravi Builders', {}, FIND))[0])
    await user.type(await screen.findByPlaceholderText('Type a message'), 'Hello Ravi')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(server.calls('POST /messages/send')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /messages/send')[0].data)).toEqual({
      conversation_id: CONVERSATION_ID,
      body: 'Hello Ravi',
      message_type: 'TEXT',
    })
  })
})

describe('House Owner dashboard: profile and Buy & Sell', () => {
  it("shows the owner's own details", async () => {
    openOwner('/owner/profile', { 'GET /auth/phone/config': { data: { enabled: false } } })
    expect(await screen.findByText('Personal Information', {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('asha@example.in').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Delete Account' })).toBeInTheDocument()
  })

  it('lists the published properties from the server', async () => {
    const { server } = openOwner('/owner/buy-sell', {
      'GET /property-listings': {
        data: { property_types: [], cities: [], listings: [{
          id: '0190a8b2-4c1e-7aa0-9f00-0000000000f1',
          title: 'Sunny 2BHK in Indiranagar',
          property_type: 'APARTMENT',
          listing_type: 'SALE',
          status: 'PUBLISHED',
          price: 9500000,
          city: 'Bengaluru',
          pincode: '560038',
          bedrooms: 2,
          area_sqft: 1100,
          image_urls: [],
          is_mine: false,
          created_at: '2026-11-03T10:00:00+05:30',
        }] },
      },
    })
    expect(await screen.findByText('Sunny 2BHK in Indiranagar', {}, FIND)).toBeInTheDocument()
    expect(server.calls('GET /property-listings').length).toBeGreaterThan(0)
  })
})
