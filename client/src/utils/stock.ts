import type { StockLine } from '../types/entries'

/** Lines worth showing: anything with stock now or any movement at all. */
export const activeLines = (lines: StockLine[]) => lines.filter((l) => l.provisional.in_qty || l.provisional.out_qty || l.confirmed.balance)

/** Total across lines in one unit (kg by default): everything recorded, or only what Finance verified. */
export const totalOf = (lines: StockLine[], which: 'provisional' | 'confirmed' = 'provisional', unit: 'kg' | 'L' = 'kg') =>
  lines.reduce((s, l) => (l.unit === unit ? s + l[which].balance : s), 0)
