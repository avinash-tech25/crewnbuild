/**
 * Viswa's chat widget: where the bubble shows, the lazy-loaded panel, the streamed answer
 * (fetch with the session cookie and the CSRF header), text-only rendering, the stored
 * chat of a House Owner (history, votes, Clear chat), a visitor's chat kept in the tab,
 * a fresh chat per account, keyboard handling and an axe accessibility check.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '../../shared/api/apiClient.js'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { location, renderApp, signedInAs, signedOut } from '../../test/renderApp.jsx'

const FIND = { timeout: 15000 }
const WELCOME = { 'GET /assistant/welcome': { data: { message: "Hi, I'm Viswa.", suggestions: ['How do I hire a builder?'] } } }

function sse(...records) {
  return records.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}

/** fetch answering POST /assistant/chat with a streamed body (two chunks). */
function fakeChat(...replies) {
  const fetchMock = vi.fn(async () => {
    const reply = replies.shift() ?? { body: sse(['done', { answer: 'ok', buttons: [], suggestions: [] }]) }
    if (reply.status && reply.status !== 200) {
      return new Response(JSON.stringify({ detail: reply.detail || 'x' }), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
    }
    const half = Math.floor(reply.body.length / 2)
    const parts = [reply.body.slice(0, half), reply.body.slice(half)]
    const stream = new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(new TextEncoder().encode(part)))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

const bubble = () => screen.findByRole('button', { name: /Open Viswa/ }, FIND)
const panel = () => screen.findByRole('dialog', { name: 'Viswa' }, FIND)

let realFetch
beforeEach(() => {
  realFetch = globalThis.fetch
  sessionStorage.clear()
})
afterEach(() => {
  globalThis.fetch = realFetch
  setCsrfToken('')
})

describe('where Viswa shows', () => {
  it('shows the bubble to a visitor on a public page, and loads the chat only when opened', async () => {
    installFakeServer({ ...WELCOME })
    renderApp('/legal', { auth: signedOut })
    const button = await bubble()
    expect(screen.queryByRole('dialog', { name: 'Viswa' })).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(await panel()).toBeInTheDocument()
    expect(await screen.findByText("Hi, I'm Viswa.", {}, FIND)).toBeInTheDocument()
  })

  it.each(['/login', '/signup', '/forgot-password'])('hides it on %s', async (path) => {
    installFakeServer({})
    renderApp(path, { auth: signedOut })
    await screen.findAllByRole('heading', {}, FIND)
    expect(screen.queryByRole('button', { name: /Open Viswa/ })).not.toBeInTheDocument()
  })

  it.each([
    ['a Builder', '/contractor', { role: 'BUILDER' }],
    ['a Site Engineer', '/engineer', { role: 'ENGINEER', engineer_profile: { specialization: 'Site Engineer' } }],
    ['a Material Supplier', '/supplier', { role: 'SUPPLIER', supplier_profile: { supplier_category: 'Material Supplier' } }],
    ['a Labor Supplier', '/supplier/labor-services', { role: 'SUPPLIER', supplier_profile: { supplier_category: 'Labor Supplier' } }],
    ['a House Owner', '/owner', { role: 'OWNER' }],
  ])('shows it to %s on the dashboard (%s), and keeps the page clear of it', async (_who, path, account) => {
    installFakeServer({})
    const { unmount } = renderApp(path, { auth: signedInAs(anAccount(account)) })
    expect(await bubble()).toBeInTheDocument()
    expect(document.documentElement.dataset.assistant).toBe('on')
    expect(document.documentElement.style.getPropertyValue('--assistant-offset')).toBe('96px')
    unmount()
    expect(document.documentElement.dataset.assistant).toBeUndefined()
  })

  it('shows it to an administrator in the admin console', async () => {
    installFakeServer({ 'GET /admin/me': { data: { role: 'LOCATION_SUPER_ADMIN', scope: 'IN', permissions: [] } } })
    renderApp('/admin', { auth: signedInAs(anAccount({ role: 'LOCATION_SUPER_ADMIN' })) })
    expect(await bubble()).toBeInTheDocument()
  })

  it.each([
    ['/complete-profile', { role: 'OWNER', profile_complete: false }],
    ['/supplier-category', { role: 'SUPPLIER', supplier_profile: null, profile_complete: false }],
    ['/engineer-category', { role: 'ENGINEER', engineer_profile: null, profile_complete: false }],
  ])('hides it on the set-up page %s', async (path, account) => {
    installFakeServer({})
    renderApp(path, { auth: signedInAs(anAccount(account)) })
    // Wherever the set-up flow sends this account, it is a sign-in or set-up page: no bubble.
    const hidden = ['/complete-profile', '/supplier-category', '/engineer-category', '/login']
    await waitFor(() => expect(hidden.some((page) => location.current?.pathname.startsWith(page))).toBe(true), FIND)
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(screen.queryByRole('button', { name: /Open Viswa/ })).not.toBeInTheDocument()
  })
})

describe('a visitor chatting', () => {
  it('streams the answer with the session cookie and CSRF header, as text only', async () => {
    const user = userEvent.setup()
    installFakeServer({ ...WELCOME })
    setCsrfToken('csrf-token-1')
    const fetchMock = fakeChat({
      body: sse(
        ['delta', { text: 'Open **Projects** ' }],
        ['delta', { text: 'and pick a builder.' }],
        ['done', {
          message_id: null, answer: 'Open **Projects** and pick a builder. <img src=x onerror="alert(1)">',
          buttons: [{ label: 'Get an estimate', path: '/estimate' }], suggestions: ['Compare quotations'],
        }],
      ),
    })
    renderApp('/legal', { auth: signedOut })
    await user.click(await bubble())
    const dialog = await panel()
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'How do I hire a builder?')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(within(dialog).getByText('Compare quotations')).toBeInTheDocument())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/assistant\/chat$/)
    expect(init.credentials).toBe('include')
    expect(init.headers['X-CSRF-Token']).toBe('csrf-token-1')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ message: 'How do I hire a builder?', current_page: '/legal' })
    expect(body.history.map((turn) => turn.role)).toEqual(['assistant']) // the greeting, from this tab
    // Text only: the tag shows as text and no image element is created.
    const answers = within(dialog).getAllByTestId('viswa-answer')
    expect(answers.at(-1).querySelector('img')).toBeNull()
    expect(answers.at(-1).textContent).toContain('<img src=x')
    expect(within(answers.at(-1)).getByText('Projects').tagName).toBe('STRONG')
    // Only the finished answer is announced.
    expect(screen.getByTestId('viswa-announcement').textContent).toContain('pick a builder')
    // A button opens the page and closes the chat.
    await user.click(within(dialog).getByRole('button', { name: 'Get an estimate' }))
    expect(location.current.pathname).toBe('/estimate')
    // The visitor's chat stays in this tab only.
    expect(JSON.parse(sessionStorage.getItem('crewnbuild_viswa_guest_chat')).length).toBe(3)
  })

  it('says to slow down on 429 and offers the question again', async () => {
    const user = userEvent.setup()
    installFakeServer({ ...WELCOME })
    fakeChat({ status: 429, detail: 'slow' })
    renderApp('/legal', { auth: signedOut })
    await user.click(await bubble())
    const dialog = await panel()
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'hello')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(within(dialog).getAllByTestId('viswa-answer').at(-1).textContent).toMatch(/sent a lot of messages/), FIND)
    expect(within(dialog).getByRole('button', { name: 'hello' })).toBeInTheDocument()
  })
})

describe('a House Owner chatting', () => {
  const OWNER = anAccount({ id: '0190a8b2-4c1e-7aa0-9f00-0000000000a7', role: 'OWNER' })
  const STORED = [
    { id: '0190a8b2-4c1e-7aa0-9f00-0000000000c1', role: 'user', text: 'Status of my villa?', buttons: [], vote: null },
    { id: '0190a8b2-4c1e-7aa0-9f00-0000000000c2', role: 'assistant', text: 'Your villa is 40% done.', buttons: [], vote: null },
  ]

  it('shows the stored chat, votes on an answer and clears the chat', async () => {
    const user = userEvent.setup()
    const server = installFakeServer({
      ...WELCOME,
      'GET /assistant/history': { data: { messages: STORED } },
      [`PUT /assistant/messages/${STORED[1].id}/vote`]: { data: { id: STORED[1].id, vote: 'up' } },
      'DELETE /assistant/history': { data: { deleted: 2 } },
    })
    renderApp('/legal', { auth: signedInAs(OWNER) })
    await user.click(await bubble())
    const dialog = await panel()
    expect(await within(dialog).findByText('Your villa is 40% done.', {}, FIND)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Good answer' }))
    await waitFor(() => expect(server.calls(`PUT /assistant/messages/${STORED[1].id}/vote`)).toHaveLength(1))
    expect(server.calls(`PUT /assistant/messages/${STORED[1].id}/vote`)[0].data).toBe(JSON.stringify({ vote: 'up' }))
    await user.click(within(dialog).getByRole('button', { name: 'Clear chat' }))
    await waitFor(() => expect(server.calls('DELETE /assistant/history')).toHaveLength(1))
    expect(await within(dialog).findByText("Hi, I'm Viswa.", {}, FIND)).toBeInTheDocument()
    expect(within(dialog).queryByText('Your villa is 40% done.')).not.toBeInTheDocument()
  })

  it('never shows a visitor chat left in the tab to the signed-in owner, and sends no history', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('crewnbuild_viswa_guest_chat', JSON.stringify([{ role: 'user', text: 'GUEST SECRET' }]))
    installFakeServer({ ...WELCOME, 'GET /assistant/history': { data: { messages: [] } } })
    const fetchMock = fakeChat()
    renderApp('/legal', { auth: signedInAs(OWNER) })
    await user.click(await bubble())
    const dialog = await panel()
    await within(dialog).findByText("Hi, I'm Viswa.", {}, FIND)
    expect(within(dialog).queryByText('GUEST SECRET')).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'hi')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).history).toEqual([]) // the server keeps the owner's chat
  })
})

describe('a signed-in Builder chatting', () => {
  it('gets its own stored chat and the welcome the server gives its role', async () => {
    const user = userEvent.setup()
    installFakeServer({
      'GET /assistant/history': { data: { messages: [] } },
      'GET /assistant/welcome': { data: { message: "Hi Ravi, I'm Viswa. Ask me about your requests.", suggestions: ['Any new requests for me?'] } },
    })
    renderApp('/contractor', { auth: signedInAs(anAccount({ role: 'BUILDER', name: 'Ravi Builder' })) })
    await user.click(await bubble())
    const dialog = await panel()
    expect(await within(dialog).findByText(/Ask me about your requests/, {}, FIND)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Any new requests for me?' })).toBeInTheDocument()
  })
})

describe('keyboard and accessibility', () => {
  it('moves focus in, keeps Tab inside, closes on Escape and returns focus to the bubble', async () => {
    const user = userEvent.setup()
    installFakeServer({ ...WELCOME })
    renderApp('/legal', { auth: signedOut })
    const button = await bubble()
    await user.click(button)
    const dialog = await panel()
    await within(dialog).findByText("Hi, I'm Viswa.", {}, FIND)
    expect(within(dialog).getByRole('textbox', { name: 'Message' })).toHaveFocus()
    for (let step = 0; step < 8; step += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Viswa' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Open Viswa/ })).toHaveFocus()
  })

  it('has no axe violations when open', async () => {
    const user = userEvent.setup()
    installFakeServer({ ...WELCOME })
    renderApp('/legal', { auth: signedOut })
    await user.click(await bubble())
    const dialog = await panel()
    await within(dialog).findByText("Hi, I'm Viswa.", {}, FIND)
    let results
    await act(async () => {
      results = await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })
    })
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})

describe('a model that fails part-way', () => {
  it('drops the partial text when the backend starts the answer over', async () => {
    const { streamChat } = await import('./assistantApi.js')
    fakeChat({
      body: sse(
        ['delta', { text: 'Half an answer from the first mod' }],
        ['reset', {}],
        ['delta', { text: 'The fallback model answers.' }],
        ['done', { answer: 'The fallback model answers.', buttons: [], suggestions: [] }],
      ),
    })
    let shown = ''
    const final = await streamChat({ message: 'hi' }, { onDelta: (chunk) => { shown += chunk }, onReset: () => { shown = '' } })
    expect(shown).toBe('The fallback model answers.')
    expect(final.answer).toBe('The fallback model answers.')
  })
})
