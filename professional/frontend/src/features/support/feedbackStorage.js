// Feedback sent from the support menu is kept in this browser (as in the old app) and holds
// the sender's name, e-mail and phone. It is forgotten on sign-out, so the next person on
// a shared computer does not find it.
export const FEEDBACK_STORAGE_KEY = 'crewnbuild_feedback'
const OLD_FEEDBACK_STORAGE_KEY = 'octabuild_feedback'

export function forgetSavedFeedback() {
  try {
    window.localStorage.removeItem(FEEDBACK_STORAGE_KEY)
    window.localStorage.removeItem(OLD_FEEDBACK_STORAGE_KEY)
  } catch {
    /* storage unavailable: nothing was kept */
  }
}
