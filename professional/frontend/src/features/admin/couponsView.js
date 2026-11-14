/**
 * The coupon screen's decisions, kept free of React so they can be tested.
 *
 * The API answers in more than one error shape: a plain string, a list of field
 * errors (422) or `{code, message}` (the subscription routes, e.g. a 503 when the
 * database has no subscription tables). Rendering anything but a string as a
 * React child unmounts the whole console, so every shape is turned into text.
 */

export function messageOf(detail, fallback) {
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    const text = detail.map((item) => (typeof item === 'string' ? item : item?.msg)).filter(Boolean).join('; ')
    return text || fallback
  }
  if (detail && typeof detail.message === 'string' && detail.message) return detail.message
  return fallback
}

// Which of the four states the list is in. An error wins over stale data.
export function couponViewState({ data, error, loading }) {
  if (error) return 'error'
  if (!data) return loading ? 'loading' : 'empty'
  return Array.isArray(data.coupons) && data.coupons.length ? 'list' : 'empty'
}

// The server's rule (app/subscription/coupons.py CODE_PATTERN / normalize_code):
// spaces removed, upper-cased, then 3-40 of A-Z, 0-9, '-' or '_', starting with A-Z or 0-9.
export const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/
export const COUPON_CODE_MESSAGE = 'Use 3 to 40 characters: capital letters A-Z, digits 0-9, hyphen (-) or underscore (_), starting with a letter or digit.'
export const normalizeCouponCode = (raw) => String(raw ?? '').replace(/\s+/g, '').toUpperCase()
export const couponCodeError = (code) => (COUPON_CODE_PATTERN.test(normalizeCouponCode(code)) ? '' : COUPON_CODE_MESSAGE)

const hasPermission =(identity, permission) => Array.isArray(identity?.permissions) && identity.permissions.includes(permission)

// Display only: the server decides with the same permissions.
export const canViewCoupons = (identity) => hasPermission(identity, 'coupons.view')
export const canManageCoupons = (identity) => hasPermission(identity, 'coupons.manage')
