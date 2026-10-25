import { GRADES } from '../../data/grades'
import { seriesColors } from '../../styles/theme'

/**
 * Chart ink and colours. Every categorical set below was checked with the dataviz palette
 * validator (CVD separation, normal-vision floor, contrast) in the order it is drawn.
 * Change a colour here only after re-running that check.
 */
export const ink = {
  primary: '#191919',
  secondary: '#5B6270',
  muted: '#8A919E',
  grid: '#EEF0F3',
  border: '#E8EAEE',
  surface: '#FFFFFF',
}

/** What each money / material flow is drawn in, everywhere. */
export const flowColors = {
  purchase: '#2F6FEB',
  sales: '#D82E54',
  output: '#1F9D6B',
  wastage: '#D98A0B',
  oil: '#C2410C',
  good: '#1F9D6B',
  critical: '#D4380D',
}

/**
 * Products in a fixed drawing order. Any subset keeps passing the validator in this order
 * (crumb: rubber · fibre · steel; pyrolysis: carbon · oil · steel · waste water).
 */
export const PRODUCT_ORDER = ['rubber', 'carbon', 'oil', 'other', 'steel', 'waste_water'] as const

export const productColor = (id: string) => seriesColors[id as keyof typeof seriesColors] ?? ink.muted

export const gradeColor = Object.fromEntries(GRADES.map((g) => [g.id, g.fg])) as Record<'A' | 'B' | 'C', string>

/** Entry kinds, for operator charts. Validated as a set: blue · amber · green. */
export const entryTypeColor = { purchase: '#2F6FEB', production: '#B8860B', sale: '#1baf7a' } as const

/** Single-hue blue ramp for magnitude (heatmaps): near-zero recedes toward the surface. */
export const sequentialBlue = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#104281']
