// The company's public support line. The backend's GET /support/config answers with
// SUPPORT_PHONE, or this same number (DEFAULT_SUPPORT_PHONE) when it is not configured;
// pages that cannot wait for that answer (or when it fails) show this.
export const SUPPORT_PHONE = '+91 628 1921 628'

export const phoneHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`
