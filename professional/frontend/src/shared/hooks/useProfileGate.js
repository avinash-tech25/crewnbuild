/**
 * The profile-completion gate.
 *
 * Signing up no longer forces anyone through Complete Profile. Instead the few
 * actions that genuinely need profile data — sending or accepting a request,
 * creating a project, applying for work — ask for it at the moment they are
 * used, and the action resumes by itself once the profile is saved.
 *
 * Usage in a dashboard:
 *
 *   const { requireCompleteProfile } = useProfileGate()
 *
 *   const sendRequest = async (payload) => {
 *     if (requireCompleteProfile('sendRequest', payload)) return
 *     …the existing body, unchanged…
 *   }
 *
 *   useResumeGatedAction({ sendRequest })
 *
 * `requireCompleteProfile` returns true when it has taken over — the caller
 * simply returns. The stored action is replayed on the dashboard the user came
 * from, so nothing has to be repeated by hand.
 */
import { useEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'

const PENDING_ACTION_KEY = 'crewnbuild_pending_profile_action'

export function profileIsIncomplete(user) {
  // Only an explicit false counts. A user object that predates this field must
  // not be treated as incomplete and pushed into the form for no reason.
  return Boolean(user) && user.profile_complete === false
}

function writePendingAction(action) {
  try {
    window.sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(action))
  } catch {
    /* private mode: the action is not resumed, the user simply retries */
  }
}

/** Reads and clears in one step, so an action can never replay twice. */
function takePendingAction() {
  try {
    const stored = window.sessionStorage.getItem(PENDING_ACTION_KEY)
    window.sessionStorage.removeItem(PENDING_ACTION_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function useProfileGate() {
  const user = useSelector((state) => state.auth.user)
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * Returns true when the user was sent to Complete Profile instead, which is
   * the caller's signal to stop. `name` must match a handler key passed to
   * useResumeGatedAction on the same dashboard.
   */
  const requireCompleteProfile = (name, payload) => {
    if (!profileIsIncomplete(user)) return false
    writePendingAction({ name, payload, returnTo: location.pathname + location.search })
    navigate('/complete-profile', {
      state: { returnTo: location.pathname + location.search },
    })
    return true
  }

  return { requireCompleteProfile, profileComplete: !profileIsIncomplete(user) }
}

function peekPendingAction() {
  try {
    const stored = window.sessionStorage.getItem(PENDING_ACTION_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

// The cart's gated actions. A page that only shows the cart behind a tab opens
// that tab when one of these is waiting, so the cart can resume it.
export const CART_GATED_ACTIONS = ['buyFromSupplier', 'buyWholeCart']

/** Whether the action waiting to be resumed is one of `names` (nothing is consumed). */
export function pendingActionIs(names) {
  const pending = peekPendingAction()
  return Boolean(pending && names.includes(pending.name))
}

/**
 * Replays the action the user was in the middle of when the profile was asked
 * for. Runs once, only after the profile is actually complete, and consumes the
 * stored action either way so a stale one cannot fire on a later visit.
 *
 * Several components on one page may each register their own actions (the
 * dashboard, a project's Site Engineer section, the cart). Each one only takes
 * an action it has a handler for, so the first to mount can no longer swallow
 * another's. The payload is replayed exactly as it was stored — it carries its
 * own project id and recipient — so nothing is rebuilt from page state that
 * may not have loaded yet.
 */
export function useResumeGatedAction(handlers) {
  const user = useSelector((state) => state.auth.user)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const resumed = useRef(false)

  useEffect(() => {
    if (resumed.current || !user) return
    const peeked = peekPendingAction()
    if (!peeked || typeof handlersRef.current?.[peeked.name] !== 'function') return
    resumed.current = true
    const pending = takePendingAction()
    // Still incomplete means the form was abandoned rather than saved; drop the
    // action rather than replaying it into an error.
    if (!pending || profileIsIncomplete(user)) return
    const handler = handlersRef.current?.[pending.name]
    if (typeof handler === 'function') handler(pending.payload)
  }, [user])
}
