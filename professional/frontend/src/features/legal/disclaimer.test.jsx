/**
 * The Disclaimer: the /disclaimer page (every section, word for word, version 1.0), the
 * Legal hub and footer links, and the short notes: under every calculator by its kind, on
 * adverts (with a visible "Sponsored" label), on Viswa, and the language switcher's note.
 * Each note links to its section of /disclaimer.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut } from '../../test/renderApp.jsx'
import { DISCLAIMER_NOTES, disclaimerHref } from '../../shared/ui/DisclaimerNote.jsx'
import disclaimer from './content/disclaimer.js'

const FIND = { timeout: 15000 }

describe('/disclaimer', () => {
  it('shows every section of the document, word for word, as version 1.0', async () => {
    const user = userEvent.setup()
    installFakeServer({})
    renderApp('/disclaimer', { auth: signedOut })
    expect(await screen.findByRole('heading', { level: 1, name: 'Disclaimer' }, FIND)).toBeInTheDocument()
    expect(disclaimer.version).toBe('1.0')
    // 16 of the Word file's 17: the developers' "Short-Form Disclaimers" list is left out.
    expect(disclaimer.sections).toHaveLength(16)
    expect(disclaimer.sections.map((section) => section.id)).not.toContain('short-form-disclaimers-for-use-on-the-website')
    expect(document.body.textContent).not.toMatch(/Short-Form Disclaimers/i)
    expect(JSON.stringify(disclaimer).toLowerCase()).not.toContain('gharbanao')
    for (const section of disclaimer.sections) {
      await user.click(await screen.findByRole('link', { name: new RegExp(section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }, FIND))
      await waitFor(() => expect(location.current.hash).toBe(`#${section.id}`))
      const first = section.blocks[0]
      const text = first.type === 'p' ? first.parts : first.items[0]
      // The clause number ("4.2") sits in its own column on the page: compare the words after it.
      const words = text.map((part) => (typeof part === 'string' ? part : part.b)).join('').replace(/^\d+(\.\d+)*\s*/, '').slice(0, 40)
      expect(document.body.textContent).toContain(words)
    }
  }, 60000)

  it('opens the section a note links to', async () => {
    installFakeServer({})
    renderApp('/disclaimer#verification-and-the-verified-badge', { auth: signedOut })
    expect((await screen.findAllByText(/A Verified badge means only that/, {}, FIND)).length).toBeGreaterThan(0)
  })

  it('is listed on the Legal hub and in the footer', async () => {
    installFakeServer({})
    renderApp('/legal', { auth: signedOut })
    expect(await screen.findByRole('link', { name: 'View Disclaimer' }, FIND)).toHaveAttribute('href', '/disclaimer')
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Disclaimer' })).toHaveAttribute('href', '/disclaimer')
  })
})

describe('the short notes', () => {
  it('link only to sections that exist on /disclaimer', () => {
    const sections = new Set(disclaimer.sections.map((section) => section.id))
    for (const kind of Object.keys(DISCLAIMER_NOTES)) {
      expect(sections.has(DISCLAIMER_NOTES[kind].section), kind).toBe(true)
      expect(disclaimerHref(kind)).toBe(`/disclaimer#${DISCLAIMER_NOTES[kind].section}`)
    }
  })

  it.each([
    ['construction', 'cost', /Estimates only/],
    ['raw-material', 'cost', /Estimates only/],
    ['paint', 'cost', /Estimates only/],
    ['ready-mix', 'cost', /Estimates only/],
    ['vastu', 'vastu', /traditional Vastu principles/],
    ['home-loan', 'loan', /CREWNBUILD is not a lender/],
    ['construction-finance', 'loan', /CREWNBUILD is not a lender/],
    ['stamp-duty', 'tax', /Rates and rules vary by state/],
    ['true-cost', 'tax', /Rates and rules vary by state/],
    ['property-tds', 'tax', /Rates and rules vary by state/],
    ['property-roi', 'general', /Indicative estimate only/],
    ['rent-vs-buy', 'general', /Indicative estimate only/],
    ['contractor-quote', 'quote', /not a finding that anyone has acted improperly/],
  ])('the %s calculator shows the %s note under its result', async (calc, kind, text) => {
    installFakeServer({})
    renderApp(`/estimate?calc=${calc}`, { auth: signedOut })
    const note = await screen.findByTestId('disclaimer-note', {}, FIND)
    expect(note).toHaveAttribute('data-note', kind)
    expect(note).toHaveTextContent(text)
    expect(within(note).getByRole('link', { name: 'Read disclaimer' })).toHaveAttribute('href', disclaimerHref(kind))
  })

  it('adverts are marked "Sponsored" and carry the paid-placement note', async () => {
    installFakeServer({
      'GET /ads': { data: [{ id: '0190a8b2-4c1e-7aa0-9f00-0000000000d1', title: 'Cement sale', image_url: '/ad.png', display_width: 'FULL', link_url: 'https://example.com' }] },
    })
    renderApp('/', { auth: signedOut })
    const labels = await screen.findAllByTestId('advert-sponsored', {}, FIND)
    expect(labels[0]).toHaveTextContent('Sponsored')
    const note = (await screen.findAllByTestId('disclaimer-note')).find((element) => element.dataset.note === 'sponsored')
    expect(note).toHaveTextContent('are paid. Placement is not an endorsement')
  })

  it('the language switcher says the English version prevails', async () => {
    installFakeServer({})
    renderApp('/legal', { auth: signedOut })
    const select = (await screen.findAllByRole('combobox', { name: 'Language' }, FIND))[0]
    expect(select).toHaveAccessibleDescription(/the English version prevails/)
    const note = screen.getAllByTestId('disclaimer-note').find((element) => element.dataset.note === 'language')
    expect(within(note).getByRole('link', { name: 'Read disclaimer' })).toHaveAttribute('href', '/disclaimer#languages-and-translations')
  })

  it('the dashboard language switcher carries the same note', async () => {
    const { default: LanguageSelector } = await import('../../shared/ui/LanguageSelector.jsx')
    const { render } = await import('@testing-library/react')
    const { LanguageProvider } = await import('../../i18n/LanguageContext.jsx')
    render(<LanguageProvider><LanguageSelector /></LanguageProvider>)
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveAccessibleDescription(/the English version prevails/)
  })

  it('Viswa says it can make mistakes and links to the disclaimer', async () => {
    const user = userEvent.setup()
    installFakeServer({ 'GET /assistant/welcome': { data: { message: 'Hi', suggestions: [] } } })
    renderApp('/legal', { auth: signedOut })
    await user.click(await screen.findByRole('button', { name: /Open Viswa/ }, FIND))
    const dialog = await screen.findByRole('dialog', { name: 'Viswa' }, FIND)
    const note = within(dialog).getByTestId('disclaimer-note')
    expect(note).toHaveTextContent('Viswa can make mistakes. Not professional advice.')
    expect(within(note).getByRole('link', { name: 'Read disclaimer' })).toHaveAttribute('href', '/disclaimer#not-professional-advice')
  })
})
