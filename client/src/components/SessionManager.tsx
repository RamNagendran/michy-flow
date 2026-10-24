import { useEffect } from 'react'
import { useMe } from '../hooks/queries/auth'
import { useAuth } from '../hooks/useAuth'
import { useIdleLogout } from '../hooks/useIdleLogout'
import { useRealtime } from '../hooks/useRealtime'
import { endSession, LOGOUT_SIGNAL_KEY } from '../services/session'
import { useAppDispatch } from '../statemanager/hooks'
import { userLoaded } from '../statemanager/slices/authSlice'
import { config } from '../utils/config'

/** Keeps the session healthy: refreshes the user from /auth/me, idle logout, sign-out across tabs, and live updates. */
export default function SessionManager() {
  const { isAuthenticated, mustChangePassword } = useAuth()
  const dispatch = useAppDispatch()
  const { data: me } = useMe()

  useEffect(() => {
    if (me) dispatch(userLoaded(me))
  }, [me, dispatch])

  useIdleLogout(config.idleLogoutMinutes, isAuthenticated)
  useRealtime(isAuthenticated && !mustChangePassword)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOGOUT_SIGNAL_KEY && e.newValue) endSession({ broadcast: false })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return null
}
