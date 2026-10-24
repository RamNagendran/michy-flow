import { useEffect } from 'react'
import { endSession } from '../services/session'

/** Shared by all tabs, so activity in any tab keeps every tab signed in. */
const ACTIVITY_KEY = 'michy-flow:last-activity'
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const
const WRITE_EVERY_MS = 5_000
const CHECK_EVERY_MS = 30_000

const readActivity = () => {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0
  } catch {
    return 0
  }
}

/** Record activity now. Call on sign-in so a stale timestamp from an old session doesn't log out the new one. */
export function markActivity(at = Date.now()) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at))
  } catch {
    /* storage unavailable: idle timeout then only tracks this tab */
  }
}

/** Signs out after `minutes` without activity in any tab. */
export function useIdleLogout(minutes: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !(minutes > 0)) return
    const limit = minutes * 60_000
    let last = readActivity()
    let lastWrite = 0

    const check = () => {
      if (Date.now() - Math.max(last, readActivity()) >= limit) endSession()
    }
    // Browser reopened after a long gap: sign out before anything else happens.
    if (last && Date.now() - last >= limit) {
      endSession()
      return
    }

    const onActivity = () => {
      last = Date.now()
      if (last - lastWrite > WRITE_EVERY_MS) {
        lastWrite = last
        markActivity(last)
      }
    }
    onActivity()

    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', check)
      window.clearInterval(timer)
    }
  }, [minutes, enabled])
}
