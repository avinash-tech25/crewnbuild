/**
 * What an administrator may see in the console, from the permissions GET /admin/me
 * returns (the same names the server checks: app/modules/admin/admin_identity.py). A
 * Global or Location Super Admin holds every permission; a Manager only its grants.
 * Hiding is a convenience: the server refuses every call the permission does not cover.
 */

// The permission each section needs (null: every administrator).
export const SECTION_PERMISSIONS = {
  dashboard: null,
  users: 'users.view',
  projects: 'projects.view',
  leads: 'projects.view',
  verification: 'verification.view',
  reports: 'reports.view',
  notifications: 'users.view',
  admins: 'admins.manage',
  ads: 'ads.view',
  audit: 'audit.view',
  catalog: 'catalog.view',
  coupons: 'coupons.view',
  'subscription-payments': 'subscriptions.view',
  'account-deletion': 'deletions.view',
  support: 'support.view',
  mobile: null,
}

export function can(identity, permission) {
  if (!permission) return Boolean(identity)
  return Array.isArray(identity?.permissions) && identity.permissions.includes(permission)
}

/** Whether `identity` may open the section an address like "users?status=x" points at. */
export function mayOpen(identity, target) {
  const section = String(target || '').split(/[/?]/)[0] || 'dashboard'
  return can(identity, SECTION_PERMISSIONS[section] ?? null)
}
