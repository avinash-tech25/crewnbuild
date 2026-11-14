/**
 * "Verified Professional" is derived, never stored: it is true only when a
 * reviewer has marked BOTH existing identity checks VERIFIED. A submission still
 * pending review (PENDING / PENDING_VERIFICATION) is not verified, whatever
 * REQUIRE_VERIFIED_IDENTITY_FOR_JOBS allows for receiving jobs.
 */
export function isVerifiedProfessional(user) {
  const onboarding = user?.onboarding
  return onboarding?.face_status === 'VERIFIED' && onboarding?.aadhaar_status === 'VERIFIED'
}

/**
 * The "You're verified" screen is shown once per account, per browser: the first
 * time the dashboard sees the account verified. Remembering that it was seen is a
 * convenience only -- nothing about verification is stored or decided here -- so
 * a browser that refuses storage simply shows it once per visit instead.
 */
const SEEN_PREFIX = 'partner_verified_seen:'

export function verifiedSuccessSeen(userId, storage = globalThis.localStorage) {
  if (!userId) return true
  try {
    return storage?.getItem(SEEN_PREFIX + userId) === '1'
  } catch {
    return false
  }
}

export function markVerifiedSuccessSeen(userId, storage = globalThis.localStorage) {
  if (!userId) return
  try {
    storage?.setItem(SEEN_PREFIX + userId, '1')
  } catch {
    /* storage refused: shown again next visit, nothing else depends on it */
  }
}

/** Whether to show the success screen now. */
export function shouldShowVerifiedSuccess(user, storage) {
  return isVerifiedProfessional(user) && !verifiedSuccessSeen(user?.id, storage)
}
