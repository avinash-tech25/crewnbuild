import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { privacy, terms } from './legalDocuments.js'

const SLOW = { timeout: 15000 }

// jsdom has no media playback; the sign-up page's backdrop video calls play().
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve()
})
const OWNER = anAccount({ role: 'OWNER' })
const label = (section) => (section.number ? `${section.number}. ${section.title}` : section.title)

describe.each([
  ['/terms', terms],
  ['/privacy', privacy],
])('%s', (path, doc) => {
  it.each([
    ['signed out', signedOut],
    ['signed in', signedInAs(OWNER)],
  ])('shows the whole document %s, and keeps the session', async (_name, auth) => {
    installFakeServer()
    const { store } = renderApp(path, { auth })
    expect(await screen.findByRole('heading', { level: 1, name: doc.title }, SLOW)).toBeInTheDocument()
    expect(screen.getByText(`Version: ${doc.version}`)).toBeInTheDocument()
    expect(screen.getByText(/^Effective date:/)).toHaveTextContent(`Effective date: ${doc.effectiveDate}`)
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument()
    const contents = screen.getByRole('navigation', { name: 'Contents' })
    for (const section of doc.sections) {
      expect(within(contents).getByRole('link', { name: label(section) })).toHaveAttribute('href', `#${section.id}`)
      expect(screen.getByRole('heading', { level: 2, name: label(section) })).toHaveAttribute('id', section.id)
    }
    expect(document.title).toContain(doc.title)
    expect(location.current.pathname).toBe(path)
    expect(store.getState().auth.user).toEqual(auth.user)
  })
})

describe('footer links', () => {
  it('the landing footer leads to the Terms and the Privacy Policy', async () => {
    const user = userEvent.setup()
    installFakeServer()
    renderApp('/terms', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    await user.click(within(footer).getByRole('link', { name: 'Privacy policy' }))
    expect(await screen.findByRole('heading', { level: 1, name: privacy.title }, SLOW)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/privacy')
    await user.click(within(screen.getAllByRole('contentinfo').at(-1)).getByRole('link', { name: 'Terms of service' }))
    expect(await screen.findByRole('heading', { level: 1, name: terms.title }, SLOW)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/terms')
  })

  it('the other public footer points at both pages', async () => {
    installFakeServer()
    renderApp('/about', { auth: signedOut })
    expect(await screen.findByRole('link', { name: 'Terms of Service' }, SLOW)).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getAllByRole('link', { name: /\+91 628 1921 628/ })[0]).toHaveAttribute('href', 'tel:+916281921628')
  })

  it('the landing footer has a Legal column and the support phone as a call link', async () => {
    installFakeServer()
    renderApp('/terms', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    const legal = within(footer).getByRole('heading', { name: 'Legal' }).parentElement
    expect(within(legal).getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms')
    expect(within(legal).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
    // GET /support/config is not answered here: the company line still shows.
    expect(within(footer).getByRole('link', { name: '+91 628 1921 628' })).toHaveAttribute('href', 'tel:+916281921628')
  })

  it('the landing footer shows the SUPPORT_PHONE the server sends', async () => {
    installFakeServer({
      'GET /support/config': { data: { contact: { phone: '+91 40 5555 0000', phone_href: 'tel:+914055550000' } } },
    })
    renderApp('/terms', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    expect(await within(footer).findByRole('link', { name: '+91 40 5555 0000' }, SLOW)).toHaveAttribute('href', 'tel:+914055550000')
  })
})

const PHONE_SIGNUP = {
  'GET /auth/phone/config': { data: { enabled: true, login: true, dial_code: '+91', digits: 10 } },
  'POST /auth/phone/send-code': { data: { sent: true, expires_in_minutes: 5, resend_after_seconds: 30 } },
  'POST /auth/phone/verify-code': { data: { verification_token: 'phone-token' } },
  'POST /auth/signup': { data: { user: anAccount({ pincode: null }), csrf_token: 'csrf-new' } },
}

async function fillPhoneSignup(user) {
  await user.type(await screen.findByPlaceholderText('Your name', {}, SLOW), 'Asha Rao')
  await user.type(screen.getByPlaceholderText('10 digit mobile number'), '9876543210')
  await user.click(screen.getByRole('button', { name: /Send OTP on WhatsApp/ }))
  const digits = await screen.findAllByLabelText(/ \d$/)
  '482913'.split('').forEach((digit, index) => fireEvent.change(digits[index], { target: { value: digit } }))
  await user.click(screen.getByRole('button', { name: 'Verify OTP' }))
  await screen.findByText('Mobile number verified')
}

describe.each([
  ['Terms of Service', terms, 'close'],
  ['Privacy Policy', privacy, 'escape'],
])('sign-up consent: %s', (name, doc, closeWith) => {
  it('opens the document over the form, keeps the form, and needs the box ticked', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({ ...PHONE_SIGNUP })
    renderApp('/signup?role=OWNER', { auth: signedOut })
    await fillPhoneSignup(user)

    const checkbox = screen.getByRole('checkbox', { name: /I agree to the Terms of Service and Privacy Policy/ })
    const opener = screen.getByRole('button', { name })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: doc.title })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(within(dialog).getByRole('heading', { level: 2, name: label(doc.sections[1]) })).toBeInTheDocument()
    expect(within(dialog).getByText(`Version: ${doc.version}`)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/signup')
    expect(checkbox).not.toBeChecked()

    if (closeWith === 'close') await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    else await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(opener)
    expect(screen.getByPlaceholderText('Your name')).toHaveValue('Asha Rao')
    expect(screen.getByText('Mobile number verified')).toBeInTheDocument()
    expect(checkbox).not.toBeChecked()

    // Unticked: refused with a message, nothing sent.
    await user.click(screen.getByRole('button', { name: /Create Account/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please accept the Terms of Service and Privacy Policy.')
    expect(server.calls('POST /auth/signup')).toHaveLength(0)

    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    await user.click(screen.getByRole('button', { name: /Create Account/ }))
    await waitFor(() => expect(server.calls('POST /auth/signup')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /auth/signup')[0].data)).toMatchObject({
      name: 'Asha Rao',
      phone: '9876543210',
      phone_verification_token: 'phone-token',
      accept_terms: true,
      terms_version: terms.version,
      privacy_version: privacy.version,
    })
  })
})

describe('sign-up consent: the password form', () => {
  it('a click outside closes the document; an unticked box sends nothing; the request carries the versions', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      'GET /auth/phone/config': { data: { enabled: false, login: false, dial_code: '+91', digits: 10 } },
      'POST /auth/email/send-code': { data: { sent: true, delivered: true, resend_after_seconds: 30 } },
      'POST /auth/email/verify-code': { data: { verified: true } },
      'POST /auth/signup': { data: { user: anAccount({ pincode: null }), csrf_token: 'csrf-new' } },
    })
    renderApp('/signup?role=OWNER', { auth: signedOut })
    await user.type(await screen.findByPlaceholderText('Your name', {}, SLOW), 'Asha Rao')
    await user.type(screen.getByPlaceholderText('you@example.com'), 'asha@example.in')
    await user.type(screen.getByPlaceholderText('10+ characters, Aa1!'), 'Str0ng!Passw0rd')
    await user.click(screen.getByRole('button', { name: 'Continue to password confirmation' }))
    await user.type(await screen.findByPlaceholderText('Re-enter your password'), 'Str0ng!Passw0rd')
    await user.click(await screen.findByRole('button', { name: 'Verify email with OTP' }, { timeout: 5000 }))
    const digits = await screen.findAllByLabelText(/ \d$/)
    '482913'.split('').forEach((digit, index) => fireEvent.change(digits[index], { target: { value: digit } }))
    await user.click(screen.getByRole('button', { name: 'Verify OTP' }))
    await screen.findByText('Email verified')

    await user.click(screen.getByRole('button', { name: 'Privacy Policy' }))
    await screen.findByRole('dialog', { name: privacy.title })
    await user.click(screen.getByTestId('legal-dialog-backdrop'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('you@example.com')).toHaveValue('asha@example.in')
    const checkbox = screen.getByRole('checkbox', { name: /I agree/ })
    expect(checkbox).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: /Create account/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please accept the Terms of Service and Privacy Policy.')
    expect(server.calls('POST /auth/signup')).toHaveLength(0)

    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: /Create account/ }))
    await waitFor(() => expect(server.calls('POST /auth/signup')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /auth/signup')[0].data)).toMatchObject({
      email: 'asha@example.in',
      accept_terms: true,
      terms_version: terms.version,
      privacy_version: privacy.version,
    })
  })
})
