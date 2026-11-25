import { useEffect, useState } from 'react'
import { readPhoneVerificationConfig } from '../auth/phoneCodeApi.js'

/**
 * Whether the Mobile number section (PhoneChangeSection) is on screen for this account:
 * the API has the WhatsApp check on, and the account is Indian (the check only reaches
 * Indian numbers). null until the API has answered; a failed answer reads as not shown.
 */
export function usePhoneChangeShown(user) {
  const [enabled, setEnabled] = useState(null)
  useEffect(() => {
    let active = true
    readPhoneVerificationConfig()
      .then((config) => { if (active) setEnabled(config?.enabled === true) })
      .catch(() => { if (active) setEnabled(false) })
    return () => { active = false }
  }, [])
  const india = !user?.country_of_residence || user.country_of_residence === 'India'
  return india ? enabled : false
}
