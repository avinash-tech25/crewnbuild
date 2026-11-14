import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../app/store.js'
import { installFakeServer } from '../../test/fakeServer.js'
import { apiClient, bookingClient, readRequesterSession, requesterSession, storeRequesterSession, technicianSession } from './apiClient.js'

createAppStore()

describe('the two session clients', () => {
  it("send each principal's own CSRF token on writes, never the other's, and none on reads", async () => {
    const server = installFakeServer({ 'PATCH /technicians/me': { data: {} }, 'POST /requester/bookings': { data: {} }, 'GET /technicians/me/dashboard': { data: {} } })
    technicianSession.setCsrf('csrf-tech')
    technicianSession.setActive(true)
    storeRequesterSession({ csrf_token: 'csrf-req', expires_in_seconds: 3600, requester: { id: 'r' } })
    await apiClient.patch('/technicians/me', {})
    await bookingClient.post('/requester/bookings', {})
    await apiClient.get('/technicians/me/dashboard')
    expect(server.calls('PATCH /technicians/me')[0].headers['X-CSRF-Token']).toBe('csrf-tech')
    expect(server.calls('POST /requester/bookings')[0].headers['X-CSRF-Token']).toBe('csrf-req')
    expect(server.calls('GET /technicians/me/dashboard')[0].headers['X-CSRF-Token']).toBeUndefined()
  })

  it('refresh a technician session once for many requests failing together, then retry each once', async () => {
    let refreshed = false
    const server = installFakeServer({
      'GET /technicians/me/offers': () => (refreshed ? { data: [] } : { status: 401, data: {} }),
      'GET /technicians/me/jobs': () => (refreshed ? { data: [] } : { status: 401, data: {} }),
      'POST /auth/refresh': () => {
        refreshed = true
        return { data: { csrf_token: 'csrf-new', session_type: 'partner' } }
      },
    })
    technicianSession.setActive(true)
    await Promise.all([apiClient.get('/technicians/me/offers'), apiClient.get('/technicians/me/jobs')])
    expect(server.calls('POST /auth/refresh')).toHaveLength(1)
    expect(server.calls('GET /technicians/me/offers')).toHaveLength(2)
    expect(technicianSession.currentCsrf()).toBe('csrf-new')
  })

  it("end the technician session when its refresh is refused, without touching the booking session", async () => {
    installFakeServer({
      'GET /technicians/me/offers': { status: 401, data: {} },
      'POST /auth/refresh': { status: 401, data: { detail: 'Session expired' } },
    })
    technicianSession.setActive(true)
    storeRequesterSession({ csrf_token: 'csrf-req', expires_in_seconds: 3600, requester: { id: 'r' } })
    const ended = vi.fn()
    const stop = technicianSession.onSessionEnded(ended)
    await expect(apiClient.get('/technicians/me/offers')).rejects.toMatchObject({ response: { status: 401 } })
    stop()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(technicianSession.isActive()).toBe(false)
    expect(readRequesterSession()).not.toBeNull()
  })

  it('refresh a booking session on its own address, and do not retry a request twice', async () => {
    const server = installFakeServer({
      'GET /requester/bookings': { status: 401, data: {} },
      'POST /requester/refresh': { data: { csrf_token: 'csrf-req-2', expires_in_seconds: 3600, requester: { id: 'r' } } },
    })
    storeRequesterSession({ csrf_token: 'csrf-req', expires_in_seconds: 3600, requester: { id: 'r' } })
    await expect(bookingClient.get('/requester/bookings')).rejects.toMatchObject({ response: { status: 401 } })
    expect(server.calls('POST /requester/refresh')).toHaveLength(1)
    expect(server.calls('POST /auth/refresh')).toHaveLength(0)
    expect(server.calls('GET /requester/bookings')).toHaveLength(2)
    expect(requesterSession.currentCsrf()).toBe('csrf-req-2')
  })

  it('never refresh for a principal with no session in this tab', async () => {
    const server = installFakeServer({ 'GET /technicians/me/offers': { status: 401, data: {} } })
    await expect(apiClient.get('/technicians/me/offers')).rejects.toBeTruthy()
    expect(server.calls('POST /auth/refresh')).toHaveLength(0)
  })

  it('recover a lost CSRF token once and replay the write', async () => {
    let attempts = 0
    const server = installFakeServer({
      'PUT /technicians/me/work-preferences': (request) => {
        attempts += 1
        return request.headers['X-CSRF-Token'] === 'csrf-recovered' ? { data: {} } : { status: 403, data: { detail: { code: 'CSRF_FAILED' } } }
      },
      'GET /auth/me': { data: { csrf_token: 'csrf-recovered' } },
    })
    technicianSession.setActive(true)
    await apiClient.put('/technicians/me/work-preferences', {})
    expect(attempts).toBe(2)
    expect(server.calls('GET /auth/me')).toHaveLength(1)
  })

  it('keep nothing about either session in browser storage', () => {
    technicianSession.setActive(true)
    storeRequesterSession({ csrf_token: 'csrf-req', expires_in_seconds: 3600, requester: { id: 'r', name: 'Asha Rao' } })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
