import { baseApi } from '../../shared/api/baseApi.js'
import { runMutation } from '../../shared/api/callEndpoint.js'

// Passwords. Every value travels in a request body (never a URL), and nothing here keeps
// a password, a code or a reset token.
const passwordEndpoints = baseApi.injectEndpoints({
  endpoints: (build) => ({
    techChangePassword: build.mutation({ query: (body) => ({ url: '/technicians/me/password', method: 'PUT', data: body }) }),
    passwordResetSendCode: build.mutation({ query: (email) => ({ url: '/auth/password-reset/send-code', method: 'POST', data: { email } }) }),
    passwordResetVerifyCode: build.mutation({ query: (body) => ({ url: '/auth/password-reset/verify-code', method: 'POST', data: body }) }),
    passwordResetReset: build.mutation({ query: (body) => ({ url: '/auth/password-reset/reset', method: 'POST', data: body }) }),
  }),
})

const { endpoints } = passwordEndpoints

export const passwordApi = {
  /** Signed in. */
  change: ({ currentPassword, newPassword, confirmPassword }) =>
    runMutation(endpoints.techChangePassword, {
      current_password: currentPassword,
      new_password: newPassword,
      confirm_new_password: confirmPassword,
    }),
  /** Forgot password, step 1. The answer is the same whether or not the email has an account. */
  sendResetCode: (email) => runMutation(endpoints.passwordResetSendCode, email),
  /** Step 2: the emailed code, exchanged for a short-lived reset token. */
  verifyResetCode: (email, code) => runMutation(endpoints.passwordResetVerifyCode, { email, code }),
  /** Step 3: the new password, allowed only with that token. */
  resetPassword: ({ resetToken, newPassword, confirmPassword }) =>
    runMutation(endpoints.passwordResetReset, { reset_token: resetToken, new_password: newPassword, confirm_new_password: confirmPassword }),
}
