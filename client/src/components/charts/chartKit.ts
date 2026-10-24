import { brand } from '../../styles/theme'
import type { Bucket } from '../../types/reports'
import { periodLabel } from '../../utils/period'

/** One palette for every report, so a colour always means the same thing. */
export const reportColors = {
  purchase: '#2F6FEB',
  sales: brand.primary,
  processed: '#5B6270',
  output: '#1F9D6B',
  wastage: '#D98A0B',
  danger: '#D4380D',
  oil: '#C2410C',
  average: '#191919',
  grid: '#EEF0F3',
}

/** A fixed set for supplier lines, picked to stay apart from each other and from the average. */
export const supplierColors = ['#2F6FEB', '#0F9D8A', '#7A5AF8', '#C2410C', '#B8860B', '#DB2777', '#0EA5E9', '#5E8C31']

export const axisTick = { fill: '#8A919E', fontSize: 12, fontWeight: 600 }
export const axisProps = { axisLine: false, tickLine: false, tick: axisTick } as const
export const gridProps = { stroke: reportColors.grid, vertical: false } as const
/** Long enough to read as motion, short enough not to slow anyone down. */
export const ANIMATION_MS = 450

export const xTick = (bucket: Bucket) => (v: string) => periodLabel(v, bucket)

/** ₹12.4L style for axes, where space is tight. */
export function shortMoney(v: number) {
  const a = Math.abs(v)
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}k`
  return `₹${v.toFixed(0)}`
}

/** 12.4t / 840kg for weight axes. */
export const shortKg = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}t` : `${v.toFixed(0)}kg`)
