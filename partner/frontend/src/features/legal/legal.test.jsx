import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aSession, aTechnician, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut, technicianSignedIn } from '../../test/renderApp.jsx'
import { sectionHeading } from './components/LegalDocument.jsx'
import terms from './content/terms.js'
import privacy from './content/privacy.js'

const FIND = { timeout: 8000 }

// jsdom has no scrollIntoView: record which element was asked to scroll into view.
function recordScrolls() {
  const scrolled = []
  Element.prototype.scrollIntoView = function record() { scrolled.push(this.id) }
  return scrolled
}

afterEach(() => {
  vi.restoreAllMocks()
  delete Element.prototype.scrollIntoView
})

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

it.each([
  [terms, 'Terms and Conditions (Terms of Use)'],
  [privacy, 'Privacy Policy'],
])('%#: the text is the Word file: title, version and dates, and no old brand', (doc, title) => {
  expect(doc.title).toBe(title)
  expect([doc.effectiveDate, doc.version, doc.lastUpdated]).toEqual(['20 November 2026', '1.1', '20 November 2026'])
  expect(JSON.stringify(doc)).not.toMatch(/gharbanao/i)
})

it('a numbered list in the Word file is a numbered list on the page', async () => {
  installFakeServer({})
  renderApp('/terms', { auth: signedOut })
  const section = terms.sections.find((candidate) => candidate.blocks.some((block) => block.ordered))
  const heading = await screen.findByRole('heading', { level: 2, name: sectionHeading(section) }, FIND)
  const list = heading.closest('section').querySelector('ol')
  expect(list).toHaveClass('list-decimal')
  expect(list.children).toHaveLength(section.blocks.find((block) => block.ordered).items.length)
})

it.each([
  ['/terms', terms],
  ['/privacy', privacy],
])('%s opens at the top and has a Back link to /legal', async (path, doc) => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const user = userEvent.setup()
  installFakeServer({})
  renderApp(path, { auth: signedOut })
  await screen.findByRole('heading', { level: 1, name: doc.title }, FIND)
  expect(scrollTo).toHaveBeenCalledWith(0, 0)
  await user.click(screen.getByRole('link', { name: 'Back to Legal' }))
  expect(await screen.findByRole('heading', { level: 1, name: 'Legal' }, FIND)).toBeInTheDocument()
  expect(location.current.pathname).toBe('/legal')
})

it('a contents link on the page jumps to its section', async () => {
  const scrolled = recordScrolls()
  const user = userEvent.setup()
  installFakeServer({})
  renderApp('/terms', { auth: signedOut })
  await screen.findByRole('heading', { level: 1, name: terms.title }, FIND)
  const target = terms.sections[9]
  await user.click(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('link', { name: sectionHeading(target) }))
  expect(scrolled).toEqual([target.id])
  expect(window.location.hash).toBe(`#${target.id}`)
})

it('/legal: title, welcome, one card per policy with its link, and the contact card', async () => {
  const user = userEvent.setup()
  installFakeServer({})
  renderApp('/legal', { auth: signedOut })
  expect(await screen.findByRole('heading', { level: 1, name: 'Legal' }, FIND)).toBeInTheDocument()
  expect(screen.getByText(/please review our legal policies/)).toBeInTheDocument()
  const termsCard = screen.getByRole('region', { name: 'Terms and Conditions' })
  expect(within(termsCard).getByText(`Version: ${terms.version} · Effective date: ${terms.effectiveDate}`)).toBeInTheDocument()
  expect(within(termsCard).getByRole('link', { name: 'View Terms and Conditions' })).toHaveAttribute('href', '/terms')
  const privacyCard = screen.getByRole('region', { name: 'Privacy Policy' })
  expect(within(privacyCard).getByRole('link', { name: 'View Privacy Policy' })).toHaveAttribute('href', '/privacy')
  const contact = screen.getByRole('region', { name: 'Contact' })
  expect(within(contact).getByRole('link', { name: 'support@crewnbuild.com' })).toHaveAttribute('href', 'mailto:support@crewnbuild.com')
  expect(within(contact).getByRole('link', { name: '+91 628 1921 628' })).toHaveAttribute('href', 'tel:+916281921628')
  await user.click(within(termsCard).getByRole('link', { name: 'View Terms and Conditions' }))
  expect(await screen.findByRole('heading', { level: 1, name: terms.title }, FIND)).toBeInTheDocument()
  expect(location.current.pathname).toBe('/terms')
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

it('the footer: a Legal column (/legal, /terms, /privacy) and Get in touch with the support phone as a call link', async () => {
  installFakeServer({})
  renderApp('/', { auth: signedOut })
  const footer = await screen.findByRole('contentinfo', {}, FIND)
  const legal = within(footer).getByRole('navigation', { name: 'Legal' })
  expect(within(legal).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/legal', '/terms', '/privacy'])
  const touch = within(footer).getByText('Get in touch').parentElement
  expect(within(touch).getByRole('link', { name: '+91 628 1921 628' })).toHaveAttribute('href', 'tel:+916281921628')
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

  const consentBox = () => screen.getByRole('checkbox', { name: /^I agree to the Terms & Conditions and I have read the Privacy Policy/ })
  const verifyButton = () => screen.getByRole('button', { name: /Verify email/ })
  const codeValue = () => screen.getAllByRole('textbox').map((input) => input.value).join('')

  it.each([
    ['Terms & Conditions', 'Escape', terms],
    ['Privacy Policy', 'the close button', privacy],
    ['Terms & Conditions', 'a click outside', terms],
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
    // It starts at the top; its contents links scroll inside it and leave the address alone.
    expect(screen.getByTestId('legal-dialog-body').scrollTop).toBe(0)
    const scrolled = recordScrolls()
    const last = doc.sections.at(-1)
    await user.click(within(within(dialog).getByRole('navigation', { name: 'Contents' })).getByRole('link', { name: sectionHeading(last) }))
    expect(scrolled).toEqual([`dialog-${last.id}`])
    expect(location.current.hash).toBe('')

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

  it('keeps Verify email disabled until the box is ticked, and sends nothing before', async () => {
    const user = userEvent.setup()
    const server = await reachCodeStep(user)
    expect(consentBox()).toBeRequired()
    expect(verifyButton()).toBeDisabled()
    await user.click(consentBox())
    expect(verifyButton()).toBeEnabled()
    await user.click(consentBox())
    expect(verifyButton()).toBeDisabled() // unticked again disables it
    expect(server.calls('POST /auth/signup/verify-code')).toHaveLength(0)
    expect(location.current.pathname).toBe('/register')
  })

  it('sends the acceptance and both document versions once the box is ticked', async () => {
    const user = userEvent.setup()
    const server = await reachCodeStep(user)
    await user.click(consentBox())
    await user.click(verifyButton())
    await waitFor(() => expect(server.calls('POST /auth/signup/verify-code')).toHaveLength(1))
    const body = JSON.parse(server.calls('POST /auth/signup/verify-code')[0].data)
    expect(body).toMatchObject({ accept_terms: true, terms_version: terms.version, privacy_version: privacy.version })
    await waitFor(() => expect(location.current.pathname).toBe('/onboarding'))
  })
})
