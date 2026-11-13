/**
 * The roles of Professional (technical-architecture.md 7.1) and what each may do (7.2).
 *
 * The account answer names the stored role: OWNER, BUILDER (CONTRACTOR before R4b),
 * SUPPLIER, ENGINEER, or an administrator role. Like the server (identity/policies.py,
 * session_role), an ENGINEER is a SITE_ENGINEER or a STORE_MANAGER by the category of
 * their profile (read here from the specialization the answer carries).
 *
 * This only decides what the screens show: the server checks every request again.
 */

// The marketplace roles, as the account answer names them.
export const MARKETPLACE_ROLES = ['OWNER', 'BUILDER', 'SUPPLIER', 'ENGINEER']

// The administrators, who have a dashboard here but no marketplace profile.
export const ADMIN_ROLES = ['GLOBAL_SUPER_ADMIN', 'LOCATION_SUPER_ADMIN', 'MANAGER']

// Everyone this application keeps a session for.
export const SIGNED_IN_ROLES = [...MARKETPLACE_ROLES, ...ADMIN_ROLES]

// The two engineer categories that change what an engineer may do.
export const SITE_ENGINEER_CATEGORY = 'Site Engineer'
export const STORE_MANAGER_CATEGORY = 'Store Manager'

const sameCategory = (value, category) => String(value || '').trim().toLowerCase() === category.toLowerCase()

/** The role the screens act on: the stored role, or an engineer's category role. */
export function accessRole(user) {
  if (!user) return null
  if (user.role === 'ENGINEER') {
    const specialization = user.engineer_profile?.specialization
    if (sameCategory(specialization, STORE_MANAGER_CATEGORY)) return 'STORE_MANAGER'
    if (sameCategory(specialization, SITE_ENGINEER_CATEGORY)) return 'SITE_ENGINEER'
  }
  return user.role
}

export function isAdministrator(user) {
  return ADMIN_ROLES.includes(user?.role)
}

// ---- permissions (7.2): the same map as the server's app/auth/permissions.py ----

export const PERMISSIONS = {
  HANDOFF_CREATE: 'handoff:create',
}

const ROLE_PERMISSIONS = {
  OWNER: [PERMISSIONS.HANDOFF_CREATE],
  BUILDER: [],
  SITE_ENGINEER: [PERMISSIONS.HANDOFF_CREATE],
  STORE_MANAGER: [],
  SUPPLIER: [],
}

/** Whether this account's role may take this kind of action at all. */
export function hasPermission(user, permission) {
  return (ROLE_PERMISSIONS[accessRole(user)] || []).includes(permission)
}
