// Mirrors server/app/schemas/analytics.py and wastage.py

import type { Unit } from '../data/catalog'

export type Bucket = 'day' | 'week' | 'month' | 'year'

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

/** open: month still running · pending: with the Super Admin · escalated: with the Manager · approved: final, month locked */
export type WastageStatus = 'open' | 'pending' | 'escalated' | 'approved'

/** How a changed month moves one raw material's stock. Positive qty is taken out of stock. */
export interface StockShare {
  item: string
  processed_kg: number
  share_pct: number
  qty: number
  stock_now: number | null
  stock_after: number | null
}

export interface WastageMonth {
  month: string
  status: WastageStatus
  runs: number
  processed_kg: number
  output_kg: number
  /** What the production entries add up to (2% of each run's output). */
  calculated_kg: number
  /** The month's figure: the Super Admin's own if they changed it. */
  wastage_kg: number
  wastage_pct: number
  changed: boolean
  adjustments: StockShare[]
  escalated_at: string | null
  approved_by_name: string | null
  approved_at: string | null
  updated_at: string | null
}

export type WastageAction = 'approve' | 'change' | 'escalate' | 'resend' | 'comment'

export interface WastageEvent {
  id: number
  action: 'sent' | 'escalated' | 'resent' | 'commented' | 'changed' | 'approved'
  comment: string
  changes: { wastage_kg?: string | [string, string]; production_kg?: string; stock_kg?: Record<string, string> } | null
  actor_name: string | null
  created_at: string
}

export interface WastageMonthDetail extends WastageMonth {
  actions: WastageAction[]
  events: WastageEvent[]
}

export interface WastageQueue {
  company_id: number
  to_approve: number
  escalated: number
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

// Trade analysis (purchases or sales). Rows hold sums and the lowest / highest single rate;
// an average rate is always amount ÷ quantity, so companies can be added together.

export type TradeSide = 'purchase' | 'sale'

export interface TradeTotals {
  bills: number
  qty_kg: number
  qty_l: number
  amount: number
  parties: number
}

export interface TradePeriod {
  period: string
  bills: number
  qty_kg: number
  qty_l: number
  amount: number
}

export interface TradeItem {
  item: string
  unit: Unit
  bills: number
  /** In the item's own unit. */
  qty: number
  amount: number
  min_rate: number
  max_rate: number
}

export interface TradeItemPeriod extends TradeItem {
  period: string
}

export interface TradeParty {
  party_id: number
  name: string
  gstin: string | null
  city: string
  bills: number
  qty_kg: number
  qty_l: number
  amount: number
  /** Only with one item chosen. */
  min_rate: number | null
  max_rate: number | null
  last_rate: number | null
  first_date: string
  last_date: string
}

export interface TradePartyPeriod {
  period: string
  party_id: number
  bills: number
  qty: number
  qty_kg: number
  qty_l: number
  amount: number
  min_rate: number | null
  max_rate: number | null
}

export interface TradeGrade {
  grade: 'A' | 'B' | 'C'
  bills: number
  qty_kg: number
  qty_l: number
  amount: number
}

export interface TradeBill {
  entry_date: string
  party_id: number
  ref_no: string
  qty: number
  rate: number
  amount: number
}

export interface TradeAnalysis {
  side: TradeSide
  item: string | null
  unit: Unit | null
  date_from: string
  date_to: string
  bucket: Bucket
  totals: TradeTotals
  previous: TradeTotals
  previous_from: string
  previous_to: string
  series: TradePeriod[]
  items: TradeItem[]
  item_series: TradeItemPeriod[]
  parties: TradeParty[]
  party_series: TradePartyPeriod[]
  grades: TradeGrade[]
  bills: TradeBill[]
  bills_truncated: boolean
}
