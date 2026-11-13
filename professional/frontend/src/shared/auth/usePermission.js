import { useAuth } from './useAuth.js'
import { hasPermission } from './roles.js'

/**
 * Whether the signed-in account's role may take this kind of action (section 7.2). For
 * hiding what a role cannot do (FE-03); the server still decides every request.
 */
export function usePermission(permission) {
  const { status, user } = useAuth()
  return status === 'authenticated' && hasPermission(user, permission)
}
