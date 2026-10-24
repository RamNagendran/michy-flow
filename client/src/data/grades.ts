/**
 * Grades A, B and C, mirrored from server/app/models/grades.py.
 *
 * - A: physical, through the plant. Tyres bought for production; products made and sold.
 * - B: physical, re-sold as bought. Tyres bought and sold on without processing.
 * - C: invoice / financial record only. No goods move; kept in a separate book stock.
 */

import type { Grade, StockSection } from '../types/entries'
import { companyItems, materials, stockedItems, type CatalogItem } from './catalog'

export type TradeKind = 'purchase' | 'sale'

export interface GradeInfo {
  id: Grade
  name: string
  /** A few words, for tags and filters. */
  short: string
  purchase: string
  sale: string
  fg: string
  bg: string
}

export const GRADES: GradeInfo[] = [
  { id: 'A', name: 'Grade A', short: 'Through the plant', purchase: 'Raw material for production', sale: 'Products made in the plant', fg: '#1f7a4d', bg: '#e8f6ef' },
  { id: 'B', name: 'Grade B', short: 'Re-sell', purchase: 'Raw material bought to re-sell as it is', sale: 'Raw material re-sold without processing', fg: '#2F6FEB', bg: '#eef4fb' },
  { id: 'C', name: 'Grade C', short: 'Invoice only', purchase: 'Financial record only — no goods move', sale: 'Credit sale or adjustment — no goods move', fg: '#8a5300', bg: '#fdf3e1' },
]

const byId = new Map(GRADES.map((g) => [g.id, g]))
export const gradeInfo = (g: Grade) => byId.get(g)!

type Configured = Parameters<typeof companyItems>[0]

/** What a purchase or sale of this grade may carry in this company. */
export function itemsFor(kind: TradeKind, grade: Grade, company: Configured): CatalogItem<string>[] {
  if (grade === 'C') return stockedItems
  const p = companyItems(company)
  return kind === 'sale' && grade === 'A' ? p.products : p.inputs
}

export const itemAllowed = (kind: TradeKind, grade: Grade, company: Configured, item: string | undefined) => !!item && itemsFor(kind, grade, company).some((i) => i.id === item)

/** Selling a product means it was made here (A); selling raw material is a re-sell (B). */
export const defaultSaleGrade = (item: string | undefined): Grade => (item && materials.some((m) => m.id === item) ? 'B' : 'A')

/** Which stock a purchase or sale of this grade moves. */
export const stockSection = (kind: TradeKind, grade: Grade): StockSection => (grade === 'B' ? 'resale' : grade === 'C' ? 'books' : kind === 'purchase' ? 'raw' : 'output')
