// The company's public support line (the same number the Professional backend's
// SUPPORT_PHONE defaults to).
export const SUPPORT_PHONE = '+91 628 1921 628'

export const phoneHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`
