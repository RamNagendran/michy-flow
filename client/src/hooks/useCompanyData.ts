import { useMemo } from 'react'
import { combineStock, useStocks, useSummaries } from './queries/stock'
import { useAccess } from './useAccess'
import { usePeriod } from './usePeriod'

/**
 * Stock and period totals for the companies in view, per company and added together.
 * Totals cover only companies where the person may see everyone's entries (not operators).
 */
export function useCompanyData() {
  const { scope, can } = useAccess()
  const { period, range } = usePeriod()

  const withTotals = useMemo(() => scope.filter((c) => can('view_all_entries', c.id)), [scope, can])
  const stocks = useStocks(scope)
  const summaries = useSummaries(withTotals, range)
  const all = [...stocks.byCompany.values()]
  return {
    scope,
    period,
    range,
    stocks: stocks.byCompany,
    raw: combineStock(all, 'raw'),
    output: combineStock(all, 'output'),
    resale: combineStock(all, 'resale'),
    books: combineStock(all, 'books'),
    summaries: summaries.byCompany,
    total: summaries.total,
    isLoading: stocks.isLoading || summaries.isLoading,
  }
}
