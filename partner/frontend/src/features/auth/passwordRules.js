/**
 * The Partner password rule, as the backend applies it (utils/security.py
 * password_is_strong) and as registration shows it. A convenience only: the server
 * checks again and its answer is shown as sent. No imports: loaded by unit tests.
 */

export const PASSWORD_RULE = 'Password must have 10 to 72 characters with upper, lower, number, and symbol.'
const MAX_BYTES = 72

export function passwordIsStrong(password) {
  const value = password ?? ''
  return value.length >= 10 && new TextEncoder().encode(value).length <= MAX_BYTES
    && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^\w\s]/.test(value)
}

/** { field: message } for a new password and its confirmation; empty when valid. */
export function newPasswordProblems({ newPassword, confirmPassword, currentPassword }) {
  const problems = {}
  if (!passwordIsStrong(newPassword)) problems.new = PASSWORD_RULE
  else if (currentPassword !== undefined && newPassword === currentPassword) {
    problems.new = 'Choose a new password that is different from your current one.'
  }
  if (!problems.new && (confirmPassword ?? '') !== newPassword) problems.confirm = 'The new passwords do not match.'
  return problems
}

/** Six digits, whatever else was typed or pasted around them. */
export function cleanCode(value) {
  return (value ?? '').replace(/\D/g, '').slice(0, 6)
}
