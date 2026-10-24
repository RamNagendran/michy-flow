import { queryClient } from '../lib/queryClient'
import { loggedOut } from '../statemanager/slices/authSlice'
import { store } from '../statemanager/store'

/** localStorage key other tabs watch, so signing out in one tab signs out all of them. */
export const LOGOUT_SIGNAL_KEY = 'michy-flow:logout'

/** Clears the session and all cached server data. Route guards then send the user to /login. */
export function endSession({ broadcast = true }: { broadcast?: boolean } = {}) {
  store.dispatch(loggedOut())
  queryClient.clear()
  if (broadcast) {
    try {
      localStorage.setItem(LOGOUT_SIGNAL_KEY, String(Date.now()))
    } catch {
      /* storage unavailable: only this tab signs out */
    }
  }
}
