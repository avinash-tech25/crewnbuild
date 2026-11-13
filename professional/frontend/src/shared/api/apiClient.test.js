import { describe, expect, it, vi } from 'vitest'
import { anAccount, installFakeServer } from '../../test/fakeServer.js'
import { apiClient, currentCsrfToken, onSessionEvent, setCsrfToken } from './apiClient.js'
import { createAppStore } from '../../app/store.js'
import { loginUser } from '../../features/auth/authApi.js'
import { ApiError } from './callEndpoint.js'

describe('the API client', () => {
  it('sends credentials, and the CSRF token on writes only', async () => {
    const server = installFakeServer({ 'GET /things': { data: [] }, 'POST /things': { data: {} } })
    setCsrfToken('csrf-1')
    await apiClient.get('/things')
    await apiClient.post('/things', {})
    expect(apiClient.defaults.withCredentials).toBe(true)
    expect(apiClient.defaults.baseURL).toBe('http://api.test/api/v1')
    expect(server.calls('GET /things')[0].headers['X-CSRF-Token']).toBeUndefined()
    expect(server.calls('POST /things')[0].headers['X-CSRF-Token']).toBe('csrf-1')
  })

  it('keeps the CSRF token a sign-in returns, in memory only', async () => {
    createAppStore()
    installFakeServer({ 'POST /auth/login': { data: { user: anAccount(), csrf_token: 'from-login' } } })
    await loginUser({ email: ' Asha@Example.in ', password: 'Secret#123' })
    expect(currentCsrfToken()).toBe('from-login')
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('from-login')
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('from-login')
  })

  it('refreshes once for many requests failing together, then retries each once', async () => {
    let accepted = false
    const server = installFakeServer({
      'GET /a': () => (accepted ? { data: 'a' } : { status: 401, data: { detail: 'expired' } }),
      'GET /b': () => (accepted ? { data: 'b' } : { status: 401, data: { detail: 'expired' } }),
      'POST /auth/refresh': () => {
        accepted = true
        return { data: { user: anAccount(), csrf_token: 'csrf-2' } }
      },
    })
    const [a, b] = await Promise.all([apiClient.get('/a'), apiClient.get('/b')])
    expect([a.data, b.data]).toEqual(['a', 'b'])
    expect(server.calls('POST /auth/refresh')).toHaveLength(1)
    expect(server.calls('GET /a')).toHaveLength(2)
    expect(currentCsrfToken()).toBe('csrf-2')
  })

  it('retries only once, and ends the session when the refresh is refused', async () => {
    const ended = vi.fn()
    const stop = onSessionEvent('ended', ended)
    const server = installFakeServer({
      'GET /private': { status: 401, data: { detail: 'expired' } },
      'POST /auth/refresh': { status: 401, data: { detail: 'Session expired. Please sign in again.' } },
    })
    await expect(apiClient.get('/private')).rejects.toMatchObject({ response: { status: 401 } })
    expect(server.calls('GET /private')).toHaveLength(1)
    expect(ended).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a refresh another tab just made is not a sign-out: the request is retried', async () => {
    let calls = 0
    installFakeServer({
      'GET /private': () => (calls++ === 0 ? { status: 401, data: {} } : { data: 'ok' }),
      'POST /auth/refresh': { status: 401, data: { detail: 'REFRESH_SUPERSEDED' } },
    })
    await expect(apiClient.get('/private')).resolves.toMatchObject({ data: 'ok' })
  })

  it('recovers a CSRF token lost to a reload once, and replays the write', async () => {
    let attempts = 0
    const server = installFakeServer({
      'POST /things': (request) =>
        attempts++ === 0 ? { status: 403, data: { detail: { code: 'CSRF_FAILED' } } } : { data: request.headers['X-CSRF-Token'] },
      'GET /auth/session': { data: { user: anAccount(), csrf_token: 'recovered' } },
    })
    const answer = await apiClient.post('/things', {})
    expect(answer.data).toBe('recovered')
    expect(server.calls('GET /auth/session')).toHaveLength(1)
  })

  it('sign-in requests never trigger a refresh of their own', async () => {
    const server = installFakeServer({ 'POST /auth/login': { status: 401, data: { detail: 'Invalid' } } })
    await expect(apiClient.post('/auth/login', {})).rejects.toBeTruthy()
    expect(server.calls('POST /auth/refresh')).toHaveLength(0)
  })

  it('an endpoint failure keeps the shape the screens read (response.status, data.detail)', async () => {
    createAppStore()
    installFakeServer({ 'POST /auth/login': { status: 429, data: { detail: 'Too many failed sign-in attempts.' } } })
    const failure = await loginUser({ email: 'a@b.in', password: 'x' }).catch((error) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure.response).toEqual({ status: 429, data: { detail: 'Too many failed sign-in attempts.' } })
  })
})
