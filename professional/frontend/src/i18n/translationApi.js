import { baseApi } from '../shared/api/baseApi.js'
import { runMutation } from '../shared/api/callEndpoint.js'

// Display translation of text people typed (project descriptions, names, company details).
// The interface's own words come from translations.js and never pass through here. The
// server answers source string -> string to display; `configured` false means no provider
// key is set, the signal to stop asking.
export const translationApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    translate: build.mutation({ query: (body) => ({ url: '/translate', method: 'POST', data: body }) }),
  }),
})

export async function translateTexts(texts, target) {
  const data = await runMutation(translationApi.endpoints.translate, { texts, target })
  return { translations: data?.translations || {}, configured: data?.configured !== false }
}

// The server refuses more than this in one request.
export const MAX_TEXTS_PER_REQUEST = 100
