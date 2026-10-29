import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Grade } from '../../types/entries'
import type { Bucket, OilKpi, OilPoint, PriceHistory, ProductionReport, TradeAnalysis, TradeBill, TradeGrade, TradeItem, TradeItemPeriod, TradeParty, TradePartyPeriod, TradePeriod, TradeSide, TradeTotals, TrendPoint } from '../../types/reports'
import { bucketFor } from '../../utils/period'

type Range = [string, string]
const STALE = 60_000 // reports change only when entries do; the realtime layer invalidates them

const params = ([from, to]: Range, bucket: Bucket) => ({ date_from: from, date_to: to, bucket })

/** Adds up per-company series period by period (one map pass, linear in the number of points). */
function mergeSeries<T extends { period: string }>(lists: T[][], add: (a: T, b: T) => T): T[] {
  const acc = new Map<string, T>()
  for (const p of lists.flat()) {
    const cur = acc.get(p.period)
    acc.set(p.period, cur ? add(cur, p) : p)
  }
  return [...acc.values()].sort((a, b) => a.period.localeCompare(b.period))
}

const addTrend = (a: TrendPoint, b: TrendPoint): TrendPoint => {
  const processed = a.processed_kg + b.processed_kg
  const wastage = a.wastage_kg + b.wastage_kg
  return {
    period: a.period,
    purchase_amount: a.purchase_amount + b.purchase_amount,
    purchase_kg: a.purchase_kg + b.purchase_kg,
    sales_amount: a.sales_amount + b.sales_amount,
    sales_kg: a.sales_kg + b.sales_kg,
    sales_l: a.sales_l + b.sales_l,
    processed_kg: processed,
    output_kg: a.output_kg + b.output_kg,
    wastage_kg: wastage,
    wastage_pct: processed ? (wastage / processed) * 100 : 0,
  }
}

/** Trends for each company, and all of them added together. Grouping defaults to one that fits the range. */
export function useTrends(companyIds: number[], range: Range, groupBy?: Bucket) {
  const bucket = groupBy ?? bucketFor(range)
  return useQueries({
    queries: companyIds.map((id) => ({
      queryKey: ['trends', id, range, bucket],
      queryFn: async () => (await api.get<TrendPoint[]>(API_ROUTES.reports.trends(id), { params: params(range, bucket) })).data,
      staleTime: STALE,
      placeholderData: keepPreviousData,
    })),
    combine: (results) => ({
      bucket,
      series: mergeSeries(results.flatMap((r) => (r.data ? [r.data] : [])), addTrend),
      isLoading: results.some((r) => r.isLoading),
      // Old figures still showing while a new period loads.
      isRefreshing: results.some((r) => r.isPlaceholderData),
    }),
  })
}

const addOil = (a: OilPoint, b: OilPoint): OilPoint => {
  const processed = a.processed_kg + b.processed_kg
  const kg = a.oil_kg + b.oil_kg
  return { period: a.period, oil_l: a.oil_l + b.oil_l, oil_kg: kg, processed_kg: processed, pct: processed ? (kg / processed) * 100 : 0 }
}

/** Oil KPI for the companies that make oil, added together by weight. */
export function useOilKpi(companyIds: number[], range: Range) {
  const bucket = bucketFor(range)
  return useQueries({
    queries: companyIds.map((id) => ({
      queryKey: ['oil-kpi', id, range, bucket],
      queryFn: async () => (await api.get<OilKpi>(API_ROUTES.reports.oilKpi(id), { params: params(range, bucket) })).data,
      staleTime: STALE,
      placeholderData: keepPreviousData,
    })),
    combine: (results) => {
      const list = results.flatMap((r) => (r.data?.applicable ? [r.data] : []))
      const isLoading = results.some((r) => r.isLoading)
      const isRefreshing = results.some((r) => r.isPlaceholderData)
      if (!list.length) return { kpi: null, isLoading, isRefreshing }
      const oil_kg = list.reduce((s, k) => s + k.oil_kg, 0)
      const processed_kg = list.reduce((s, k) => s + k.processed_kg, 0)
      const pct = processed_kg ? (oil_kg / processed_kg) * 100 : 0
      const { green_at, red_below } = list[0]
      const kpi: OilKpi = {
        applicable: true,
        oil_l: list.reduce((s, k) => s + k.oil_l, 0),
        oil_kg,
        processed_kg,
        pct,
        status: !processed_kg ? 'none' : pct >= green_at ? 'green' : pct < red_below ? 'red' : 'amber',
        green_at,
        red_below,
        series: mergeSeries(list.map((k) => k.series), addOil),
      }
      return { kpi, isLoading, isRefreshing }
    },
  })
}

export function usePrices(companyId: number | undefined, item: string | undefined, range: Range) {
  const bucket = bucketFor(range, true)
  return useQuery({
    queryKey: ['prices', companyId, item, range, bucket],
    queryFn: async () => (await api.get<PriceHistory>(API_ROUTES.reports.prices(companyId!), { params: { ...params(range, bucket), item } })).data,
    enabled: !!companyId && !!item,
    staleTime: STALE,
    placeholderData: keepPreviousData,
  })
}

export function useProductionReport(companyId: number | undefined, range: Range) {
  return useQuery({
    queryKey: ['production-report', companyId, range],
    queryFn: async () => (await api.get<ProductionReport>(API_ROUTES.reports.production(companyId!), { params: { date_from: range[0], date_to: range[1] } })).data,
    enabled: !!companyId,
    staleTime: STALE,
    placeholderData: keepPreviousData,
  })
}

// ---------------------------------------------------------------------------
// Trade analysis: purchases or sales, per period, item, party and grade
// ---------------------------------------------------------------------------

export interface TradeFilters {
  side: TradeSide
  range: Range
  bucket: Bucket
  item?: string
  grades: Grade[]
  /** Only for one company: parties belong to one company. */
  partyIds?: number[]
}

/** A supplier or buyer, matched across companies by GST number (else by name). */
export type PartyRow = TradeParty & { key: string; companies: number[] }
export type PartyPeriodRow = TradePartyPeriod & { key: string }
export type BillRow = TradeBill & { key: string; company_id: number }

export interface TradeView {
  side: TradeSide
  item: string | null
  unit: TradeAnalysis['unit']
  bucket: Bucket
  totals: TradeTotals
  previous: TradeTotals
  previous_from: string
  previous_to: string
  series: TradePeriod[]
  items: TradeItem[]
  itemSeries: TradeItemPeriod[]
  parties: PartyRow[]
  partySeries: PartyPeriodRow[]
  grades: TradeGrade[]
  bills: BillRow[]
  billsTruncated: boolean
}

/** Weighted average rate of a row: amount ÷ quantity. */
export const avgRate = (amount: number, qty: number) => (qty ? amount / qty : null)

const minOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b))
const maxOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b))
const addTotals = (a: TradeTotals, b: TradeTotals): TradeTotals => ({ bills: a.bills + b.bills, qty_kg: a.qty_kg + b.qty_kg, qty_l: a.qty_l + b.qty_l, amount: a.amount + b.amount, parties: a.parties + b.parties })

/** Adds rows that share a key: sums add up, the rate range widens. */
function mergeBy<T extends { bills: number; amount: number }>(rows: T[], keyOf: (r: T) => string, add: (a: T, b: T) => Partial<T>): T[] {
  const acc = new Map<string, T>()
  for (const r of rows) {
    const k = keyOf(r)
    const cur = acc.get(k)
    acc.set(k, cur ? { ...cur, bills: cur.bills + r.bills, amount: cur.amount + r.amount, ...add(cur, r) } : r)
  }
  return [...acc.values()]
}

const partyKey = (p: Pick<TradeParty, 'gstin' | 'name'>) => (p.gstin ? `g:${p.gstin}` : `n:${p.name.trim().toLowerCase()}`)

function combineTrade(list: { companyId: number; data: TradeAnalysis }[]): TradeView | null {
  if (!list.length) return null
  const first = list[0].data
  // party id → key, per company (ids are only unique within a company).
  const keys = new Map<string, string>()
  for (const { companyId, data } of list) for (const p of data.parties) keys.set(`${companyId}:${p.party_id}`, partyKey(p))
  const keyFor = (companyId: number, partyId: number) => keys.get(`${companyId}:${partyId}`) ?? `${companyId}:${partyId}`

  const parties = mergeBy(
    list.flatMap(({ companyId, data }) => data.parties.map((p) => ({ ...p, key: partyKey(p), companies: [companyId] }))),
    (p) => p.key,
    (a, b) => ({
      qty_kg: a.qty_kg + b.qty_kg,
      qty_l: a.qty_l + b.qty_l,
      min_rate: minOf(a.min_rate, b.min_rate),
      max_rate: maxOf(a.max_rate, b.max_rate),
      // The latest bill wins.
      last_rate: b.last_date > a.last_date ? b.last_rate : a.last_rate,
      first_date: b.first_date < a.first_date ? b.first_date : a.first_date,
      last_date: b.last_date > a.last_date ? b.last_date : a.last_date,
      companies: [...a.companies, ...b.companies],
    }),
  ).sort((a, b) => b.amount - a.amount)

  const itemAdd = (a: TradeItem, b: TradeItem) => ({ qty: a.qty + b.qty, min_rate: Math.min(a.min_rate, b.min_rate), max_rate: Math.max(a.max_rate, b.max_rate) })
  return {
    side: first.side,
    item: first.item,
    unit: first.unit,
    bucket: first.bucket,
    totals: { ...list.map((l) => l.data.totals).reduce(addTotals), parties: parties.length },
    previous: list.map((l) => l.data.previous).reduce(addTotals),
    previous_from: first.previous_from,
    previous_to: first.previous_to,
    series: mergeBy(
      list.flatMap((l) => l.data.series),
      (p) => p.period,
      (a, b) => ({ qty_kg: a.qty_kg + b.qty_kg, qty_l: a.qty_l + b.qty_l }),
    ).sort((a, b) => a.period.localeCompare(b.period)),
    items: mergeBy(list.flatMap((l) => l.data.items), (i) => i.item, itemAdd).sort((a, b) => b.amount - a.amount),
    itemSeries: mergeBy(list.flatMap((l) => l.data.item_series), (i) => `${i.period}|${i.item}`, itemAdd).sort((a, b) => a.period.localeCompare(b.period)),
    partySeries: mergeBy(
      list.flatMap(({ companyId, data }) => data.party_series.map((p) => ({ ...p, key: keyFor(companyId, p.party_id) }))),
      (p) => `${p.period}|${p.key}`,
      (a, b) => ({ qty: a.qty + b.qty, qty_kg: a.qty_kg + b.qty_kg, qty_l: a.qty_l + b.qty_l, min_rate: minOf(a.min_rate, b.min_rate), max_rate: maxOf(a.max_rate, b.max_rate) }),
    ).sort((a, b) => a.period.localeCompare(b.period)),
    parties,
    grades: mergeBy(
      list.flatMap((l) => l.data.grades),
      (g) => g.grade,
      (a, b) => ({ qty_kg: a.qty_kg + b.qty_kg, qty_l: a.qty_l + b.qty_l }),
    ),
    bills: list
      .flatMap(({ companyId, data }) => data.bills.map((b) => ({ ...b, company_id: companyId, key: keyFor(companyId, b.party_id) })))
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
    billsTruncated: list.some((l) => l.data.bills_truncated),
  }
}

/** Purchases or sales analysed for each company, and all of them added together. */
export function useTradeAnalysis(companyIds: number[], f: TradeFilters) {
  return useQueries({
    queries: companyIds.map((id) => ({
      queryKey: ['trade-analysis', id, f.side, f.range, f.bucket, f.item ?? null, f.grades, f.partyIds ?? []],
      queryFn: async () =>
        (
          await api.get<TradeAnalysis>(API_ROUTES.reports.tradeAnalysis(id), {
            params: { ...params(f.range, f.bucket), side: f.side, item: f.item, grade: f.grades, party_id: f.partyIds },
            // Lists as repeated keys (grade=A&grade=B), the way FastAPI reads them.
            paramsSerializer: { indexes: null },
          })
        ).data,
      staleTime: STALE,
      placeholderData: keepPreviousData,
    })),
    combine: (results) => ({
      view: combineTrade(results.flatMap((r, i) => (r.data ? [{ companyId: companyIds[i], data: r.data }] : []))),
      isLoading: results.some((r) => r.isLoading),
      isRefreshing: results.some((r) => r.isPlaceholderData),
      isError: results.some((r) => r.isError),
    }),
  })
}
