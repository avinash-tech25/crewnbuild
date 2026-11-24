/**
 * The landing header's links to app pages navigate inside the single-page app: the router's
 * location changes and the next page renders, with no full page reload. (jsdom does not
 * follow a plain <a href> at all, so a link that still reloaded would leave the router
 * where it was and these tests would fail.) The current page's link is marked
 * aria-current="page".
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedOut } from '../../test/renderApp.jsx'

const FIND = { timeout: 15000 }
const header = async () => within((await screen.findAllByRole('banner', {}, FIND))[0])

describe('the landing header', () => {
  it('Sign in opens /login inside the app', async () => {
    const user = userEvent.setup()
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    const signIn = (await header()).getAllByRole('link', { name: 'Sign in' })[0]
    expect(signIn).toHaveAttribute('href', '/login')
    await user.click(signIn)
    await waitFor(() => expect(location.current.pathname).toBe('/login'))
  })

  it('Get started opens /signup inside the app', async () => {
    const user = userEvent.setup()
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    await user.click((await header()).getAllByRole('link', { name: /Get started/ })[0])
    await waitFor(() => expect(location.current.pathname).toBe('/signup'))
  })

  it('Contact us opens /contact-us inside the app and is then marked as the current page', async () => {
    const user = userEvent.setup()
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    const contact = (await header()).getByRole('link', { name: 'Contact us' })
    expect(contact).not.toHaveAttribute('aria-current')
    await user.click(contact)
    await waitFor(() => expect(location.current.pathname).toBe('/contact-us'), FIND)
    await waitFor(async () => expect((await header()).getByRole('link', { name: 'Contact us' })).toHaveAttribute('aria-current', 'page'), FIND)
  })

  it('keeps the section links as in-page anchors on the landing page', async () => {
    installFakeServer({})
    renderApp('/', { auth: signedOut })
    const links = (await header()).getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(links).toEqual(expect.arrayContaining(['#roles', '#how', '#world']))
  })
})
