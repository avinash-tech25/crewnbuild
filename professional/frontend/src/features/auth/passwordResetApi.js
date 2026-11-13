import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

// Password recovery. The API answers the same whether or not an address has an account.
export const passwordResetApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    sendResetCode: build.mutation({ query: (body) => ({ url: '/auth/password/forgot', method: 'POST', data: body }) }),
    verifyResetCode: build.mutation({ query: (body) => ({ url: '/auth/password/verify-code', method: 'POST', data: body }) }),
    resetPassword: build.mutation({ query: (body) => ({ url: '/auth/password/reset', method: 'POST', data: body }) }),
  }),
})

const codeDigits = (code) => (Array.isArray(code) ? code.join('') : String(code || ''))

export const sendResetCode = (email) => runMutation(passwordResetApi.endpoints.sendResetCode, { email })
export const verifyResetCode = (email, code) => runMutation(passwordResetApi.endpoints.verifyResetCode, { email, code: codeDigits(code) })
export const resetPassword = (email, password) => runMutation(passwordResetApi.endpoints.resetPassword, { email, password })
