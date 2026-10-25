import { useLayoutEffect, useRef } from 'react'
import type * as am5 from '@amcharts/amcharts5'
import { createRoot } from './root'

/**
 * Mounts an amCharts root in the returned div and builds the chart with `build`.
 * The chart is rebuilt whenever `key` changes (pass a string made from the data and options),
 * and disposed on unmount, so no canvases or listeners leak between renders.
 */
export function useAmChart(build: (root: am5.Root) => void, key: string) {
  const ref = useRef<HTMLDivElement>(null)
  const buildRef = useRef(build)
  useLayoutEffect(() => {
    buildRef.current = build
  })
  useLayoutEffect(() => {
    if (!ref.current) return
    const root = createRoot(ref.current)
    buildRef.current(root)
    return () => root.dispose()
  }, [key])
  return ref
}
