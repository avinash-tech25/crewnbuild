import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../../shared/auth/useAuth.js'
import { ADMIN_ROLES, SIGNED_IN_ROLES } from '../../../shared/auth/roles.js'
import { dashboardPath, postAuthPath, subscriptionCheckoutPending } from '../../../shared/auth/accountPaths.js'
import FullPageLoader from '../../../shared/ui/FullPageLoader.jsx'

/** Where an account's own home is: its dashboard, or /admin for an administrator. */
export function homeFor(user) {
  return ADMIN_ROLES.includes(user?.role) ? '/admin' : dashboardPath(user)
}

/**
 * The access rule of a route (technical-architecture.md 8.2), decided from the session the
 * server has just confirmed, never from stored data:
 *
 *   'public'                    anyone
 *   'guest'                     signed-out visitors; a signed-in account goes home
 *   { roles, checkout }         a signed-in account whose role (accessRole: OWNER, BUILDER,
 *                               SITE_ENGINEER, ENGINEER, STORE_MANAGER, SUPPLIER, admin roles)
 *                               is listed; `checkout` sends a builder whose paid sign-up is
 *                               unpaid to the checkout first
 *
 * While the server is still confirming the session a protected route shows only a loader,
 * so no private page flashes. A signed-out visitor goes to /login and comes back after
 * signing in (returnTo); an account of another role goes to its own home, as before.
 */
export default function RequireAccess({ access, children }) {
  const { status, user, role } = useAuth()
  const location = useLocation()

  if (access === 'public') return children
  if (status === 'checking') return <FullPageLoader />
  if (access === 'guest') return status === 'authenticated' ? <Navigate to={homeFor(user)} replace /> : children
  if (status !== 'authenticated' || !SIGNED_IN_ROLES.includes(user?.role)) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" state={{ returnTo }} replace />
  }
  if (!access.roles.includes(role)) return <Navigate to={homeFor(user)} replace />
  if (access.checkout && subscriptionCheckoutPending(user)) return <Navigate to={postAuthPath(user)} replace />
  return children
}
