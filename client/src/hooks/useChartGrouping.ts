import { useState } from 'react'
import type { Bucket } from '../types/reports'
import { bucketFor, bucketsFor } from '../utils/period'
import { usePeriod } from './usePeriod'

/**
 * The dashboard's chart grouping (Daily … Yearly). One choice for the whole dashboard: the
 * buying and selling analysis and the production charts below it both follow it. Dates come
 * from the period picked in the top bar; a grouping that no longer fits falls back to the automatic one.
 */
export function useChartGrouping() {
  const { range } = usePeriod()
  const [picked, setBucket] = useState<Bucket | null>(null)
  const allowed = bucketsFor(range)
  const bucket = picked && allowed.includes(picked) ? picked : bucketFor(range)
  return { bucket, allowed, picked: !!picked, setBucket, reset: () => setBucket(null) }
}

export type ChartGrouping = ReturnType<typeof useChartGrouping>
