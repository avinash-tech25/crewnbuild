import { ADMIN_ROLES, MARKETPLACE_ROLES, accessRole } from './roles.js'

// Each dashboard's Profile Settings address (its Mobile number and Email sections).
export function settingsPath(role) {
  if (role === 'BUILDER') return '/contractor/profile-settings'
  if (role === 'SUPPLIER') return '/supplier/profile'
  if (role === 'ENGINEER') return '/engineer/profile'
  return '/owner/profile'
}

export function rolePath(role) {
  if (role === 'BUILDER') return '/contractor'
  if (role === 'SUPPLIER') return '/supplier'
  if (role === 'ENGINEER') return '/engineer'
  return '/owner'
}

// Role ENGINEER with the Store Manager category. Read from the account the server
// returned; the server decides for itself on every Store Manager route.
export const STORE_MANAGER_PATH = '/store-manager'

export function isStoreManager(user) {
  return accessRole(user) === 'STORE_MANAGER'
}

// The dashboard this account opens: its role's, except a Store Manager's.
export function dashboardPath(user) {
  return isStoreManager(user) ? STORE_MANAGER_PATH : rolePath(user?.role)
}

export function accountSettingsPath(user) {
  return isStoreManager(user) ? `${STORE_MANAGER_PATH}/profile` : settingsPath(user?.role)
}

// Whether this account still needs the pincode step: a marketplace account in
// India with no pincode saved, which is every account straight after signing
// up. Pincodes are looked up against India Post, so other countries skip it.
export function needsLocationPincode(user) {
  return Boolean(user?.id)
    && MARKETPLACE_ROLES.includes(user.role)
    && String(user.country_of_residence || 'India').trim().toLowerCase() === 'india'
    && !String(user.pincode || '').trim()
}

// Where an account lands straight after signup, login or OAuth: the pincode
// step while it has no pincode, otherwise its dashboard. An unfinished profile
// does not stop anyone at the door: the actions that need profile data ask for
// Complete Profile themselves (useProfileGate), and the server refuses them
// too. Every entry path uses this one rule. Administrators have no marketplace
// profile and always go to /admin.
export function postAuthPath(user) {
  if (ADMIN_ROLES.includes(user?.role)) return '/admin'
  if (needsLocationPincode(user)) return '/pincode'
  if (subscriptionCheckoutPending(user)) return SUBSCRIPTION_CHECKOUT_PATH
  return dashboardPath(user)
}

// A new supplier chooses a Supplier Category before the pincode step. Only sign-up
// asks: login keeps postAuthPath, so no existing supplier repeats anything.
export const SUPPLIER_CATEGORY_PATH = '/supplier-category'

export function supplierCategoryMissing(user) {
  return user?.role === 'SUPPLIER'
    && Boolean(user?.profile_completion?.missing_fields?.some(({ field }) => field === 'supplier_category'))
}

// A new engineer chooses an Engineer Category the same way, before the pincode step.
export const ENGINEER_CATEGORY_PATH = '/engineer-category'

export function engineerCategoryMissing(user) {
  return user?.role === 'ENGINEER'
    && Boolean(user?.profile_completion?.missing_fields?.some(({ field }) => field === 'specialization'))
}

/**
 * Where to go after signing in from a protected page (RequireAccess sent the visitor to
 * /login with that page as returnTo): back there, unless a step comes first (pincode,
 * checkout), which postAuthPath decides as before.
 */
export function afterSignInPath(user, returnTo) {
  const next = postAuthPath(user)
  const home = ADMIN_ROLES.includes(user?.role) ? '/admin' : dashboardPath(user)
  const safeReturn = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : ''
  return safeReturn && next === home ? safeReturn : next
}

export function postSignupPath(user) {
  if (supplierCategoryMissing(user)) return SUPPLIER_CATEGORY_PATH
  return engineerCategoryMissing(user) ? ENGINEER_CATEGORY_PATH : postAuthPath(user)
}

// A builder who signed up for Professional Pro or Premium pays before the
// dashboard: Sign up -> verify e-mail -> PIN code -> checkout -> dashboard. The
// server reports it (user.subscription_checkout) and refuses every other route
// until a verified payment, whatever this page shows.
export const SUBSCRIPTION_CHECKOUT_PATH = '/subscription-checkout'

export function subscriptionCheckoutPending(user) {
  return user?.role === 'BUILDER' && Boolean(user?.subscription_checkout?.plan_code)
}

export function readPendingEstimate() {
  try {
    return JSON.parse(localStorage.getItem('crewnbuild_pending_estimate') || 'null')
  } catch {
    return null
  }
}

export function floorCountFromEstimate(value) {
  if (value === 'Ground') return 1
  if (value === 'Ground + 1') return 2
  if (value === 'Ground + 2') return 3
  if (value === 'Ground + 3') return 4
  return 1
}

export function budgetNumberFromEstimate(value) {
  const budgetMap = {
    '10 - 15 Lakhs': 1500000,
    '15 - 25 Lakhs': 2500000,
    '25 - 30 Lakhs': 3000000,
    '30 - 50 Lakhs': 5000000,
    '50 Lakhs+': 5000000,
  }
  return budgetMap[value] || 0
}
export function apiErrorMessage(error, fallbackMessage) {
  // A check made in the browser before any request (see profileImageRules.js).
  if (error?.userMessage) return error.userMessage
  const detail = error.response?.data?.detail
  if (detail?.message) return detail.message
  if (Array.isArray(detail)) return detail.map((item) => item.msg || String(item)).join(', ') || fallbackMessage
  return detail || fallbackMessage
}

// `invalidMessage` is optional; callers can pass a translated fallback.
export function apiFieldErrors(error, invalidMessage = 'Invalid value.') {
  const detail = error.response?.data?.detail
  if (detail?.fields) return detail.fields
  if (!Array.isArray(detail)) return {}
  return detail.reduce((errors, item) => {
    const field = item.loc?.[item.loc.length - 1]
    if (field) errors[field] = item.msg || invalidMessage
    return errors
  }, {})
}

export function normalizePhone(value, maxLength = 10) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length > maxLength ? digits.slice(-maxLength) : digits
}

export function isIndiaResidence(country) {
  return String(country || 'India').trim().toLowerCase() === 'india'
}

export function phoneMaxLengthForCountry(country) {
  return isIndiaResidence(country) ? 10 : 8
}

export function isValidPhoneForCountry(phoneDigits, country) {
  if (isIndiaResidence(country)) return phoneDigits.length === 10
  return phoneDigits.length >= 8 && phoneDigits.length <= 15
}

export function isValidPostalCodeForCountry(pincodeDigits, country) {
  if (isIndiaResidence(country)) return /^\d{6}$/.test(pincodeDigits)
  return pincodeDigits.length >= 3 && pincodeDigits.length <= 10
}

// A builder's required profile fields still empty, with the same presence rules
// as User.profile_completion_fields() on the server. `saved` is the builder's
// saved profile (GET /contractors/{id}/profile, or null before one exists);
// phone, address and pincode fall back to the signed-in account, where sign-up
// and the PIN code step store them. Service locations are only the builder's own
// saved lead areas -- never the account address -- and stay required while none
// is saved.
export function missingContractorProfileFields(saved, user) {
  const listOf = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item).trim())
    .filter(Boolean)
  return [
    !(saved?.phone || user?.phone) && 'phone',
    !(saved?.address || user?.address) && 'address',
    !(saved?.pincode || user?.pincode) && 'pincode',
    !saved?.company_name && 'company_name',
    !saved?.license_number && 'license_number',
    !saved?.experience_years && 'experience_years',
    !saved?.about && 'about',
    !listOf(saved?.service_locations).length && 'service_locations',
    !listOf(saved?.services_offered).length && 'services_offered',
  ].filter(Boolean)
}

// The account's pincode and post office are still the ones saved (by the PIN
// code step or an earlier profile save): nothing to choose again, so the post
// office list is not offered. Changing the pincode or location offers it again.
export function savedPincodeLocationKept(current, saved) {
  const pincode = String(current?.pincode || '').trim()
  const location = String(current?.location || '').trim()
  return Boolean(pincode) && Boolean(location)
    && pincode === String(saved?.pincode || '').trim()
    && location === String(saved?.location || '').trim()
}

export function estimateStorageKey(userId) {
  return `crewnbuild_owner_estimates_${userId || 'guest'}`
}

export function saveOwnerEstimate(userId, profileDetails) {
  let savedEstimates
  try {
    savedEstimates = JSON.parse(localStorage.getItem(estimateStorageKey(userId)) || '[]')
  } catch {
    savedEstimates = []
  }
  const nextEstimate = {
    id: `local-${Date.now()}`,
    source: 'Draft',
    owner_id: userId || null,
    owner_email: profileDetails.owner_email || '',
    phone: profileDetails.phone || '',
    address: profileDetails.address || '',
    pincode: profileDetails.pincode || '',
    project_title: profileDetails.project_title || 'Untitled estimate',
    start_timeline: profileDetails.start_timeline || '',
    project_description: profileDetails.project_description || '',
    building_type: profileDetails.building_type || 'RESIDENTIAL',
    construction_type: profileDetails.construction_type || 'CONTRACTOR',
    budget: profileDetails.budget === '' ? 0 : Number(profileDetails.budget || 0),
    land_area: profileDetails.land_area === '' ? 0 : Number(profileDetails.land_area || 0),
    floors: profileDetails.floors === '' ? 1 : Number(profileDetails.floors || 1),
    created_at: new Date().toISOString(),
  }
  localStorage.setItem(estimateStorageKey(userId), JSON.stringify([nextEstimate, ...savedEstimates]))
}