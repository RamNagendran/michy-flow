// Mirrors server/app/schemas/analytics.py and wastage.py

import type { Unit } from '../data/catalog'

export type Bucket = 'day' | 'week' | 'month'

export interface TrendPoint {
  period: string
  purchase_amount: number
  purchase_kg: number
  sales_amount: number
  sales_kg: number
  sales_l: number
  processed_kg: number
  output_kg: number
  wastage_kg: number
  wastage_pct: number
}

export interface OilPoint {
  period: string
  oil_l: number
  oil_kg: number
  processed_kg: number
  pct: number
}

export type OilStatus = 'green' | 'amber' | 'red' | 'none'

export interface OilKpi {
  applicable: boolean
  oil_l: number
  oil_kg: number
  processed_kg: number
  pct: number
  status: OilStatus
  green_at: number
  red_below: number
  series: OilPoint[]
}

export interface SupplierPrice {
  supplier_id: number
  name: string
  bills: number
  qty: number
  amount: number
  avg_rate: number
  min_rate: number
  max_rate: number
  last_rate: number
  last_date: string
  /** vs the overall average: negative is cheaper. */
  diff_pct: number
  /** (average − theirs) × quantity: positive means they cost less. */
  saving: number
  roi_pct: number
}

export interface PricePoint {
  period: string
  avg_rate: number | null
  qty: number
  suppliers: Record<string, number>
}

export interface PriceHistory {
  item: string
  unit: Unit
  avg_rate: number | null
  min_rate: number | null
  max_rate: number | null
  qty: number
  amount: number
  suppliers: SupplierPrice[]
  series: PricePoint[]
}

export interface ShiftRow {
  shift: number | null
  runs: number
  hours: number
  processed_kg: number
  output_kg: number
  wastage_kg: number
  kg_per_hour: number | null
  efficiency_pct: number | null
}

export interface OperatorRow {
  user_id: number
  name: string
  runs: number
  hours: number
  processed_kg: number
  kg_per_hour: number | null
}

export interface ProductionReport {
  shift_hours: number
  by_shift: ShiftRow[]
  by_operator: OperatorRow[]
}

export interface WastageMonth {
  month: string
  allowance_pct: number
  declared: boolean
  runs: number
  processed_kg: number
  output_kg: number
  wastage_kg: number
  wastage_pct: number
  over_allowance: boolean
  flagged_runs: number
  high_runs: number
  notes_missing: number
}

export interface Allowance {
  month: string
  pct: number
  note: string
  declared_by_name: string | null
  updated_at: string
}

export interface PendingDebitNote {
  production_id: number
  ref_no: string
  entry_date: string
  material: string
  processed_kg: number
  wastage_kg: number
  wastage_pct: number
  status: string
}

export type CountSection = 'raw' | 'output' | 'resale'

export interface CountLine {
  section: CountSection
  grade: string
  item: string
  unit: Unit
  book_qty: number
  counted_qty: number
  difference: number
}

export interface StockCheck {
  id: number
  counted_on: string
  note: string
  counted_by_name: string | null
  created_at: string
  lines: CountLine[]
}

export interface DebitNoteInput {
  note_no: string
  supplier_id?: number
  qty_kg: number
  amount: number
  reason: string
}
