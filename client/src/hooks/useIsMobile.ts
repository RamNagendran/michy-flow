import { useSyncExternalStore } from 'react'

/** Phone width. Keep in step with the 767px media queries in styles/global.css. */
const QUERY = '(max-width: 767px)'

const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** True on a phone (or a very narrow window). Updates when the screen turns or the window resizes. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches)
}
