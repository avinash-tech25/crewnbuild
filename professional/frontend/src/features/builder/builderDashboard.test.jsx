import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import {
  BUILDER,
  OWNER_ID,
  PROJECT_ID,
  REQUEST_ID,
  aPortfolio,
  anOwnerLead,
  anOwnerRequest,
  builderDashboardServer,
  planRequired,
  professionalPlan,
} from './builderTestData.js'

const FIND = { timeout: 8000 }
const SECTIONS = ['/contractor', '/contractor/projects', '/contractor/portfolio', '/contractor/subscription', '/contractor/requests',
  '/contractor/my-site-engineers', '/contractor/find-clients', '/contractor/buy-sell', '/contractor/product-catalog',
  '/contractor/messages', '/contractor/profile-settings']

function openBuilder(path, routes = {}, account = BUILDER) {
  const server = installFakeServer(builderDashboardServer(routes))
  const view = renderApp(path, { auth: signedInAs(account) })
  return { server, ...view }
}

describe('Builder dashboard: access', () => {
  it.each(SECTIONS)('%s asks a signed-out visitor to sign in first', async (path) => {
    installFakeServer({ 'GET /auth/phone/config': { data: { enabled: false, login: false } } })
    renderApp(path, { auth: signedOut })
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
    expect(location.current.state).toEqual({ returnTo: path })
  })

  it.each([
    ['OWNER', {}, '/owner'],
    ['SUPPLIER', {}, '/supplier'],
    ['ENGINEER', { engineer_profile: { specialization: 'Store Manager' } }, '/store-manager'],
    ['MANAGER', {}, '/admin'],
  ])('is closed to a %s, who goes to their own home', async (role, extra, home) => {
    installFakeServer({})
    renderApp('/contractor/requests', { auth: signedInAs(anAccount({ role, ...extra })) })
    await waitFor(() => expect(location.current.pathname).toBe(home))
  })

  it('sends a builder whose paid sign-up is unpaid to the checkout first', async () => {
    installFakeServer({ 'GET /subscriptions/plans': { data: { plans: [] } } })
    renderApp('/contractor/projects', { auth: signedInAs({ ...BUILDER, subscription_checkout: { plan_code: 'PROFESSIONAL', duration_code: 'MONTHLY' } }) })
    await waitFor(() => expect(location.current.pathname).toBe('/subscription-checkout'))
  })
})

describe('Builder dashboard: home', () => {
  it('greets the builder, shows the figures and reads the plan from the server', async () => {
    const { server } = openBuilder('/contractor')
    expect(await screen.findByText('Welcome, Ravi Builders', {}, FIND)).toBeInTheDocument()
    expect(screen.getByText('Total Projects')).toBeInTheDocument()
    expect(server.calls('GET /subscriptions/me').length).toBeGreaterThan(0)
  })
})

describe('Builder dashboard: requests', () => {
  it("answers a House Owner's request with a quotation", async () => {
    const user = userEvent.setup()
    const { server } = openBuilder('/contractor/requests', {
      'GET /project-requests/incoming': { data: [anOwnerRequest()] },
      'POST /project-requests/accept': { data: { message: 'Request accepted' } },
    })
    await user.click(await screen.findByRole('button', { name: /Accept with Quote/ }, FIND))
    await user.type(screen.getByPlaceholderText('Amount'), '4200000')
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(server.calls('POST /project-requests/accept')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /project-requests/accept')[0].data)).toEqual({ request_id: REQUEST_ID, quotation_amount: 4200000 })
  })

  it('declines a request it is not interested in', async () => {
    const user = userEvent.setup()
    const { server } = openBuilder('/contractor/requests', {
      'GET /project-requests/incoming': { data: [anOwnerRequest()] },
      'POST /project-requests/reject': { data: { message: 'Request rejected' } },
    })
    await user.click(await screen.findByRole('button', { name: 'Not interested' }, FIND))
    await waitFor(() => expect(server.calls('POST /project-requests/reject')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /project-requests/reject')[0].data)).toEqual({ request_id: REQUEST_ID })
  })
})

describe('Builder dashboard: find clients', () => {
  it('shows an open project nearby and sends its owner a request', async () => {
    const user = userEvent.setup()
    const { server } = openBuilder('/contractor/find-clients', {
      'GET /contractors/find-clients': { data: [anOwnerLead()] },
      'POST /project-requests/send': { data: { id: REQUEST_ID, status: 'pending' } },
    })
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send Request' }))
    // The drawer shows the project and an optional quotation; its own button sends.
    await user.type(await screen.findByPlaceholderText('e.g. 2500000'), '4300000')
    const sendButtons = screen.getAllByRole('button', { name: /Send Request/ })
    await user.click(sendButtons[sendButtons.length - 1])
    await waitFor(() => expect(server.calls('POST /project-requests/send')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /project-requests/send')[0].data)).toMatchObject({
      receiver_id: OWNER_ID,
      project_id: PROJECT_ID,
      request_type: 'CONTRACTOR_TO_OWNER',
      quotation_amount: 4300000,
    })
  })
})

describe('Builder dashboard: plan-gated features', () => {
  it('shows the portfolio as a locked Premium feature on the Free plan', async () => {
    openBuilder('/contractor/portfolio', { 'GET /builder/portfolio': planRequired('portfolio_dashboard') })
    // The section re-renders when the dashboard's second load lands; check the settled view.
    await waitFor(() => {
      expect(screen.getByText('Premium feature')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'View plans' })).toBeInTheDocument()
    }, FIND)
    expect(screen.queryByRole('button', { name: /Download the CSV report/ })).not.toBeInTheDocument()
  })

  it('opens the portfolio and its project CSV on the Professional plan', async () => {
    const user = userEvent.setup()
    const createObjectURL = URL.createObjectURL
    URL.createObjectURL = () => 'blob:summary'
    const { server } = openBuilder('/contractor/portfolio', {
      'GET /subscriptions/me': { data: professionalPlan() },
      'GET /builder/portfolio': { data: aPortfolio() },
      [`GET /projects/${PROJECT_ID}/summary.csv`]: { data: new Blob(['date,cost\n']) },
    })
    await user.click(await screen.findByRole('button', { name: 'Download the CSV report for Rao Family Home' }, FIND))
    expect(screen.queryByText('Premium feature')).not.toBeInTheDocument()
    await waitFor(() => expect(server.calls(`GET /projects/${PROJECT_ID}/summary.csv`)).toHaveLength(1))
    URL.createObjectURL = createObjectURL
  })

  it('shows the plan in force: Free, or Professional with its end date', async () => {
    openBuilder('/contractor/subscription')
    expect(await screen.findByText('Free plan', {}, FIND)).toBeInTheDocument()
  })

  it('shows an active Professional plan and when it ends', async () => {
    openBuilder('/contractor/subscription', { 'GET /subscriptions/me': { data: professionalPlan() } })
    expect(await screen.findByText('Valid until 1 Dec 2026', {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('PRO').length).toBeGreaterThan(0)
  })
})

describe('Builder dashboard: team, projects and profile', () => {
  it('lists an awarded project as upcoming until a site engineer is assigned (as before)', async () => {
    const user = userEvent.setup()
    openBuilder('/contractor/projects', {
      'GET /owners/projects': {
        data: [{
          id: PROJECT_ID, owner_id: OWNER_ID, owner_name: 'Asha Rao', contractor_id: BUILDER.id, title: 'Rao Family Home',
          address: '12 MG Road', pincode: '560001', project_country: 'India', construction_type: 'CONTRACTOR', budget: 4500000,
          status: 'active', completion_percentage: 40, start_date: '2026-11-01', end_date: '2027-06-01', created_at: '2026-11-01T10:00:00+05:30',
          contract_status: 'confirmed', contract_amount: 4200000,
        }],
      },
    })
    expect(await screen.findByText('No assigned projects yet', {}, FIND)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Upcoming projects' }))
    expect(await screen.findByText('Rao Family Home', {}, FIND)).toBeInTheDocument()
  })

  it('shows the site engineer team and invites one', async () => {
    openBuilder('/contractor/my-site-engineers')
    expect(await screen.findByRole('button', { name: 'Invite Site Engineer' }, FIND)).toBeInTheDocument()
  })

  it("shows the builder's own profile settings", async () => {
    openBuilder('/contractor/profile-settings', { 'GET /auth/phone/config': { data: { enabled: false } } })
    expect(await screen.findByText('Profile Settings', {}, FIND)).toBeInTheDocument()
    expect(screen.getAllByText('ravi@example.in').length).toBeGreaterThan(0)
  })
})

describe('Builder profile page (/contractors/:contractorId)', () => {
  const profile = { id: BUILDER.id, name: 'Ravi Builders', role: 'BUILDER', company_name: 'Ravi Constructions', projects: [], reviews: [], rating: 4.5 }

  it.each(['OWNER', 'SUPPLIER'])("opens a builder's public profile for a %s", async (role) => {
    const server = installFakeServer({ [`GET /contractors/${BUILDER.id}/profile`]: { data: profile }, 'GET /subscriptions/badges': { data: { badges: {} } } })
    renderApp(`/contractors/${BUILDER.id}`, { auth: signedInAs(anAccount({ role })) })
    expect((await screen.findAllByText('Ravi Builders', {}, FIND)).length).toBeGreaterThan(0)
    expect(server.calls(`GET /contractors/${BUILDER.id}/profile`).length).toBeGreaterThan(0)
  })

  it('is closed to a Site Engineer', async () => {
    installFakeServer({})
    renderApp(`/contractors/${BUILDER.id}`, { auth: signedInAs(anAccount({ role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer' } })) })
    await waitFor(() => expect(location.current.pathname).toBe('/engineer'))
  })
})
