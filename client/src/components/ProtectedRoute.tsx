import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAccess } from '../hooks/useAccess'
import { useAuth } from '../hooks/useAuth'
import type { CompanyPermission, GlobalRole, SystemPermission } from '../types/auth'

interface Props {
  /** Allowed when the person holds at least one of these in some company. */
  anyOf?: readonly CompanyPermission[]
  /** Allowed only with this system permission (Super Admin). */
  system?: SystemPermission
  /** Allowed only for these global roles. */
  globalRoles?: readonly GlobalRole[]
  children?: ReactNode
}

/**
 * Requires a signed-in user, plus any of the checks given. Renders `children`, or the nested routes.
 * This only hides screens; the API enforces the same rules on every request.
 */
export default function ProtectedRoute({ anyOf, system, globalRoles, children }: Props) {
  const { isAuthenticated, mustChangePassword, globalRole } = useAuth()
  const access = useAccess()
  const location = useLocation()
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (mustChangePassword) return <Navigate to="/change-password" replace />
  const allowed =
    (!anyOf || access.canAnywhere(...anyOf)) &&
    (!system || access.canSystem(system)) &&
    (!globalRoles || (!!globalRole && globalRoles.includes(globalRole)))
  if (!allowed) return <Navigate to="/" replace />
  return children ?? <Outlet />
}
