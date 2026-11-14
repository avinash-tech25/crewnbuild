/**
 * Calling an RTK Query endpoint from code that is not a component (a form's submit
 * handler, a thunk): `await runMutation(authApi.endpoints.login, payload)`.
 *
 * The screens ported from the old app handle errors the way axios shaped them
 * (error.response.status, error.response.data.detail, error.code), so a failure is
 * rethrown as an ApiError with that shape. The store binds its dispatch at start-up.
 */

let dispatchRequest = null

export function bindApiDispatch(dispatch) {
  dispatchRequest = dispatch
}

export class ApiError extends Error {
  constructor(failure) {
    super(failure?.message || `Request failed${typeof failure?.status === 'number' ? ` (${failure.status})` : ''}`)
    this.name = 'ApiError'
    // No response object when no answer came back, as with axios.
    this.response = typeof failure?.status === 'number' ? { status: failure.status, data: failure.data } : undefined
    this.code = failure?.code
  }
}

function dispatchOrThrow(action) {
  if (!dispatchRequest) throw new Error('The API is not bound to the store yet.')
  return dispatchRequest(action)
}

async function unwrapOrThrow(request) {
  try {
    return await request.unwrap()
  } catch (failure) {
    throw new ApiError(failure)
  }
}

/** A query endpoint, fetched now (never from a stale cache), not kept subscribed. */
export function runQuery(endpoint, arg) {
  return unwrapOrThrow(dispatchOrThrow(endpoint.initiate(arg, { subscribe: false, forceRefetch: true })))
}

/** A mutation endpoint; its result is not kept in the store. */
export function runMutation(endpoint, arg) {
  return unwrapOrThrow(dispatchOrThrow(endpoint.initiate(arg, { track: false })))
}
