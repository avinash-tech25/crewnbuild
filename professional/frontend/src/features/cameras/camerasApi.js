import { API_BASE_URL, csrfHeaders } from '../../shared/api/apiClient.js'
import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

/**
 * Live Camera (CCTV). None of these answers contains a camera address, stream path or
 * credential. A playback session's `playback_token` is returned once, by
 * startPlaybackSession; callers keep it in memory only (never in React state, Redux,
 * browser storage, a URL or a log line). The recorder password of the first-time setup
 * travels in the POST body only and is dropped as soon as the request resolves.
 *
 * Playback answers are kept out of the RTK Query cache (runMutation does not track them),
 * so the token never sits in the store.
 */
export const camerasApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    cameraSetup: build.query({ query: (projectId) => ({ url: `/cctv/projects/${projectId}/camera-setup` }) }),
    connectCamera: build.mutation({
      query: ({ projectId, body }) => ({ url: `/cctv/projects/${projectId}/camera-setup`, method: 'POST', data: body }),
    }),
    cameraDevices: build.query({ query: (projectId) => ({ url: `/cctv/projects/${projectId}/devices` }) }),
    startPlayback: build.mutation({
      query: ({ channelId, body }) => ({ url: `/cctv/channels/${channelId}/playback`, method: 'POST', data: body }),
    }),
    searchRecordings: build.mutation({
      query: ({ channelId, window }) => ({ url: `/cctv/channels/${channelId}/recordings/search`, method: 'POST', data: window }),
    }),
    startRecordedPlayback: build.mutation({
      query: ({ channelId, body }) => ({ url: `/cctv/channels/${channelId}/recordings/playback`, method: 'POST', data: body }),
    }),
    renewPlayback: build.mutation({ query: (sessionId) => ({ url: `/cctv/playback/${sessionId}/renew`, method: 'POST' }) }),
    endPlayback: build.mutation({ query: (sessionId) => ({ url: `/cctv/playback/${sessionId}`, method: 'DELETE' }) }),
  }),
})

const { endpoints } = camerasApi

// --- first-time camera setup: each person verifies the project's recorder once ---
export const fetchProjectCameraSetup = (projectId) => runQuery(endpoints.cameraSetup, projectId)

export function connectProjectCamera(projectId, { deviceType, host, port, rtspPort, username, password }) {
  // `port` is the ONVIF port. `rtspPort` is sent only when the installer typed one; the
  // server defaults it to 554.
  const device = { device_type: deviceType, host, port: Number(port) }
  const rtsp = String(rtspPort ?? '').trim()
  if (rtsp) device.rtsp_port = Number(rtsp)
  return runMutation(endpoints.connectCamera, { projectId, body: { device, credentials: { username, password } } })
}

export const fetchProjectCameraDevices = (projectId) => runQuery(endpoints.cameraDevices, projectId)

export function startPlaybackSession(channelId, { transport = 'LL_HLS', streamVariant } = {}) {
  const body = { transport }
  if (streamVariant) body.stream_variant = streamVariant
  return runMutation(endpoints.startPlayback, { channelId, body })
}

// Recorded playback: `start`/`end` are local-time ISO strings (YYYY-MM-DDTHH:MM:SS).
// Speed is applied by the recorder; only '1', '1.5', '2', '3'.
export const searchRecordings = (channelId, { start, end }) => runMutation(endpoints.searchRecordings, { channelId, window: { start, end } })

export const startRecordedPlayback = (channelId, { start, end, speed = '1', streamVariant = 'MAIN' }) =>
  runMutation(endpoints.startRecordedPlayback, {
    channelId,
    body: { start, end, speed, stream_variant: streamVariant, transport: 'LL_HLS' },
  })

export const renewPlaybackSession = (sessionId) => runMutation(endpoints.renewPlayback, sessionId)
export const endPlaybackSession = (sessionId) => runMutation(endpoints.endPlayback, sessionId)

// For a tab that is closing, where a normal request would be cancelled with the page:
// `keepalive` lets the browser finish it. Best effort: a session not ended here stops
// being renewed and expires on the server.
export function endPlaybackSessionOnPageExit(sessionId) {
  try {
    fetch(`${API_BASE_URL}/cctv/playback/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: csrfHeaders(),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // The page is going away; nothing further to do.
  }
}
