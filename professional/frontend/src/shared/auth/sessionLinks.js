import { useMemo } from 'react'
import { useSelector } from 'react-redux'
import { ADMIN_ROLES } from './roles.js'
import { accountSettingsPath, dashboardPath, postSignupPath } from './accountPaths.js'

/**
 * Where a signed-in account's own links lead, from the account the server confirmed
 * (`state.auth.user` is only set once the session check has answered; nothing is read
 * from browser storage here).
 *
 *   home       "Go to dashboard": the role's dashboard, or the step it has not finished
 *              (category, PIN code, builder checkout), the same rule as after sign-in
 *   dashboard  the role's dashboard itself
 *   profile    the role's profile settings; none for an administrator
 *
 * The routes' own guards still decide what each address shows.
 */
export function accountLinks(user) {
  if (!user?.id) return null
  const admin = ADMIN_ROLES.includes(user.role)
  return {
    home: admin ? '/admin' : postSignupPath(user),
    dashboard: admin ? '/admin' : dashboardPath(user),
    profile: admin ? null : accountSettingsPath(user),
  }
}

/** The signed-in account and its links, or `{ user: null, links: null }` when signed out. */
export function useAccountLinks() {
  const user = useSelector((state) => state.auth.user)
  const links = useMemo(() => accountLinks(user), [user])
  return { user, links }
}
