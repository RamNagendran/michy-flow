import { useQueries } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Company } from '../../types/auth'
import type { CompanyStock, CompanySummary, GradeTotal, ItemTotal, MoneyTotals, StockLine, StockSection } from '../../types/entries'

/** Stock for each company, as a map by company id. One request per company, cached separately. */
export function useStocks(companies: Pick<Company, 'id'>[]) {
  return useQueries({
    queries: companies.map((c) => ({
      queryKey: ['stock', c.id],
      queryFn: async () => (await api.get<CompanyStock>(API_ROUTES.stock(c.id))).data,
    })),
    combine: (results) => ({
      byCompany: new Map(results.flatMap((r) => (r.data ? [[r.data.company_id, r.data] as const] : []))),
      isLoading: results.some((r) => r.isLoading),
    }),
  })
}

/** Period summary for each company plus the companies added together. */
export function useSummaries(companies: Pick<Company, 'id'>[], [from, to]: [string, string], enabled = true) {
  return useQueries({
    queries: companies.map((c) => ({
      queryKey: ['summary', c.id, from, to],
      queryFn: async () => (await api.get<CompanySummary>(API_ROUTES.summary(c.id), { params: { date_from: from, date_to: to } })).data,
      enabled,
    })),
    combine: (results) => {
      const list = results.flatMap((r) => (r.data ? [r.data] : []))
      return {
        byCompany: new Map(list.map((s) => [s.company_id, s])),
        total: list.length ? combineSummaries(list) : null,
        isLoading: results.some((r) => r.isLoading),
      }
    },
  })
}

function mergeItems(lists: ItemTotal[][]): ItemTotal[] {
  const acc = new Map<string, ItemTotal>()
  for (const t of lists.flat()) {
    const cur = acc.get(t.item)
    acc.set(t.item, cur ? { ...cur, qty: cur.qty + t.qty, amount: cur.amount + t.amount } : t)
  }
  return [...acc.values()]
}

/** Grade totals added up by position: the server always sends A, B and C in that order. */
const mergeGrades = (lists: GradeTotal[][]): GradeTotal[] =>
  lists.reduce((acc, list) => acc.map((g, i) => ({ ...g, count: g.count + list[i].count, qty_kg: g.qty_kg + list[i].qty_kg, qty_l: g.qty_l + list[i].qty_l, amount: g.amount + list[i].amount })))

const sumMoney = (list: MoneyTotals[]): MoneyTotals => ({
  count: list.reduce((s, m) => s + m.count, 0),
  qty_kg: list.reduce((s, m) => s + m.qty_kg, 0),
  qty_l: list.reduce((s, m) => s + m.qty_l, 0),
  amount: list.reduce((s, m) => s + m.amount, 0),
  verified_amount: list.reduce((s, m) => s + m.verified_amount, 0),
  by_item: mergeItems(list.map((m) => m.by_item)),
  by_grade: mergeGrades(list.map((m) => m.by_grade)),
})

export function combineSummaries(list: CompanySummary[]): CompanySummary {
  const sum = (f: (s: CompanySummary) => number) => list.reduce((acc, s) => acc + f(s), 0)
  return {
    company_id: 0,
    date_from: list[0].date_from,
    date_to: list[0].date_to,
    purchases: sumMoney(list.map((s) => s.purchases)),
    sales: sumMoney(list.map((s) => s.sales)),
    production: {
      count: sum((s) => s.production.count),
      input_kg: sum((s) => s.production.input_kg),
      returned_kg: sum((s) => s.production.returned_kg),
      processed_kg: sum((s) => s.production.processed_kg),
      output_kg: sum((s) => s.production.output_kg),
      wastage_kg: sum((s) => s.production.wastage_kg),
      flagged_count: sum((s) => s.production.flagged_count),
      by_item: mergeItems(list.map((s) => s.production.by_item)),
    },
    queue: {
      pending: sum((s) => s.queue.pending),
      approved: sum((s) => s.queue.approved),
      on_hold: sum((s) => s.queue.on_hold),
      escalated: sum((s) => s.queue.escalated),
      debit_notes_due: sum((s) => s.queue.debit_notes_due),
    },
  }
}

/** Stock lines added up across companies, item by item. */
export function combineStock(stocks: CompanyStock[], kind: StockSection): StockLine[] {
  const acc = new Map<string, StockLine>()
  const add = (a: StockLine['provisional'], b: StockLine['provisional']) => ({
    in_qty: a.in_qty + b.in_qty,
    out_qty: a.out_qty + b.out_qty,
    balance: a.balance + b.balance,
  })
  for (const line of stocks.flatMap((s) => s[kind])) {
    const cur = acc.get(line.item)
    acc.set(line.item, cur ? { ...cur, provisional: add(cur.provisional, line.provisional), confirmed: add(cur.confirmed, line.confirmed) } : line)
  }
  return [...acc.values()]
}
