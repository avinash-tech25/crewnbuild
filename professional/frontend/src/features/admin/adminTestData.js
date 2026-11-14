import { anAccount } from '../../test/fakeServer.js'

// Server answers for the admin console tests, shaped like the backend's.
export const ALL_PERMISSIONS = [
  'users.view', 'users.suspend', 'projects.view', 'verification.view', 'verification.decide', 'reports.view',
  'reports.resolve', 'audit.view', 'ads.view', 'ads.manage', 'admins.manage', 'catalog.view', 'catalog.manage',
  'coupons.view', 'coupons.manage', 'subscriptions.view', 'deletions.view', 'deletions.manage', 'support.view', 'support.manage',
]

const ROLE_OF = { global: 'GLOBAL_SUPER_ADMIN', location: 'LOCATION_SUPER_ADMIN', manager: 'MANAGER' }

export const anAdminAccount = (kind = 'global') =>
  anAccount({ id: '0190a8b2-4c1e-7aa0-9f00-00000000ad01', role: ROLE_OF[kind], name: 'Priya Admin', email: 'priya@crewnbuild.test' })

/** GET /admin/me. A Super Admin holds every permission; a Manager only `permissions`. */
export const anIdentity = (kind = 'global', permissions = ALL_PERMISSIONS) => ({
  id: '0190a8b2-4c1e-7aa0-9f00-00000000ad01',
  name: 'Priya Admin',
  email: 'priya@crewnbuild.test',
  role: ROLE_OF[kind],
  scope: kind === 'global' ? 'GLOBAL' : 'IN',
  phone: '',
  is_global: kind === 'global',
  permissions: kind === 'manager' ? [...permissions].sort() : ALL_PERMISSIONS,
  permission_catalogue: Object.fromEntries(ALL_PERMISSIONS.map((name) => [name, name])),
})

export const USER_ID = '0190a8b2-4c1e-7aa0-9f00-000000000001'

export const aUserRow = (overrides = {}) => ({
  id: USER_ID,
  name: 'Asha Rao',
  email: 'asha@example.in',
  phone: '9876543210',
  role: 'OWNER',
  supplier_category: null,
  country: 'IN',
  pincode: '560001',
  locality: 'IN',
  status: 'ACTIVE',
  profile_complete: true,
  // Only builders and suppliers submit documents; null for the rest (as the server sends).
  verification_status: null,
  verified: false,
  rating: 0,
  created_at: '2026-11-01T10:00:00+05:30',
  ...overrides,
})

/** Every call the console may make while open, answered empty unless given. */
export const adminServer = (identity, overrides = {}) => ({
  'GET /admin/me': { data: identity },
  'GET /admin/overview': { data: { attention: {}, countries: [] } },
  'GET /notifications': { data: [] },
  'GET /ads': { data: [] },
  'GET /weather/summary': { data: null },
  ...overrides,
})
