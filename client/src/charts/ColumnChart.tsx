import { buildCategoryChart, specKey, type CategoryChartSpec } from './core/categoryChart'
import { useAmChart } from './core/useAmChart'

export type ColumnChartProps = Omit<CategoryChartSpec, 'horizontal' | 'stacked' | 'percent'> & { height?: number }

/**
 * Vertical columns: one series, or several side by side (clustered).
 * Use for comparing amounts across a handful of categories or periods.
 * Too many columns for the card → an amCharts scrollbar under the chart.
 */
export default function ColumnChart({ height = 220, ...spec }: ColumnChartProps) {
  const ref = useAmChart((root) => buildCategoryChart(root, spec), specKey(spec))
  return <div ref={ref} className="viz-canvas" style={{ height }} />
}
