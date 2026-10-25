// Mirrors server/app/schemas/document.py

import type { Grade } from './entries'

export interface ParsedValue<T = string | number> {
  value: T
  /** 0–100: how sure the reader is. */
  confidence: number
  /** qr = from the signed e-invoice QR · label = next to a printed label · pattern / arithmetic = worked out. */
  source: 'qr' | 'label' | 'pattern' | 'arithmetic'
}

export interface ParsedBill {
  party_name: ParsedValue<string> | null
  invoice_no: ParsedValue<string> | null
  invoice_date: ParsedValue<string> | null
  item: ParsedValue<string> | null
  item_text: string | null
  /** Suggested grade for a sales bill: B when it is for tyres, A for products. */
  grade: Grade | null
  hsn: string | null
  qty_on_bill: ParsedValue<number> | null
  /** As printed on the bill. */
  unit_on_bill: 'KG' | 'MT' | 'L' | 'KL' | null
  /** What qty and rate are in. */
  unit: 'kg' | 'L' | null
  qty: ParsedValue<number> | null
  rate_on_bill: ParsedValue<number> | null
  /** Per kg or per litre. */
  rate: ParsedValue<number> | null
  taxable_amount: ParsedValue<number> | null
  tax_amount: ParsedValue<number> | null
  total: ParsedValue<number> | null
  einvoice: boolean
  warnings: string[]
}

export interface BillDocument {
  id: number
  company_id: number
  kind: 'purchase' | 'sale'
  filename: string
  content_type: 'application/pdf' | 'image/png' | 'image/jpeg'
  size_bytes: number
  pages: number
  method: 'pdf_text' | 'ocr' | 'none'
  created_at: string
  parsed: ParsedBill
  lines: string[]
  /** The supplier / buyer in this company whose name matches the one read from the bill. */
  party_id: number | null
  /** Set when this exact file is already the bill of a live entry. */
  duplicate_of: string | null
}

/** What a person confirms on the review screen or types in by hand, before it is saved. */
export interface EntryDraft {
  companyId: number
  partyId: number
  invoiceNo: string
  date: string
  grade: Grade
  item: string
  /** In the item's unit: kg, or litres for oil. */
  qty: number
  rate: number
  documentId?: number
}
