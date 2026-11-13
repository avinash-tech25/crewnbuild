import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// The WhatsApp check of an Indian mobile number. The code is sent by WhatsApp and never
// returned by the API (except the development preview to this machine).

// A hung request counts as no answer, so the page can ask again.
const CONFIG_TIMEOUT_MS = 8000

export const phoneCodeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    phoneVerificationConfig: build.query({ query: () => ({ url: '/auth/phone/config', timeout: CONFIG_TIMEOUT_MS }) }),
    sendPhoneCode: build.mutation({ query: (body) => ({ url: '/auth/phone/send-code', method: 'POST', data: body }) }),
    verifyPhoneCode: build.mutation({ query: (body) => ({ url: '/auth/phone/verify-code', method: 'POST', data: body }) }),
    sendPhoneLoginCode: build.mutation({ query: (body) => ({ url: '/auth/phone/login/send-code', method: 'POST', data: body }) }),
    changeAccountPhone: build.mutation({ query: (body) => ({ url: '/auth/phone/change', method: 'POST', data: body }) }),
  }),
})

const codeDigits = (code) => (Array.isArray(code) ? code.join('') : String(code || ''))

export const readPhoneVerificationConfig = () => runQuery(phoneCodeApi.endpoints.phoneVerificationConfig)
export const sendPhoneCode = (phone) => runMutation(phoneCodeApi.endpoints.sendPhoneCode, { phone })
export const verifyPhoneCode = (phone, code) => runMutation(phoneCodeApi.endpoints.verifyPhoneCode, { phone, code: codeDigits(code) })
// WhatsApp sign-in for a registered +91 number: the reply is the same whether or not the
// number has an account.
export const sendPhoneLoginCode = (phone) => runMutation(phoneCodeApi.endpoints.sendPhoneLoginCode, { phone })
// Profile Settings: replace the account's number with one that just passed the check.
export const changeAccountPhone = (phone, verificationToken) =>
  runMutation(phoneCodeApi.endpoints.changeAccountPhone, { phone, phone_verification_token: verificationToken })
