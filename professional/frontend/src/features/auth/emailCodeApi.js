import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

// The six-digit e-mail checks: sign-up, and Profile Settings adding an address. The code
// is only ever e-mailed (or shown by the development preview to this machine).
export const emailCodeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    sendEmailCode: build.mutation({ query: (body) => ({ url: '/auth/email/send-code', method: 'POST', data: body }) }),
    verifyEmailCode: build.mutation({ query: (body) => ({ url: '/auth/email/verify-code', method: 'POST', data: body }) }),
    sendProfileEmailCode: build.mutation({ query: (body) => ({ url: '/auth/email/profile/send-code', method: 'POST', data: body }) }),
    verifyProfileEmailCode: build.mutation({ query: (body) => ({ url: '/auth/email/profile/verify-code', method: 'POST', data: body }) }),
  }),
})

const codeDigits = (code) => (Array.isArray(code) ? code.join('') : String(code || ''))

export const sendEmailCode = (email) => runMutation(emailCodeApi.endpoints.sendEmailCode, { email })
export const verifyEmailCode = (email, code) => runMutation(emailCodeApi.endpoints.verifyEmailCode, { email, code: codeDigits(code) })
// Profile Settings: the address is saved, verified, only once the code checks out; the
// reply then carries the updated account.
export const sendProfileEmailCode = (email) => runMutation(emailCodeApi.endpoints.sendProfileEmailCode, { email })
export const verifyProfileEmailCode = (email, code) =>
  runMutation(emailCodeApi.endpoints.verifyProfileEmailCode, { email, code: codeDigits(code) })
