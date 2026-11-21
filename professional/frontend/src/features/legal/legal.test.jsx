import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { history, location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'
import { sectionLabel as label } from './components/LegalDocument.jsx'
import { privacy, terms } from './legalDocuments.js'

const SLOW = { timeout: 15000 }

// jsdom has no media playback; the sign-up page's backdrop video calls play().
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve()
})

// jsdom has no scrollIntoView: record which element was asked to scroll into view.
function recordScrolls() {
  const scrolled = []
  Element.prototype.scrollIntoView = function record() { scrolled.push(this) }
  return scrolled
}

afterEach(() => {
  vi.restoreAllMocks()
  delete Element.prototype.scrollIntoView
})

const OWNER = anAccount({ role: 'OWNER' })
const SHORT_TITLES = { terms: 'Terms & Conditions', privacy: 'Privacy Policy' }

/** The section view: the one section shown (its h2), and the section list beside it. */
const shownHeading = (scope = document.body) => within(scope).getByRole('heading', { level: 2 })
const sectionList = (scope = document.body) => within(scope).getByRole('navigation', { name: 'Sections' })
const current = (scope) => within(sectionList(scope)).getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'true')

describe('the documents are the Word files, word for word', () => {
  it.each([
    [terms, 'Terms and Conditions (Terms of Use)'],
    [privacy, 'Privacy Policy'],
  ])('%#: title, version and dates, and no old brand', (doc, title) => {
    expect(doc.title).toBe(title)
    expect([doc.effectiveDate, doc.version, doc.lastUpdated]).toEqual(['20 November 2026', '1.1', '20 November 2026'])
    expect(JSON.stringify(doc)).not.toMatch(/gharbanao/i)
  })
})

describe.each([
  ['/terms', terms],
  ['/privacy', privacy],
])('%s', (path, doc) => {
  it.each([
    ['signed out', signedOut],
    ['signed in', signedInAs(OWNER)],
  ])('opens %s at the top on the first section: short title, section list, last updated at the bottom', async (_name, auth) => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    installFakeServer()
    const { store } = renderApp(path, { auth })
    expect(await screen.findByRole('heading', { level: 1, name: SHORT_TITLES[doc.id] }, SLOW)).toBeInTheDocument()
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0))
    // No brand line, effective date, version or contents block at the top.
    expect(screen.queryByText(/Effective date:|Version:|CREWNBUILD · crewnbuild\.com/)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument()
    // Every heading is in the list; only the first section is shown.
    const links = within(sectionList()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(doc.sections.map(label))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(doc.sections.map((section) => `#${section.id}`))
    expect(shownHeading()).toHaveTextContent(label(doc.sections[0]))
    expect(current().map((link) => link.textContent)).toEqual([label(doc.sections[0])])
    expect(screen.getByText(`Last updated: ${doc.lastUpdated}`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Previous/ })).not.toBeInTheDocument()
    expect(document.title).toContain(SHORT_TITLES[doc.id])
    expect(store.getState().auth.user).toEqual(auth.user)
  })

  it('a section in the list shows that section and puts it in the address, without a new history entry', async () => {
    const scrolled = recordScrolls()
    const user = userEvent.setup()
    installFakeServer()
    renderApp(path, { auth: signedOut })
    await screen.findByRole('heading', { level: 1, name: SHORT_TITLES[doc.id] }, SLOW)
    const target = doc.sections[4]
    await user.click(within(sectionList()).getByRole('link', { name: label(target) }))
    expect(location.current.hash).toBe(`#${target.id}`)
    expect(shownHeading()).toHaveTextContent(label(target))
    expect(shownHeading()).toHaveFocus()
    expect(scrolled.at(-1).getAttribute('aria-labelledby')).toBe(target.id)
    expect(current().map((link) => link.textContent)).toEqual([label(target)])

    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(location.current.hash).toBe(`#${doc.sections[5].id}`)
    expect(shownHeading()).toHaveTextContent(label(doc.sections[5]))
    await user.click(screen.getByRole('button', { name: /Previous/ }))
    expect(shownHeading()).toHaveTextContent(label(target))
    // (No history entry per switch: see "Back from a policy page" below.)
  })

  it('a link to a section opens on it; the last has no Next; the full text is there for print', async () => {
    installFakeServer()
    const last = doc.sections.at(-1)
    renderApp(`${path}#${last.id}`, { auth: signedOut })
    await screen.findByRole('heading', { level: 1, name: SHORT_TITLES[doc.id] }, SLOW)
    expect(shownHeading()).toHaveTextContent(label(last))
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toHaveTextContent(label(doc.sections.at(-2)))
    // Print: every section, in order, in a copy hidden from the screen and from assistive tech.
    const print = document.querySelector('[data-legal-document] [aria-hidden="true"].hidden')
    expect(print).toHaveClass('print:block')
    expect([...print.children].map((part) => part.firstChild.textContent)).toEqual(doc.sections.map(label))
  })

  it('on a small screen the sections are a dropdown that does the same', async () => {
    const user = userEvent.setup()
    installFakeServer()
    renderApp(path, { auth: signedOut })
    await screen.findByRole('heading', { level: 1, name: SHORT_TITLES[doc.id] }, SLOW)
    const dropdown = screen.getByRole('combobox', { name: 'Sections' })
    expect(dropdown).toHaveValue(doc.sections[0].id)
    await user.selectOptions(dropdown, doc.sections[2].id)
    expect(location.current.hash).toBe(`#${doc.sections[2].id}`)
    expect(shownHeading()).toHaveTextContent(label(doc.sections[2]))
  })

  it('opened directly, the one Back button goes to the landing page; there is no "Back to Legal"', async () => {
    const user = userEvent.setup()
    installFakeServer()
    renderApp(path, { auth: signedOut })
    await screen.findByRole('heading', { level: 1, name: SHORT_TITLES[doc.id] }, SLOW)
    expect(screen.getAllByRole('button', { name: 'Back' })).toHaveLength(1)
    expect(screen.queryByText('Back to Legal')).not.toBeInTheDocument()
    await user.click(within(sectionList()).getByRole('link', { name: label(doc.sections[3]) }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.current.pathname).toBe('/'))
  })
})

describe('Back from a policy page', () => {
  const FOOTER_SCROLL = 2400

  /** The landing page, scrolled down to its footer. */
  async function landingAtFooter() {
    renderApp('/', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: FOOTER_SCROLL })
    window.dispatchEvent(new Event('scroll'))
    return footer
  }

  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('footer -> /privacy -> Back lands on the landing page at the same scroll position', async () => {
    const user = userEvent.setup()
    installFakeServer()
    const footer = await landingAtFooter()
    await user.click(within(footer).getByRole('link', { name: 'Privacy policy' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }, SLOW)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/privacy')
    // The policy page opened at the top.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    const scrollTo = vi.spyOn(window, 'scrollTo')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.current.pathname).toBe('/'))
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, FOOTER_SCROLL), { timeout: 4000 })
  })

  it('footer -> /terms, several sections, then one Back leaves the page', async () => {
    const user = userEvent.setup()
    installFakeServer()
    const footer = await landingAtFooter()
    await user.click(within(footer).getByRole('link', { name: 'Terms of service' }))
    await screen.findByRole('heading', { level: 1, name: 'Terms & Conditions' }, SLOW)
    for (const index of [2, 6, 9]) {
      await user.click(within(sectionList()).getByRole('link', { name: label(terms.sections[index]) }))
    }
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(location.current.hash).toBe(`#${terms.sections[10].id}`)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(location.current.pathname).toBe('/'))
    expect(location.current.hash).toBe('')
  })

  it('the browser Back button also leaves a policy page in one step after section clicks', async () => {
    const user = userEvent.setup()
    installFakeServer()
    const footer = await landingAtFooter()
    await user.click(within(footer).getByRole('link', { name: 'Privacy policy' }))
    await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }, SLOW)
    await user.click(within(sectionList()).getByRole('link', { name: label(privacy.sections[3]) }))
    await user.click(within(sectionList()).getByRole('link', { name: label(privacy.sections[7]) }))
    history.back()
    await waitFor(() => expect(location.current.pathname).toBe('/'))
  })
})

it('the text is justified, hyphenated English, with each clause number in its own column', async () => {
  installFakeServer()
  renderApp('/terms#cancellations', { auth: signedOut })
  const heading = await screen.findByRole('heading', { level: 2, name: '10. Cancellations and Refunds' }, SLOW)
  const section = heading.closest('section')
  expect(section.querySelector('[lang="en"]')).toHaveClass('font-sans')
  const number = within(section).getByText('10.5')
  const clause = number.parentElement
  expect(clause).toHaveClass('grid')
  expect(number.nextElementSibling).toHaveClass('text-justify', 'hyphens-auto')
  expect(number.nextElementSibling).toHaveTextContent(/^How to ask\. Request refunds at support@crewnbuild\.com/)
  for (const item of section.querySelectorAll('li')) expect(item).toHaveClass('text-justify')
})

it('a numbered list in the Word file is a numbered list on the page', async () => {
  const section = terms.sections.find((candidate) => candidate.blocks.some((block) => block.ordered))
  installFakeServer()
  renderApp(`/terms#${section.id}`, { auth: signedOut })
  const heading = await screen.findByRole('heading', { level: 2, name: label(section) }, SLOW)
  const list = heading.closest('section').querySelector('ol')
  expect(list).toHaveClass('list-decimal')
  expect(list.children).toHaveLength(section.blocks.find((block) => block.ordered).items.length)
})

describe('the Legal hub', () => {
  it('/legal: back arrow, title, one card: intro, three policies with their links, and the contact box', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    installFakeServer()
    renderApp('/legal', { auth: signedOut })
    expect(await screen.findByRole('heading', { level: 1, name: 'Terms & Conditions' }, SLOW)).toBeInTheDocument()
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0))
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByText(/^Welcome to CREWNBUILD\..*please take a moment to review and agree to our legal policies.*By using our website or services, you acknowledge your understanding and acceptance of these policies\.$/)).toBeInTheDocument()
    const cards = [
      ['Terms & Conditions', 'View Detailed Terms', '/terms'],
      ['Privacy Policy', 'View Privacy Policy', '/privacy'],
      ['Cancellation & Refund Policy', 'View Cancellation Policy', '/terms#cancellations'],
    ]
    for (const [title, link, href] of cards) {
      const card = screen.getByRole('region', { name: title })
      expect(within(card).getByRole('link', { name: link })).toHaveAttribute('href', href)
      expect(within(card).getByRole('link', { name: link })).toHaveClass('underline')
    }
    const contact = screen.getByRole('region', { name: 'Contact' })
    expect(within(contact).getByRole('link', { name: 'support@crewnbuild.com' })).toHaveAttribute('href', 'mailto:support@crewnbuild.com')
    expect(within(contact).getByRole('link', { name: '+91 628 1921 628' })).toHaveAttribute('href', 'tel:+916281921628')
  })

  it('View Cancellation Policy opens section 10 of the Terms', async () => {
    const user = userEvent.setup()
    installFakeServer()
    renderApp('/legal', { auth: signedOut })
    await user.click(await screen.findByRole('link', { name: 'View Cancellation Policy' }, SLOW))
    expect(await screen.findByRole('heading', { level: 2, name: '10. Cancellations and Refunds' }, SLOW)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/terms')
  })

  it('the back arrow returns to the page the visitor came from', async () => {
    const user = userEvent.setup()
    installFakeServer()
    renderApp('/privacy', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    await user.click(within(footer).getByRole('link', { name: 'Legal' }))
    await user.click(await screen.findByRole('button', { name: 'Back' }, SLOW))
    await waitFor(() => expect(location.current.pathname).toBe('/privacy'))
  })
})

describe('footer links', () => {
  it('the landing footer Legal column leads to /legal, /terms and /privacy', async () => {
    const user = userEvent.setup()
    installFakeServer()
    renderApp('/legal', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    const column = within(footer).getAllByRole('heading', { name: 'Legal' })[0].parentElement
    expect(within(column).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/legal', '/terms', '/privacy'])
    await user.click(within(column).getByRole('link', { name: 'Privacy policy' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' }, SLOW)).toBeInTheDocument()
    expect(location.current.pathname).toBe('/privacy')
  })

  it('the other public footer points at the hub and both pages', async () => {
    installFakeServer()
    renderApp('/about', { auth: signedOut })
    expect(await screen.findByRole('link', { name: 'Terms of Service' }, SLOW)).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(screen.getAllByRole('link', { name: 'Legal' }).map((link) => link.getAttribute('href'))).toContain('/legal')
    expect(screen.getAllByRole('link', { name: /\+91 628 1921 628/ })[0]).toHaveAttribute('href', 'tel:+916281921628')
  })

  it('the landing footer shows the support phone as a call link under Get in touch', async () => {
    installFakeServer()
    renderApp('/terms', { auth: signedOut })
    const footer = (await screen.findAllByRole('contentinfo', {}, SLOW)).at(-1)
    const touch = within(footer).getByRole('heading', { name: 'Get in touch' }).parentElement
    // GET /support/config is not answered here: the company line still shows.
    expect(within(touch).getByRole('link', { name: '+91 628 1921 628' })).toHaveAttribute('href', 'tel:+916281921628')
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

// The one required consent box of every sign-up form.
const consentBox = () => screen.getByRole('checkbox', { name: /^I agree to the Terms & Conditions and I have read the Privacy Policy/ })

describe.each([
  ['Terms & Conditions', terms, 'close'],
  ['Privacy Policy', privacy, 'escape'],
])('sign-up consent: %s', (name, doc, closeWith) => {
  it('opens the document over the form, keeps the form, and needs the box ticked', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({ ...PHONE_SIGNUP })
    renderApp('/signup?role=OWNER', { auth: signedOut })
    await fillPhoneSignup(user)

    expect(consentBox()).toBeRequired()
    const opener = screen.getByRole('button', { name })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: SHORT_TITLES[doc.id] })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    // The same section view, starting at the first section, at the top.
    expect(screen.getByTestId('legal-dialog-body').scrollTop).toBe(0)
    expect(shownHeading(dialog)).toHaveTextContent(label(doc.sections[0]))
    expect(within(dialog).getByText(`Last updated: ${doc.lastUpdated}`)).toBeInTheDocument()
    // Choosing a section changes the window only: the address and the form stay.
    const scrolled = recordScrolls()
    const last = doc.sections.at(-1)
    await user.click(within(sectionList(dialog)).getByRole('link', { name: label(last) }))
    expect(shownHeading(dialog)).toHaveTextContent(label(last))
    expect(scrolled.at(-1).getAttribute('aria-labelledby')).toBe(`dialog-${last.id}`)
    await user.click(within(dialog).getByRole('button', { name: /Previous/ }))
    expect(shownHeading(dialog)).toHaveTextContent(label(doc.sections.at(-2)))
    expect(location.current.hash).toBe('')
    expect(location.current.pathname).toBe('/signup')
    expect(consentBox()).not.toBeChecked()

    if (closeWith === 'close') await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    else await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(opener)
    expect(screen.getByPlaceholderText('Your name')).toHaveValue('Asha Rao')
    expect(screen.getByText('Mobile number verified')).toBeInTheDocument()
    // Reading the document ticked nothing.
    expect(consentBox()).not.toBeChecked()

    // Create Account stays disabled until the box is ticked; nothing is sent before.
    const create = () => screen.getByRole('button', { name: /Create Account/ })
    expect(create()).toBeDisabled()
    await user.click(consentBox())
    expect(create()).toBeEnabled()
    await user.click(consentBox())
    expect(create()).toBeDisabled()
    expect(server.calls('POST /auth/signup')).toHaveLength(0)

    await user.click(consentBox())
    await user.click(create())
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
  it('a click outside closes the document; Create account waits for the box; the request carries the versions', async () => {
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
    await screen.findByRole('dialog', { name: 'Privacy Policy' })
    await user.click(screen.getByTestId('legal-dialog-backdrop'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByPlaceholderText('you@example.com')).toHaveValue('asha@example.in')
    expect(consentBox()).not.toBeChecked()

    const create = () => screen.getByRole('button', { name: /Create account/ })
    expect(create()).toBeDisabled()
    expect(server.calls('POST /auth/signup')).toHaveLength(0)

    await user.click(consentBox())
    await user.click(create())
    await waitFor(() => expect(server.calls('POST /auth/signup')).toHaveLength(1))
    expect(JSON.parse(server.calls('POST /auth/signup')[0].data)).toMatchObject({
      email: 'asha@example.in',
      accept_terms: true,
      terms_version: terms.version,
      privacy_version: privacy.version,
    })
  })
})
