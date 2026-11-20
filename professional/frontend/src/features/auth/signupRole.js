// The role a sign-up link preselects. No React, no network.

const DEFAULT_SIGNUP_ROLE = 'OWNER'

// By the key the landing page uses (/signup?role=home|builder|engineer|supplier) or
// by the API role code itself (/signup?role=CONTRACTOR, the footer and invite links).
export const SIGNUP_LINK_ROLES = { home: 'OWNER', builder: 'BUILDER', engineer: 'ENGINEER', supplier: 'SUPPLIER' }
// Old links name the Builder role CONTRACTOR (the role is called BUILDER since R4b).
const LEGACY_ROLE_CODES = { CONTRACTOR: 'BUILDER' }

/** The role /signup?role= names, else Owner: a key, a role code, or nothing usable. */
export function signupRoleFromLink(requestedRole) {
  const requested = String(requestedRole || '').trim()
  if (!requested) return DEFAULT_SIGNUP_ROLE
  const byKey = SIGNUP_LINK_ROLES[requested.toLowerCase()]
  if (byKey) return byKey
  const code = LEGACY_ROLE_CODES[requested.toUpperCase()] || requested.toUpperCase()
  return Object.values(SIGNUP_LINK_ROLES).includes(code) ? code : DEFAULT_SIGNUP_ROLE
}
