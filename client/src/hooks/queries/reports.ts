import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Bucket, OilKpi, OilPoint, PriceHistory, ProductionReport, TrendPoint } from '../../types/reports'
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

/** Trends for each company, and all of them added together. */
export function useTrends(companyIds: number[], range: Range) {
  const bucket = bucketFor(range)
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
