// Mirrors server/app/schemas/entries.py, party.py and stock.py

import type { Unit } from '../data/catalog'

export type EntryType = 'purchase' | 'sale' | 'production'
export type EntryStatus = 'pending' | 'approved' | 'change_requested' | 'verified' | 'rejected'
export type EntrySource = 'manual' | 'ai'
/** approve / request_change: Manager · verify: Finance · reject: Super Admin. */
export type EntryAction = 'approve' | 'request_change' | 'verify' | 'reject'
/** Who an open escalation is waiting on: the in-charge (Manager asked) or the Manager (Finance asked). */
export type EscalatedTo = 'incharge' | 'manager'
export type PartyKind = 'supplier' | 'buyer'
/** A: through the plant · B: re-sold as bought · C: invoice only (see data/grades.ts). */
export type Grade = 'A' | 'B' | 'C'

export interface EntryRow {
  type: EntryType
  id: number
  company_id: number
  company_code: string
  company_name: string
  ref_no: string
  entry_date: string
  status: EntryStatus
  /** Always A for production. */
  grade: Grade
  /** An open escalation (see escalated_to). */
  escalated: boolean
  escalated_to: EscalatedTo | null
  party_name: string | null
  item: string
  /** In `unit`; the input weight for production. */
  qty: number
  unit: Unit
  rate: number | null
  amount: number | null
  invoice_no: string | null
  output_kg: number | null
  wastage_pct: number | null
  source: EntrySource
  created_by_name: string | null
  created_at: string
}

export interface EntryEvent {
  id: number
  action: string
  comment: string
  changes: Record<string, unknown> | null
  actor_name: string | null
  created_at: string
}

export interface CrewMember {
  id: number
  name: string
}

export interface DebitNote {
  id: number
  note_no: string
  supplier_id: number | null
  supplier_name: string | null
  qty_kg: number
  amount: number
  reason: string
  created_by_name: string | null
  created_at: string
}

export interface StatusCount {
  status: EntryStatus
  count: number
  amount: number
}

export interface EntryDetail {
  type: EntryType
  id: number
  company_id: number
  ref_no: string
  entry_date: string
  status: EntryStatus
  grade: Grade
  escalated_at: string | null
  escalated_to: EscalatedTo | null
  notes: string
  created_by_name: string | null
  approved_by_name: string | null
  approved_at: string | null
  verified_by_name: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
  /** Buttons the caller may press: approve, request_change, verify, reject, escalate, comment, edit. */
  actions: string[]
  events: EntryEvent[]
  party_id: number | null
  party_name: string | null
  item: string
  qty: number
  unit: Unit
  /** Per unit. */
  rate: number | null
  amount: number | null
  invoice_no: string | null
  source: EntrySource
  document_id: number | null
  shift: number | null
  /** Production: put back into stock unprocessed. */
  returned_kg: number | null
  processed_kg: number | null
  /** Products + 2%, worked out on save: what stock went down by. Null on runs saved before this rule. */
  calculated_input_kg: number | null
  output_kg: number | null
  wastage_kg: number | null
  wastage_pct: number | null
  /** Over the month's declared allowance. */
  wastage_flagged: boolean
  wastage_allowance_pct: number | null
  /** Over the hard limit: a high alert, and it cannot be approved without a debit note. */
  debit_note_required: boolean
  debit_note: DebitNote | null
  crew: CrewMember[]
  running_hours: number | null
  efficiency_pct: number | null
  kg_per_hour: number | null
  /** qty is in the product's unit; qty_kg is its weight. */
  outputs: { product: string; qty: number; unit: Unit; qty_kg: number }[]
}

interface EntryBody {
  entry_date: string
  notes?: string
}

export interface PurchaseBody extends EntryBody {
  supplier_id: number
  grade: Grade
  material: string
  qty: number
  rate: number
  invoice_no: string
  source?: EntrySource
  document_id?: number
}

export interface SaleBody extends EntryBody {
  buyer_id: number
  grade: Grade
  product: string
  qty: number
  rate: number
  invoice_no: string
  source?: EntrySource
  document_id?: number
}

export interface ProductionBody extends EntryBody {
  material: string
  /** A total bigger than products + 2%, used only to work out the wastage. Not saved. */
  wastage_on_kg: number | null
  /** Put back into stock after the run; stock goes down by products + 2% minus this. */
  returned_kg: number
  shift: number | null
  crew_ids: number[]
  running_hours: number | null
  /** qty in the product's unit: litres for oil. */
  outputs: { product: string; qty: number }[]
}

export type EntryBodyFor = { purchase: PurchaseBody; sale: SaleBody; production: ProductionBody }

export interface EntryQuery {
  type?: EntryType[]
  status?: EntryStatus[]
  grade?: Grade[]
  company_id?: number[]
  date_from?: string
  date_to?: string
  item?: string
  q?: string
  escalated?: boolean
  escalated_to?: EscalatedTo
  party_id?: number
  page?: number
  page_size?: number
}

export interface Party {
  id: number
  company_id: number
  kind: PartyKind
  name: string
  city: string
  contact_name: string
  phone: string
  is_active: boolean
}

export type PartyInput = Omit<Party, 'id' | 'company_id'>

/** In the line's unit: kg, or litres for oil. */
export interface StockFigures {
  in_qty: number
  out_qty: number
  balance: number
}

export interface StockLine {
  item: string
  grade: Grade
  unit: Unit
  /** The Manager's stock-check differences (book − counted), already in out / balance. */
  counted_adjustment: number
  /** Every live entry, including ones waiting for approval. */
  provisional: StockFigures
  /** Only entries Finance has verified. */
  confirmed: StockFigures
}

/** Stock per grade. The grades never mix. */
export interface CompanyStock {
  company_id: number
  /** Grade A raw material: in by Grade A purchases, out into production. */
  raw: StockLine[]
  /** Grade A products: in from production, out by Grade A sales. */
  output: StockLine[]
  /** Grade B raw material: bought and re-sold as they are. */
  resale: StockLine[]
  /** Grade C book stock: invoices only, no goods move. */
  books: StockLine[]
  check_every_months: number
  last_check_on: string | null
  next_check_due: string
  check_overdue: boolean
}

export type StockSection = 'raw' | 'output' | 'resale' | 'books'

export interface ItemTotal {
  item: string
  unit: Unit
  qty: number
  amount: number
}

export interface GradeTotal {
  grade: Grade
  count: number
  /** Items measured in kg. */
  qty_kg: number
  /** Items measured in litres (oil). */
  qty_l: number
  amount: number
}

export interface MoneyTotals {
  count: number
  qty_kg: number
  qty_l: number
  amount: number
  verified_amount: number
  by_item: ItemTotal[]
  /** Always A, B and C, in that order. */
  by_grade: GradeTotal[]
}

export interface ProductionTotals {
  count: number
  input_kg: number
  returned_kg: number
  processed_kg: number
  output_kg: number
  wastage_kg: number
  flagged_count: number
  by_item: ItemTotal[]
}

export interface QueueCounts {
  pending: number
  approved: number
  /** The Manager asked the Super Admin to edit or reject. */
  change_requested: number
  /** The Manager is waiting on an in-charge. */
  escalated_to_incharge: number
  /** Finance is waiting on the Manager. */
  escalated_to_manager: number
  debit_notes_due: number
}

export interface CompanySummary {
  company_id: number
  date_from: string
  date_to: string
  purchases: MoneyTotals
  production: ProductionTotals
  sales: MoneyTotals
  queue: QueueCounts
}
