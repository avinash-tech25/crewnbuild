import { useAuth } from '../../shared/auth/useAuth.js'
import { canBookPartner, openPartnerBooking, partnerBookingConfigured } from './partnerBooking.js'

/**
 * The Book Technician button's state for the signed-in account: whether to show it at all
 * (only for a role that may book), whether Partner is configured, and the click handler.
 */
export function usePartnerBooking() {
  const { user } = useAuth()
  return {
    canBook: canBookPartner(user),
    configured: partnerBookingConfigured,
    open: (trade = null) => openPartnerBooking(trade, user),
  }
}
