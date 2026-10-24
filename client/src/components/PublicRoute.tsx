import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { homePath } from '../utils/navigation'

/** For /login and /signup: signed-in users are sent into the app instead. */
export default function PublicRoute() {
  const { isAuthenticated, user } = useAuth()
  if (isAuthenticated) return <Navigate to={homePath(user)} replace />
  return <Outlet />
}
