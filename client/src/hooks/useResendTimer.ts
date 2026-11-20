import { useEffect, useState } from 'react'

/** Countdown for a "Resend code" button. start(seconds) begins it; waitSeconds is 0 when sending is allowed again. */
export function useResendTimer() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  // Ticks once a second while waiting.
  useEffect(() => {
    if (until <= now) return
    const t = setTimeout(() => setNow(Date.now()), 1000)
    return () => clearTimeout(t)
  }, [until, now])

  const start = (seconds: number) => {
    setNow(Date.now())
    setUntil(Date.now() + seconds * 1000)
  }
  return { waitSeconds: Math.max(0, Math.ceil((until - now) / 1000)), start }
}
