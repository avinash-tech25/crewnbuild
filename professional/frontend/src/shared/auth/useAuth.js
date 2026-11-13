import { useSelector } from 'react-redux'
import { accessRole } from './roles.js'

// The status names of technical-architecture.md 8.1, from the slice's sessionStatus.
const STATUS = { verifying: 'checking', verified: 'authenticated', anonymous: 'anonymous', unreachable: 'unreachable' }

/**
 * Who is signed in: { status, user, role }. `status` is checking while the server is still
 * confirming the session (render a loader, nothing private), then authenticated or
 * anonymous; unreachable when the server never answered. `role` is the role the screens
 * act on (an engineer's category role, see roles.js).
 */
export function useAuth() {
  const { user, sessionStatus } = useSelector((state) => state.auth)
  return { status: STATUS[sessionStatus] || 'checking', user, role: accessRole(user) }
}
