import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { aSession, aTechnician, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut, technicianSignedIn } from '../../test/renderApp.jsx'
import { sectionHeading } from './components/LegalDocument.jsx'
import terms from './content/terms.js'
import privacy from './content/privacy.js'

const FIND = { timeout: 8000 }

describe.each([
  ['/terms', terms],
  ['/privacy', privacy],
])('%s', (path, doc) => {
  it('renders the title, version, dates, contents and every section without a session', async () => {
    const server = installFakeServer({})
    renderApp(path, { auth: signedOut })
    expect(await screen.findByRole('heading', { level: 1, name: doc.title }, FIND)).toBeInTheDocument()
    expect(screen.getByText('Version:').parentElement).toHaveTextContent(`Version: ${doc.version}`)
    expect(screen.getByText('Effective date:').parentElement).toHaveTextContent(`Effective date: ${doc.effectiveDate}`)
    expect(screen.getByText('Last updated:')).toBeInTheDocument()
    const toc = screen.getByRole('navigation', { name: 'Contents' })
    for (const section of doc.sections) {
      expect(within(toc).getByRole('link', { name: sectionHeading(section) })).toHaveAttribute('href', `#${section.id}`)
      expect(screen.getByRole('heading', { level: 2, name: sectionHeading(section) })).toHaveAttribute('id', section.id)
    }
    expect(location.current.pathname).toBe(path)
    expect(server.requests.filter((request) => request.path.startsWith('/auth'))).toHaveLength(0)
  })

  it('opens for a signed-in technician and leaves the session alone', async () => {
    installFakeServer({ 'GET /auth/me': { data: aSession() } })
    const { store } = renderApp(path, { auth: technicianSignedIn(aTechnician()) })
    expect(await screen.findByRole('heading', { level: 1, name: doc.title }, FIND)).toBeInTheDocument()
    expect(location.current.pathname).toBe(path)
    expect(store.getState().auth.signedIn).toBe(true)
  })
})

it('shows [placeholders] as written', async () => {
  installFakeServer({})
  renderApp('/terms', { auth: signedOut })
  await screen.findByRole('heading', { level: 1, name: terms.title }, FIND)
  expect(screen.getAllByText('[Company legal name]').length).toBeGreaterThan(0)
})

it.each([
  ['Terms of service', '/terms', terms],
  ['Privacy policy', '/privacy', privacy],
])('the landing page footer link "%s" leads to %s', async (label, path, doc) => {
  installFakeServer({})
  const user = userEvent.setup()
  renderApp('/', { auth: signedOut })
  const footer = await screen.findByRole('contentinfo', {}, FIND)
  await user.click(within(footer).getByRole('link', { name: label }))
  await waitFor(() => expect(location.current.pathname).toBe(path))
  expect(await screen.findByRole('heading', { level: 1, name: doc.title }, FIND)).toBeInTheDocument()
})

it('the footer has a Legal column with both documents and the support phone as a call link', async () => {
  installFakeServer({})
  renderApp('/', { auth: signedOut })
  const footer = await screen.findByRole('contentinfo', {}, FIND)
  const legal = within(footer).getByRole('navigation', { name: 'Legal' })
  expect(within(legal).getByText('Legal')).toBeInTheDocument()
  expect(within(legal).getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms')
  expect(within(legal).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
  expect(within(footer).getByRole('link', { name: '+91 628 1921 628' })).toHaveAttribute('href', 'tel:+916281921628')
})

describe('registration consent', () => {
  const SIGNUP = {
    'POST /auth/signup/send-code': { data: { sent: true, expires_in_minutes: 10, resend_after_seconds: 30 } },
    'POST /auth/signup/verify-code': {
      data: { session_type: 'onboarding', user: aTechnician({ status: 'PENDING' }), csrf_token: 'csrf-onboarding' },
    },
  }

  async function reachCodeStep(user) {
    const server = installFakeServer({ ...SIGNUP })
    renderApp('/register', { auth: signedOut })
    await user.type(await screen.findByLabelText('Email', {}, FIND), 'new.tech@example.in')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByPlaceholderText('10 digit mobile'), '9876500022')
    await user.click(screen.getByRole('button', { name: /Send email code/ }))
    await waitFor(() => expect(server.calls('POST /auth/signup/send-code')).toHaveLength(1))
    const digits = await screen.findAllByRole('textbox')
    await user.click(digits[0])
    await user.paste('482913')
    return server
  }

  const consentBox = () => screen.getByRole('checkbox', { name: 'I agree to the Terms of Service and Privacy Policy' })
  const codeValue = () => screen.getAllByRole('textbox').map((input) => input.value).join('')

  it.each([
    ['Terms of Service', 'Escape', terms],
    ['Privacy Policy', 'the close button', privacy],
    ['Terms of Service', 'a click outside', terms],
  ])('"%s" opens the full text in a dialog; closing with %s keeps the form and the box unticked', async (word, how, doc) => {
    const user = userEvent.setup()
    await reachCodeStep(user)
    const opener = screen.getByRole('button', { name: word })
    await user.click(opener)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('heading', { level: 1, name: doc.title })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { level: 2, name: sectionHeading(doc.sections[1]) })).toBeInTheDocument()
    expect(dialog).toContainElement(document.activeElement)
    expect(consentBox()).not.toBeChecked()

    if (how === 'Escape') await user.keyboard('{Escape}')
    else if (how === 'the close button') await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    else await user.click(screen.getByTestId('legal-dialog-backdrop'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(location.current.pathname).toBe('/register')
    expect(codeValue()).toBe('482913')
    expect(screen.getAllByText(/new\.tech@example\.in/).length).toBeGreaterThan(0)
    expect(consentBox()).not.toBeChecked()
  })

  it('refuses to create the account while the box is unticked, and sends nothing', async () => {
    const user = userEvent.setup()
    const server = await reachCodeStep(user)
    await user.click(screen.getByRole('button', { name: /Verify email/ }))
    expect(await screen.findByText('Please agree to the Terms of Service and Privacy Policy to create your account.')).toBeInTheDocument()
    expect(server.calls('POST /auth/signup/verify-code')).toHaveLength(0)
    expect(location.current.pathname).toBe('/register')
  })

  it('sends the acceptance and both document versions once the box is ticked', async () => {
    const user = userEvent.setup()
    const server = await reachCodeStep(user)
    await user.click(consentBox())
    await user.click(screen.getByRole('button', { name: /Verify email/ }))
    await waitFor(() => expect(server.calls('POST /auth/signup/verify-code')).toHaveLength(1))
    const body = JSON.parse(server.calls('POST /auth/signup/verify-code')[0].data)
    expect(body).toMatchObject({ accept_terms: true, terms_version: terms.version, privacy_version: privacy.version })
    await waitFor(() => expect(location.current.pathname).toBe('/onboarding'))
  })
})
