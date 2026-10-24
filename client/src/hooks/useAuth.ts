import { useAppSelector } from '../statemanager/hooks'
import { endSession } from '../services/session'

export function useAuth() {
  const { accessToken, user } = useAppSelector((s) => s.auth)
  return {
    user,
    globalRole: user?.global_role ?? null,
    isAuthenticated: !!accessToken,
    mustChangePassword: !!user?.must_change_password,
    logout: endSession,
  }
}
