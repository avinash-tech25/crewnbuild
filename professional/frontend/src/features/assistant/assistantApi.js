import { API_BASE_URL, apiClient, csrfHeaders } from '../../shared/api/apiClient.js'

/**
 * Viswa, the help assistant (backend: app/modules/assistant). Who is asking comes from the
 * session cookie only; the browser never sends a user id or a role, and never sees the AI
 * key. The chat answer is streamed (Server-Sent Events) through our own backend, so it is
 * read with fetch (EventSource cannot POST or send the CSRF header).
 */

export const fetchWelcome = async () => (await apiClient.get('/assistant/welcome')).data
export const fetchHistory = async () => (await apiClient.get('/assistant/history')).data
export const clearHistory = async () => (await apiClient.delete('/assistant/history')).data
export const voteOnAnswer = async (messageId, vote) =>
  (await apiClient.put(`/assistant/messages/${encodeURIComponent(messageId)}/vote`, { vote })).data

export class AssistantError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function postChat(body, signal) {
  return fetch(`${API_BASE_URL}/assistant/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...csrfHeaders() },
    body: JSON.stringify(body),
    signal,
  })
}

/** Splits a Server-Sent Events text into { event, data } records. */
export function parseEvents(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/)
      const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim()
      const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      if (!event || !data) return null
      try {
        return { event, data: JSON.parse(data) }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * Sends one question and calls onDelta(text) for each chunk of the answer as it arrives,
 * then resolves with the final "done" record (cleaned answer, buttons, suggestions).
 */
export async function streamChat(body, { onDelta, signal } = {}) {
  let response = await postChat(body, signal)
  if (response.status === 403) {
    // After a page reload the CSRF token is gone from memory: read the session once, retry.
    const detail = await response.clone().json().catch(() => ({}))
    if (detail?.detail?.code === 'CSRF_FAILED') {
      await apiClient.get('/auth/session').catch(() => {})
      response = await postChat(body, signal)
    }
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    const message = typeof detail?.detail === 'string' ? detail.detail : detail?.detail?.message
    throw new AssistantError(message || '', response.status)
  }
  let final = null
  const handle = (record) => {
    if (record.event === 'delta') onDelta?.(record.data.text || '')
    else if (record.event === 'done') final = record.data
    else if (record.event === 'error') throw new AssistantError(record.data.message || '', 503)
  }
  const reader = response.body?.getReader?.()
  if (reader) {
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const cut = buffer.lastIndexOf('\n\n')
      if (cut >= 0) {
        parseEvents(buffer.slice(0, cut)).forEach(handle)
        buffer = buffer.slice(cut + 2)
      }
    }
    parseEvents(buffer).forEach(handle)
  } else {
    parseEvents(await response.text()).forEach(handle)
  }
  if (!final) throw new AssistantError('', 503)
  return final
}
