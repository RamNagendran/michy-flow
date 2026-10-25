import type { AuthUser } from '../types/auth'

/**
 * Where a person lands after signing in. People who must replace a temporary password go there
 * first; anyone who can see more than one company picks one on the welcome screen.
 */
export function homePath(user: AuthUser | null) {
  if (!user) return '/login'
  if (user.must_change_password) return '/change-password'
  return user.companies.length > 1 ? '/welcome' : '/'
}
