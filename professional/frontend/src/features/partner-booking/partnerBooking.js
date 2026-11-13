import { requestPartnerHandoffToken } from '../auth/authApi.js'
import { PERMISSIONS, hasPermission } from '../../shared/auth/roles.js'

/**
 * Book Technician: opens the separate Partner application and hands it a one-time token
 * (technical-architecture.md 6.3 step 6, FE-08). Partner's side lives in
 * partner/frontend (booking) and uses the same two message names, which must not change.
 */

// Partner's address comes from configuration only; without it the button reports that
// booking is not configured instead of guessing an address.
const PARTNER_URL = String(import.meta.env.VITE_PARTNER_URL || '').trim().replace(/\/+$/, '')

export const HANDOFF_READY = 'PARTNER_BOOKING_READY'
export const HANDOFF_TOKEN = 'OCTABUILD_HOUSE_OWNER_HANDOFF'

export function partnerOrigin() {
  try {
    return new URL(PARTNER_URL).origin
  } catch {
    return ''
  }
}

export const partnerBookingConfigured = Boolean(PARTNER_URL && partnerOrigin())

/**
 * Whether this account may book a Partner technician: a House Owner or a Site Engineer
 * (permission handoff:create, as the server decides). Other engineers do not see the
 * button any more; the server always refused their hand-off.
 */
export function canBookPartner(user) {
  return hasPermission(user, PERMISSIONS.HANDOFF_CREATE)
}

let partnerWindow = null
let bookingUser = null
let listening = false

// Answers only the Partner window this tab opened, only from Partner's exact origin, and
// sends the one-time token to that origin alone; it never appears in a URL. One token per
// window: a second request from the same window gets nothing.
let answeredWindow = null

function answerPartnerHandoff(event) {
  if (!partnerWindow || event.source !== partnerWindow) return
  if (event.origin !== partnerOrigin()) return
  if (event.data?.type !== HANDOFF_READY) return
  if (answeredWindow === partnerWindow) return
  if (!canBookPartner(bookingUser)) return
  answeredWindow = partnerWindow
  requestPartnerHandoffToken().then((handoffToken) => {
    if (!handoffToken || !partnerWindow || partnerWindow.closed) return
    partnerWindow.postMessage({ type: HANDOFF_TOKEN, handoffToken }, partnerOrigin())
  })
}

// Partner's own trade pages (/book-technician/<slug>), for a link straight to one.
const PARTNER_TRADE_SLUGS = ['plumber', 'carpenter', 'electrician', 'painter']

/**
 * Opens Partner's technician selection page, or one trade's page when `trade` is one of
 * Partner's four slugs, for the signed-in `user`. Returns false when it could not.
 */
export function openPartnerBooking(trade = null, user = null) {
  if (!partnerBookingConfigured || !canBookPartner(user)) return false
  bookingUser = user
  if (!listening) {
    window.addEventListener('message', answerPartnerHandoff)
    listening = true
  }
  // Opened synchronously inside the click so pop-up blockers allow it. The opener reference
  // is kept on purpose: it is how Partner asks for the hand-off.
  const path = PARTNER_TRADE_SLUGS.includes(trade) ? `/book-technician/${trade}` : '/book-technician'
  partnerWindow = window.open(`${PARTNER_URL}${path}`, 'crewnbuild-partner-booking')
  partnerWindow?.focus()
  return Boolean(partnerWindow)
}
