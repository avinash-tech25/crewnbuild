import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation, runQuery } from '../../shared/api/callEndpoint.js'

// Sign-in answers carry the account and this session's CSRF token (apiClient keeps the
// token); the session itself arrives as HttpOnly cookies the page never sees.
export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    login: build.mutation({ query: (body) => ({ url: '/auth/login', method: 'POST', data: body }) }),
    accountRecoveryConfig: build.query({ query: () => ({ url: '/auth/recovery/config' }) }),
    loginWithPhoneCode: build.mutation({ query: (body) => ({ url: '/auth/phone/login/verify-code', method: 'POST', data: body }) }),
    session: build.query({
      query: ({ skipRefresh = false } = {}) => ({ url: '/auth/session', skipRefresh }),
      providesTags: ['Session'],
    }),
    signup: build.mutation({ query: (body) => ({ url: '/auth/signup', method: 'POST', data: body }) }),
    completeProfile: build.mutation({ query: (body) => ({ url: '/auth/complete-profile', method: 'PATCH', data: body }) }),
    saveSupplierCategory: build.mutation({ query: (body) => ({ url: '/auth/supplier-category', method: 'PATCH', data: body }) }),
    saveEngineerCategory: build.mutation({ query: (body) => ({ url: '/auth/engineer-category', method: 'PATCH', data: body }) }),
    updateProfileImage: build.mutation({
      query: (profileImageUrl) => ({ url: '/auth/profile-image', method: 'PATCH', data: { profile_image_url: profileImageUrl } }),
    }),
    partnerHandoff: build.mutation({ query: () => ({ url: '/auth/partner-handoff', method: 'POST' }) }),
  }),
})

const codeDigits = (code) => (Array.isArray(code) ? code.join('') : String(code || ''))

export function loginUser(credentials) {
  return runMutation(authApi.endpoints.login, {
    email: credentials.email.trim().toLowerCase(),
    password: credentials.password,
  })
}

// Whether this server shows the development-only /account-recovery page.
export function readAccountRecoveryConfig() {
  return runQuery(authApi.endpoints.accountRecoveryConfig)
}

// The WhatsApp sign-in: a correct LOGIN code answers like a password sign-in.
export function loginWithPhoneCode({ phone, code }) {
  return runMutation(authApi.endpoints.loginWithPhoneCode, { phone, code: codeDigits(code) })
}

// The account the browser's session really belongs to, read from the database (never
// from anything the browser sent). An expired access cookie is renewed once on the way.
export function verifySession({ skipRefresh = false } = {}) {
  return runQuery(authApi.endpoints.session, { skipRefresh })
}

export function signupUser(profileDetails) {
  return runMutation(authApi.endpoints.signup, profileDetails)
}

export function completeUserProfile(profileDetails) {
  return runMutation(authApi.endpoints.completeProfile, profileDetails)
}

// The server reads the account from the session, so no identifier is sent.
export function saveSupplierCategory(category) {
  return runMutation(authApi.endpoints.saveSupplierCategory, { supplier_category: category })
}

// The new engineer's Engineer Category, chosen once.
export function saveEngineerCategory(category) {
  return runMutation(authApi.endpoints.saveEngineerCategory, { specialization: category })
}

/** A one-time hand-off token for Partner (about a minute, single use), or null. */
export async function requestPartnerHandoffToken() {
  try {
    const answer = await runMutation(authApi.endpoints.partnerHandoff)
    return answer?.handoff_token || null
  } catch {
    return null
  }
}

export const updateUserProfileImage = (profileImageUrl) => runMutation(authApi.endpoints.updateProfileImage, profileImageUrl)
