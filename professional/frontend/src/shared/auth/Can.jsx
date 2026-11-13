import { useAuth } from './useAuth.js'
import { usePermission } from './usePermission.js'

/**
 * Renders its children only for an account that may do the thing: a permission
 * (<Can permission="handoff:create">) or one of some roles (<Can roles={['OWNER']}>).
 * A user never sees a button or link for an action their role cannot take.
 */
export default function Can({ permission, roles, children, fallback = null }) {
  const { status, role } = useAuth()
  const permitted = usePermission(permission)
  if (status !== 'authenticated') return fallback
  if (permission && !permitted) return fallback
  if (roles && !roles.includes(role)) return fallback
  return children
}
